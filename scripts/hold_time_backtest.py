#!/usr/bin/env python3
"""
Hold Time Backtest — Exit Strategy Relaxation
==============================================
Tests whether relaxing exit strategies (profit ladder, trailing stops, grace period)
improves returns, based on the finding that winners hold longer (5.9d avg) vs
losers (4.0d avg, +0.386 correlation).

Hypothesis: the profit ladder and trailing stops may be cutting winners short.

Variants tested (all based on V9_ATR_2_0X production baseline):
  a) No profit ladder
  b) Relaxed profit ladder (levels at 20/35/50 instead of 15/25/35)
  c) Wider trailing stop (8% activation, 4% trail vs 5%/2.5%)
  d) No trailing stop
  e) Longer grace period (7 days vs 5)
  f) Longer grace + relaxed ladder (b + e)
  g) Longer grace + wider trail (c + e)
  h) Full relaxed (b + c + e)

Usage:
    python3 scripts/hold_time_backtest.py
    python3 scripts/hold_time_backtest.py --days 365
"""

import argparse
import sys
import time
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

# Production baseline
ACTIVE_CONFIG = V9_ATR_2_0X

# ---------------------------------------------------------------------------
# Variant configs — each modifies V9_ATR_2_0X
# ---------------------------------------------------------------------------

VARIANTS = {
    # ── Baseline ──
    "baseline": {
        **V9_ATR_2_0X,
        "name": "Baseline (V9_ATR_2_0X)",
    },
    # ── Reference: no trailing stop (best from round 1) ──
    "d_no_trail": {
        **V9_ATR_2_0X,
        "name": "D: No trailing stop",
        "trailing_stop_long": False,
        "trailing_stop_short": False,
    },

    # ── Experiment 1: ATR-scaled trailing stop ──
    # Instead of fixed 5%/2.5%, trail at N x ATR(14).
    # Low-vol = tight trail, high-vol = wide trail.
    "atr_trail_1_5x_0_75x": {
        **V9_ATR_2_0X,
        "name": "ATR trail: 1.5x act / 0.75x trail",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 1.5,
        "trailing_stop_atr_trail": 0.75,
    },
    "atr_trail_2x_1x": {
        **V9_ATR_2_0X,
        "name": "ATR trail: 2.0x act / 1.0x trail",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 2.0,
        "trailing_stop_atr_trail": 1.0,
    },
    "atr_trail_2_5x_1_25x": {
        **V9_ATR_2_0X,
        "name": "ATR trail: 2.5x act / 1.25x trail",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 2.5,
        "trailing_stop_atr_trail": 1.25,
    },
    "atr_trail_3x_1_5x": {
        **V9_ATR_2_0X,
        "name": "ATR trail: 3.0x act / 1.5x trail",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 3.0,
        "trailing_stop_atr_trail": 1.5,
    },

    # ── Experiment 2: Time-delayed trailing stop ──
    # Only activate trail after N bars (days) in position.
    # Lets early winners run, protects extended ones.
    "delay_5bars": {
        **V9_ATR_2_0X,
        "name": "Trail delay: 5 bars (5d)",
        "trailing_stop_delay_bars": 5,
    },
    "delay_7bars": {
        **V9_ATR_2_0X,
        "name": "Trail delay: 7 bars (7d)",
        "trailing_stop_delay_bars": 7,
    },
    "delay_10bars": {
        **V9_ATR_2_0X,
        "name": "Trail delay: 10 bars (10d)",
        "trailing_stop_delay_bars": 10,
    },
    "delay_14bars": {
        **V9_ATR_2_0X,
        "name": "Trail delay: 14 bars (14d)",
        "trailing_stop_delay_bars": 14,
    },

    # ── Experiment 3: Direction-specific trailing stop ──
    # Hypothesis: shorts reverse faster, so trail is correct for shorts.
    # Longs trend longer, so trail hurts longs more.
    "trail_short_only": {
        **V9_ATR_2_0X,
        "name": "Trail shorts only (no long trail)",
        "trailing_stop_long": False,
        "trailing_stop_short": True,
    },
    "trail_long_only": {
        **V9_ATR_2_0X,
        "name": "Trail longs only (no short trail)",
        "trailing_stop_long": True,
        "trailing_stop_short": False,
    },

    # ── Best combos (hypothetical — see which components win) ──
    "atr_trail_short_only": {
        **V9_ATR_2_0X,
        "name": "ATR 2x/1x trail on shorts only",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 2.0,
        "trailing_stop_atr_trail": 1.0,
        "trailing_stop_long": False,
        "trailing_stop_short": True,
    },
    "delay_10_atr_2x": {
        **V9_ATR_2_0X,
        "name": "ATR 2x/1x + 10-bar delay",
        "trailing_stop_atr_mode": True,
        "trailing_stop_atr_activation": 2.0,
        "trailing_stop_atr_trail": 1.0,
        "trailing_stop_delay_bars": 10,
    },
    "delay_7_short_only": {
        **V9_ATR_2_0X,
        "name": "7-bar delay + shorts only",
        "trailing_stop_delay_bars": 7,
        "trailing_stop_long": False,
        "trailing_stop_short": True,
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def compute_metrics(trades: list[dict]) -> dict:
    """Compute summary metrics for a list of trades."""
    if not trades:
        return {
            "total_trades": 0,
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "avg_hold_days": 0.0,
            "avg_pnl_per_trade": 0.0,
        }

    closed = [t for t in trades if t.get("status") == "closed"]
    if not closed:
        return {
            "total_trades": 0,
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "avg_hold_days": 0.0,
            "avg_pnl_per_trade": 0.0,
        }

    total = len(closed)
    pnls = [t["pnl_usd"] for t in closed]
    total_pnl = sum(pnls)
    wins = sum(1 for p in pnls if p > 0)
    win_rate = wins / total * 100 if total > 0 else 0

    # Hold days from entry/exit dates
    hold_days_list = []
    for t in closed:
        try:
            entry = pd.Timestamp(t["entry_date"])
            exit_ = pd.Timestamp(t["exit_date"])
            hold = (exit_ - entry).total_seconds() / 86400
            hold_days_list.append(hold)
        except Exception:
            pass

    avg_hold = np.mean(hold_days_list) if hold_days_list else 0
    avg_pnl = total_pnl / total if total > 0 else 0

    return {
        "total_trades": total,
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "avg_hold_days": avg_hold,
        "avg_pnl_per_trade": avg_pnl,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Hold time / exit relaxation backtest")
    parser.add_argument("--days", type=int, default=730, help="Lookback days")
    args = parser.parse_args()

    print("=" * 100)
    print("HOLD TIME BACKTEST — EXIT STRATEGY RELAXATION")
    print(f"Baseline: V9_ATR_2_0X (profit ladder 15/25/35, trail 5%/2.5%, grace 5d, ATR 2.0x stop)")
    print(f"Assets: {', '.join(ASSETS_HL.keys())} | Lookback: {args.days} days | Position: ${POSITION_SIZE_USD}")
    print("=" * 100)

    # ----- Step 1: Fetch OHLC data once for all assets -----
    raw_data = {}  # cg_id -> raw DataFrame (before indicators)

    # Fetch BTC first for crash filtering
    print(f"\nFetching bitcoin (for crash filter)...")
    try:
        btc_raw = fetch_ohlc("bitcoin", args.days)
        if btc_raw is not None and len(btc_raw) >= 50:
            raw_data["bitcoin"] = btc_raw
            print(f"  Got {len(btc_raw)} candles")
        else:
            print(f"  Insufficient BTC data ({len(btc_raw) if btc_raw is not None else 0} rows)")
    except Exception as e:
        print(f"  Failed to fetch BTC: {e}")
    time.sleep(2)

    # Fetch remaining assets
    for cg_id in ASSETS_HL:
        if cg_id == "bitcoin":
            continue
        print(f"Fetching {cg_id}...")
        try:
            df = fetch_ohlc(cg_id, args.days)
            if df is not None and len(df) >= 50:
                raw_data[cg_id] = df
                print(f"  Got {len(df)} candles")
            else:
                print(f"  Insufficient data ({len(df) if df is not None else 0} rows)")
        except Exception as e:
            print(f"  Failed to fetch {cg_id}: {e}")
        time.sleep(2)

    if not raw_data:
        print("\nNo data fetched. Exiting.")
        return

    print(f"\nData fetched for: {', '.join(raw_data.keys())}")

    # ----- Step 2: Run each variant across all assets -----
    results = {}  # variant_name -> metrics dict

    for var_name, var_config in VARIANTS.items():
        print(f"\n{'─' * 60}")
        print(f"Running: {var_config['name']}")
        print(f"{'─' * 60}")

        all_trades = []

        # Compute indicators + signals for BTC with this config (needed for crash filter)
        btc_df_with_signals = None
        if "bitcoin" in raw_data:
            btc_copy = raw_data["bitcoin"].copy()
            btc_copy = calculate_indicators(btc_copy, var_config)
            btc_copy = generate_signals(btc_copy, var_config)
            btc_df_with_signals = btc_copy

        for cg_id in raw_data:
            is_btc = cg_id == "bitcoin"

            if is_btc and btc_df_with_signals is not None:
                df_ready = btc_df_with_signals
            else:
                df_copy = raw_data[cg_id].copy()
                df_copy = calculate_indicators(df_copy, var_config)
                df_copy = generate_signals(df_copy, var_config)
                df_ready = df_copy

            trades = simulate_trades(
                df_ready,
                POSITION_SIZE_USD,
                var_config,
                btc_df=btc_df_with_signals if not is_btc else None,
                is_btc=is_btc,
            )

            # Tag with asset
            for t in trades:
                t["asset"] = cg_id

            closed = [t for t in trades if t.get("status") == "closed"]
            long_count = sum(1 for t in closed if t.get("direction") == "long")
            short_count = sum(1 for t in closed if t.get("direction") == "short")
            print(f"  {cg_id}: {len(closed)} closed trades ({long_count}L, {short_count}S)")

            all_trades.extend(trades)

        metrics = compute_metrics(all_trades)
        results[var_name] = {
            "config_name": var_config["name"],
            **metrics,
        }

        print(f"  => {metrics['total_trades']} trades, ${metrics['total_pnl']:+.2f} P&L, "
              f"{metrics['win_rate']:.1f}% win rate, {metrics['avg_hold_days']:.1f}d avg hold")

    # ----- Step 3: Print comparison table -----
    print(f"\n\n{'=' * 120}")
    print("COMPARISON TABLE")
    print(f"{'=' * 120}")
    print(f"{'Config':<45} {'Trades':>7} {'Total P&L':>12} {'Win Rate':>10} {'Avg Hold':>10} {'Avg P&L/Trade':>15}")
    print("-" * 120)

    baseline_pnl = results.get("baseline", {}).get("total_pnl", 0)

    for var_name, m in results.items():
        delta = m["total_pnl"] - baseline_pnl
        delta_str = " ({:+.2f})".format(delta) if var_name != "baseline" else ""
        pnl_str = "${:+.2f}".format(m["total_pnl"])
        avg_str = "${:+.2f}".format(m["avg_pnl_per_trade"])
        print(
            "{:<45} {:>7} {:>12}{:<14} {:.1f}%{:<5} {:.1f}d{:<5} {:>15}".format(
                m["config_name"],
                m["total_trades"],
                pnl_str, delta_str,
                m["win_rate"], "",
                m["avg_hold_days"], "",
                avg_str,
            )
        )

    # ----- Step 4: Per-asset breakdown for each variant -----
    print(f"\n\n{'=' * 120}")
    print("PER-ASSET BREAKDOWN")
    print(f"{'=' * 120}")

    # Re-run to get per-asset detail (quick since no fetching)
    for var_name, var_config in VARIANTS.items():
        print(f"\n  {var_config['name']}")
        print(f"  {'Asset':<15} {'Trades':>7} {'P&L':>12} {'Win Rate':>10} {'Avg Hold':>10} {'Avg P&L/Trade':>15}")
        print(f"  {'-' * 80}")

        btc_df_with_signals = None
        if "bitcoin" in raw_data:
            btc_copy = raw_data["bitcoin"].copy()
            btc_copy = calculate_indicators(btc_copy, var_config)
            btc_copy = generate_signals(btc_copy, var_config)
            btc_df_with_signals = btc_copy

        for cg_id in raw_data:
            is_btc = cg_id == "bitcoin"
            if is_btc and btc_df_with_signals is not None:
                df_ready = btc_df_with_signals
            else:
                df_copy = raw_data[cg_id].copy()
                df_copy = calculate_indicators(df_copy, var_config)
                df_copy = generate_signals(df_copy, var_config)
                df_ready = df_copy

            trades = simulate_trades(
                df_ready, POSITION_SIZE_USD, var_config,
                btc_df=btc_df_with_signals if not is_btc else None,
                is_btc=is_btc,
            )
            for t in trades:
                t["asset"] = cg_id

            m = compute_metrics(trades)
            pnl_str = "${:+.2f}".format(m["total_pnl"])
            avg_str = "${:+.2f}".format(m["avg_pnl_per_trade"])
            print(
                "  {:<15} {:>7} {:>12} {:.1f}%{:<5} {:.1f}d{:<5} {:>15}".format(
                    cg_id,
                    m["total_trades"],
                    pnl_str,
                    m["win_rate"], "",
                    m["avg_hold_days"], "",
                    avg_str,
                )
            )

    print(f"\n{'=' * 120}")
    print("DONE")
    print(f"{'=' * 120}")


if __name__ == "__main__":
    main()
