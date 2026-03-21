#!/usr/bin/env python3
"""
test_4h_bars.py — Research script: compare backtest results on 4h vs daily bars.

Context: Production signals run on 4-hour bars, but backtest.py uses daily candles.
This script tests whether the granularity difference affects signal timing, trade
count, or P&L.

Steps:
  1. Fetch 90 days of 4h BTC candles from Hyperliquid (as a manageable test)
  2. Fetch 90 days of daily BTC candles from Hyperliquid
  3. Run PROD_ACTUAL config on both datasets
  4. Compare signals and trades generated
  5. Report differences

Usage:
  python scripts/test_4h_bars.py
  python scripts/test_4h_bars.py --days 180
  python scripts/test_4h_bars.py --days 730 --asset bitcoin
"""

import sys
import os
import argparse
import time

import pandas as pd
import numpy as np
import requests

# ---------------------------------------------------------------------------
# Import from backtest.py (same directory)
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(__file__))
from backtest import (
    HYPERLIQUID_INFO_URL,
    HL_SLEEP_SECONDS,
    ASSETS_HL,
    PROD_ACTUAL,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    fetch_historical_ohlc_hyperliquid,
    POSITION_SIZE_USD,
)


# ---------------------------------------------------------------------------
# 1. Fetch 4h candles from Hyperliquid
# ---------------------------------------------------------------------------

def fetch_4h_ohlc_hyperliquid(coingecko_id: str, days: int = 90) -> pd.DataFrame:
    """
    Fetch 4-hour OHLC data from Hyperliquid's candleSnapshot API.

    Max 5,000 candles per request. At 6 candles/day, that covers ~833 days.
    For longer periods, paginates automatically.
    """
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(
            f"No Hyperliquid symbol mapping for '{coingecko_id}'. "
            f"Known: {list(ASSETS_HL.keys())}"
        )

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of 4h price data for '{symbol}' from Hyperliquid...")

    all_candles = []
    current_start = start_ms

    while current_start < end_ms:
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol,
                "interval": "4h",
                "startTime": current_start,
                "endTime": end_ms,
            },
        }

        for attempt in range(3):
            try:
                resp = requests.post(HYPERLIQUID_INFO_URL, json=payload, timeout=30)
                if resp.status_code == 429:
                    wait = 10 * (attempt + 1)
                    print(f"  Rate limited. Waiting {wait}s ({attempt + 1}/3)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"Hyperliquid API failed after 3 retries for {symbol}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Hyperliquid rate limit exceeded for {symbol}")

        candles = resp.json()
        if not candles:
            break

        all_candles.extend(candles)

        if len(candles) < 5000:
            break

        last_close_ms = candles[-1].get("T", candles[-1].get("t", 0))
        if last_close_ms <= current_start:
            break
        current_start = last_close_ms + 1
        time.sleep(HL_SLEEP_SECONDS)

    if not all_candles:
        raise ValueError(f"No 4h candle data returned from Hyperliquid for {symbol}")

    # Parse: {t, T, s, i, o, c, h, l, v, n}
    rows = []
    for c in all_candles:
        rows.append({
            "timestamp_ms": c["t"],
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c["v"]),
        })

    df = pd.DataFrame(rows)
    # Use datetime index (not date) since we have multiple bars per day
    df["datetime"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True)
    df = df.drop_duplicates(subset="datetime", keep="last")
    df = df.set_index("datetime").sort_index()
    df = df.drop(columns=["timestamp_ms"])

    # Trim to requested range
    from datetime import datetime, timezone
    cutoff = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    df = df[df.index >= cutoff]

    print(f"  Got {len(df)} 4h candles ({df.index[0]} to {df.index[-1]}) [Hyperliquid]")
    return df


def resample_4h_to_daily(df_4h: pd.DataFrame) -> pd.DataFrame:
    """
    Resample 4h bars to daily bars for cross-validation.
    This lets us verify the 4h data matches the daily data from HL.
    """
    daily = df_4h.resample("1D").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna()
    return daily


# ---------------------------------------------------------------------------
# 2. Analysis helpers
# ---------------------------------------------------------------------------

def summarize_trades(trades: list[dict], label: str) -> dict:
    """Produce summary stats for a trade list."""
    if not trades:
        return {"label": label, "count": 0}

    longs = [t for t in trades if t.get("direction") == "long"]
    shorts = [t for t in trades if t.get("direction") == "short"]
    trims = [t for t in trades if t.get("direction") == "trim"]
    bb2 = [t for t in trades if t.get("direction", "").startswith("bb2_")]

    total_pnl = sum(t.get("pnl_usd", 0) for t in trades)
    total_pnl_pct = sum(t.get("pnl_pct", 0) for t in trades)

    # Win rate (exclude trims)
    main_trades = [t for t in trades if t.get("direction") in ("long", "short")]
    wins = [t for t in main_trades if t.get("pnl_pct", 0) > 0]
    win_rate = len(wins) / len(main_trades) * 100 if main_trades else 0

    return {
        "label": label,
        "count": len(trades),
        "longs": len(longs),
        "shorts": len(shorts),
        "trims": len(trims),
        "bb2": len(bb2),
        "total_pnl_usd": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 2),
        "win_rate": round(win_rate, 1),
        "main_trades": len(main_trades),
        "wins": len(wins),
    }


def compare_signals(df_daily: pd.DataFrame, df_4h: pd.DataFrame) -> None:
    """Compare signal distributions between daily and 4h bar datasets."""
    print("\n" + "=" * 70)
    print("SIGNAL COMPARISON")
    print("=" * 70)

    for label, df in [("Daily", df_daily), ("4H", df_4h)]:
        colors = df["signal_color"].value_counts()
        reasons = df["signal_reason"].value_counts()
        print(f"\n--- {label} bars ({len(df)} total) ---")
        print(f"  Colors: {dict(colors)}")
        print(f"  Top reasons:")
        for reason, count in reasons.head(8).items():
            print(f"    {reason}: {count}")


def compare_trade_timing(daily_trades: list[dict], h4_trades: list[dict]) -> None:
    """Show entry/exit timing differences between daily and 4h trades."""
    print("\n" + "=" * 70)
    print("TRADE TIMING COMPARISON")
    print("=" * 70)

    for label, trades in [("Daily", daily_trades), ("4H", h4_trades)]:
        main = [t for t in trades if t.get("direction") in ("long", "short")]
        print(f"\n--- {label} main trades ({len(main)}) ---")
        for t in main[:15]:  # Show first 15
            direction = t.get("direction", "?")
            entry = t.get("entry_date", "?")
            exit_ = t.get("exit_date", "?")
            entry_p = t.get("entry_price", 0)
            exit_p = t.get("exit_price", 0)
            pnl = t.get("pnl_pct", 0)
            reason = t.get("exit_signal_reason", "?")
            print(f"  {direction:5s} {entry} -> {exit_} | entry=${entry_p:,.0f} exit=${exit_p:,.0f} | {pnl:+.1f}% | {reason}")
        if len(main) > 15:
            print(f"  ... and {len(main) - 15} more trades")


# ---------------------------------------------------------------------------
# 3. Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Compare backtest on 4h vs daily bars")
    parser.add_argument("--days", type=int, default=90, help="Days of history (default: 90)")
    parser.add_argument("--asset", type=str, default="bitcoin", help="CoinGecko ID (default: bitcoin)")
    args = parser.parse_args()

    days = args.days
    asset = args.asset
    config = PROD_ACTUAL.copy()

    print(f"{'=' * 70}")
    print(f"4H vs DAILY BAR COMPARISON")
    print(f"Asset: {asset} | Days: {days} | Config: {config['name']}")
    print(f"{'=' * 70}")

    # ── Step 1: Check 4h data availability ──
    print("\n[1/5] Fetching 4h candle data...")
    try:
        df_4h_raw = fetch_4h_ohlc_hyperliquid(asset, days)
    except Exception as e:
        print(f"\n  FAILED: 4h data not available: {e}")
        print("  Hyperliquid may not support 4h candles or history is insufficient.")
        sys.exit(1)

    expected_candles = days * 6  # 6 four-hour bars per day
    actual_candles = len(df_4h_raw)
    coverage_pct = actual_candles / expected_candles * 100
    print(f"  Coverage: {actual_candles}/{expected_candles} expected ({coverage_pct:.0f}%)")

    # ── Step 2: Fetch daily data for the same period ──
    print("\n[2/5] Fetching daily candle data...")
    df_daily_raw = fetch_historical_ohlc_hyperliquid(asset, days)

    # ── Step 3: Cross-validate by resampling 4h -> daily ──
    print("\n[3/5] Cross-validating 4h data against daily...")
    df_4h_resampled = resample_4h_to_daily(df_4h_raw)
    # Compare close prices on overlapping dates
    df_daily_raw_dt = df_daily_raw.copy()
    df_4h_resampled.index = df_4h_resampled.index.date  # Convert to date for comparison

    overlap_dates = sorted(set(df_daily_raw_dt.index) & set(df_4h_resampled.index))
    if overlap_dates:
        price_diffs = []
        for d in overlap_dates:
            daily_close = df_daily_raw_dt.loc[d, "close"]
            resampled_close = df_4h_resampled.loc[d, "close"]
            diff_pct = abs(daily_close - resampled_close) / daily_close * 100
            price_diffs.append(diff_pct)
        avg_diff = np.mean(price_diffs)
        max_diff = np.max(price_diffs)
        print(f"  Overlapping dates: {len(overlap_dates)}")
        print(f"  Close price difference (4h resampled vs daily): avg={avg_diff:.4f}%, max={max_diff:.4f}%")
        if avg_diff > 1.0:
            print("  WARNING: Large discrepancy between 4h and daily data sources!")
    else:
        print("  WARNING: No overlapping dates for cross-validation")

    # ── Step 4: Run backtest on both ──
    print("\n[4/5] Running backtest on daily bars...")
    df_daily = calculate_indicators(df_daily_raw, config=config)
    df_daily = generate_signals(df_daily, config=config)
    daily_trades = simulate_trades(df_daily, config=config, is_btc=(asset == "bitcoin"))

    print("\n[4/5] Running backtest on 4h bars...")
    df_4h = calculate_indicators(df_4h_raw, config=config)
    df_4h = generate_signals(df_4h, config=config)
    h4_trades = simulate_trades(df_4h, config=config, is_btc=(asset == "bitcoin"))

    # ── Step 5: Compare results ──
    print("\n[5/5] Comparing results...")

    daily_summary = summarize_trades(daily_trades, "Daily bars")
    h4_summary = summarize_trades(h4_trades, "4H bars")

    print("\n" + "=" * 70)
    print("SUMMARY COMPARISON")
    print("=" * 70)

    headers = ["Metric", "Daily", "4H", "Delta"]
    rows = [
        ("Total trades", daily_summary["count"], h4_summary["count"],
         h4_summary["count"] - daily_summary["count"]),
        ("Main trades (L+S)", daily_summary.get("main_trades", 0), h4_summary.get("main_trades", 0),
         h4_summary.get("main_trades", 0) - daily_summary.get("main_trades", 0)),
        ("Longs", daily_summary.get("longs", 0), h4_summary.get("longs", 0),
         h4_summary.get("longs", 0) - daily_summary.get("longs", 0)),
        ("Shorts", daily_summary.get("shorts", 0), h4_summary.get("shorts", 0),
         h4_summary.get("shorts", 0) - daily_summary.get("shorts", 0)),
        ("Trims", daily_summary.get("trims", 0), h4_summary.get("trims", 0),
         h4_summary.get("trims", 0) - daily_summary.get("trims", 0)),
        ("BB2 trades", daily_summary.get("bb2", 0), h4_summary.get("bb2", 0),
         h4_summary.get("bb2", 0) - daily_summary.get("bb2", 0)),
        ("Win rate %", daily_summary.get("win_rate", 0), h4_summary.get("win_rate", 0),
         h4_summary.get("win_rate", 0) - daily_summary.get("win_rate", 0)),
        ("Total P&L $", daily_summary.get("total_pnl_usd", 0), h4_summary.get("total_pnl_usd", 0),
         h4_summary.get("total_pnl_usd", 0) - daily_summary.get("total_pnl_usd", 0)),
        ("Total P&L %", daily_summary.get("total_pnl_pct", 0), h4_summary.get("total_pnl_pct", 0),
         h4_summary.get("total_pnl_pct", 0) - daily_summary.get("total_pnl_pct", 0)),
    ]

    # Print table
    print(f"\n  {'Metric':<20s} {'Daily':>10s} {'4H':>10s} {'Delta':>10s}")
    print(f"  {'-'*20} {'-'*10} {'-'*10} {'-'*10}")
    for metric, daily_val, h4_val, delta in rows:
        if isinstance(daily_val, float):
            print(f"  {metric:<20s} {daily_val:>10.1f} {h4_val:>10.1f} {delta:>+10.1f}")
        else:
            print(f"  {metric:<20s} {daily_val:>10d} {h4_val:>10d} {delta:>+10d}")

    # Signal distribution
    compare_signals(df_daily, df_4h)

    # Trade timing
    compare_trade_timing(daily_trades, h4_trades)

    # ── Key observations ──
    print("\n" + "=" * 70)
    print("KEY OBSERVATIONS")
    print("=" * 70)

    bar_ratio = len(df_4h) / len(df_daily) if len(df_daily) > 0 else 0
    print(f"\n  Bar count ratio: {len(df_4h)} 4h / {len(df_daily)} daily = {bar_ratio:.1f}x")

    trade_ratio = h4_summary["count"] / daily_summary["count"] if daily_summary["count"] > 0 else float("inf")
    print(f"  Trade count ratio: {h4_summary['count']} 4h / {daily_summary['count']} daily = {trade_ratio:.1f}x")

    pnl_diff = h4_summary.get("total_pnl_usd", 0) - daily_summary.get("total_pnl_usd", 0)
    print(f"  P&L difference: ${pnl_diff:+.2f}")

    print(f"\n  IMPORTANT CAVEATS:")
    print(f"  - The backtest indicator periods (EMA-9, EMA-21, RSI-14, SMA-50, ADX-14)")
    print(f"    are in BARS, not time. On 4h bars, EMA-9 = 36 hours, not 9 days.")
    print(f"    This means 4h indicators react much faster than daily indicators.")
    print(f"  - Production uses 4h bars with these same period lengths, so the 4h")
    print(f"    backtest is actually MORE representative of production behavior.")
    print(f"  - However, more signals = more trades = more fees in practice.")
    print(f"  - The anti-whipsaw window and cooldown bars also scale differently.")
    print(f"  - Grace period, BB2 hold days, and trailing stop delay are in BARS,")
    print(f"    so they represent 4x shorter durations on 4h bars.")

    print(f"\n  TO MAKE 4H BACKTEST MATCH PRODUCTION TIMING:")
    print(f"  - Multiply all bar-denominated config values by 6:")
    print(f"    anti_whipsaw_window: {config.get('anti_whipsaw_window', 5)} -> {config.get('anti_whipsaw_window', 5) * 6}")
    print(f"    grace_period_days: {config.get('grace_period_days', 0)} -> {config.get('grace_period_days', 0) * 6}")
    print(f"    ema_cooldown_bars: {config.get('ema_cooldown_bars', 0)} -> {config.get('ema_cooldown_bars', 0) * 6}")
    print(f"    bb_improved_hold_days: {config.get('bb_improved_hold_days', 2)} -> {config.get('bb_improved_hold_days', 2) * 6}")
    print(f"  - OR adjust indicator periods to compensate:")
    print(f"    EMA 9/21 -> EMA 54/126 (to match daily lookback in hours)")
    print(f"    RSI 14 -> RSI 84, SMA 50 -> SMA 300, ADX 14 -> ADX 84")


if __name__ == "__main__":
    main()
