#!/usr/bin/env python3
"""
Bear/Choppy Market Backtest — Trailing Stop Isolation
=====================================================
Tests whether removing the trailing stop still outperforms during the
adverse market period from mid-October 2025 to March 2026 (~160 days).

Two configs compared:
  1. Baseline: V9_ATR_2_0X (production)
  2. No trailing stop: V9_ATR_2_0X with trailing stops disabled

Metrics: P&L, win rate, max drawdown, longest losing streak,
         Sharpe-like ratio, worst/best single trade.

Usage:
    python3 scripts/bear_market_backtest.py
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

# ---------------------------------------------------------------------------
# Configs
# ---------------------------------------------------------------------------
BEAR_START = pd.Timestamp("2025-10-15", tz="UTC")
FETCH_DAYS = 180  # buffer for indicator warmup

CONFIGS = {
    "baseline": {
        **V9_ATR_2_0X,
        "name": "V9_ATR_2_0X (baseline)",
    },
    "no_trail": {
        **V9_ATR_2_0X,
        "name": "V9 — No trailing stop",
        "trailing_stop_long": False,
        "trailing_stop_short": False,
    },
}

ASSETS = ["bitcoin", "ethereum", "hyperliquid", "solana"]


# ---------------------------------------------------------------------------
# Extended metrics
# ---------------------------------------------------------------------------
def compute_extended_metrics(trades: list[dict]) -> dict:
    """Compute comprehensive metrics including drawdown, streaks, Sharpe."""
    closed = [t for t in trades if t.get("status") == "closed"]

    if not closed:
        return {
            "total_trades": 0,
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "avg_hold_days": 0.0,
            "avg_pnl_per_trade": 0.0,
            "max_drawdown": 0.0,
            "longest_losing_streak": 0,
            "sharpe_like": 0.0,
            "worst_trade_pnl": 0.0,
            "worst_trade_asset": "N/A",
            "best_trade_pnl": 0.0,
            "best_trade_asset": "N/A",
        }

    pnls = [t["pnl_usd"] for t in closed]
    total_pnl = sum(pnls)
    total = len(closed)
    wins = sum(1 for p in pnls if p > 0)
    win_rate = wins / total * 100

    # Hold days
    hold_days_list = []
    for t in closed:
        try:
            entry = pd.Timestamp(t["entry_date"])
            exit_ = pd.Timestamp(t["exit_date"])
            hold_days_list.append((exit_ - entry).total_seconds() / 86400)
        except Exception:
            pass
    avg_hold = np.mean(hold_days_list) if hold_days_list else 0.0

    # Max drawdown (peak-to-trough on cumulative P&L)
    cum_pnl = np.cumsum(pnls)
    running_max = np.maximum.accumulate(cum_pnl)
    drawdowns = cum_pnl - running_max
    max_drawdown = float(np.min(drawdowns))  # most negative

    # Longest losing streak
    longest_losing = 0
    current_losing = 0
    for p in pnls:
        if p <= 0:
            current_losing += 1
            longest_losing = max(longest_losing, current_losing)
        else:
            current_losing = 0

    # Sharpe-like ratio: mean daily P&L / std daily P&L
    # Approximate: spread each trade's P&L across its hold days
    daily_pnls = []
    for t in closed:
        try:
            entry = pd.Timestamp(t["entry_date"])
            exit_ = pd.Timestamp(t["exit_date"])
            days_held = max((exit_ - entry).total_seconds() / 86400, 1)
            daily_pnl = t["pnl_usd"] / days_held
            for _ in range(int(round(days_held))):
                daily_pnls.append(daily_pnl)
        except Exception:
            daily_pnls.append(t["pnl_usd"])

    if daily_pnls and np.std(daily_pnls) > 0:
        sharpe_like = float(np.mean(daily_pnls) / np.std(daily_pnls))
    else:
        sharpe_like = 0.0

    # Worst / best single trade
    worst_idx = int(np.argmin(pnls))
    best_idx = int(np.argmax(pnls))

    return {
        "total_trades": total,
        "total_pnl": total_pnl,
        "win_rate": win_rate,
        "avg_hold_days": avg_hold,
        "avg_pnl_per_trade": total_pnl / total,
        "max_drawdown": max_drawdown,
        "longest_losing_streak": longest_losing,
        "sharpe_like": sharpe_like,
        "worst_trade_pnl": pnls[worst_idx],
        "worst_trade_asset": closed[worst_idx].get("asset", "?"),
        "best_trade_pnl": pnls[best_idx],
        "best_trade_asset": closed[best_idx].get("asset", "?"),
    }


# ---------------------------------------------------------------------------
# Filter trades to bear period only
# ---------------------------------------------------------------------------
def filter_trades_to_bear_period(trades: list[dict]) -> list[dict]:
    """Keep only trades entered on or after BEAR_START."""
    filtered = []
    for t in trades:
        try:
            entry = pd.Timestamp(t["entry_date"])
            if entry.tzinfo is None:
                entry = entry.tz_localize("UTC")
            if entry >= BEAR_START:
                filtered.append(t)
        except Exception:
            pass
    return filtered


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 110)
    print("BEAR/CHOPPY MARKET BACKTEST — TRAILING STOP ISOLATION")
    print(f"Period: {BEAR_START.strftime('%Y-%m-%d')} to present (~160 days)")
    print(f"Assets: {', '.join(ASSETS)} | Position: ${POSITION_SIZE_USD:,}")
    print(f"Configs: Baseline (V9_ATR_2_0X) vs No Trailing Stop")
    print("=" * 110)

    # ----- Step 1: Fetch data -----
    raw_data = {}

    # BTC first (needed for crash filter)
    print(f"\nFetching bitcoin (for crash filter)...")
    try:
        btc_raw = fetch_ohlc("bitcoin", FETCH_DAYS)
        if btc_raw is not None and len(btc_raw) >= 50:
            raw_data["bitcoin"] = btc_raw
            print(f"  Got {len(btc_raw)} candles")
        else:
            print(f"  Insufficient BTC data")
    except Exception as e:
        print(f"  Failed: {e}")
    time.sleep(2)

    for cg_id in ASSETS:
        if cg_id == "bitcoin":
            continue
        print(f"Fetching {cg_id}...")
        try:
            df = fetch_ohlc(cg_id, FETCH_DAYS)
            if df is not None and len(df) >= 50:
                raw_data[cg_id] = df
                print(f"  Got {len(df)} candles")
            else:
                print(f"  Insufficient data")
        except Exception as e:
            print(f"  Failed: {e}")
        time.sleep(2)

    if not raw_data:
        print("\nNo data fetched. Exiting.")
        return

    print(f"\nData ready for: {', '.join(raw_data.keys())}")

    # ----- Step 2: Run both configs -----
    all_results = {}  # config_key -> {"metrics": ..., "per_asset": ...}

    for cfg_key, cfg in CONFIGS.items():
        print(f"\n{'─' * 80}")
        print(f"Running: {cfg['name']}")
        print(f"{'─' * 80}")

        all_trades = []

        # BTC indicators (for crash filter)
        btc_df_with_signals = None
        if "bitcoin" in raw_data:
            btc_copy = raw_data["bitcoin"].copy()
            btc_copy = calculate_indicators(btc_copy, cfg)
            btc_copy = generate_signals(btc_copy, cfg)
            btc_df_with_signals = btc_copy

        per_asset_metrics = {}

        for cg_id in raw_data:
            is_btc = cg_id == "bitcoin"

            if is_btc and btc_df_with_signals is not None:
                df_ready = btc_df_with_signals
            else:
                df_copy = raw_data[cg_id].copy()
                df_copy = calculate_indicators(df_copy, cfg)
                df_copy = generate_signals(df_copy, cfg)
                df_ready = df_copy

            trades = simulate_trades(
                df_ready,
                POSITION_SIZE_USD,
                cfg,
                btc_df=btc_df_with_signals if not is_btc else None,
                is_btc=is_btc,
            )

            # Tag with asset
            for t in trades:
                t["asset"] = cg_id

            # Filter to bear period
            bear_trades = filter_trades_to_bear_period(trades)
            closed_bear = [t for t in bear_trades if t.get("status") == "closed"]
            long_count = sum(1 for t in closed_bear if t.get("direction") == "long")
            short_count = sum(1 for t in closed_bear if t.get("direction") == "short")
            print(f"  {cg_id}: {len(closed_bear)} closed trades in bear period ({long_count}L, {short_count}S)")

            all_trades.extend(bear_trades)
            per_asset_metrics[cg_id] = compute_extended_metrics(bear_trades)

        agg_metrics = compute_extended_metrics(all_trades)
        all_results[cfg_key] = {
            "metrics": agg_metrics,
            "per_asset": per_asset_metrics,
            "config_name": cfg["name"],
        }

        m = agg_metrics
        print(f"  => {m['total_trades']} trades, ${m['total_pnl']:+.2f} P&L, "
              f"{m['win_rate']:.1f}% win rate, {m['avg_hold_days']:.1f}d avg hold")

    # ----- Step 3: Comparison table -----
    print(f"\n\n{'=' * 110}")
    print("COMPARISON TABLE — Bear/Choppy Period (Oct 15 2025 – Mar 2026)")
    print(f"{'=' * 110}")

    header = (
        f"{'Metric':<30} "
        f"{'Baseline':>18} "
        f"{'No Trail':>18} "
        f"{'Delta':>14}"
    )
    print(header)
    print("-" * 82)

    bl = all_results["baseline"]["metrics"]
    nt = all_results["no_trail"]["metrics"]

    rows = [
        ("Total Trades", f"{bl['total_trades']}", f"{nt['total_trades']}",
         f"{nt['total_trades'] - bl['total_trades']:+d}"),
        ("Total P&L", f"${bl['total_pnl']:+.2f}", f"${nt['total_pnl']:+.2f}",
         f"${nt['total_pnl'] - bl['total_pnl']:+.2f}"),
        ("Win Rate", f"{bl['win_rate']:.1f}%", f"{nt['win_rate']:.1f}%",
         f"{nt['win_rate'] - bl['win_rate']:+.1f}pp"),
        ("Avg P&L / Trade", f"${bl['avg_pnl_per_trade']:+.2f}", f"${nt['avg_pnl_per_trade']:+.2f}",
         f"${nt['avg_pnl_per_trade'] - bl['avg_pnl_per_trade']:+.2f}"),
        ("Avg Hold Days", f"{bl['avg_hold_days']:.1f}d", f"{nt['avg_hold_days']:.1f}d",
         f"{nt['avg_hold_days'] - bl['avg_hold_days']:+.1f}d"),
        ("Max Drawdown", f"${bl['max_drawdown']:.2f}", f"${nt['max_drawdown']:.2f}",
         f"${nt['max_drawdown'] - bl['max_drawdown']:+.2f}"),
        ("Longest Losing Streak", f"{bl['longest_losing_streak']}", f"{nt['longest_losing_streak']}",
         f"{nt['longest_losing_streak'] - bl['longest_losing_streak']:+d}"),
        ("Sharpe-like Ratio", f"{bl['sharpe_like']:.3f}", f"{nt['sharpe_like']:.3f}",
         f"{nt['sharpe_like'] - bl['sharpe_like']:+.3f}"),
        ("Worst Trade", f"${bl['worst_trade_pnl']:.2f} ({bl['worst_trade_asset']})",
         f"${nt['worst_trade_pnl']:.2f} ({nt['worst_trade_asset']})", ""),
        ("Best Trade", f"${bl['best_trade_pnl']:.2f} ({bl['best_trade_asset']})",
         f"${nt['best_trade_pnl']:.2f} ({nt['best_trade_asset']})", ""),
    ]

    for label, v1, v2, delta in rows:
        print(f"{label:<30} {v1:>18} {v2:>18} {delta:>14}")

    # ----- Step 4: Per-asset breakdown -----
    print(f"\n\n{'=' * 110}")
    print("PER-ASSET BREAKDOWN")
    print(f"{'=' * 110}")

    for cg_id in ASSETS:
        if cg_id not in raw_data:
            continue
        print(f"\n  {cg_id.upper()}")
        print(f"  {'Metric':<28} {'Baseline':>16} {'No Trail':>16} {'Delta':>14}")
        print(f"  {'-' * 76}")

        bm = all_results["baseline"]["per_asset"].get(cg_id, {})
        nm = all_results["no_trail"]["per_asset"].get(cg_id, {})

        if not bm or not nm:
            print(f"  (no data)")
            continue

        asset_rows = [
            ("Trades", f"{bm.get('total_trades', 0)}", f"{nm.get('total_trades', 0)}",
             f"{nm.get('total_trades', 0) - bm.get('total_trades', 0):+d}"),
            ("P&L", f"${bm.get('total_pnl', 0):+.2f}", f"${nm.get('total_pnl', 0):+.2f}",
             f"${nm.get('total_pnl', 0) - bm.get('total_pnl', 0):+.2f}"),
            ("Win Rate", f"{bm.get('win_rate', 0):.1f}%", f"{nm.get('win_rate', 0):.1f}%",
             f"{nm.get('win_rate', 0) - bm.get('win_rate', 0):+.1f}pp"),
            ("Avg Hold Days", f"{bm.get('avg_hold_days', 0):.1f}d", f"{nm.get('avg_hold_days', 0):.1f}d",
             f"{nm.get('avg_hold_days', 0) - bm.get('avg_hold_days', 0):+.1f}d"),
            ("Max Drawdown", f"${bm.get('max_drawdown', 0):.2f}", f"${nm.get('max_drawdown', 0):.2f}",
             f"${nm.get('max_drawdown', 0) - bm.get('max_drawdown', 0):+.2f}"),
        ]

        for label, v1, v2, delta in asset_rows:
            print(f"  {label:<28} {v1:>16} {v2:>16} {delta:>14}")

    print(f"\n{'=' * 110}")
    print("DONE — Bear/Choppy Market Backtest")
    print(f"{'=' * 110}")


if __name__ == "__main__":
    main()
