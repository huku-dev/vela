#!/usr/bin/env python3
"""
Re-run key backtests using PROD_ACTUAL config (fixed 8% stop, no grace period).
This matches what production actually runs, not the V9_ATR_2_0X config.

Tests:
  A) PROD_ACTUAL baseline (fixed 8% stop, no grace, immediate)
  B) V9_ATR_2_0X (ATR stop, grace period) — for comparison
  C) PROD + 7d trail delay
  D) PROD + scaling-in (pullback recovery, winners only, 1 add, 50% size)
  E) PROD + 7d trail + scaling-in (V10 candidate)

Also runs bear market isolation (Oct 15 2025 — Mar 2026) for A, C, E.
"""
import sys, time, copy
import pandas as pd
import numpy as np

sys.path.insert(0, "scripts")
from backtest import (
    PROD_ACTUAL,
    V9_ATR_2_0X,
    fetch_ohlc,
    calculate_indicators,
    generate_signals,
    simulate_trades,
)

POSITION_SIZE = 1000
ASSETS = [
    ("bitcoin", "BTC", True),
    ("ethereum", "ETH", False),
    ("hyperliquid", "HYPE", False),
    ("solana", "SOL", False),
]
DAYS = 730

# ── Helpers ──────────────────────────────────────────────────────────────────

def enrich_trades(trades, df, symbol):
    """Add asset tag and compute exit_bar_index from dates."""
    date_to_idx = {}
    for i in range(len(df)):
        d = str(df.index[i])[:10]
        date_to_idx[d] = i

    for t in trades:
        t["asset"] = symbol
        # Compute exit_bar_index from exit_date if missing
        if t.get("exit_bar_index") is None and t.get("exit_date"):
            t["exit_bar_index"] = date_to_idx.get(str(t["exit_date"])[:10], t.get("entry_bar_index", 0))
        # Ensure entry_bar_index exists
        if t.get("entry_bar_index") is None and t.get("entry_date"):
            t["entry_bar_index"] = date_to_idx.get(str(t["entry_date"])[:10], 0)
    return trades


def run_config(config, all_data, btc_df, position_size=POSITION_SIZE):
    """Run a config across all assets. Returns list of trades with asset tag."""
    all_trades = []
    for cg_id, symbol, is_btc in ASSETS:
        df = all_data[symbol]
        indicators = calculate_indicators(df, config)
        signals = generate_signals(indicators, config)
        trades = simulate_trades(
            signals, position_size, config,
            btc_df=btc_df, is_btc=is_btc
        )
        trades = enrich_trades(trades, df, symbol)
        all_trades.extend(trades)
    return all_trades


def apply_7d_trail(trades, all_data, config, btc_df, position_size=POSITION_SIZE):
    """
    Re-run with trailing stop delayed by 7 days.
    We modify the config to disable trailing stop, run simulation,
    then manually apply trailing stop logic only after day 7.
    """
    cfg = copy.deepcopy(config)
    # Disable built-in trailing stop
    cfg["trailing_stop_short"] = False
    cfg["trailing_stop_long"] = False
    # Keep the activation/trail params for our manual logic
    activation_pct = config.get("trailing_stop_activation_pct", 5.0)
    trail_pct = config.get("trailing_stop_trail_pct", 2.5)

    all_trades = []
    for cg_id, symbol, is_btc in ASSETS:
        df = all_data[symbol]
        indicators = calculate_indicators(df, cfg)
        signals = generate_signals(indicators, cfg)
        raw_trades = simulate_trades(
            signals, position_size, cfg,
            btc_df=btc_df, is_btc=is_btc
        )
        raw_trades = enrich_trades(raw_trades, df, symbol)

        modified_trades = []
        for t in raw_trades:
            entry_idx = t.get("entry_bar_index") or 0
            exit_idx = t.get("exit_bar_index") or entry_idx
            entry_price = t["entry_price"]
            direction = t["direction"]
            hold_bars = exit_idx - entry_idx

            # Only apply trailing stop logic to main trades held > 7 days
            if direction in ("long", "short") and hold_bars > 7:
                # Walk through bars from day 7 to exit, apply trailing stop
                peak_profit_pct = 0.0
                trail_exit = None

                for bar_i in range(entry_idx + 7, exit_idx + 1):
                    if bar_i >= len(df):
                        break
                    bar_price = df.iloc[bar_i]["close"]

                    if direction == "long":
                        current_pct = (bar_price - entry_price) / entry_price * 100
                    else:
                        current_pct = (entry_price - bar_price) / entry_price * 100

                    if current_pct > peak_profit_pct:
                        peak_profit_pct = current_pct

                    # Check trailing stop
                    if peak_profit_pct >= activation_pct:
                        retrace = peak_profit_pct - current_pct
                        if retrace >= trail_pct:
                            # Trailing stop triggered
                            trail_exit = {
                                "bar_index": bar_i,
                                "price": bar_price,
                                "profit_pct": current_pct,
                            }
                            break

                if trail_exit:
                    # Recalculate trade with trailing stop exit
                    t_mod = copy.deepcopy(t)
                    t_mod["exit_price"] = trail_exit["price"]
                    t_mod["exit_date"] = str(df.index[trail_exit["bar_index"]])[:10] if trail_exit["bar_index"] < len(df) else t["exit_date"]
                    t_mod["exit_bar_index"] = trail_exit["bar_index"]

                    remaining = t_mod.get("remaining_pct", 100.0) / 100.0
                    if direction == "long":
                        pnl_pct = (trail_exit["price"] - entry_price) / entry_price * 100
                    else:
                        pnl_pct = (entry_price - trail_exit["price"]) / entry_price * 100
                    t_mod["pnl_pct"] = round(pnl_pct, 2)
                    t_mod["pnl_usd"] = round(remaining * pnl_pct / 100 * position_size, 2)
                    t_mod["exit_reason"] = "trailing_stop_7d"
                    t_mod["asset"] = symbol
                    modified_trades.append(t_mod)
                    continue

            t["asset"] = symbol
            modified_trades.append(t)

        all_trades.extend(modified_trades)
    return all_trades


def apply_scaling_in(trades, all_data, position_size=POSITION_SIZE):
    """
    Apply scaling-in logic to trade list.
    Pullback recovery trigger, winners only, 1 add max, 50% size.
    No RSI trigger.
    """
    PULLBACK_PCT = 3.0
    RECOVERY_PCT = 0.50  # 50% of pullback recovered
    ADD_SIZE_FRAC = 0.50  # 50% of original position

    enhanced_trades = []
    for t in trades:
        t_out = copy.deepcopy(t)
        symbol = t.get("asset", "")
        direction = t.get("direction", "")
        entry_idx = t.get("entry_bar_index", 0)
        exit_idx = t.get("exit_bar_index", entry_idx)
        entry_price = t["entry_price"]
        remaining = t.get("remaining_pct", 100.0) / 100.0

        # Skip BB2 trades and very short trades
        if "bb2" in direction or exit_idx - entry_idx < 3:
            enhanced_trades.append(t_out)
            continue

        if symbol not in all_data:
            enhanced_trades.append(t_out)
            continue

        df = all_data[symbol]
        add_triggered = False
        add_pnl = 0.0

        # Track high watermark for pullback detection
        if direction == "long":
            hwm = entry_price
            for bar_i in range(entry_idx + 1, exit_idx):
                if bar_i >= len(df):
                    break
                bar_price = df.iloc[bar_i]["close"]

                # Check if currently in profit (winners only)
                current_pnl_pct = (bar_price - entry_price) / entry_price * 100
                if current_pnl_pct <= 0:
                    hwm = max(hwm, bar_price)
                    continue

                hwm = max(hwm, bar_price)
                pullback_pct = (hwm - bar_price) / hwm * 100

                if pullback_pct >= PULLBACK_PCT:
                    # Check for recovery in subsequent bars
                    pullback_low = bar_price
                    for rec_i in range(bar_i + 1, exit_idx):
                        if rec_i >= len(df):
                            break
                        rec_price = df.iloc[rec_i]["close"]
                        recovery = (rec_price - pullback_low) / (hwm - pullback_low) if hwm > pullback_low else 0
                        if recovery >= RECOVERY_PCT:
                            # Add triggered at recovery bar
                            add_entry = rec_price
                            # Calculate add P&L to trade exit
                            exit_price = t["exit_price"]
                            add_pnl_pct = (exit_price - add_entry) / add_entry * 100
                            add_pnl = add_pnl_pct / 100 * position_size * ADD_SIZE_FRAC
                            add_triggered = True
                            break
                    break  # Max 1 add attempt

        elif direction == "short":
            lwm = entry_price  # low water mark
            for bar_i in range(entry_idx + 1, exit_idx):
                if bar_i >= len(df):
                    break
                bar_price = df.iloc[bar_i]["close"]

                current_pnl_pct = (entry_price - bar_price) / entry_price * 100
                if current_pnl_pct <= 0:
                    lwm = min(lwm, bar_price)
                    continue

                lwm = min(lwm, bar_price)
                # Pullback for short = price bounced up from low
                pullback_pct = (bar_price - lwm) / lwm * 100

                if pullback_pct >= PULLBACK_PCT:
                    pullback_high = bar_price
                    for rec_i in range(bar_i + 1, exit_idx):
                        if rec_i >= len(df):
                            break
                        rec_price = df.iloc[rec_i]["close"]
                        recovery = (pullback_high - rec_price) / (pullback_high - lwm) if pullback_high > lwm else 0
                        if recovery >= RECOVERY_PCT:
                            add_entry = rec_price
                            exit_price = t["exit_price"]
                            add_pnl_pct = (add_entry - exit_price) / add_entry * 100
                            add_pnl = add_pnl_pct / 100 * position_size * ADD_SIZE_FRAC
                            add_triggered = True
                            break
                    break

        if add_triggered:
            t_out["scaling_in_add"] = True
            t_out["add_pnl_usd"] = round(add_pnl, 2)
            t_out["pnl_usd"] = round(t.get("pnl_usd", 0) + add_pnl, 2)

        enhanced_trades.append(t_out)
    return enhanced_trades


def compute_metrics(trades, label=""):
    """Compute comprehensive metrics for a set of trades."""
    if not trades:
        return {"label": label, "trades": 0}

    pnls = [t.get("pnl_usd", 0) for t in trades]
    pnl_pcts = [t.get("pnl_pct", 0) for t in trades]
    holds = []
    for t in trades:
        entry_i = t.get("entry_bar_index")
        exit_i = t.get("exit_bar_index")
        if entry_i is not None and exit_i is not None:
            holds.append(exit_i - entry_i)
        else:
            # Fallback: compute from dates
            try:
                from datetime import datetime
                ed = str(t.get("entry_date", ""))[:10]
                xd = str(t.get("exit_date", ""))[:10]
                d1 = datetime.strptime(ed, "%Y-%m-%d")
                d2 = datetime.strptime(xd, "%Y-%m-%d")
                holds.append((d2 - d1).days)
            except Exception:
                holds.append(0)

    total_pnl = sum(pnls)
    n = len(trades)
    winners = sum(1 for p in pnls if p > 0)
    win_rate = winners / n * 100 if n > 0 else 0

    # Max drawdown (peak-to-trough of cumulative P&L)
    cum = np.cumsum(pnls)
    peak = np.maximum.accumulate(cum)
    drawdowns = cum - peak
    max_dd = abs(min(drawdowns)) if len(drawdowns) > 0 else 0

    # Longest losing streak
    max_streak = 0
    current_streak = 0
    for p in pnls:
        if p <= 0:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    # Count adds
    adds = sum(1 for t in trades if t.get("scaling_in_add"))
    add_pnl = sum(t.get("add_pnl_usd", 0) for t in trades if t.get("scaling_in_add"))

    return {
        "label": label,
        "trades": n,
        "total_pnl": round(total_pnl, 2),
        "win_rate": round(win_rate, 1),
        "avg_pnl": round(total_pnl / n, 2) if n > 0 else 0,
        "avg_hold": round(np.mean(holds), 1) if holds else 0,
        "max_dd": round(max_dd, 2),
        "worst_trade": round(min(pnls), 2) if pnls else 0,
        "best_trade": round(max(pnls), 2) if pnls else 0,
        "lose_streak": max_streak,
        "adds": adds,
        "add_pnl": round(add_pnl, 2),
    }


def compute_per_asset(trades, label=""):
    """Compute per-asset metrics."""
    by_asset = {}
    for t in trades:
        asset = t.get("asset", "?")
        by_asset.setdefault(asset, []).append(t)

    results = {}
    for asset in ["BTC", "ETH", "HYPE", "SOL"]:
        asset_trades = by_asset.get(asset, [])
        results[asset] = compute_metrics(asset_trades, f"{label} ({asset})")
    return results


def print_comparison(configs_metrics):
    """Print a comparison table."""
    headers = ["Config", "Trades", "P&L", "Win%", "Avg P&L", "Hold", "MaxDD", "Worst", "Best", "LStrk", "Adds", "Add P&L"]
    widths = [38, 6, 9, 6, 8, 6, 9, 8, 8, 5, 4, 8]

    header_line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    print(header_line)
    print("-" * len(header_line))

    for m in configs_metrics:
        vals = [
            m["label"],
            str(m.get("trades", 0)),
            f"${m.get('total_pnl', 0):+,.0f}",
            f"{m.get('win_rate', 0):.1f}%",
            f"${m.get('avg_pnl', 0):+.2f}",
            f"{m.get('avg_hold', 0):.1f}d",
            f"${m.get('max_dd', 0):,.0f}",
            f"${m.get('worst_trade', 0):+,.0f}",
            f"${m.get('best_trade', 0):+,.0f}",
            str(m.get("lose_streak", 0)),
            str(m.get("adds", 0)),
            f"${m.get('add_pnl', 0):+,.0f}",
        ]
        print("  ".join(str(v).ljust(w) for v, w in zip(vals, widths)))


def filter_bear_market(trades, after_date="2025-10-15"):
    """Filter trades to only those entered after a date."""
    return [t for t in trades if str(t.get("entry_date", "")) >= after_date]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 90)
    print("PRODUCTION BASELINE RE-RUN")
    print(f"Period: {DAYS} days | Assets: BTC, ETH, HYPE, SOL | Position: ${POSITION_SIZE}")
    print("=" * 90)
    print()

    # Fetch data
    all_data = {}
    btc_df = None
    for cg_id, symbol, is_btc in ASSETS:
        print(f"Fetching {symbol}...")
        df = fetch_ohlc(cg_id, DAYS)
        all_data[symbol] = df
        if is_btc:
            btc_df = df
        if not is_btc:
            time.sleep(2)
    print()

    # ── Config A: PROD_ACTUAL baseline ──
    print("Running A) PROD_ACTUAL baseline...")
    trades_a = run_config(PROD_ACTUAL, all_data, btc_df)

    # ── Config B: V9_ATR_2_0X (old "baseline") ──
    print("Running B) V9_ATR_2_0X (ATR stop + grace)...")
    trades_b = run_config(V9_ATR_2_0X, all_data, btc_df)

    # ── Config C: PROD + 7d trail delay ──
    print("Running C) PROD + 7d trail delay...")
    trades_c = apply_7d_trail([], all_data, PROD_ACTUAL, btc_df)

    # ── Config D: PROD + scaling-in ──
    print("Running D) PROD + scaling-in...")
    trades_d = run_config(PROD_ACTUAL, all_data, btc_df)
    trades_d = apply_scaling_in(trades_d, all_data)

    # ── Config E: PROD + 7d trail + scaling-in (V10 candidate) ──
    print("Running E) V10 candidate (PROD + 7d trail + scaling-in)...")
    trades_e = apply_7d_trail([], all_data, PROD_ACTUAL, btc_df)
    trades_e = apply_scaling_in(trades_e, all_data)

    print()

    # ── Full period comparison ──
    print("=" * 90)
    print("FULL PERIOD (730 days)")
    print("=" * 90)
    print()

    metrics = [
        compute_metrics(trades_a, "A) PROD_ACTUAL (fixed 8%, no grace)"),
        compute_metrics(trades_b, "B) V9_ATR_2_0X (ATR stop, 5d grace)"),
        compute_metrics(trades_c, "C) PROD + 7d trail delay"),
        compute_metrics(trades_d, "D) PROD + scaling-in"),
        compute_metrics(trades_e, "E) V10: PROD + 7d trail + scaling"),
    ]
    print_comparison(metrics)

    # Delta from PROD baseline
    print()
    print("Delta from PROD_ACTUAL baseline:")
    base_pnl = metrics[0]["total_pnl"]
    for m in metrics[1:]:
        delta = m["total_pnl"] - base_pnl
        print(f"  {m['label']}: {'+' if delta >= 0 else ''}{delta:,.0f}")

    # ── Per-asset breakdown ──
    print()
    print("-" * 90)
    print("PER-ASSET BREAKDOWN (Full Period)")
    print("-" * 90)

    for config_label, trades in [
        ("A) PROD_ACTUAL", trades_a),
        ("B) V9_ATR_2_0X", trades_b),
        ("C) PROD + 7d trail", trades_c),
        ("D) PROD + scaling", trades_d),
        ("E) V10 candidate", trades_e),
    ]:
        print(f"\n  {config_label}:")
        per_asset = compute_per_asset(trades, config_label)
        for asset in ["BTC", "ETH", "HYPE", "SOL"]:
            m = per_asset[asset]
            adds_str = f" [{m['adds']} adds, ${m['add_pnl']:+,.0f}]" if m["adds"] > 0 else ""
            print(f"    {asset}: {m['trades']} trades, ${m['total_pnl']:+,.0f}, "
                  f"{m['win_rate']:.0f}% win, {m['avg_hold']:.1f}d hold, "
                  f"MaxDD ${m['max_dd']:,.0f}{adds_str}")

    # ── Bear market isolation ──
    print()
    print("=" * 90)
    print("BEAR MARKET ISOLATION (Oct 15 2025 — Mar 2026)")
    print("=" * 90)
    print()

    bear_metrics = [
        compute_metrics(filter_bear_market(trades_a), "A) PROD_ACTUAL"),
        compute_metrics(filter_bear_market(trades_c), "C) PROD + 7d trail"),
        compute_metrics(filter_bear_market(trades_e), "E) V10 candidate"),
    ]
    print_comparison(bear_metrics)

    print()
    bear_base = bear_metrics[0]["total_pnl"]
    for m in bear_metrics[1:]:
        delta = m["total_pnl"] - bear_base
        print(f"  {m['label']} vs baseline: {'+' if delta >= 0 else ''}{delta:,.0f}")

    print()
    print("=" * 90)
    print("DONE")
    print("=" * 90)


if __name__ == "__main__":
    main()
