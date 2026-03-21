#!/usr/bin/env python3
"""
Combined Strategy Backtest: No Trailing Stop + Scaling-In
==========================================================
Tests whether removing trailing stops and adding scaling-in are
additive improvements or have negative interactions.

Four configs compared:
  A) Baseline V9_ATR_2_0X (production)
  B) No trailing stop only
  C) Scaling-in only (winners-only, pullback + RSI, no vol spike)
  D) Combined: no trailing stop + scaling-in

Metrics: Total P&L, trade count, win rate, avg P&L, avg hold days,
         max drawdown, longest losing streak, worst single trade,
         max capital at risk, capital utilization, Sharpe ratio.

Usage:
    python3 scripts/combined_strategy_backtest.py
    python3 scripts/combined_strategy_backtest.py --days 365
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Import shared infrastructure from backtest.py
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

# Import scaling-in helpers from scaling_in_backtest.py
from scaling_in_backtest import (
    enrich_trades_with_idx,
    find_strengthening_events,
)

# ---------------------------------------------------------------------------
# Scaling-in parameters (best from scaling_in_backtest.py analysis)
# ---------------------------------------------------------------------------
SCALE_PRICE_DIP_PCT = 3.0       # Price pullback >= 3% from trade high
SCALE_RSI_DIP = 15              # RSI drop >= 15 points
SCALE_ADD_SIZE_FRACTION = 0.5   # 50% of original position
SCALE_MAX_ADDS = 1             # Max 1 add per trade
SCALE_ONLY_WINNERS = True       # Only add to trades currently in profit
SCALE_NO_VOL_SPIKE = True       # Exclude volume spike triggers

ALLOWED_ADD_TYPES = ["pullback_recovery", "rsi_bounce"]

# ---------------------------------------------------------------------------
# Config builders
# ---------------------------------------------------------------------------

def make_no_trailing_config() -> dict:
    """V9_ATR_2_0X with trailing stops disabled."""
    cfg = {**V9_ATR_2_0X}
    cfg["name"] = "V9 No Trailing Stop"
    cfg["trailing_stop_short"] = False
    cfg["trailing_stop_long"] = False
    return cfg


NO_TRAILING_CONFIG = make_no_trailing_config()


# ---------------------------------------------------------------------------
# Scaling-in simulation
# ---------------------------------------------------------------------------

def apply_scaling_in(df: pd.DataFrame, trades: list[dict]) -> list[dict]:
    """
    Apply scaling-in logic to a list of enriched trades.
    Returns modified trade list with blended P&L for trades that got adds.

    For each trade:
    - Only add if currently in profit at the add point (winners-only)
    - Only add if not already trimmed (no trim events in trade list for this trade)
    - Trigger: pullback recovery (3% dip, 50% recovery) OR RSI bounce (15pt drop, 7pt recover)
    - Max 1 add per trade, 50% of original size
    - Track blended entry and recalculate P&L
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
            rsi_dip_override=SCALE_RSI_DIP,
            price_dip_override=SCALE_PRICE_DIP_PCT,
        )

        # Filter to allowed types (no volume spike)
        if SCALE_NO_VOL_SPIKE:
            events = [e for e in events if e["type"] in ALLOWED_ADD_TYPES]

        if not events:
            results.append({**trade, "add_triggered": False, "add_pnl_usd": 0.0,
                            "scaled_pnl_usd": base_pnl_usd, "add_price": None,
                            "blended_entry": entry_price,
                            "total_capital": POSITION_SIZE_USD})
            continue

        # Use first event only (max 1 add)
        event = events[0]
        add_price = event["price"]

        # Winners-only gate
        if SCALE_ONLY_WINNERS:
            if direction == "long":
                unrealized = (add_price - entry_price) / entry_price
            else:
                unrealized = (entry_price - add_price) / entry_price
            if unrealized <= 0:
                results.append({**trade, "add_triggered": False, "add_pnl_usd": 0.0,
                                "scaled_pnl_usd": base_pnl_usd, "add_price": None,
                                "blended_entry": entry_price,
                                "total_capital": POSITION_SIZE_USD})
                continue

        # Check if trade was trimmed (skip adding to trimmed trades)
        # We detect this by checking remaining_pct < 100 on the trade
        remaining = trade.get("remaining_pct", 100.0)
        if remaining is not None and remaining < 95.0:
            results.append({**trade, "add_triggered": False, "add_pnl_usd": 0.0,
                            "scaled_pnl_usd": base_pnl_usd, "add_price": None,
                            "blended_entry": entry_price,
                            "total_capital": POSITION_SIZE_USD})
            continue

        add_size = POSITION_SIZE_USD * SCALE_ADD_SIZE_FRACTION

        # Calculate add P&L
        if direction == "long":
            add_pnl = add_size * (exit_price - add_price) / add_price
        else:
            add_pnl = add_size * (add_price - exit_price) / add_price

        scaled_pnl_usd = base_pnl_usd + add_pnl

        # Blended entry price
        total_capital = POSITION_SIZE_USD + add_size
        if direction == "long":
            # Weighted average entry
            blended_entry = (POSITION_SIZE_USD * entry_price + add_size * add_price) / total_capital
        else:
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

def compute_metrics(trades: list[dict], total_bars: int, pnl_key: str = "pnl_usd",
                    capital_key: str = "total_capital") -> dict:
    """
    Compute comprehensive metrics for a list of trades.

    Args:
        trades: list of trade dicts with pnl_usd, entry_date, exit_date, hold_days, etc.
        total_bars: total number of bars in the dataset (for utilization calc)
        pnl_key: which field to use for P&L (pnl_usd or scaled_pnl_usd)
        capital_key: which field to use for capital at risk
    """
    if not trades:
        return {k: 0 for k in [
            "total_pnl", "trade_count", "win_rate", "avg_pnl", "avg_hold_days",
            "max_drawdown", "longest_losing_streak", "worst_trade",
            "max_capital_at_risk", "capital_utilization", "sharpe",
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

    # --- Max drawdown (peak-to-trough of cumulative P&L) ---
    cumulative = np.cumsum(pnls)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = cumulative - peak
    max_drawdown = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0

    # --- Longest losing streak ---
    longest_streak = 0
    current_streak = 0
    for p in pnls:
        if p <= 0:
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0

    # --- Worst single trade ---
    worst_trade = min(pnls) if pnls else 0

    # --- Max capital at risk at any point ---
    # Build timeline of open positions and their capital
    # Sort trades by entry date, track overlapping positions
    sorted_trades = sorted(trades, key=lambda t: str(t.get("entry_date", "")))
    max_capital = 0
    # Simple approach: for each bar, check which trades are open
    # We use entry_idx/exit_idx if available, otherwise approximate
    open_positions = []
    for t in sorted_trades:
        entry = t.get("entry_idx", 0)
        exit_ = t.get("exit_idx", entry + t.get("hold_days", 1))
        cap = t.get(capital_key, POSITION_SIZE_USD)
        open_positions.append((entry, exit_, cap))

    # Sweep through time to find max concurrent capital
    if open_positions:
        all_events = []
        for entry, exit_, cap in open_positions:
            all_events.append((entry, cap))
            all_events.append((exit_, -cap))
        all_events.sort(key=lambda x: x[0])
        running = 0
        for _, delta in all_events:
            running += delta
            max_capital = max(max_capital, running)

    # --- Capital utilization ---
    # What fraction of time was capital locked in positions
    total_bars_in_trades = sum(t.get("hold_days", 0) for t in trades)
    # Approximate: total_bars is per-asset, but we have multi-asset trades
    # Use total_bars * num_assets as denominator
    num_assets = len(set(t.get("asset", t.get("asset_name", "?")) for t in trades))
    total_possible_bars = total_bars * max(num_assets, 1)
    capital_utilization = total_bars_in_trades / total_possible_bars * 100 if total_possible_bars > 0 else 0

    # --- Sharpe ratio (annualized) ---
    # Using per-trade returns, annualize based on avg hold period
    if len(pnls) >= 2 and np.std(pnls) > 0:
        avg_hold_real = np.mean(hold_days) if hold_days else 1
        # Each bar is ~4 hours, so bars_per_year = 365 * 6 = 2190
        bars_per_year = 2190
        trades_per_year = bars_per_year / max(avg_hold_real, 1)
        mean_return = np.mean(pnls)
        std_return = np.std(pnls)
        sharpe = (mean_return / std_return) * np.sqrt(trades_per_year)
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
        "capital_utilization": round(capital_utilization, 1),
        "sharpe": round(sharpe, 2),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Combined strategy backtest")
    parser.add_argument("--days", type=int, default=730, help="Lookback days")
    args = parser.parse_args()

    assets = ASSETS_HL  # BTC, ETH, HYPE, SOL
    days = args.days

    print("=" * 100)
    print("COMBINED STRATEGY BACKTEST: No Trailing Stop + Scaling-In")
    print("=" * 100)
    print(f"Assets: {', '.join(assets.keys())}")
    print(f"Lookback: {days} days | Position: ${POSITION_SIZE_USD}")
    print(f"Scaling-in: {SCALE_ADD_SIZE_FRACTION*100:.0f}% add, pullback >={SCALE_PRICE_DIP_PCT}%, "
          f"RSI dip >={SCALE_RSI_DIP}pts, max {SCALE_MAX_ADDS} add, winners-only={SCALE_ONLY_WINNERS}")
    print("=" * 100)

    # ------------------------------------------------------------------
    # Phase 1: Fetch data
    # ------------------------------------------------------------------
    all_dfs = {}
    btc_df = None

    print(f"\nFetching bitcoin (for crash filter)...")
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
            continue  # Already fetched

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
    configs = {
        "A) Baseline V9_ATR_2_0X": V9_ATR_2_0X,
        "B) No trailing stop": NO_TRAILING_CONFIG,
    }

    # We also need configs C and D — these use baseline/no-trailing + scaling-in post-processing
    # So we run simulate_trades for configs A and B, then apply scaling-in for C and D

    raw_trades = {}  # config_key -> {asset -> enriched_trades}

    for config_label, config in configs.items():
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
            raw_trades[config_label][cg_id] = enriched

    # Flatten trades for each config
    all_config_trades = {}
    for config_label in configs:
        flat = []
        for cg_id, trades in raw_trades[config_label].items():
            flat.extend(trades)
        all_config_trades[config_label] = flat

    # Apply scaling-in to create configs C and D
    # C = baseline trades + scaling-in
    c_trades = []
    for cg_id, trades in raw_trades["A) Baseline V9_ATR_2_0X"].items():
        df = all_dfs[cg_id]
        scaled = apply_scaling_in(df, trades)
        c_trades.extend(scaled)
    all_config_trades["C) Scaling-in only"] = c_trades

    # D = no trailing stop trades + scaling-in
    d_trades = []
    for cg_id, trades in raw_trades["B) No trailing stop"].items():
        df = all_dfs[cg_id]
        scaled = apply_scaling_in(df, trades)
        d_trades.extend(scaled)
    all_config_trades["D) Combined (no trail + scale-in)"] = d_trades

    # ------------------------------------------------------------------
    # Phase 3: Compute metrics
    # ------------------------------------------------------------------
    all_metrics = {}
    for label, trades in all_config_trades.items():
        is_scaled = label.startswith("C)") or label.startswith("D)")
        pnl_key = "scaled_pnl_usd" if is_scaled else "pnl_usd"
        capital_key = "total_capital" if is_scaled else "total_capital"
        all_metrics[label] = compute_metrics(trades, total_bars, pnl_key=pnl_key,
                                             capital_key=capital_key)

    # ------------------------------------------------------------------
    # Phase 4: Print comparison table
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("RESULTS COMPARISON")
    print("=" * 100)

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
        ("capital_utilization", "Capital Utilization (%)", "%"),
        ("sharpe", "Sharpe Ratio (ann.)", ""),
    ]

    config_labels = list(all_config_trades.keys())

    # Header
    header = f"{'Metric':<30}"
    for cl in config_labels:
        # Shorten labels for table
        short = cl.split(") ")[1] if ") " in cl else cl
        header += f" {short:>18}"
    print(header)
    print("-" * (30 + 19 * len(config_labels)))

    for key, label, unit in metric_labels:
        row = f"{label:<30}"
        for cl in config_labels:
            val = all_metrics[cl][key]
            if unit == "$":
                row += f" {'$' + f'{val:,.2f}':>17}"
            elif unit == "%":
                row += f" {f'{val:.1f}%':>17}"
            elif isinstance(val, float):
                row += f" {f'{val:.2f}':>17}"
            else:
                row += f" {str(val):>17}"
        print(row)

    # ------------------------------------------------------------------
    # Phase 5: Delta analysis (interaction effects)
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("INTERACTION ANALYSIS")
    print("=" * 100)

    baseline_pnl = all_metrics["A) Baseline V9_ATR_2_0X"]["total_pnl"]
    no_trail_pnl = all_metrics["B) No trailing stop"]["total_pnl"]
    scale_pnl = all_metrics["C) Scaling-in only"]["total_pnl"]
    combined_pnl = all_metrics["D) Combined (no trail + scale-in)"]["total_pnl"]

    delta_no_trail = no_trail_pnl - baseline_pnl
    delta_scale = scale_pnl - baseline_pnl
    expected_additive = baseline_pnl + delta_no_trail + delta_scale
    actual_combined = combined_pnl
    interaction = actual_combined - expected_additive

    print(f"\n  Baseline P&L:                     ${baseline_pnl:>+10,.2f}")
    print(f"  Delta from no trailing stop:      ${delta_no_trail:>+10,.2f}")
    print(f"  Delta from scaling-in:            ${delta_scale:>+10,.2f}")
    print(f"  Expected if additive:             ${expected_additive:>+10,.2f}")
    print(f"  Actual combined:                  ${actual_combined:>+10,.2f}")
    print(f"  Interaction effect:               ${interaction:>+10,.2f}")

    if abs(interaction) < 50:
        print(f"\n  --> Effects are roughly ADDITIVE (interaction < $50)")
    elif interaction > 0:
        print(f"\n  --> POSITIVE interaction: combined is BETTER than sum of parts (+${interaction:.2f})")
    else:
        print(f"\n  --> NEGATIVE interaction: combined is WORSE than sum of parts (${interaction:.2f})")

    # Drawdown comparison
    print(f"\n  Drawdown comparison:")
    for cl in config_labels:
        dd = all_metrics[cl]["max_drawdown"]
        sh = all_metrics[cl]["sharpe"]
        short = cl.split(") ")[1] if ") " in cl else cl
        print(f"    {short:<35} drawdown: ${dd:>+10,.2f}   Sharpe: {sh:>6.2f}")

    # ------------------------------------------------------------------
    # Phase 6: Per-asset breakdown
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("PER-ASSET BREAKDOWN")
    print("=" * 100)

    for cg_id in sorted(all_dfs.keys()):
        print(f"\n  {cg_id.upper()}")
        print(f"  {'Config':<35} {'Trades':>7} {'P&L':>12} {'Win%':>8} {'Avg P&L':>10} {'MaxDD':>12}")
        print(f"  {'-' * 85}")

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

            # Max drawdown for this asset
            if pnls:
                cum = np.cumsum(pnls)
                pk = np.maximum.accumulate(cum)
                dd = float(np.min(cum - pk))
            else:
                dd = 0

            short = cl.split(") ")[1] if ") " in cl else cl
            print(f"  {short:<35} {n:>7} ${total:>+10,.2f} {wr:>7.1f}% ${avg:>+8.2f} ${dd:>+10,.2f}")

    # ------------------------------------------------------------------
    # Phase 7: Scaling-in detail for C and D
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("SCALING-IN DETAIL")
    print("=" * 100)

    for label in ["C) Scaling-in only", "D) Combined (no trail + scale-in)"]:
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
        print(f"    Total trades: {total}, Adds triggered: {n_adds} ({add_rate:.0f}%)")
        print(f"    Add P&L contribution: ${total_add_pnl:+,.2f}")
        print(f"    Good adds: {good_adds}, Bad adds: {bad_adds}")

        if adds:
            add_pnls = [t.get("add_pnl_usd", 0) for t in adds]
            print(f"    Avg add P&L: ${np.mean(add_pnls):+,.2f}")
            print(f"    Best add: ${max(add_pnls):+,.2f}, Worst add: ${min(add_pnls):+,.2f}")

            # By type
            types = {}
            for t in adds:
                # The add type info is not directly stored, but we can check the event
                # For now, just count adds
                pass

    # ------------------------------------------------------------------
    # Phase 8: Risk-adjusted summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("RISK-ADJUSTED SUMMARY")
    print("=" * 100)

    print(f"\n  {'Config':<35} {'P&L':>10} {'MaxDD':>10} {'P&L/DD':>8} {'Sharpe':>8} {'WinRate':>8}")
    print(f"  {'-' * 80}")

    for cl in config_labels:
        m = all_metrics[cl]
        pnl = m["total_pnl"]
        dd = m["max_drawdown"]
        ratio = abs(pnl / dd) if dd != 0 else float("inf")
        sh = m["sharpe"]
        wr = m["win_rate"]
        short = cl.split(") ")[1] if ") " in cl else cl
        print(f"  {short:<35} ${pnl:>+8,.0f} ${dd:>+8,.0f} {ratio:>7.2f} {sh:>7.2f} {wr:>6.1f}%")

    # ------------------------------------------------------------------
    # Recommendation
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("RECOMMENDATION")
    print("=" * 100)

    best_label = max(all_metrics.keys(), key=lambda k: all_metrics[k]["sharpe"])
    best_m = all_metrics[best_label]
    short_best = best_label.split(") ")[1] if ") " in best_label else best_label

    # Also check: is combined better than individual changes?
    print(f"\n  Best risk-adjusted (Sharpe): {short_best} (Sharpe={best_m['sharpe']:.2f})")
    print(f"  Best total P&L: {max(all_metrics.keys(), key=lambda k: all_metrics[k]['total_pnl']).split(') ')[1]}")
    print(f"  Best max drawdown: {min(all_metrics.keys(), key=lambda k: abs(all_metrics[k]['max_drawdown'])).split(') ')[1]}")

    if interaction > 0:
        print(f"\n  The combined strategy shows POSITIVE interaction (+${interaction:.2f}).")
        print(f"  Removing trailing stop allows winners to run longer, giving scaling-in")
        print(f"  more time/opportunity to trigger on profitable pullbacks.")
    elif interaction < -50:
        print(f"\n  The combined strategy shows NEGATIVE interaction (${interaction:.2f}).")
        print(f"  Without trailing stops, some winning trades turn into losers,")
        print(f"  and scaling-in amplifies those reversals.")
    else:
        print(f"\n  The effects are roughly additive (interaction: ${interaction:.2f}).")
        print(f"  Each change contributes independently.")

    print(f"\n{'=' * 100}")
    print("DONE")
    print(f"{'=' * 100}")


if __name__ == "__main__":
    main()
