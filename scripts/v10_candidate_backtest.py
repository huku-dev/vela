#!/usr/bin/env python3
"""
V10 Candidate Backtest: Trail After 7d + Scaling-In
=====================================================
Tests whether the time-delayed trailing stop (7d) combined with
pullback-recovery scaling-in produces a superior risk-adjusted result.

Four configs compared:
  A) Baseline V9_ATR_2_0X (production)
  B) Trail after 7d only (no scaling-in)
  C) Scaling-in only (normal trailing stop) — pullback recovery, winners only, 1 add max
  D) V10 Candidate: trail after 7d + scaling-in combined

Metrics per config:
  Total P&L, trade count, win rate, avg P&L per trade, avg hold days,
  max drawdown, longest losing streak, Sharpe-like ratio, worst single trade,
  max capital at risk, number of add triggers.

Interaction analysis: additive vs super-additive.
Per-asset breakdown for all 4 configs.

Usage:
    python3 scripts/v10_candidate_backtest.py
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Import shared infrastructure
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (
    ASSETS_HL,
    V9_ATR_2_0X,
    POSITION_SIZE_USD,
    fetch_ohlc,
    calculate_indicators,
    generate_signals,
    simulate_trades,
)
from scaling_in_backtest import (
    enrich_trades_with_idx,
    find_strengthening_events,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DAYS = 730
TRAIL_DELAY_BARS = 7 * 6  # 7 days at 4h bars = 42 bars

# Scaling-in parameters (pullback recovery only, NO RSI trigger)
SCALE_PRICE_DIP_PCT = 3.0        # Price pullback >= 3% from trade high
SCALE_PRICE_RECOVER = 0.50       # Must recover >= 50% of dip
SCALE_ADD_SIZE_FRACTION = 0.5    # 50% of original position ($500)
SCALE_MAX_ADDS = 1               # Max 1 add per trade
SCALE_ONLY_WINNERS = True        # Only add to trades currently in profit

# ---------------------------------------------------------------------------
# Config builders
# ---------------------------------------------------------------------------


def make_trail_7d_config() -> dict:
    """V9_ATR_2_0X with trailing stop delayed 7 days."""
    return {
        **V9_ATR_2_0X,
        "name": "V9 + Trail after 7d",
        "trailing_stop_delay_bars": TRAIL_DELAY_BARS,
    }


TRAIL_7D_CONFIG = make_trail_7d_config()


# ---------------------------------------------------------------------------
# Scaling-in logic (pullback recovery only, no RSI trigger)
# ---------------------------------------------------------------------------

def apply_scaling_in(df: pd.DataFrame, trades: list[dict]) -> list[dict]:
    """
    Apply pullback-recovery scaling-in to enriched trades.

    Trigger: pullback >= 3% from trade's high watermark, then recovered >= 50%.
    Winners only (position currently in profit at add point).
    Max 1 add per position, 50% of original size.
    NO RSI trigger — pullback_recovery only.

    Returns modified trade list with blended P&L.
    """
    results = []

    for trade in trades:
        entry_idx = trade["entry_idx"]
        exit_idx = trade["exit_idx"]
        direction = trade["direction"]
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"]
        base_pnl_usd = trade["pnl_usd"]

        # Find strengthening events within this trade's duration
        events = find_strengthening_events(
            df, entry_idx, exit_idx, direction,
            rsi_dip_override=999,  # effectively disable RSI trigger
            price_dip_override=SCALE_PRICE_DIP_PCT,
        )

        # Filter to pullback_recovery ONLY (no RSI bounce, no volume spike)
        events = [e for e in events if e["type"] == "pullback_recovery"]

        if not events:
            results.append({
                **trade,
                "add_triggered": False,
                "add_pnl_usd": 0.0,
                "scaled_pnl_usd": base_pnl_usd,
                "add_price": None,
                "blended_entry": entry_price,
                "total_capital": POSITION_SIZE_USD,
            })
            continue

        # Use first event only (max 1 add)
        event = events[0]
        add_price = event["price"]

        # Winners-only gate: position must be in profit at add point
        if SCALE_ONLY_WINNERS:
            if direction == "long":
                unrealized = (add_price - entry_price) / entry_price
            else:
                unrealized = (entry_price - add_price) / entry_price
            if unrealized <= 0:
                results.append({
                    **trade,
                    "add_triggered": False,
                    "add_pnl_usd": 0.0,
                    "scaled_pnl_usd": base_pnl_usd,
                    "add_price": None,
                    "blended_entry": entry_price,
                    "total_capital": POSITION_SIZE_USD,
                })
                continue

        # Skip trimmed trades
        remaining = trade.get("remaining_pct", 100.0)
        if remaining is not None and remaining < 95.0:
            results.append({
                **trade,
                "add_triggered": False,
                "add_pnl_usd": 0.0,
                "scaled_pnl_usd": base_pnl_usd,
                "add_price": None,
                "blended_entry": entry_price,
                "total_capital": POSITION_SIZE_USD,
            })
            continue

        add_size = POSITION_SIZE_USD * SCALE_ADD_SIZE_FRACTION

        # Calculate add P&L
        if direction == "long":
            add_pnl = add_size * (exit_price - add_price) / add_price
        else:
            add_pnl = add_size * (add_price - exit_price) / add_price

        scaled_pnl_usd = base_pnl_usd + add_pnl
        total_capital = POSITION_SIZE_USD + add_size

        # Blended entry price
        blended_entry = (POSITION_SIZE_USD * entry_price + add_size * add_price) / total_capital

        results.append({
            **trade,
            "add_triggered": True,
            "add_pnl_usd": add_pnl,
            "scaled_pnl_usd": scaled_pnl_usd,
            "add_price": add_price,
            "blended_entry": blended_entry,
            "total_capital": total_capital,
        })

    return results


# ---------------------------------------------------------------------------
# Metrics computation
# ---------------------------------------------------------------------------

def compute_metrics(trades: list[dict], total_bars: int,
                    pnl_key: str = "pnl_usd",
                    capital_key: str = "total_capital") -> dict:
    """Compute comprehensive metrics for a list of trades."""
    if not trades:
        return {k: 0 for k in [
            "total_pnl", "trade_count", "win_rate", "avg_pnl", "avg_hold_days",
            "max_drawdown", "longest_losing_streak", "worst_trade",
            "max_capital_at_risk", "sharpe", "add_triggers",
        ]}

    pnls = [t.get(pnl_key, t.get("pnl_usd", 0)) for t in trades]
    hold_days = [t.get("hold_days", 0) for t in trades]
    capitals = [t.get(capital_key, POSITION_SIZE_USD) for t in trades]

    total_pnl = sum(pnls)
    trade_count = len(trades)
    wins = sum(1 for p in pnls if p > 0)
    win_rate = wins / trade_count * 100 if trade_count > 0 else 0
    avg_pnl = total_pnl / trade_count if trade_count > 0 else 0
    avg_hold = np.mean(hold_days) if hold_days else 0

    # Max drawdown (peak-to-trough of cumulative P&L)
    cumulative = np.cumsum(pnls)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = cumulative - peak
    max_drawdown = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0

    # Longest losing streak
    longest_streak = 0
    current_streak = 0
    for p in pnls:
        if p <= 0:
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0

    # Worst single trade
    worst_trade = min(pnls) if pnls else 0

    # Max capital at risk (sweep through time)
    sorted_trades = sorted(trades, key=lambda t: str(t.get("entry_date", "")))
    max_capital = 0
    all_events = []
    for t in sorted_trades:
        entry = t.get("entry_idx", 0)
        exit_ = t.get("exit_idx", entry + t.get("hold_days", 1))
        cap = t.get(capital_key, POSITION_SIZE_USD)
        all_events.append((entry, cap))
        all_events.append((exit_, -cap))
    if all_events:
        all_events.sort(key=lambda x: x[0])
        running = 0
        for _, delta in all_events:
            running += delta
            max_capital = max(max_capital, running)

    # Add triggers count
    add_triggers = sum(1 for t in trades if t.get("add_triggered", False))

    # Sharpe ratio (annualized)
    if len(pnls) >= 2 and np.std(pnls) > 0:
        avg_hold_real = np.mean(hold_days) if hold_days else 1
        bars_per_year = 2190  # 365 * 6 (4h bars)
        trades_per_year = bars_per_year / max(avg_hold_real, 1)
        sharpe = (np.mean(pnls) / np.std(pnls)) * np.sqrt(trades_per_year)
    else:
        sharpe = 0.0

    return {
        "total_pnl": round(total_pnl, 2),
        "trade_count": trade_count,
        "win_rate": round(win_rate, 1),
        "avg_pnl": round(avg_pnl, 2),
        "avg_hold_days": round(avg_hold, 1),
        "max_drawdown": round(max_drawdown, 2),
        "longest_losing_streak": longest_streak,
        "worst_trade": round(worst_trade, 2),
        "max_capital_at_risk": round(max_capital, 2),
        "sharpe": round(sharpe, 2),
        "add_triggers": add_triggers,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    assets = ASSETS_HL  # BTC, ETH, HYPE, SOL
    days = DAYS

    print("=" * 110)
    print("V10 CANDIDATE BACKTEST: Trail After 7d + Scaling-In")
    print("=" * 110)
    print(f"Assets: {', '.join(assets.keys())}")
    print(f"Lookback: {days} days | Position: ${POSITION_SIZE_USD}")
    print(f"Trail delay: {TRAIL_DELAY_BARS} bars ({TRAIL_DELAY_BARS // 6} days)")
    print(f"Scaling-in: {SCALE_ADD_SIZE_FRACTION*100:.0f}% add (${POSITION_SIZE_USD * SCALE_ADD_SIZE_FRACTION:.0f}), "
          f"pullback >={SCALE_PRICE_DIP_PCT}%, recovery >={SCALE_PRICE_RECOVER*100:.0f}%, "
          f"max {SCALE_MAX_ADDS} add, winners-only, NO RSI trigger")
    print("=" * 110)

    # ------------------------------------------------------------------
    # Phase 1: Fetch data
    # ------------------------------------------------------------------
    all_dfs = {}
    btc_df = None

    print(f"\nFetching bitcoin (crash filter)...")
    try:
        btc_df = fetch_ohlc("bitcoin", days)
        if btc_df is not None and len(btc_df) >= 50:
            btc_df = calculate_indicators(btc_df, V9_ATR_2_0X)
            btc_df = generate_signals(btc_df, V9_ATR_2_0X)
            all_dfs["bitcoin"] = btc_df
            print(f"  Got {len(btc_df)} candles")
        else:
            print(f"  Insufficient BTC data")
            btc_df = None
    except Exception as e:
        print(f"  Failed to fetch BTC: {e}")

    time.sleep(2)

    for cg_id, hl_sym in assets.items():
        if cg_id == "bitcoin":
            continue
        print(f"Fetching {cg_id} ({hl_sym})...")
        try:
            df = fetch_ohlc(cg_id, days)
        except Exception as e:
            print(f"  Failed to fetch: {e}")
            continue
        if df is None or len(df) < 50:
            print(f"  Insufficient data ({len(df) if df is not None else 0} rows)")
            continue
        print(f"  Got {len(df)} candles")
        df = calculate_indicators(df, V9_ATR_2_0X)
        df = generate_signals(df, V9_ATR_2_0X)
        all_dfs[cg_id] = df
        time.sleep(2)

    if not all_dfs:
        print("\nNo data fetched.")
        return

    total_bars = max(len(df) for df in all_dfs.values())

    # ------------------------------------------------------------------
    # Phase 2: Run four configs
    # ------------------------------------------------------------------
    # A and B use simulate_trades directly; C and D add scaling-in post-processing
    configs_ab = {
        "A) Baseline V9_ATR_2_0X": V9_ATR_2_0X,
        "B) Trail after 7d only": TRAIL_7D_CONFIG,
    }

    raw_trades = {}  # config_key -> {asset -> enriched_trades}

    for config_label, config in configs_ab.items():
        raw_trades[config_label] = {}
        for cg_id, df in all_dfs.items():
            is_btc = cg_id == "bitcoin"
            trades = simulate_trades(
                df, POSITION_SIZE_USD, config,
                btc_df=btc_df if not is_btc else None,
                is_btc=is_btc,
            )
            enriched = enrich_trades_with_idx(df, trades)
            for t in enriched:
                t["asset"] = cg_id
                t["total_capital"] = POSITION_SIZE_USD
                t["add_triggered"] = False
                t["add_pnl_usd"] = 0.0
                t["scaled_pnl_usd"] = t["pnl_usd"]
            raw_trades[config_label][cg_id] = enriched

    # Flatten A and B
    all_config_trades = {}
    for config_label in configs_ab:
        flat = []
        for cg_id, trades in raw_trades[config_label].items():
            flat.extend(trades)
        all_config_trades[config_label] = flat

    # C = baseline trades + scaling-in
    c_trades = []
    for cg_id, trades in raw_trades["A) Baseline V9_ATR_2_0X"].items():
        df = all_dfs[cg_id]
        scaled = apply_scaling_in(df, trades)
        for t in scaled:
            t["asset"] = cg_id
        c_trades.extend(scaled)
    all_config_trades["C) Scaling-in only"] = c_trades

    # D = trail-7d trades + scaling-in
    d_trades = []
    for cg_id, trades in raw_trades["B) Trail after 7d only"].items():
        df = all_dfs[cg_id]
        scaled = apply_scaling_in(df, trades)
        for t in scaled:
            t["asset"] = cg_id
        d_trades.extend(scaled)
    all_config_trades["D) V10 Candidate (7d trail + scale-in)"] = d_trades

    # ------------------------------------------------------------------
    # Phase 3: Compute metrics
    # ------------------------------------------------------------------
    all_metrics = {}
    config_labels = list(all_config_trades.keys())

    for label in config_labels:
        trades = all_config_trades[label]
        is_scaled = label.startswith("C)") or label.startswith("D)")
        pnl_key = "scaled_pnl_usd" if is_scaled else "pnl_usd"
        all_metrics[label] = compute_metrics(trades, total_bars, pnl_key=pnl_key)

    # ------------------------------------------------------------------
    # Phase 4: Comparison table
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("RESULTS COMPARISON")
    print("=" * 110)

    metric_labels = [
        ("total_pnl", "Total P&L ($)", "$"),
        ("trade_count", "Trade Count", ""),
        ("win_rate", "Win Rate (%)", "%"),
        ("avg_pnl", "Avg P&L/Trade ($)", "$"),
        ("avg_hold_days", "Avg Hold (bars)", ""),
        ("max_drawdown", "Max Drawdown ($)", "$"),
        ("longest_losing_streak", "Longest Losing Streak", ""),
        ("worst_trade", "Worst Single Trade ($)", "$"),
        ("max_capital_at_risk", "Max Capital at Risk ($)", "$"),
        ("sharpe", "Sharpe Ratio (ann.)", ""),
        ("add_triggers", "Add Triggers Fired", ""),
    ]

    # Header
    short_labels = []
    for cl in config_labels:
        short = cl.split(") ")[1] if ") " in cl else cl
        short_labels.append(short)

    header = f"{'Metric':<30}"
    for sl in short_labels:
        header += f" {sl:>22}"
    print(header)
    print("-" * (30 + 23 * len(config_labels)))

    for key, label, unit in metric_labels:
        row = f"{label:<30}"
        for cl in config_labels:
            val = all_metrics[cl][key]
            if unit == "$":
                row += f" {'$' + f'{val:,.2f}':>21}"
            elif unit == "%":
                row += f" {f'{val:.1f}%':>21}"
            elif isinstance(val, float):
                row += f" {f'{val:.2f}':>21}"
            else:
                row += f" {str(val):>21}"
        print(row)

    # Delta from baseline
    print("\n  Delta from Baseline (A):")
    baseline_pnl = all_metrics[config_labels[0]]["total_pnl"]
    baseline_sharpe = all_metrics[config_labels[0]]["sharpe"]
    baseline_dd = all_metrics[config_labels[0]]["max_drawdown"]
    for cl in config_labels[1:]:
        m = all_metrics[cl]
        short = cl.split(") ")[1] if ") " in cl else cl
        d_pnl = m["total_pnl"] - baseline_pnl
        d_sharpe = m["sharpe"] - baseline_sharpe
        d_dd = m["max_drawdown"] - baseline_dd
        print(f"    {short:<40} P&L: ${d_pnl:>+10,.2f}   Sharpe: {d_sharpe:>+6.2f}   MaxDD: ${d_dd:>+10,.2f}")

    # ------------------------------------------------------------------
    # Phase 5: Interaction analysis
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("INTERACTION ANALYSIS")
    print("=" * 110)

    a_pnl = all_metrics[config_labels[0]]["total_pnl"]
    b_pnl = all_metrics[config_labels[1]]["total_pnl"]
    c_pnl = all_metrics[config_labels[2]]["total_pnl"]
    d_pnl = all_metrics[config_labels[3]]["total_pnl"]

    delta_trail = b_pnl - a_pnl
    delta_scale = c_pnl - a_pnl
    expected_additive = a_pnl + delta_trail + delta_scale
    actual_combined = d_pnl
    interaction = actual_combined - expected_additive

    print(f"\n  Baseline P&L (A):                    ${a_pnl:>+10,.2f}")
    print(f"  Delta from trail-7d (B-A):           ${delta_trail:>+10,.2f}")
    print(f"  Delta from scaling-in (C-A):         ${delta_scale:>+10,.2f}")
    print(f"  Expected if purely additive:         ${expected_additive:>+10,.2f}")
    print(f"  Actual combined (D):                 ${actual_combined:>+10,.2f}")
    print(f"  Interaction effect:                  ${interaction:>+10,.2f}")

    if abs(interaction) < 50:
        print(f"\n  --> Effects are roughly ADDITIVE (interaction < $50)")
    elif interaction > 0:
        print(f"\n  --> POSITIVE interaction: combined is BETTER than sum of parts (+${interaction:.2f})")
        print(f"      Delayed trailing allows winners to run longer, giving scaling-in")
        print(f"      more time to trigger on profitable pullbacks.")
    else:
        print(f"\n  --> NEGATIVE interaction: combined is WORSE than sum of parts (${interaction:.2f})")
        print(f"      Extended hold times from delayed trailing may expose scale-in")
        print(f"      capital to larger reversals.")

    # Sharpe interaction
    a_sh = all_metrics[config_labels[0]]["sharpe"]
    b_sh = all_metrics[config_labels[1]]["sharpe"]
    c_sh = all_metrics[config_labels[2]]["sharpe"]
    d_sh = all_metrics[config_labels[3]]["sharpe"]
    print(f"\n  Sharpe comparison:")
    print(f"    A (baseline):       {a_sh:>6.2f}")
    print(f"    B (trail 7d):       {b_sh:>6.2f}  ({b_sh - a_sh:>+.2f})")
    print(f"    C (scale-in):       {c_sh:>6.2f}  ({c_sh - a_sh:>+.2f})")
    print(f"    D (V10 combined):   {d_sh:>6.2f}  ({d_sh - a_sh:>+.2f})")

    # Drawdown comparison
    print(f"\n  Max drawdown comparison:")
    for cl in config_labels:
        dd = all_metrics[cl]["max_drawdown"]
        short = cl.split(") ")[1] if ") " in cl else cl
        print(f"    {short:<40} ${dd:>+10,.2f}")

    # ------------------------------------------------------------------
    # Phase 6: Per-asset breakdown
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("PER-ASSET BREAKDOWN")
    print("=" * 110)

    for cg_id in sorted(all_dfs.keys()):
        print(f"\n  {cg_id.upper()}")
        print(f"  {'Config':<42} {'Trades':>7} {'P&L':>12} {'Win%':>8} {'Avg P&L':>10} "
              f"{'MaxDD':>12} {'Adds':>6}")
        print(f"  {'-' * 98}")

        for cl in config_labels:
            trades = all_config_trades[cl]
            asset_trades = [t for t in trades if t.get("asset") == cg_id]

            is_scaled = cl.startswith("C)") or cl.startswith("D)")
            pnl_key = "scaled_pnl_usd" if is_scaled else "pnl_usd"

            pnls = [t.get(pnl_key, t.get("pnl_usd", 0)) for t in asset_trades]
            n = len(pnls)
            total = sum(pnls)
            wins = sum(1 for p in pnls if p > 0)
            wr = wins / n * 100 if n > 0 else 0
            avg = total / n if n > 0 else 0
            adds = sum(1 for t in asset_trades if t.get("add_triggered", False))

            if pnls:
                cum = np.cumsum(pnls)
                pk = np.maximum.accumulate(cum)
                dd = float(np.min(cum - pk))
            else:
                dd = 0

            short = cl.split(") ")[1] if ") " in cl else cl
            print(f"  {short:<42} {n:>7} ${total:>+10,.2f} {wr:>7.1f}% ${avg:>+8.2f} "
                  f"${dd:>+10,.2f} {adds:>5}")

    # ------------------------------------------------------------------
    # Phase 7: Scaling-in detail (C and D)
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("SCALING-IN DETAIL")
    print("=" * 110)

    for label in [config_labels[2], config_labels[3]]:
        trades = all_config_trades[label]
        total = len(trades)
        adds = [t for t in trades if t.get("add_triggered")]
        n_adds = len(adds)
        add_rate = n_adds / total * 100 if total > 0 else 0

        total_add_pnl = sum(t.get("add_pnl_usd", 0) for t in adds)
        good_adds = sum(1 for t in adds if t.get("add_pnl_usd", 0) > 0)
        bad_adds = n_adds - good_adds

        short_label = label.split(") ")[1] if ") " in label else label
        print(f"\n  {short_label}:")
        print(f"    Total trades: {total}, Adds triggered: {n_adds} ({add_rate:.1f}%)")
        print(f"    Add P&L contribution: ${total_add_pnl:+,.2f}")
        print(f"    Good adds (profitable): {good_adds}, Bad adds (unprofitable): {bad_adds}")
        if n_adds > 0:
            good_rate = good_adds / n_adds * 100
            print(f"    Add success rate: {good_rate:.1f}%")

        if adds:
            add_pnls = [t.get("add_pnl_usd", 0) for t in adds]
            print(f"    Avg add P&L: ${np.mean(add_pnls):+,.2f}")
            print(f"    Best add: ${max(add_pnls):+,.2f}, Worst add: ${min(add_pnls):+,.2f}")

        # Per-asset add detail
        print(f"    Per-asset adds:")
        for cg_id in sorted(all_dfs.keys()):
            asset_adds = [t for t in adds if t.get("asset") == cg_id]
            if asset_adds:
                asset_add_pnl = sum(t.get("add_pnl_usd", 0) for t in asset_adds)
                print(f"      {cg_id:<15} {len(asset_adds)} adds, P&L contribution: ${asset_add_pnl:+,.2f}")

    # ------------------------------------------------------------------
    # Phase 8: Risk-adjusted summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("RISK-ADJUSTED SUMMARY")
    print("=" * 110)

    print(f"\n  {'Config':<42} {'P&L':>10} {'MaxDD':>10} {'P&L/DD':>8} {'Sharpe':>8} {'WinRate':>8} {'Adds':>6}")
    print(f"  {'-' * 93}")

    for cl in config_labels:
        m = all_metrics[cl]
        pnl = m["total_pnl"]
        dd = m["max_drawdown"]
        ratio = abs(pnl / dd) if dd != 0 else float("inf")
        sh = m["sharpe"]
        wr = m["win_rate"]
        adds = m["add_triggers"]
        short = cl.split(") ")[1] if ") " in cl else cl
        print(f"  {short:<42} ${pnl:>+8,.0f} ${dd:>+8,.0f} {ratio:>7.2f} {sh:>7.2f} {wr:>6.1f}% {adds:>5}")

    # ------------------------------------------------------------------
    # Phase 9: Recommendation
    # ------------------------------------------------------------------
    print("\n" + "=" * 110)
    print("RECOMMENDATION")
    print("=" * 110)

    best_sharpe_label = max(all_metrics.keys(), key=lambda k: all_metrics[k]["sharpe"])
    best_pnl_label = max(all_metrics.keys(), key=lambda k: all_metrics[k]["total_pnl"])
    best_dd_label = min(all_metrics.keys(), key=lambda k: abs(all_metrics[k]["max_drawdown"]))

    def short_name(label: str) -> str:
        return label.split(") ")[1] if ") " in label else label

    print(f"\n  Best risk-adjusted (Sharpe): {short_name(best_sharpe_label)} "
          f"(Sharpe={all_metrics[best_sharpe_label]['sharpe']:.2f})")
    print(f"  Best total P&L:             {short_name(best_pnl_label)} "
          f"(${all_metrics[best_pnl_label]['total_pnl']:,.2f})")
    print(f"  Best max drawdown:          {short_name(best_dd_label)} "
          f"(${all_metrics[best_dd_label]['max_drawdown']:,.2f})")

    # V10 verdict
    v10_m = all_metrics[config_labels[3]]
    baseline_m = all_metrics[config_labels[0]]

    pnl_improvement = v10_m["total_pnl"] - baseline_m["total_pnl"]
    sharpe_improvement = v10_m["sharpe"] - baseline_m["sharpe"]
    dd_change = v10_m["max_drawdown"] - baseline_m["max_drawdown"]

    print(f"\n  V10 Candidate vs Baseline:")
    print(f"    P&L improvement:    ${pnl_improvement:>+10,.2f}")
    print(f"    Sharpe improvement: {sharpe_improvement:>+10.2f}")
    print(f"    Drawdown change:    ${dd_change:>+10,.2f}")

    if interaction > 0:
        print(f"\n  Interaction is SUPER-ADDITIVE (+${interaction:.2f}).")
        print(f"  The 7d trailing delay gives winning positions more room to breathe,")
        print(f"  and scaling-in captures value from profitable pullbacks within that window.")
    elif interaction < -50:
        print(f"\n  Interaction is NEGATIVE (${interaction:.2f}).")
        print(f"  Extended hold + added capital amplifies downside when winners reverse.")
    else:
        print(f"\n  Interaction is roughly ADDITIVE (${interaction:.2f}).")
        print(f"  Each improvement contributes independently.")

    if v10_m["sharpe"] > baseline_m["sharpe"] and v10_m["total_pnl"] > baseline_m["total_pnl"]:
        print(f"\n  VERDICT: V10 is an IMPROVEMENT over baseline on both Sharpe and total P&L.")
        if abs(dd_change) / abs(baseline_m["max_drawdown"]) > 0.20:
            print(f"  CAUTION: Max drawdown changed significantly ({dd_change:+.0f}). Review risk tolerance.")
    elif v10_m["sharpe"] > baseline_m["sharpe"]:
        print(f"\n  VERDICT: V10 improves risk-adjusted returns (Sharpe) but not total P&L.")
    elif v10_m["total_pnl"] > baseline_m["total_pnl"]:
        print(f"\n  VERDICT: V10 improves total P&L but at lower Sharpe. More risk per dollar.")
    else:
        print(f"\n  VERDICT: V10 does NOT improve over baseline. Stick with V9_ATR_2_0X.")

    print(f"\n{'=' * 110}")
    print("DONE")
    print(f"{'=' * 110}")


if __name__ == "__main__":
    main()
