#!/usr/bin/env python3
"""
Integrated 7-Day Trailing Stop Delay Test
==========================================
Tests the integrated trailing_stop_delay_days parameter in simulate_trades()
against the baseline PROD_ACTUAL config.

Configs:
  A) PROD_ACTUAL — baseline (no trail delay)
  B) PROD_ACTUAL + trailing_stop_delay_days=7

Runs on all 4 assets (BTC, ETH, HYPE, SOL) over 730 days.

Usage:
    python3 scripts/test_integrated_7d_trail.py
"""

import sys
import time
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Import shared infrastructure from the main backtest module
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (
    ASSETS_HL,
    HL_SLEEP_SECONDS,
    POSITION_SIZE_USD,
    PROD_ACTUAL,
    calculate_indicators,
    extract_metrics,
    fetch_ohlc,
    generate_signals,
    simulate_trades,
)

# ---------------------------------------------------------------------------
# Configs
# ---------------------------------------------------------------------------
DAYS = 730

CONFIG_A = {
    **PROD_ACTUAL,
    "name": "A) PROD_ACTUAL (baseline)",
}

CONFIG_B = {
    **PROD_ACTUAL,
    "name": "B) PROD_ACTUAL + 7d trail delay",
    "trailing_stop_delay_days": 7,
}

CONFIGS = {"baseline": CONFIG_A, "7d_delay": CONFIG_B}


# ---------------------------------------------------------------------------
# Run backtest for a single asset + config
# ---------------------------------------------------------------------------
def run_single(
    coingecko_id: str,
    df_cached: pd.DataFrame,
    config: dict,
    btc_df: pd.DataFrame | None = None,
) -> tuple[list[dict], dict]:
    """Run backtest and return (trades, metrics)."""
    df = df_cached.copy()
    df = calculate_indicators(df, config=config)
    df = generate_signals(df, config=config)
    is_btc = coingecko_id == "bitcoin"
    trades = simulate_trades(df, config=config, btc_df=btc_df, is_btc=is_btc)
    metrics = extract_metrics(trades)
    return trades, metrics


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 80)
    print("Integrated 7-Day Trailing Stop Delay Test")
    print("=" * 80)
    print(f"Position size: ${POSITION_SIZE_USD}")
    print(f"Lookback: {DAYS} days")
    print()

    # Show config diffs
    print("Config differences:")
    for key in ("trailing_stop_delay_days", "trailing_stop_delay_bars",
                "trailing_stop_long", "trailing_stop_short",
                "trailing_stop_activation_pct", "trailing_stop_trail_pct",
                "trailing_stop_atr_mode", "trailing_stop_atr_activation",
                "trailing_stop_atr_trail",
                "atr_stop_loss", "stop_loss_pct", "grace_period_days"):
        va = CONFIG_A.get(key, "—")
        vb = CONFIG_B.get(key, "—")
        marker = " <--" if va != vb else ""
        print(f"  {key:<35} {str(va):>10}  ->  {str(vb):<10}{marker}")
    print()

    # Fetch data for all assets (cache to avoid redundant API calls)
    print("Fetching price data...")
    asset_data: dict[str, pd.DataFrame] = {}
    for cg_id, symbol in ASSETS_HL.items():
        print(f"  {symbol} ({cg_id})...", end=" ", flush=True)
        df = fetch_ohlc(cg_id, DAYS, source="hyperliquid")
        asset_data[cg_id] = df
        print(f"{len(df)} candles")
        if cg_id != list(ASSETS_HL.keys())[-1]:
            time.sleep(HL_SLEEP_SECONDS)
    print()

    # Pre-calculate BTC indicators for crash filter
    btc_df = asset_data.get("bitcoin")
    if btc_df is not None:
        btc_df = calculate_indicators(btc_df.copy(), config=CONFIG_A)
        btc_df = generate_signals(btc_df, config=CONFIG_A)

    # Run all configs on all assets
    results: dict[str, dict[str, dict]] = {}  # config_key -> asset -> metrics
    for config_key, config in CONFIGS.items():
        results[config_key] = {}
        print(f"Running: {config['name']}")
        for cg_id, symbol in ASSETS_HL.items():
            is_btc = cg_id == "bitcoin"
            _btc = None if is_btc else btc_df
            trades, metrics = run_single(cg_id, asset_data[cg_id], config, btc_df=_btc)
            results[config_key][cg_id] = metrics
            closed = [t for t in trades if t["status"] == "closed"]
            trail_exits = [t for t in closed if t.get("exit_signal_reason") == "trailing_stop"]
            print(f"  {symbol:>5}: {metrics['positions']:>3} positions, "
                  f"P&L ${metrics['total_pnl_usd']:>+8,.0f}, "
                  f"win {metrics['win_rate']:>5.1f}%, "
                  f"avg hold {metrics['avg_duration_days']:>5.1f}d, "
                  f"trail exits {len(trail_exits)}")
        print()

    # ---------------------------------------------------------------------------
    # Comparison table
    # ---------------------------------------------------------------------------
    print("=" * 80)
    print("COMPARISON: Baseline vs 7-Day Trail Delay")
    print("=" * 80)
    print()

    header = f"{'Metric':<25} {'Baseline':>12} {'7d Delay':>12} {'Delta':>12}"
    sep = "-" * len(header)

    for cg_id, symbol in ASSETS_HL.items():
        ma = results["baseline"][cg_id]
        mb = results["7d_delay"][cg_id]

        print(f"  {symbol}")
        print(f"  {sep}")
        print(f"  {header}")
        print(f"  {sep}")

        rows = [
            ("Positions", f"{ma['positions']}", f"{mb['positions']}",
             f"{mb['positions'] - ma['positions']:+d}"),
            ("Win Rate %", f"{ma['win_rate']:.1f}", f"{mb['win_rate']:.1f}",
             f"{mb['win_rate'] - ma['win_rate']:+.1f}"),
            ("Total P&L $", f"{ma['total_pnl_usd']:+,.0f}", f"{mb['total_pnl_usd']:+,.0f}",
             f"{mb['total_pnl_usd'] - ma['total_pnl_usd']:+,.0f}"),
            ("Avg Hold (days)", f"{ma['avg_duration_days']:.1f}", f"{mb['avg_duration_days']:.1f}",
             f"{mb['avg_duration_days'] - ma['avg_duration_days']:+.1f}"),
            ("Max Single Loss %", f"{ma['max_single_loss_pct']:.1f}", f"{mb['max_single_loss_pct']:.1f}",
             f"{mb['max_single_loss_pct'] - ma['max_single_loss_pct']:+.1f}"),
            ("Trail Exits", f"{ma['trailing_stop_closes']}", f"{mb['trailing_stop_closes']}",
             f"{mb['trailing_stop_closes'] - ma['trailing_stop_closes']:+d}"),
            ("Long Wins", f"{ma['long_wins']}/{ma['longs']}", f"{mb['long_wins']}/{mb['longs']}", ""),
            ("Short Wins", f"{ma['short_wins']}/{ma['shorts']}", f"{mb['short_wins']}/{mb['shorts']}", ""),
        ]

        for label, va, vb, delta in rows:
            print(f"  {label:<25} {va:>12} {vb:>12} {delta:>12}")
        print()

    # ---------------------------------------------------------------------------
    # Aggregate totals
    # ---------------------------------------------------------------------------
    print("=" * 80)
    print("AGGREGATE (all 4 assets)")
    print("=" * 80)

    for config_key, label in [("baseline", "A) Baseline"), ("7d_delay", "B) 7d Delay")]:
        total_pnl = sum(m["total_pnl_usd"] for m in results[config_key].values())
        total_positions = sum(m["positions"] for m in results[config_key].values())
        total_wins = sum(m["long_wins"] + m["short_wins"] for m in results[config_key].values())
        avg_hold = (
            sum(m["avg_duration_days"] * m["positions"] for m in results[config_key].values())
            / total_positions if total_positions else 0
        )
        win_rate = total_wins / total_positions * 100 if total_positions else 0
        total_trails = sum(m["trailing_stop_closes"] for m in results[config_key].values())
        worst_loss = min(m["max_single_loss_pct"] for m in results[config_key].values())

        print(f"  {label}:")
        print(f"    Positions:      {total_positions}")
        print(f"    Total P&L:      ${total_pnl:+,.0f}")
        print(f"    Win Rate:       {win_rate:.1f}%")
        print(f"    Avg Hold:       {avg_hold:.1f} days")
        print(f"    Worst Loss:     {worst_loss:.1f}%")
        print(f"    Trail Exits:    {total_trails}")
        print()

    # Delta
    pnl_a = sum(m["total_pnl_usd"] for m in results["baseline"].values())
    pnl_b = sum(m["total_pnl_usd"] for m in results["7d_delay"].values())
    print(f"  P&L Delta (7d delay - baseline): ${pnl_b - pnl_a:+,.0f}")
    print()
    print("  Reference: wrapper approach showed +$4,301 delta.")
    print("  If integrated result differs, the gap represents second-order effects")
    print("  (new entries enabled by earlier trailing stop exits).")


if __name__ == "__main__":
    main()
