#!/usr/bin/env python3
"""
Momentum Detector Backtest
===========================
Tests whether a fast-loop momentum detector that triggers early signal
evaluation would have improved entry timing for HYPE over 365 days.

Compares 3 strategies against the same 4H + 30m OHLCV data:

  A) BASELINE — current system. Evaluate signals every 4H candle close.
  B) MOMENTUM DETECTOR — same V6D rules, but a fast 30m scanner detects
     price acceleration and triggers early evaluation mid-candle.
  C) MOMENTUM + BB2 FAST — same as B, plus checks BB2 entry conditions
     on the 30m loop to catch mean-reversion setups that start/resolve
     between 4H windows.

Momentum detector fires when:
  - Price moves >X% in a rolling 2H window (4 × 30m bars)
  - Volume spike above threshold (empirically calibrated from data)

Usage:
    python scripts/momentum_detector_backtest.py
    python scripts/momentum_detector_backtest.py --days 365 --asset HYPE
    python scripts/momentum_detector_backtest.py --analyze-volume  # volume spike analysis only
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import numpy as np
import requests

# ---------------------------------------------------------------------------
# Hyperliquid API
# ---------------------------------------------------------------------------

HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"
HL_SLEEP_SECONDS = 2

# Import signal logic from main backtest
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (
    calculate_indicators,
    evaluate_signal,
    check_yellow_events,
    V6D_TRAILING_BOTH,
    POSITION_SIZE_USD,
)


# ---------------------------------------------------------------------------
# Data fetching — supports multiple intervals
# ---------------------------------------------------------------------------

def fetch_candles(coin: str, interval: str, days: int = 365) -> pd.DataFrame:
    """
    Fetch OHLCV candles from Hyperliquid's candleSnapshot API.

    Args:
        coin: Symbol (e.g., "HYPE", "BTC")
        interval: Candle interval ("4h", "1h", "30m", "15m")
        days: Lookback period

    Returns:
        DataFrame indexed by UTC datetime with OHLCV columns.
    """
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of {interval} candles for {coin}...")

    all_candles = []
    current_start = start_ms

    while current_start < end_ms:
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": coin,
                "interval": interval,
                "startTime": current_start,
                "endTime": end_ms,
            },
        }

        for attempt in range(3):
            try:
                resp = requests.post(HYPERLIQUID_INFO_URL, json=payload, timeout=30)
                if resp.status_code == 429:
                    wait = 10 * (attempt + 1)
                    print(f"    Rate limited. Waiting {wait}s ({attempt + 1}/3)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"HL API failed after 3 retries for {coin}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Rate limit exceeded for {coin}")

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
        raise ValueError(f"No candle data returned for {coin} ({interval})")

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
    df["datetime"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True)
    df = df.drop_duplicates(subset="datetime", keep="last")
    df = df.set_index("datetime").sort_index()

    # Trim to requested date range
    cutoff = pd.Timestamp.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    df = df[df.index >= cutoff]

    print(f"    Got {len(df)} candles ({df.index[0]} to {df.index[-1]})")
    return df


# ---------------------------------------------------------------------------
# Volume spike analysis — empirical breakout characterization
# ---------------------------------------------------------------------------

def analyze_volume_at_breakouts(df_4h: pd.DataFrame, df_30m: pd.DataFrame) -> dict:
    """
    Analyze what volume increases typically accompany the early phase of
    breakouts in HYPE. Used to calibrate the momentum detector threshold.

    A "breakout" is defined as a 4H bar where price moves >3% AND an EMA
    cross occurs (or is about to occur). We then look at the 30m bars within
    that 4H window and measure volume ratios vs the 20-period SMA.

    Returns dict with statistics.
    """
    print("\n" + "=" * 70)
    print("  VOLUME SPIKE ANALYSIS — Breakout Characterization")
    print("=" * 70)

    # Calculate 4H indicators to find signal change bars
    df_4h_ind = calculate_indicators(df_4h.copy())

    # Find bars with significant moves (>2% in a single 4H bar)
    df_4h_ind["bar_return_pct"] = (
        (df_4h_ind["close"] - df_4h_ind["open"]) / df_4h_ind["open"] * 100
    )
    big_moves = df_4h_ind[df_4h_ind["bar_return_pct"].abs() >= 2.0]

    print(f"\n  Found {len(big_moves)} 4H bars with >2% moves (out of {len(df_4h_ind)} total)")

    # For the 30m data, calculate rolling volume average
    df_30m = df_30m.copy()
    df_30m["vol_sma_20"] = df_30m["volume"].rolling(20, min_periods=5).mean()
    df_30m["vol_ratio"] = df_30m["volume"] / df_30m["vol_sma_20"].replace(0, np.nan)
    df_30m["price_change_2h"] = df_30m["close"].pct_change(4) * 100  # 4 × 30m = 2H

    # For each big 4H move, find the 30m bars within that window
    # and characterize the volume at the START of the move
    early_vol_ratios = []
    early_price_deltas = []

    for idx, row in big_moves.iterrows():
        candle_start = idx
        candle_end = idx + pd.Timedelta(hours=4)

        # Get 30m bars within this 4H window
        mask = (df_30m.index >= candle_start) & (df_30m.index < candle_end)
        intra_bars = df_30m[mask]

        if len(intra_bars) < 2:
            continue

        # Look at the first half of the window (early phase)
        first_half = intra_bars.iloc[:len(intra_bars) // 2]
        if len(first_half) == 0:
            continue

        # Volume ratio at the start of the breakout
        for _, bar in first_half.iterrows():
            if not np.isnan(bar["vol_ratio"]) and bar["vol_ratio"] > 0:
                early_vol_ratios.append(bar["vol_ratio"])

        # Price change in first 2H of the 4H bar
        first_price = intra_bars.iloc[0]["open"]
        mid_price = intra_bars.iloc[len(intra_bars) // 2]["close"]
        delta = (mid_price - first_price) / first_price * 100
        early_price_deltas.append(abs(delta))

    if not early_vol_ratios:
        print("  No valid breakout data found.")
        return {}

    vol_arr = np.array(early_vol_ratios)
    price_arr = np.array(early_price_deltas)

    stats = {
        "breakout_count": len(big_moves),
        "vol_ratio_mean": float(np.mean(vol_arr)),
        "vol_ratio_median": float(np.median(vol_arr)),
        "vol_ratio_p25": float(np.percentile(vol_arr, 25)),
        "vol_ratio_p75": float(np.percentile(vol_arr, 75)),
        "vol_ratio_p10": float(np.percentile(vol_arr, 10)),
        "vol_ratio_p90": float(np.percentile(vol_arr, 90)),
        "early_price_delta_mean": float(np.mean(price_arr)),
        "early_price_delta_median": float(np.median(price_arr)),
    }

    print(f"\n  Volume ratios at breakout onset (first half of 4H bar):")
    print(f"    Mean:   {stats['vol_ratio_mean']:.2f}x")
    print(f"    Median: {stats['vol_ratio_median']:.2f}x")
    print(f"    P10:    {stats['vol_ratio_p10']:.2f}x")
    print(f"    P25:    {stats['vol_ratio_p25']:.2f}x")
    print(f"    P75:    {stats['vol_ratio_p75']:.2f}x")
    print(f"    P90:    {stats['vol_ratio_p90']:.2f}x")
    print(f"\n  Price delta in first 2H of breakout 4H bars:")
    print(f"    Mean:   {stats['early_price_delta_mean']:.2f}%")
    print(f"    Median: {stats['early_price_delta_median']:.2f}%")

    # Suggest threshold
    suggested_vol = round(stats["vol_ratio_p25"], 1)
    print(f"\n  Suggested volume threshold: {suggested_vol}x")
    print(f"    (P25 — catches 75% of breakouts while filtering normal noise)")

    return stats


# ---------------------------------------------------------------------------
# Strategy A: Baseline (current 4H system)
# ---------------------------------------------------------------------------

def run_baseline(df_4h: pd.DataFrame, config: dict) -> list[dict]:
    """
    Current production system: evaluate signals on every 4H candle close.
    Returns list of trade dicts.
    """
    df = calculate_indicators(df_4h.copy(), config=config)
    return _simulate_trades(df, config, strategy_name="Baseline (4H)")


# ---------------------------------------------------------------------------
# Strategy B: Momentum Detector
# ---------------------------------------------------------------------------

def run_momentum_detector(
    df_4h: pd.DataFrame,
    df_30m: pd.DataFrame,
    config: dict,
    price_threshold_pct: float = 2.0,
    vol_threshold: float = 1.3,
    lookback_bars: int = 4,  # 4 × 30m = 2H rolling window
) -> tuple[list[dict], list[dict]]:
    """
    Same V6D signal rules, but with a 30m momentum scanner that triggers
    early evaluation when price acceleration is detected.

    Momentum trigger fires when EITHER:
      - Price moved >threshold_pct in the last lookback_bars (2H rolling window)
      - Volume spike above vol_threshold × SMA(20)
      AND both conditions hold simultaneously.

    When triggered mid-4H-window, we compute indicators on partial data
    and run signal evaluation early.

    Returns:
        (trades, triggers) — trades list + list of trigger events for analysis
    """
    # Pre-compute 4H indicators for signal evaluation
    df_4h_full = calculate_indicators(df_4h.copy(), config=config)

    # Pre-compute 30m momentum metrics
    df_30m = df_30m.copy()
    df_30m["vol_sma_20"] = df_30m["volume"].rolling(20, min_periods=5).mean()
    df_30m["vol_ratio"] = df_30m["volume"] / df_30m["vol_sma_20"].replace(0, np.nan)
    df_30m["price_change_rolling"] = df_30m["close"].pct_change(lookback_bars) * 100

    # Walk through 4H bars, but check 30m data within each for early triggers
    trades: list[dict] = []
    triggers: list[dict] = []

    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac = 1.0
    short_remaining_frac = 1.0

    for bar_idx in range(50, len(df_4h_full)):  # skip warmup
        row_4h = df_4h_full.iloc[bar_idx]
        candle_start = df_4h_full.index[bar_idx]
        candle_end = candle_start + pd.Timedelta(hours=4)

        # Get 30m bars within this 4H window
        mask_30m = (df_30m.index >= candle_start) & (df_30m.index < candle_end)
        intra_bars = df_30m[mask_30m]

        early_trigger = False
        trigger_time = None
        trigger_price = None
        trigger_type = None

        # Scan 30m bars for momentum (skip last bar — that's candle close anyway)
        for i in range(len(intra_bars) - 1):
            bar_30m = intra_bars.iloc[i]
            price_chg = bar_30m.get("price_change_rolling", 0)
            vol_r = bar_30m.get("vol_ratio", 1.0)

            if pd.isna(price_chg) or pd.isna(vol_r):
                continue

            # Momentum detector: price acceleration + volume confirmation
            if abs(price_chg) >= price_threshold_pct and vol_r >= vol_threshold:
                early_trigger = True
                trigger_time = intra_bars.index[i]
                trigger_price = bar_30m["close"]
                trigger_type = "momentum"
                break

        # Determine entry/exit price and time
        if early_trigger:
            eval_price = trigger_price
            eval_time = trigger_time
            triggers.append({
                "time": str(trigger_time),
                "type": trigger_type,
                "price": trigger_price,
                "candle_close_price": row_4h["close"],
                "price_delta_pct": round(
                    (trigger_price - row_4h["close"]) / row_4h["close"] * 100, 2
                ) if row_4h["close"] != 0 else 0,
                "bar_idx": bar_idx,
            })
        else:
            eval_price = row_4h["close"]
            eval_time = candle_start

        # Evaluate signal using the 4H indicators (even if triggered early,
        # we use the 4H indicator values — the trigger just accelerates WHEN
        # we act, not WHAT we decide)
        color, reason = evaluate_signal(
            row_4h,
            open_trade=open_long or open_short,
            config=config,
            bar_index=bar_idx,
        )

        # Trade execution (simplified version of simulate_trades)
        date_str = str(eval_time.date()) if hasattr(eval_time, 'date') else str(eval_time)[:10]
        price = eval_price

        # Yellow event trims
        if open_long is not None and long_remaining_frac > 0.1:
            rsi14 = row_4h.get("rsi_14", 50)
            yellow = check_yellow_events(rsi14, "long", config)
            if yellow == "strong_take_profit":
                trim_frac = config.get("trim_pct_orange", 0.5)
                trim_pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                trim_pnl_usd = round(trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "orange_trim",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trigger": early_trigger,
                })
                long_remaining_frac *= (1 - trim_frac)
            elif yellow == "take_profit":
                trim_frac = config.get("trim_pct_yellow", 0.25)
                trim_pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                trim_pnl_usd = round(trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "yellow_trim",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trigger": early_trigger,
                })
                long_remaining_frac *= (1 - trim_frac)

        # Signal-based entries and exits
        if color == "green" and reason in ("ema_cross_up", "late_entry"):
            # Close short if open
            if open_short is not None:
                pnl_pct = round(((open_short["entry_price"] - price) / open_short["entry_price"]) * 100, 2)
                pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "short", "entry_date": open_short["entry_date"],
                    "entry_price": open_short["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "green",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trigger": early_trigger,
                })
                open_short = None
                short_remaining_frac = 1.0

            # Open long
            if open_long is None:
                open_long = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx, "early_trigger": early_trigger,
                }
                long_remaining_frac = 1.0

        elif color == "red" and reason in ("ema_cross_down", "late_entry", "stop_loss",
                                            "trend_break", "atr_stop_loss"):
            # Close long if open
            if open_long is not None:
                pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "long", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "red",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trigger": early_trigger,
                })
                open_long = None
                long_remaining_frac = 1.0

            # Open short (only on cross, not stop-loss)
            if open_short is None and reason in ("ema_cross_down", "late_entry"):
                open_short = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx, "early_trigger": early_trigger,
                }
                short_remaining_frac = 1.0

    # Close any remaining open positions at last price
    last_price = df_4h_full.iloc[-1]["close"]
    last_date = str(df_4h_full.index[-1])[:10]
    if open_long is not None:
        pnl_pct = round(((last_price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
        pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "long", "entry_date": open_long["entry_date"],
            "entry_price": open_long["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open",
            "early_trigger": False,
        })
    if open_short is not None:
        pnl_pct = round(((open_short["entry_price"] - last_price) / open_short["entry_price"]) * 100, 2)
        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "short", "entry_date": open_short["entry_date"],
            "entry_price": open_short["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open",
            "early_trigger": False,
        })

    return trades, triggers


# ---------------------------------------------------------------------------
# Strategy C: Momentum Detector + BB2 Fast Scan
# ---------------------------------------------------------------------------

def run_momentum_with_bb2(
    df_4h: pd.DataFrame,
    df_30m: pd.DataFrame,
    config: dict,
    price_threshold_pct: float = 2.0,
    vol_threshold: float = 1.3,
    lookback_bars: int = 4,
) -> tuple[list[dict], list[dict]]:
    """
    Strategy B + BB2 mean-reversion detection on the 30m loop.

    BB2 fast-scan: compute RSI on 30m bars. When RSI breaks below/above
    Bollinger Bands on the 30m timeframe, AND the 4H trend filter agrees,
    enter a quick mean-reversion trade without waiting for 4H close.
    """
    # Run the base momentum detector
    trades, triggers = run_momentum_detector(
        df_4h, df_30m, config,
        price_threshold_pct=price_threshold_pct,
        vol_threshold=vol_threshold,
        lookback_bars=lookback_bars,
    )

    # Additional BB2 fast-scan on 30m data
    df_30m_bb2 = df_30m.copy()

    # Calculate RSI on 30m bars
    delta = df_30m_bb2["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=13, min_periods=14).mean()
    avg_loss = loss.ewm(com=13, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df_30m_bb2["rsi_14"] = 100 - (100 / (1 + rs))

    # RSI Bollinger Bands (same as V6d: SMA(RSI, 10) ± 1.5σ)
    df_30m_bb2["rsi_sma_10"] = df_30m_bb2["rsi_14"].rolling(10, min_periods=5).mean()
    df_30m_bb2["rsi_std_10"] = df_30m_bb2["rsi_14"].rolling(10, min_periods=5).std()
    df_30m_bb2["rsi_bb_upper"] = df_30m_bb2["rsi_sma_10"] + 1.5 * df_30m_bb2["rsi_std_10"]
    df_30m_bb2["rsi_bb_lower"] = df_30m_bb2["rsi_sma_10"] - 1.5 * df_30m_bb2["rsi_std_10"]

    # SMA-50 on 30m (for trend filter — ~25 hours lookback)
    df_30m_bb2["sma_50"] = df_30m_bb2["close"].rolling(50, min_periods=30).mean()

    # Scan for BB2 entries on fast-loop candles
    bb2_trades: list[dict] = []
    bb2_open: dict | None = None
    bb2_bars_held = 0
    # Scale BB2 hold to maintain 8H regardless of candle interval:
    #   30m: lookback_bars=4 → 4*4=16 bars (16×30m=8H)
    #   15m: lookback_bars=8 → 4*8=32 bars (32×15m=8H)
    BB2_MAX_HOLD = 4 * lookback_bars  # 8H in bar units
    BB2_STOP_PCT = 3.0  # tight stop for fast BB2

    for i in range(50, len(df_30m_bb2)):
        row = df_30m_bb2.iloc[i]
        price = row["close"]
        rsi = row.get("rsi_14", 50)
        bb_upper = row.get("rsi_bb_upper", 70)
        bb_lower = row.get("rsi_bb_lower", 30)
        sma50 = row.get("sma_50", price)
        dt = df_30m_bb2.index[i]

        if pd.isna(rsi) or pd.isna(bb_upper) or pd.isna(bb_lower) or pd.isna(sma50):
            continue

        # Manage open BB2 position
        if bb2_open is not None:
            bb2_bars_held += 1
            entry_p = bb2_open["entry_price"]

            if bb2_open["direction"] == "bb2_long":
                pnl_pct = ((price - entry_p) / entry_p) * 100
                # Exit: RSI > 50 (mean reversion target), or stop, or expiry
                if rsi > 50 or pnl_pct <= -BB2_STOP_PCT or bb2_bars_held >= BB2_MAX_HOLD:
                    pnl_usd = round(pnl_pct / 100 * POSITION_SIZE_USD * 0.5, 2)  # half-size
                    reason = "bb2_target" if rsi > 50 else ("bb2_stop" if pnl_pct <= -BB2_STOP_PCT else "bb2_expiry")
                    bb2_trades.append({
                        "direction": "bb2_long", "entry_date": bb2_open["entry_date"],
                        "entry_price": entry_p, "exit_date": str(dt)[:10],
                        "exit_price": round(price, 2), "exit_signal_reason": reason,
                        "pnl_pct": round(pnl_pct, 2), "pnl_usd": pnl_usd,
                        "status": "closed", "early_trigger": True,
                        "hold_bars_30m": bb2_bars_held,
                    })
                    bb2_open = None
                    bb2_bars_held = 0

            elif bb2_open["direction"] == "bb2_short":
                pnl_pct = ((entry_p - price) / entry_p) * 100
                if rsi < 50 or pnl_pct <= -BB2_STOP_PCT or bb2_bars_held >= BB2_MAX_HOLD:
                    pnl_usd = round(pnl_pct / 100 * POSITION_SIZE_USD * 0.5, 2)
                    reason = "bb2_target" if rsi < 50 else ("bb2_stop" if pnl_pct <= -BB2_STOP_PCT else "bb2_expiry")
                    bb2_trades.append({
                        "direction": "bb2_short", "entry_date": bb2_open["entry_date"],
                        "entry_price": entry_p, "exit_date": str(dt)[:10],
                        "exit_price": round(price, 2), "exit_signal_reason": reason,
                        "pnl_pct": round(pnl_pct, 2), "pnl_usd": pnl_usd,
                        "status": "closed", "early_trigger": True,
                        "hold_bars_30m": bb2_bars_held,
                    })
                    bb2_open = None
                    bb2_bars_held = 0

        # Open new BB2 trade
        if bb2_open is None:
            if rsi < bb_lower and price > sma50:  # oversold + uptrend = long
                bb2_open = {
                    "direction": "bb2_long", "entry_date": str(dt)[:10],
                    "entry_price": round(price, 2),
                }
                bb2_bars_held = 0
                triggers.append({
                    "time": str(dt), "type": "bb2_long_30m",
                    "price": price, "bar_idx": i,
                })
            elif rsi > bb_upper and price < sma50:  # overbought + downtrend = short
                bb2_open = {
                    "direction": "bb2_short", "entry_date": str(dt)[:10],
                    "entry_price": round(price, 2),
                }
                bb2_bars_held = 0
                triggers.append({
                    "time": str(dt), "type": "bb2_short_30m",
                    "price": price, "bar_idx": i,
                })

    # Combine trades
    all_trades = trades + bb2_trades
    return all_trades, triggers


# ---------------------------------------------------------------------------
# Simplified trade simulator for baseline (reuses core logic from backtest.py)
# ---------------------------------------------------------------------------

def _simulate_trades(df: pd.DataFrame, config: dict, strategy_name: str = "") -> list[dict]:
    """
    Simplified trade simulator — runs signal evaluation on each 4H bar.
    This is a streamlined version of backtest.py's simulate_trades() that
    focuses on EMA entries/exits and yellow trims (no BB/BB2/DCA/reentry).
    """
    trades: list[dict] = []
    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac = 1.0
    short_remaining_frac = 1.0

    for bar_idx in range(50, len(df)):  # skip warmup period
        row = df.iloc[bar_idx]
        date = df.index[bar_idx]
        date_str = str(date)[:10] if hasattr(date, 'date') else str(date)
        price = row["close"]

        color, reason = evaluate_signal(
            row, open_trade=open_long or open_short, config=config, bar_index=bar_idx
        )

        # Yellow trims for longs
        if open_long is not None and long_remaining_frac > 0.1:
            rsi14 = row.get("rsi_14", 50)
            yellow = check_yellow_events(rsi14, "long", config)
            if yellow == "strong_take_profit":
                trim_frac = config.get("trim_pct_orange", 0.5)
                trim_pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                trim_pnl_usd = round(trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "orange_trim",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trigger": False,
                })
                long_remaining_frac *= (1 - trim_frac)
            elif yellow == "take_profit":
                trim_frac = config.get("trim_pct_yellow", 0.25)
                trim_pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                trim_pnl_usd = round(trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "yellow_trim",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trigger": False,
                })
                long_remaining_frac *= (1 - trim_frac)

        # Entries and exits
        if color == "green" and reason in ("ema_cross_up", "late_entry"):
            if open_short is not None:
                pnl_pct = round(((open_short["entry_price"] - price) / open_short["entry_price"]) * 100, 2)
                pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "short", "entry_date": open_short["entry_date"],
                    "entry_price": open_short["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "green",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trigger": False,
                })
                open_short = None
                short_remaining_frac = 1.0

            if open_long is None:
                open_long = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx,
                }
                long_remaining_frac = 1.0

        elif color == "red" and reason in ("ema_cross_down", "late_entry", "stop_loss",
                                            "trend_break", "atr_stop_loss"):
            if open_long is not None:
                pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "long", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "red",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trigger": False,
                })
                open_long = None
                long_remaining_frac = 1.0

            if open_short is None and reason in ("ema_cross_down", "late_entry"):
                open_short = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx,
                }
                short_remaining_frac = 1.0

    # Close remaining positions
    last_price = df.iloc[-1]["close"]
    last_date = str(df.index[-1])[:10]
    if open_long is not None:
        pnl_pct = round(((last_price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
        pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "long", "entry_date": open_long["entry_date"],
            "entry_price": open_long["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open",
            "early_trigger": False,
        })
    if open_short is not None:
        pnl_pct = round(((open_short["entry_price"] - last_price) / open_short["entry_price"]) * 100, 2)
        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "short", "entry_date": open_short["entry_date"],
            "entry_price": open_short["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open",
            "early_trigger": False,
        })

    return trades


# ---------------------------------------------------------------------------
# Metrics and reporting
# ---------------------------------------------------------------------------

def extract_metrics(trades: list[dict], label: str) -> dict:
    """Extract summary metrics from trade list."""
    closed = [t for t in trades if t["status"] == "closed"]
    opens = [t for t in trades if t["status"] == "open"]
    trims = [t for t in closed if t.get("direction") == "trim"]
    bb2_trades = [t for t in closed if t.get("direction", "").startswith("bb2_")]

    # Separate position trades from trims/bb2
    position_trades = [t for t in closed if t["direction"] in ("long", "short")]
    longs = [t for t in position_trades if t["direction"] == "long"]
    shorts = [t for t in position_trades if t["direction"] == "short"]

    long_wins = [t for t in longs if t["pnl_pct"] >= 0]
    short_wins = [t for t in shorts if t["pnl_pct"] >= 0]
    bb2_wins = [t for t in bb2_trades if t["pnl_pct"] >= 0]

    total_pnl = sum(t.get("pnl_usd", 0) for t in closed)
    trim_pnl = sum(t.get("pnl_usd", 0) for t in trims)
    bb2_pnl = sum(t.get("pnl_usd", 0) for t in bb2_trades)
    position_pnl = sum(t.get("pnl_usd", 0) for t in position_trades)

    # Early trigger stats
    early_entries = [t for t in position_trades if t.get("early_trigger")]
    early_pnl = sum(t.get("pnl_usd", 0) for t in early_entries)

    win_count = len(long_wins) + len(short_wins)
    total_positions = len(longs) + len(shorts)
    win_rate = (win_count / total_positions * 100) if total_positions > 0 else 0

    return {
        "label": label,
        "total_positions": total_positions,
        "longs": len(longs),
        "shorts": len(shorts),
        "trims": len(trims),
        "bb2_trades": len(bb2_trades),
        "win_rate": round(win_rate, 1),
        "long_win_rate": round(len(long_wins) / len(longs) * 100, 1) if longs else 0,
        "short_win_rate": round(len(short_wins) / len(shorts) * 100, 1) if shorts else 0,
        "total_pnl_usd": round(total_pnl, 2),
        "position_pnl_usd": round(position_pnl, 2),
        "trim_pnl_usd": round(trim_pnl, 2),
        "bb2_pnl_usd": round(bb2_pnl, 2),
        "bb2_win_rate": round(len(bb2_wins) / len(bb2_trades) * 100, 1) if bb2_trades else 0,
        "early_trigger_count": len(early_entries),
        "early_trigger_pnl": round(early_pnl, 2),
        "open_positions": len(opens),
        "avg_pnl_per_position": round(position_pnl / total_positions, 2) if total_positions else 0,
    }


def print_comparison(metrics_list: list[dict], triggers_b: list[dict], triggers_c: list[dict]):
    """Print side-by-side comparison of all strategies."""
    print("\n" + "=" * 90)
    print("  MOMENTUM DETECTOR BACKTEST — STRATEGY COMPARISON")
    print("=" * 90)

    headers = [m["label"] for m in metrics_list]
    col_w = 22

    def row(label: str, key: str, fmt: str = "", is_money: bool = False):
        vals = []
        for m in metrics_list:
            v = m.get(key, 0)
            if is_money:
                vals.append(f"${v:+,.0f}")
            elif fmt:
                vals.append(f"{v:{fmt}}")
            else:
                vals.append(str(v))
        line = f"  {label:<26}"
        for v in vals:
            line += f"{v:>{col_w}}"
        # Delta column (B vs A, C vs A)
        if len(metrics_list) >= 2:
            base = metrics_list[0].get(key, 0)
            for m in metrics_list[1:]:
                diff = m.get(key, 0) - base
                if is_money:
                    arrow = "+" if diff >= 0 else ""
                    line += f"  {arrow}${diff:,.0f}"
                elif fmt and "f" in fmt:
                    line += f"  {diff:+.1f}"
                else:
                    line += f"  {diff:+d}" if isinstance(diff, int) else f"  {diff:+.1f}"
        print(line)

    # Header
    line = f"  {'Metric':<26}"
    for h in headers:
        line += f"{h:>{col_w}}"
    if len(headers) >= 2:
        for h in headers[1:]:
            line += f"  {'Δ vs A':>10}"
    print(line)
    print(f"  {'─' * (26 + col_w * len(headers) + 12 * max(0, len(headers) - 1))}")

    row("Positions (L+S)", "total_positions")
    row("  Longs", "longs")
    row("  Shorts", "shorts")
    row("Trims", "trims")
    row("BB2 trades (30m)", "bb2_trades")
    print(f"  {'─' * (26 + col_w * len(headers) + 12 * max(0, len(headers) - 1))}")
    row("Position win rate", "win_rate", ".1f")
    row("  Long win rate", "long_win_rate", ".1f")
    row("  Short win rate", "short_win_rate", ".1f")
    row("BB2 win rate", "bb2_win_rate", ".1f")
    print(f"  {'─' * (26 + col_w * len(headers) + 12 * max(0, len(headers) - 1))}")
    row("Total P&L (closed)", "total_pnl_usd", is_money=True)
    row("  Position P&L", "position_pnl_usd", is_money=True)
    row("  Trim P&L", "trim_pnl_usd", is_money=True)
    row("  BB2 P&L", "bb2_pnl_usd", is_money=True)
    row("Avg P&L per position", "avg_pnl_per_position", is_money=True)
    print(f"  {'─' * (26 + col_w * len(headers) + 12 * max(0, len(headers) - 1))}")
    row("Early trigger entries", "early_trigger_count")
    row("Early trigger P&L", "early_trigger_pnl", is_money=True)
    row("Open positions", "open_positions")

    # Trigger analysis
    if triggers_b:
        momentum_triggers = [t for t in triggers_b if t["type"] == "momentum"]
        print(f"\n  Momentum Detector Triggers (Strategy B): {len(momentum_triggers)}")
        if momentum_triggers:
            deltas = [abs(t["price_delta_pct"]) for t in momentum_triggers if "price_delta_pct" in t]
            if deltas:
                print(f"    Avg price delta vs 4H close: {np.mean(deltas):.2f}%")
                print(f"    Median price delta:          {np.median(deltas):.2f}%")
                print(f"    Max price delta:             {max(deltas):.2f}%")

    if triggers_c:
        bb2_triggers = [t for t in triggers_c if t["type"].startswith("bb2_")]
        if bb2_triggers:
            print(f"\n  BB2 Fast-Scan Triggers (Strategy C): {len(bb2_triggers)}")
            longs_t = [t for t in bb2_triggers if t["type"] == "bb2_long_30m"]
            shorts_t = [t for t in bb2_triggers if t["type"] == "bb2_short_30m"]
            print(f"    Long entries: {len(longs_t)}, Short entries: {len(shorts_t)}")


def print_trade_log(trades: list[dict], label: str, show_all: bool = False):
    """Print individual trade details."""
    closed = [t for t in trades if t["status"] == "closed" and t["direction"] in ("long", "short")]
    if not closed:
        return
    print(f"\n  {'─' * 70}")
    print(f"  Trade Log: {label}")
    print(f"  {'─' * 70}")
    print(f"  {'Dir':<6} {'Entry Date':<12} {'Entry $':>10} {'Exit Date':<12} {'Exit $':>10} {'P&L%':>8} {'P&L$':>8} {'Early':>6}")
    for t in closed[:30] if not show_all else closed:
        early = "YES" if t.get("early_trigger") else ""
        print(
            f"  {t['direction']:<6} {t['entry_date']:<12} "
            f"${t['entry_price']:>9,.2f} {t['exit_date']:<12} "
            f"${t['exit_price']:>9,.2f} {t['pnl_pct']:>+7.1f}% "
            f"${t['pnl_usd']:>+7.0f} {early:>6}"
        )
    if len(closed) > 30 and not show_all:
        print(f"  ... and {len(closed) - 30} more trades")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Momentum Detector Backtest")
    parser.add_argument("--asset", default="HYPE", help="Asset symbol (default: HYPE)")
    parser.add_argument("--days", type=int, default=365, help="Lookback days (default: 365)")
    parser.add_argument("--analyze-volume", action="store_true",
                        help="Only run volume spike analysis, skip backtests")
    parser.add_argument("--price-threshold", type=float, default=2.0,
                        help="Price move %% threshold for momentum trigger (default: 2.0)")
    parser.add_argument("--vol-threshold", type=float, default=None,
                        help="Volume spike threshold (default: empirically determined)")
    parser.add_argument("--fast-interval", default="30m", choices=["30m", "15m"],
                        help="Fast-loop candle interval (default: 30m). 15m = higher granularity.")
    parser.add_argument("--trades", action="store_true", help="Print full trade logs")
    args = parser.parse_args()

    coin = args.asset.upper()
    fast_interval = args.fast_interval

    # Adjust lookback bars and BB2 hold to maintain same TIME windows
    # regardless of candle interval:
    #   30m: lookback_bars=4 (4×30m=2H), BB2 hold=16 (16×30m=8H)
    #   15m: lookback_bars=8 (8×15m=2H), BB2 hold=32 (32×15m=8H)
    if fast_interval == "15m":
        lookback_bars = 8
    else:
        lookback_bars = 4

    print("=" * 70)
    print(f"  Momentum Detector Backtest — {coin}")
    print(f"  Lookback: {args.days} days")
    print(f"  Price threshold: {args.price_threshold}%")
    print(f"  Fast interval: {fast_interval} (lookback: {lookback_bars} bars = 2H)")
    print("=" * 70)

    # 1. Fetch data
    print("\n[1/4] Fetching historical data...")
    df_4h = fetch_candles(coin, "4h", args.days)
    df_30m = fetch_candles(coin, fast_interval, args.days)

    print(f"\n  4H candles: {len(df_4h)} ({df_4h.index[0]} to {df_4h.index[-1]})")
    print(f"  30m candles: {len(df_30m)} ({df_30m.index[0]} to {df_30m.index[-1]})")

    # 2. Volume analysis (always run to calibrate threshold)
    print("\n[2/4] Analyzing volume at breakouts...")
    vol_stats = analyze_volume_at_breakouts(df_4h, df_30m)

    if args.analyze_volume:
        print("\n  Volume analysis complete. Use results to calibrate --vol-threshold.")
        return

    # Determine volume threshold
    vol_threshold = args.vol_threshold
    if vol_threshold is None:
        # Use empirical P25 from breakout analysis, floored at 1.1
        vol_threshold = max(1.1, round(vol_stats.get("vol_ratio_p25", 1.3), 1))
        print(f"\n  Using empirical volume threshold: {vol_threshold}x")
    else:
        print(f"\n  Using manual volume threshold: {vol_threshold}x")

    config = {**V6D_TRAILING_BOTH}

    # 3. Run strategies
    print("\n[3/4] Running backtests...")

    print("\n  Strategy A: Baseline (4H only)...")
    trades_a = run_baseline(df_4h, config)
    metrics_a = extract_metrics(trades_a, "A: Baseline")

    print(f"\n  Strategy B: Momentum Detector (price >{args.price_threshold}%, vol >{vol_threshold}x, {fast_interval})...")
    trades_b, triggers_b = run_momentum_detector(
        df_4h, df_30m, config,
        price_threshold_pct=args.price_threshold,
        vol_threshold=vol_threshold,
        lookback_bars=lookback_bars,
    )
    metrics_b = extract_metrics(trades_b, "B: Momentum")

    print(f"\n  Strategy C: Momentum + BB2 Fast Scan ({fast_interval})...")
    trades_c, triggers_c = run_momentum_with_bb2(
        df_4h, df_30m, config,
        price_threshold_pct=args.price_threshold,
        vol_threshold=vol_threshold,
        lookback_bars=lookback_bars,
    )
    metrics_c = extract_metrics(trades_c, "C: Mom+BB2")

    # 4. Results
    print("\n[4/4] Results")
    print_comparison([metrics_a, metrics_b, metrics_c], triggers_b, triggers_c)

    if args.trades:
        print_trade_log(trades_a, "Baseline (A)")
        print_trade_log(trades_b, "Momentum Detector (B)")
        print_trade_log(trades_c, "Momentum + BB2 (C)")

    # Summary verdict
    print("\n" + "=" * 70)
    print("  VERDICT")
    print("=" * 70)
    pnl_delta_b = metrics_b["total_pnl_usd"] - metrics_a["total_pnl_usd"]
    pnl_delta_c = metrics_c["total_pnl_usd"] - metrics_a["total_pnl_usd"]
    wr_delta_b = metrics_b["win_rate"] - metrics_a["win_rate"]
    wr_delta_c = metrics_c["win_rate"] - metrics_a["win_rate"]

    print(f"\n  Momentum Detector (B) vs Baseline (A):")
    print(f"    P&L delta:      ${pnl_delta_b:+,.0f}")
    print(f"    Win rate delta:  {wr_delta_b:+.1f}%")
    print(f"    Early triggers:  {len([t for t in triggers_b if t['type'] == 'momentum'])}")

    print(f"\n  Momentum + BB2 (C) vs Baseline (A):")
    print(f"    P&L delta:      ${pnl_delta_c:+,.0f}")
    print(f"    Win rate delta:  {wr_delta_c:+.1f}%")
    bb2_triggers_c = [t for t in triggers_c if t["type"].startswith("bb2_")]
    print(f"    BB2 opportunities found: {len(bb2_triggers_c)}")

    if pnl_delta_b > 0:
        print(f"\n  ✓ Momentum detector IMPROVES P&L by ${pnl_delta_b:,.0f}")
    else:
        print(f"\n  ✗ Momentum detector REDUCES P&L by ${abs(pnl_delta_b):,.0f}")

    if pnl_delta_c > pnl_delta_b:
        print(f"  ✓ Adding BB2 fast-scan adds ${pnl_delta_c - pnl_delta_b:,.0f} more")
    elif metrics_c["bb2_trades"] > 0:
        print(f"  ✗ BB2 fast-scan reduces net by ${abs(pnl_delta_c - pnl_delta_b):,.0f}")

    print()


if __name__ == "__main__":
    main()
