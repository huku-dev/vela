#!/usr/bin/env python3
"""
Exit Timing Detector Backtest
===============================
Tests whether scanning RSI on 30m bars for yellow/orange threshold crossings
can improve trim timing vs waiting for 4H candle closes.

Compares 3 strategies:

  A) BASELINE — current system. Trims only happen at 4H candle close when
     RSI >= 78 (yellow, 25%) or RSI >= 85 (orange, 50%).

  B) EXIT SCANNER — same trim rules, but 30m RSI scanner detects crossings
     between 4H closes. Fires when RSI velocity >= +10 pts/2H AND RSI crosses
     the threshold on 30m. Trims at the actual crossing price.

  C) COMBINED — Strategy B exits + momentum detector entries (1.5% price
     threshold from prior backtest). Full pipeline: faster in, faster out.

Key hypothesis: the 4H cycle delays trims by up to 3.5H. The 30m scanner
should trim closer to actual peaks, capturing more profit before reversion.

RSI velocity filter (+10 pts/2H) was empirically validated:
  - +5 pts/2H happens 51-55% of all bars (too noisy)
  - +10 pts/2H is the median velocity at actual RSI 78 crossings
  - Catches genuine acceleration while filtering noise

Usage:
    python3 scripts/exit_timing_backtest.py
    python3 scripts/exit_timing_backtest.py --asset BTC --days 365
    python3 scripts/exit_timing_backtest.py --asset HYPE --trades
    python3 scripts/exit_timing_backtest.py --all  # run all 4 assets
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
# Data fetching (shared with momentum_detector_backtest.py)
# ---------------------------------------------------------------------------

def fetch_candles(coin: str, interval: str, days: int = 365) -> pd.DataFrame:
    """
    Fetch OHLCV candles from Hyperliquid's candleSnapshot API.
    Supports pagination for large lookbacks.
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

    cutoff = pd.Timestamp.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    df = df[df.index >= cutoff]

    print(f"    Got {len(df)} candles ({df.index[0]} to {df.index[-1]})")
    return df


# ---------------------------------------------------------------------------
# Compute RSI on 30m bars
# ---------------------------------------------------------------------------

def compute_30m_rsi(df_30m: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate RSI-14 on 30m data with velocity metrics.
    Adds columns: rsi_14, rsi_velocity_2h (change over 4 bars = 2H).
    """
    df = df_30m.copy()

    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=13, min_periods=14).mean()
    avg_loss = loss.ewm(com=13, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi_14"] = 100 - (100 / (1 + rs))

    # RSI velocity: change over 4 × 30m bars = 2 hours
    df["rsi_velocity_2h"] = df["rsi_14"].diff(4)

    return df


# ---------------------------------------------------------------------------
# Strategy A: Baseline (current 4H system — trims only at 4H close)
# ---------------------------------------------------------------------------

def run_baseline(df_4h: pd.DataFrame, config: dict) -> list[dict]:
    """
    Current production system: evaluate signals on every 4H candle close.
    Trims happen only when RSI >= 78/85 at the 4H close.
    """
    df = calculate_indicators(df_4h.copy(), config=config)
    return _simulate_trades_4h(df, config, strategy_name="A: Baseline")


# ---------------------------------------------------------------------------
# Strategy B: Exit Scanner (30m RSI scanner for earlier trims)
# ---------------------------------------------------------------------------

def run_exit_scanner(
    df_4h: pd.DataFrame,
    df_30m: pd.DataFrame,
    config: dict,
    rsi_velocity_threshold: float = 10.0,
    orange_only_30m: bool = False,
) -> tuple[list[dict], list[dict]]:
    """
    Same V6D signal rules for entries/exits, but trims are detected on 30m
    bars instead of waiting for 4H candle close.

    The 30m scanner fires an early trim when:
      1. RSI on 30m crosses 78 (yellow) or 85 (orange)
      2. RSI velocity >= +10 pts/2H (genuine acceleration, not drift)

    When both conditions are met, we trim at the 30m bar price instead of
    waiting for the 4H candle to close (which could be up to 3.5H later).

    Entries and signal changes still happen on 4H candle closes.

    Returns:
        (trades, trim_events) — trade list + list of early trim events
    """
    df_4h_full = calculate_indicators(df_4h.copy(), config=config)
    df_30m_rsi = compute_30m_rsi(df_30m)

    trades: list[dict] = []
    trim_events: list[dict] = []

    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac = 1.0
    short_remaining_frac = 1.0

    # Track which 4H bars have already had trims (to avoid double-trimming)
    trimmed_yellow_this_bar = False
    trimmed_orange_this_bar = False
    current_4h_bar_idx = -1

    rsi_yellow = config.get("rsi_yellow_threshold", 78)
    rsi_orange = config.get("rsi_orange_threshold", 85)

    for bar_idx in range(50, len(df_4h_full)):
        row_4h = df_4h_full.iloc[bar_idx]
        candle_start = df_4h_full.index[bar_idx]
        candle_end = candle_start + pd.Timedelta(hours=4)

        # Reset trim flags for new 4H bar
        if bar_idx != current_4h_bar_idx:
            trimmed_yellow_this_bar = False
            trimmed_orange_this_bar = False
            current_4h_bar_idx = bar_idx

        # --- 30m SCAN for early trims (within this 4H window) ---
        # Only scan if we have an open long position to trim
        if open_long is not None and long_remaining_frac > 0.1:
            mask_30m = (df_30m_rsi.index >= candle_start) & (df_30m_rsi.index < candle_end)
            intra_bars = df_30m_rsi[mask_30m]

            # Scan 30m bars (skip the last one — that's the 4H close anyway)
            for i in range(len(intra_bars) - 1):
                bar_30m = intra_bars.iloc[i]
                rsi_30m = bar_30m.get("rsi_14", 50)
                rsi_vel = bar_30m.get("rsi_velocity_2h", 0)

                if pd.isna(rsi_30m) or pd.isna(rsi_vel):
                    continue

                price_30m = bar_30m["close"]
                dt_30m = intra_bars.index[i]
                date_str_30m = str(dt_30m)[:10]

                # Orange threshold check (RSI >= 85 on 30m + velocity filter)
                if (
                    not trimmed_orange_this_bar
                    and rsi_30m >= rsi_orange
                    and rsi_vel >= rsi_velocity_threshold
                    and long_remaining_frac > 0.1
                ):
                    trim_frac = config.get("trim_pct_orange", 0.5)
                    trim_pnl_pct = round(
                        ((price_30m - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                    )
                    trim_pnl_usd = round(
                        trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                    )
                    trades.append({
                        "direction": "trim",
                        "entry_date": open_long["entry_date"],
                        "entry_price": open_long["entry_price"],
                        "exit_date": date_str_30m,
                        "exit_price": round(price_30m, 2),
                        "exit_signal_reason": "orange_trim_30m",
                        "pnl_pct": trim_pnl_pct,
                        "pnl_usd": trim_pnl_usd,
                        "status": "closed",
                        "early_trim": True,
                        "rsi_at_trim": round(rsi_30m, 1),
                        "rsi_velocity": round(rsi_vel, 1),
                    })
                    long_remaining_frac *= (1 - trim_frac)
                    trimmed_orange_this_bar = True
                    trimmed_yellow_this_bar = True  # orange subsumes yellow

                    trim_events.append({
                        "time": str(dt_30m),
                        "type": "orange_trim_30m",
                        "price_30m": round(price_30m, 2),
                        "price_4h_close": round(row_4h["close"], 2),
                        "price_delta_pct": round(
                            (price_30m - row_4h["close"]) / row_4h["close"] * 100, 2
                        ),
                        "rsi_30m": round(rsi_30m, 1),
                        "rsi_4h": round(row_4h.get("rsi_14", 50), 1),
                        "rsi_velocity": round(rsi_vel, 1),
                        "trim_pnl_usd": trim_pnl_usd,
                    })

                # Yellow threshold check (RSI >= 78 on 30m + velocity filter)
                # Skip yellow on 30m when orange_only mode is active
                elif (
                    not orange_only_30m
                    and not trimmed_yellow_this_bar
                    and rsi_30m >= rsi_yellow
                    and rsi_vel >= rsi_velocity_threshold
                    and long_remaining_frac > 0.1
                ):
                    trim_frac = config.get("trim_pct_yellow", 0.25)
                    trim_pnl_pct = round(
                        ((price_30m - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                    )
                    trim_pnl_usd = round(
                        trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                    )
                    trades.append({
                        "direction": "trim",
                        "entry_date": open_long["entry_date"],
                        "entry_price": open_long["entry_price"],
                        "exit_date": date_str_30m,
                        "exit_price": round(price_30m, 2),
                        "exit_signal_reason": "yellow_trim_30m",
                        "pnl_pct": trim_pnl_pct,
                        "pnl_usd": trim_pnl_usd,
                        "status": "closed",
                        "early_trim": True,
                        "rsi_at_trim": round(rsi_30m, 1),
                        "rsi_velocity": round(rsi_vel, 1),
                    })
                    long_remaining_frac *= (1 - trim_frac)
                    trimmed_yellow_this_bar = True

                    trim_events.append({
                        "time": str(dt_30m),
                        "type": "yellow_trim_30m",
                        "price_30m": round(price_30m, 2),
                        "price_4h_close": round(row_4h["close"], 2),
                        "price_delta_pct": round(
                            (price_30m - row_4h["close"]) / row_4h["close"] * 100, 2
                        ),
                        "rsi_30m": round(rsi_30m, 1),
                        "rsi_4h": round(row_4h.get("rsi_14", 50), 1),
                        "rsi_velocity": round(rsi_vel, 1),
                        "trim_pnl_usd": trim_pnl_usd,
                    })

        # --- Fallback: 4H close trims (for thresholds the 30m scanner missed) ---
        if open_long is not None and long_remaining_frac > 0.1:
            rsi_4h = row_4h.get("rsi_14", 50)
            if not trimmed_orange_this_bar and rsi_4h >= rsi_orange:
                trim_frac = config.get("trim_pct_orange", 0.5)
                price = row_4h["close"]
                date_str = str(candle_start)[:10]
                trim_pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                trim_pnl_usd = round(
                    trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                )
                trades.append({
                    "direction": "trim",
                    "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"],
                    "exit_date": date_str,
                    "exit_price": round(price, 2),
                    "exit_signal_reason": "orange_trim_4h",
                    "pnl_pct": trim_pnl_pct,
                    "pnl_usd": trim_pnl_usd,
                    "status": "closed",
                    "early_trim": False,
                })
                long_remaining_frac *= (1 - trim_frac)
                trimmed_orange_this_bar = True
                trimmed_yellow_this_bar = True

            elif not trimmed_yellow_this_bar and rsi_4h >= rsi_yellow:
                trim_frac = config.get("trim_pct_yellow", 0.25)
                price = row_4h["close"]
                date_str = str(candle_start)[:10]
                trim_pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                trim_pnl_usd = round(
                    trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                )
                trades.append({
                    "direction": "trim",
                    "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"],
                    "exit_date": date_str,
                    "exit_price": round(price, 2),
                    "exit_signal_reason": "yellow_trim_4h",
                    "pnl_pct": trim_pnl_pct,
                    "pnl_usd": trim_pnl_usd,
                    "status": "closed",
                    "early_trim": False,
                })
                long_remaining_frac *= (1 - trim_frac)
                trimmed_yellow_this_bar = True

        # --- SHORT position trims (symmetric logic) ---
        if open_short is not None and short_remaining_frac > 0.1:
            short_yellow = config.get("rsi_short_yellow_threshold", 22)
            short_orange = config.get("rsi_short_orange_threshold", 15)

            if short_yellow > 0:
                # 30m scan for short trims
                mask_30m = (df_30m_rsi.index >= candle_start) & (df_30m_rsi.index < candle_end)
                intra_bars = df_30m_rsi[mask_30m]

                for i in range(len(intra_bars) - 1):
                    bar_30m = intra_bars.iloc[i]
                    rsi_30m = bar_30m.get("rsi_14", 50)
                    rsi_vel = bar_30m.get("rsi_velocity_2h", 0)

                    if pd.isna(rsi_30m) or pd.isna(rsi_vel):
                        continue

                    price_30m = bar_30m["close"]
                    dt_30m = intra_bars.index[i]
                    date_str_30m = str(dt_30m)[:10]

                    # For shorts, velocity should be NEGATIVE (RSI dropping fast)
                    if (
                        short_orange > 0
                        and not trimmed_orange_this_bar
                        and rsi_30m <= short_orange
                        and rsi_vel <= -rsi_velocity_threshold
                        and short_remaining_frac > 0.1
                    ):
                        trim_frac = config.get("trim_pct_orange", 0.5)
                        trim_pnl_pct = round(
                            ((open_short["entry_price"] - price_30m) / open_short["entry_price"]) * 100, 2
                        )
                        trim_pnl_usd = round(
                            trim_frac * short_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                        )
                        trades.append({
                            "direction": "trim_short",
                            "entry_date": open_short["entry_date"],
                            "entry_price": open_short["entry_price"],
                            "exit_date": date_str_30m,
                            "exit_price": round(price_30m, 2),
                            "exit_signal_reason": "orange_trim_30m_short",
                            "pnl_pct": trim_pnl_pct,
                            "pnl_usd": trim_pnl_usd,
                            "status": "closed",
                            "early_trim": True,
                        })
                        short_remaining_frac *= (1 - trim_frac)
                        trimmed_orange_this_bar = True
                        trimmed_yellow_this_bar = True
                        break

                    elif (
                        not orange_only_30m
                        and not trimmed_yellow_this_bar
                        and rsi_30m <= short_yellow
                        and rsi_vel <= -rsi_velocity_threshold
                        and short_remaining_frac > 0.1
                    ):
                        trim_frac = config.get("trim_pct_yellow", 0.25)
                        trim_pnl_pct = round(
                            ((open_short["entry_price"] - price_30m) / open_short["entry_price"]) * 100, 2
                        )
                        trim_pnl_usd = round(
                            trim_frac * short_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                        )
                        trades.append({
                            "direction": "trim_short",
                            "entry_date": open_short["entry_date"],
                            "entry_price": open_short["entry_price"],
                            "exit_date": date_str_30m,
                            "exit_price": round(price_30m, 2),
                            "exit_signal_reason": "yellow_trim_30m_short",
                            "pnl_pct": trim_pnl_pct,
                            "pnl_usd": trim_pnl_usd,
                            "status": "closed",
                            "early_trim": True,
                        })
                        short_remaining_frac *= (1 - trim_frac)
                        trimmed_yellow_this_bar = True
                        break

        # --- Signal-based entries and exits (4H candle close, as before) ---
        date_str = str(candle_start)[:10]
        price = row_4h["close"]

        color, reason = evaluate_signal(
            row_4h, open_trade=open_long or open_short, config=config, bar_index=bar_idx
        )

        if color == "green" and reason in ("ema_cross_up", "late_entry"):
            if open_short is not None:
                pnl_pct = round(
                    ((open_short["entry_price"] - price) / open_short["entry_price"]) * 100, 2
                )
                pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "short", "entry_date": open_short["entry_date"],
                    "entry_price": open_short["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "green",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trim": False,
                })
                open_short = None
                short_remaining_frac = 1.0

            if open_long is None:
                open_long = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx,
                }
                long_remaining_frac = 1.0

        elif color == "red" and reason in (
            "ema_cross_down", "late_entry", "stop_loss", "trend_break", "atr_stop_loss"
        ):
            if open_long is not None:
                pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "long", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "red",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trim": False,
                })
                open_long = None
                long_remaining_frac = 1.0

            if open_short is None and reason in ("ema_cross_down", "late_entry"):
                open_short = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx,
                }
                short_remaining_frac = 1.0

    # Close remaining open positions at last price
    last_price = df_4h_full.iloc[-1]["close"]
    last_date = str(df_4h_full.index[-1])[:10]
    if open_long is not None:
        pnl_pct = round(((last_price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
        pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "long", "entry_date": open_long["entry_date"],
            "entry_price": open_long["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })
    if open_short is not None:
        pnl_pct = round(((open_short["entry_price"] - last_price) / open_short["entry_price"]) * 100, 2)
        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "short", "entry_date": open_short["entry_date"],
            "entry_price": open_short["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })

    return trades, trim_events


# ---------------------------------------------------------------------------
# Strategy C: Combined (momentum entries + exit scanner)
# ---------------------------------------------------------------------------

def run_combined(
    df_4h: pd.DataFrame,
    df_30m: pd.DataFrame,
    config: dict,
    price_threshold_pct: float = 1.5,
    vol_threshold: float = 1.1,
    rsi_velocity_threshold: float = 10.0,
    orange_only_30m: bool = False,
) -> tuple[list[dict], list[dict]]:
    """
    Full pipeline: momentum detector for faster entries + exit scanner
    for faster trims. Best-case scenario if both improvements compound.

    Entry improvement: momentum detector triggers early 4H evaluation
    when price >1.5% in 2H + volume >1.1x SMA(20).

    Exit improvement: 30m RSI scanner trims at 78/85 crossings
    with velocity >= +10 pts/2H.
    """
    df_4h_full = calculate_indicators(df_4h.copy(), config=config)
    df_30m_rsi = compute_30m_rsi(df_30m)

    # Pre-compute momentum metrics on 30m
    df_30m_mom = df_30m_rsi.copy()
    df_30m_mom["vol_sma_20"] = df_30m_mom["volume"].rolling(20, min_periods=5).mean()
    df_30m_mom["vol_ratio"] = df_30m_mom["volume"] / df_30m_mom["vol_sma_20"].replace(0, np.nan)
    df_30m_mom["price_change_rolling"] = df_30m_mom["close"].pct_change(4) * 100

    trades: list[dict] = []
    events: list[dict] = []

    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac = 1.0
    short_remaining_frac = 1.0

    trimmed_yellow_this_bar = False
    trimmed_orange_this_bar = False
    current_4h_bar_idx = -1

    rsi_yellow = config.get("rsi_yellow_threshold", 78)
    rsi_orange = config.get("rsi_orange_threshold", 85)

    for bar_idx in range(50, len(df_4h_full)):
        row_4h = df_4h_full.iloc[bar_idx]
        candle_start = df_4h_full.index[bar_idx]
        candle_end = candle_start + pd.Timedelta(hours=4)

        if bar_idx != current_4h_bar_idx:
            trimmed_yellow_this_bar = False
            trimmed_orange_this_bar = False
            current_4h_bar_idx = bar_idx

        # Get 30m bars in this window
        mask_30m = (df_30m_mom.index >= candle_start) & (df_30m_mom.index < candle_end)
        intra_bars = df_30m_mom[mask_30m]

        # --- ENTRY: Momentum detector for early entries ---
        early_entry_trigger = False
        trigger_price = None
        trigger_time = None

        if open_long is None and open_short is None:
            for i in range(len(intra_bars) - 1):
                bar_30m = intra_bars.iloc[i]
                price_chg = bar_30m.get("price_change_rolling", 0)
                vol_r = bar_30m.get("vol_ratio", 1.0)

                if pd.isna(price_chg) or pd.isna(vol_r):
                    continue

                if abs(price_chg) >= price_threshold_pct and vol_r >= vol_threshold:
                    early_entry_trigger = True
                    trigger_price = bar_30m["close"]
                    trigger_time = intra_bars.index[i]
                    break

        # --- EXIT: 30m RSI scanner for early trims ---
        if open_long is not None and long_remaining_frac > 0.1:
            for i in range(len(intra_bars) - 1):
                bar_30m = intra_bars.iloc[i]
                rsi_30m = bar_30m.get("rsi_14", 50)
                rsi_vel = bar_30m.get("rsi_velocity_2h", 0)

                if pd.isna(rsi_30m) or pd.isna(rsi_vel):
                    continue

                price_30m = bar_30m["close"]
                dt_30m = intra_bars.index[i]
                date_str_30m = str(dt_30m)[:10]

                if (
                    not trimmed_orange_this_bar
                    and rsi_30m >= rsi_orange
                    and rsi_vel >= rsi_velocity_threshold
                    and long_remaining_frac > 0.1
                ):
                    trim_frac = config.get("trim_pct_orange", 0.5)
                    trim_pnl_pct = round(
                        ((price_30m - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                    )
                    trim_pnl_usd = round(
                        trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                    )
                    trades.append({
                        "direction": "trim", "entry_date": open_long["entry_date"],
                        "entry_price": open_long["entry_price"], "exit_date": date_str_30m,
                        "exit_price": round(price_30m, 2), "exit_signal_reason": "orange_trim_30m",
                        "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                        "early_trim": True,
                    })
                    long_remaining_frac *= (1 - trim_frac)
                    trimmed_orange_this_bar = True
                    trimmed_yellow_this_bar = True

                    events.append({
                        "time": str(dt_30m), "type": "orange_trim_30m",
                        "price_30m": round(price_30m, 2),
                        "price_4h_close": round(row_4h["close"], 2),
                    })

                # Yellow threshold check (RSI >= 78 on 30m + velocity filter)
                # Skip yellow on 30m when orange_only mode is active
                elif (
                    not orange_only_30m
                    and not trimmed_yellow_this_bar
                    and rsi_30m >= rsi_yellow
                    and rsi_vel >= rsi_velocity_threshold
                    and long_remaining_frac > 0.1
                ):
                    trim_frac = config.get("trim_pct_yellow", 0.25)
                    trim_pnl_pct = round(
                        ((price_30m - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                    )
                    trim_pnl_usd = round(
                        trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                    )
                    trades.append({
                        "direction": "trim", "entry_date": open_long["entry_date"],
                        "entry_price": open_long["entry_price"], "exit_date": date_str_30m,
                        "exit_price": round(price_30m, 2), "exit_signal_reason": "yellow_trim_30m",
                        "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                        "early_trim": True,
                    })
                    long_remaining_frac *= (1 - trim_frac)
                    trimmed_yellow_this_bar = True

                    events.append({
                        "time": str(dt_30m), "type": "yellow_trim_30m",
                        "price_30m": round(price_30m, 2),
                        "price_4h_close": round(row_4h["close"], 2),
                    })

        # --- Fallback: 4H trims if 30m scanner missed ---
        if open_long is not None and long_remaining_frac > 0.1:
            rsi_4h = row_4h.get("rsi_14", 50)
            if not trimmed_orange_this_bar and rsi_4h >= rsi_orange:
                trim_frac = config.get("trim_pct_orange", 0.5)
                price = row_4h["close"]
                date_str = str(candle_start)[:10]
                trim_pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                trim_pnl_usd = round(
                    trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                )
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "orange_trim_4h",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trim": False,
                })
                long_remaining_frac *= (1 - trim_frac)
                trimmed_orange_this_bar = True
                trimmed_yellow_this_bar = True

            elif not trimmed_yellow_this_bar and rsi_4h >= rsi_yellow:
                trim_frac = config.get("trim_pct_yellow", 0.25)
                price = row_4h["close"]
                date_str = str(candle_start)[:10]
                trim_pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                trim_pnl_usd = round(
                    trim_frac * long_remaining_frac * trim_pnl_pct / 100 * POSITION_SIZE_USD, 2
                )
                trades.append({
                    "direction": "trim", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_reason": "yellow_trim_4h",
                    "pnl_pct": trim_pnl_pct, "pnl_usd": trim_pnl_usd, "status": "closed",
                    "early_trim": False,
                })
                long_remaining_frac *= (1 - trim_frac)
                trimmed_yellow_this_bar = True

        # --- Signal-based entries/exits ---
        if early_entry_trigger:
            eval_price = trigger_price
            eval_time = trigger_time
        else:
            eval_price = row_4h["close"]
            eval_time = candle_start

        date_str = str(eval_time)[:10] if eval_time else str(candle_start)[:10]
        price = eval_price if eval_price else row_4h["close"]

        color, reason = evaluate_signal(
            row_4h, open_trade=open_long or open_short, config=config, bar_index=bar_idx
        )

        if color == "green" and reason in ("ema_cross_up", "late_entry"):
            if open_short is not None:
                pnl_pct = round(
                    ((open_short["entry_price"] - price) / open_short["entry_price"]) * 100, 2
                )
                pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "short", "entry_date": open_short["entry_date"],
                    "entry_price": open_short["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "green",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trim": False,
                })
                open_short = None
                short_remaining_frac = 1.0

            if open_long is None:
                open_long = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx, "early_entry": early_entry_trigger,
                }
                long_remaining_frac = 1.0

        elif color == "red" and reason in (
            "ema_cross_down", "late_entry", "stop_loss", "trend_break", "atr_stop_loss"
        ):
            if open_long is not None:
                pnl_pct = round(
                    ((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2
                )
                pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "long", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "red",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trim": False,
                })
                open_long = None
                long_remaining_frac = 1.0

            if open_short is None and reason in ("ema_cross_down", "late_entry"):
                open_short = {
                    "entry_date": date_str, "entry_price": round(price, 2),
                    "entry_bar_index": bar_idx,
                }
                short_remaining_frac = 1.0

    # Close remaining open positions
    last_price = df_4h_full.iloc[-1]["close"]
    last_date = str(df_4h_full.index[-1])[:10]
    if open_long is not None:
        pnl_pct = round(((last_price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
        pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "long", "entry_date": open_long["entry_date"],
            "entry_price": open_long["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })
    if open_short is not None:
        pnl_pct = round(((open_short["entry_price"] - last_price) / open_short["entry_price"]) * 100, 2)
        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "short", "entry_date": open_short["entry_date"],
            "entry_price": open_short["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })

    return trades, events


# ---------------------------------------------------------------------------
# Simplified 4H trade simulator (for baseline)
# ---------------------------------------------------------------------------

def _simulate_trades_4h(df: pd.DataFrame, config: dict, strategy_name: str = "") -> list[dict]:
    """
    Baseline 4H trade simulator. Same as momentum_detector_backtest._simulate_trades.
    Trims only happen at 4H candle close when RSI hits thresholds.
    """
    trades: list[dict] = []
    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac = 1.0
    short_remaining_frac = 1.0

    for bar_idx in range(50, len(df)):
        row = df.iloc[bar_idx]
        date = df.index[bar_idx]
        date_str = str(date)[:10]
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
                    "early_trim": False,
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
                    "early_trim": False,
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
                    "status": "closed", "early_trim": False,
                })
                open_short = None
                short_remaining_frac = 1.0

            if open_long is None:
                open_long = {"entry_date": date_str, "entry_price": round(price, 2), "entry_bar_index": bar_idx}
                long_remaining_frac = 1.0

        elif color == "red" and reason in ("ema_cross_down", "late_entry", "stop_loss", "trend_break", "atr_stop_loss"):
            if open_long is not None:
                pnl_pct = round(((price - open_long["entry_price"]) / open_long["entry_price"]) * 100, 2)
                pnl_usd = round(long_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
                trades.append({
                    "direction": "long", "entry_date": open_long["entry_date"],
                    "entry_price": open_long["entry_price"], "exit_date": date_str,
                    "exit_price": round(price, 2), "exit_signal_color": "red",
                    "exit_signal_reason": reason, "pnl_pct": pnl_pct, "pnl_usd": pnl_usd,
                    "status": "closed", "early_trim": False,
                })
                open_long = None
                long_remaining_frac = 1.0

            if open_short is None and reason in ("ema_cross_down", "late_entry"):
                open_short = {"entry_date": date_str, "entry_price": round(price, 2), "entry_bar_index": bar_idx}
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
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })
    if open_short is not None:
        pnl_pct = round(((open_short["entry_price"] - last_price) / open_short["entry_price"]) * 100, 2)
        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * POSITION_SIZE_USD, 2)
        trades.append({
            "direction": "short", "entry_date": open_short["entry_date"],
            "entry_price": open_short["entry_price"], "exit_date": last_date,
            "exit_price": round(last_price, 2), "exit_signal_reason": "end_of_data",
            "pnl_pct": pnl_pct, "pnl_usd": pnl_usd, "status": "open", "early_trim": False,
        })

    return trades


# ---------------------------------------------------------------------------
# Metrics and reporting
# ---------------------------------------------------------------------------

def extract_metrics(trades: list[dict], label: str) -> dict:
    """Extract summary metrics with focus on trim timing quality."""
    closed = [t for t in trades if t["status"] == "closed"]
    trims = [t for t in closed if t.get("direction") in ("trim", "trim_short")]
    position_trades = [t for t in closed if t["direction"] in ("long", "short")]

    early_trims = [t for t in trims if t.get("early_trim")]
    fallback_trims = [t for t in trims if not t.get("early_trim")]

    total_pnl = sum(t.get("pnl_usd", 0) for t in closed)
    trim_pnl = sum(t.get("pnl_usd", 0) for t in trims)
    early_trim_pnl = sum(t.get("pnl_usd", 0) for t in early_trims)
    position_pnl = sum(t.get("pnl_usd", 0) for t in position_trades)

    longs = [t for t in position_trades if t["direction"] == "long"]
    shorts = [t for t in position_trades if t["direction"] == "short"]
    long_wins = [t for t in longs if t["pnl_pct"] >= 0]
    short_wins = [t for t in shorts if t["pnl_pct"] >= 0]
    total_positions = len(longs) + len(shorts)
    win_count = len(long_wins) + len(short_wins)
    win_rate = (win_count / total_positions * 100) if total_positions > 0 else 0

    return {
        "label": label,
        "total_positions": total_positions,
        "longs": len(longs),
        "shorts": len(shorts),
        "total_trims": len(trims),
        "early_trims": len(early_trims),
        "fallback_trims": len(fallback_trims),
        "win_rate": round(win_rate, 1),
        "total_pnl_usd": round(total_pnl, 2),
        "position_pnl_usd": round(position_pnl, 2),
        "trim_pnl_usd": round(trim_pnl, 2),
        "early_trim_pnl_usd": round(early_trim_pnl, 2),
        "avg_trim_pnl": round(trim_pnl / len(trims), 2) if trims else 0,
        "avg_early_trim_pnl": round(early_trim_pnl / len(early_trims), 2) if early_trims else 0,
        "open_positions": len([t for t in trades if t["status"] == "open"]),
    }


def print_comparison(metrics_list: list[dict], trim_events: list[dict]):
    """Print side-by-side comparison focused on trim quality."""
    print("\n" + "=" * 90)
    print("  EXIT TIMING DETECTOR BACKTEST — STRATEGY COMPARISON")
    print("=" * 90)

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
        line = f"  {label:<28}"
        for v in vals:
            line += f"{v:>{col_w}}"
        # Delta columns
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
                    line += f"  {diff:+.1f}" if isinstance(diff, float) else f"  {diff:+d}"
        print(line)

    # Header
    headers = [m["label"] for m in metrics_list]
    line = f"  {'Metric':<28}"
    for h in headers:
        line += f"{h:>{col_w}}"
    if len(headers) >= 2:
        for _ in headers[1:]:
            line += f"  {'delta vs A':>10}"
    print(line)
    sep_len = 28 + col_w * len(headers) + 12 * max(0, len(headers) - 1)
    print(f"  {'─' * sep_len}")

    row("Positions (L+S)", "total_positions")
    row("Win rate %", "win_rate", ".1f")
    print(f"  {'─' * sep_len}")
    row("Total P&L (closed)", "total_pnl_usd", is_money=True)
    row("  Position P&L", "position_pnl_usd", is_money=True)
    row("  Trim P&L (total)", "trim_pnl_usd", is_money=True)
    row("  Trim P&L (early 30m)", "early_trim_pnl_usd", is_money=True)
    print(f"  {'─' * sep_len}")
    row("Total trims", "total_trims")
    row("  Early trims (30m)", "early_trims")
    row("  Fallback trims (4H)", "fallback_trims")
    row("Avg trim P&L", "avg_trim_pnl", is_money=True)
    row("Avg early trim P&L", "avg_early_trim_pnl", is_money=True)

    # Trim event analysis
    if trim_events:
        print(f"\n  {'─' * 60}")
        print(f"  Early Trim Events (30m RSI scanner)")
        print(f"  {'─' * 60}")

        yellow_trims = [e for e in trim_events if e["type"] == "yellow_trim_30m"]
        orange_trims = [e for e in trim_events if e["type"] == "orange_trim_30m"]

        print(f"    Yellow trims (RSI >= 78): {len(yellow_trims)}")
        print(f"    Orange trims (RSI >= 85): {len(orange_trims)}")

        if trim_events:
            price_deltas = [e["price_delta_pct"] for e in trim_events]
            rsi_deltas = [e["rsi_30m"] - e["rsi_4h"] for e in trim_events]
            print(f"\n    Price at 30m trim vs 4H close:")
            print(f"      Mean delta:   {np.mean(price_deltas):+.2f}%")
            print(f"      Median delta: {np.median(price_deltas):+.2f}%")
            print(f"      (positive = trimmed at higher price than 4H close)")
            print(f"\n    RSI at 30m trim vs RSI at 4H close:")
            print(f"      Mean delta:   {np.mean(rsi_deltas):+.1f} pts")
            print(f"      (positive = RSI was higher at 30m trim → closer to peak)")

        # Show individual trim events
        print(f"\n    {'Time':<24} {'Type':<18} {'30m $':>10} {'4H $':>10} {'delta':>8} {'RSI 30m':>8} {'RSI vel':>8} {'Trim P&L':>10}")
        for e in trim_events[:20]:
            print(
                f"    {e['time'][:19]:<24} {e['type']:<18} "
                f"${e['price_30m']:>9,.2f} ${e['price_4h_close']:>9,.2f} "
                f"{e['price_delta_pct']:>+7.2f}% "
                f"{e['rsi_30m']:>7.1f} {e['rsi_velocity']:>+7.1f} "
                f"${e.get('trim_pnl_usd', 0):>+9,.0f}"
            )
        if len(trim_events) > 20:
            print(f"    ... and {len(trim_events) - 20} more")


def print_trade_log(trades: list[dict], label: str):
    """Print trim-focused trade details."""
    trims = [t for t in trades if t["status"] == "closed" and t["direction"] in ("trim", "trim_short")]
    if not trims:
        return
    print(f"\n  {'─' * 70}")
    print(f"  Trim Log: {label}")
    print(f"  {'─' * 70}")
    print(f"  {'Reason':<22} {'Date':<12} {'Exit $':>10} {'P&L%':>8} {'P&L$':>8} {'Early':>6} {'RSI':>6} {'Vel':>6}")
    for t in trims[:30]:
        early = "30m" if t.get("early_trim") else "4H"
        rsi = t.get("rsi_at_trim", "")
        vel = t.get("rsi_velocity", "")
        rsi_str = f"{rsi:.0f}" if isinstance(rsi, float) else ""
        vel_str = f"{vel:+.0f}" if isinstance(vel, float) else ""
        print(
            f"  {t['exit_signal_reason']:<22} {t['exit_date']:<12} "
            f"${t['exit_price']:>9,.2f} {t['pnl_pct']:>+7.1f}% "
            f"${t['pnl_usd']:>+7.0f} {early:>6} {rsi_str:>6} {vel_str:>6}"
        )
    if len(trims) > 30:
        print(f"  ... and {len(trims) - 30} more trims")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_single_asset(
    coin: str,
    days: int = 365,
    rsi_velocity_threshold: float = 10.0,
    show_trades: bool = False,
) -> tuple[dict, dict, dict, dict, dict]:
    """Run all 5 strategies for a single asset. Returns (metrics_a..e)."""
    print("\n" + "=" * 70)
    print(f"  Exit Timing Detector — {coin}")
    print(f"  Lookback: {days} days | RSI velocity threshold: +{rsi_velocity_threshold} pts/2H")
    print("=" * 70)

    # 1. Fetch data
    print("\n[1/5] Fetching data...")
    df_4h = fetch_candles(coin, "4h", days)
    df_30m = fetch_candles(coin, "30m", days)

    # Determine overlap period
    overlap_start = max(df_4h.index[0], df_30m.index[0])
    overlap_end = min(df_4h.index[-1], df_30m.index[-1])
    print(f"\n  Overlap period: {overlap_start} to {overlap_end}")
    print(f"  4H candles in range: {len(df_4h[(df_4h.index >= overlap_start) & (df_4h.index <= overlap_end)])}")
    print(f"  30m candles in range: {len(df_30m[(df_30m.index >= overlap_start) & (df_30m.index <= overlap_end)])}")

    config = {**V6D_TRAILING_BOTH}

    # 2. Run strategies
    print("\n[2/5] Running backtests...")

    print("\n  Strategy A: Baseline (4H trims only)...")
    trades_a = run_baseline(df_4h, config)
    metrics_a = extract_metrics(trades_a, "A: Baseline")

    print(f"\n  Strategy B: Exit Scanner (30m RSI yellow+orange, vel >= +{rsi_velocity_threshold})...")
    trades_b, trim_events_b = run_exit_scanner(
        df_4h, df_30m, config, rsi_velocity_threshold=rsi_velocity_threshold
    )
    metrics_b = extract_metrics(trades_b, "B: Exit All")

    print(f"\n  Strategy C: Combined (momentum entries + exit scanner yellow+orange)...")
    trades_c, events_c = run_combined(
        df_4h, df_30m, config, rsi_velocity_threshold=rsi_velocity_threshold
    )
    metrics_c = extract_metrics(trades_c, "C: Combo All")

    print(f"\n  Strategy D: Exit Scanner ORANGE ONLY (30m RSI >= 85, no yellow)...")
    trades_d, trim_events_d = run_exit_scanner(
        df_4h, df_30m, config, rsi_velocity_threshold=rsi_velocity_threshold,
        orange_only_30m=True,
    )
    metrics_d = extract_metrics(trades_d, "D: Exit Org")

    print(f"\n  Strategy E: Combined (momentum entries + orange-only exit)...")
    trades_e, events_e = run_combined(
        df_4h, df_30m, config, rsi_velocity_threshold=rsi_velocity_threshold,
        orange_only_30m=True,
    )
    metrics_e = extract_metrics(trades_e, "E: Combo Org")

    # 3. Results
    print("\n[3/5] Results — All thresholds (yellow + orange)")
    print_comparison([metrics_a, metrics_b, metrics_c], trim_events_b)

    print("\n[4/5] Results — Orange only (RSI >= 85)")
    print_comparison([metrics_a, metrics_d, metrics_e], trim_events_d)

    if show_trades:
        print_trade_log(trades_a, "Baseline (A)")
        print_trade_log(trades_b, "Exit Scanner All (B)")
        print_trade_log(trades_c, "Combined All (C)")
        print_trade_log(trades_d, "Exit Scanner Orange (D)")
        print_trade_log(trades_e, "Combined Orange (E)")

    # Verdict
    print(f"\n[5/5] Verdicts")
    print(f"  {'─' * 70}")
    pnl_delta_b = metrics_b["total_pnl_usd"] - metrics_a["total_pnl_usd"]
    pnl_delta_c = metrics_c["total_pnl_usd"] - metrics_a["total_pnl_usd"]
    pnl_delta_d = metrics_d["total_pnl_usd"] - metrics_a["total_pnl_usd"]
    pnl_delta_e = metrics_e["total_pnl_usd"] - metrics_a["total_pnl_usd"]

    print(f"  B (exit all)       vs A: ${pnl_delta_b:>+8,.0f}  early trims: {metrics_b['early_trims']}")
    print(f"  C (combo all)      vs A: ${pnl_delta_c:>+8,.0f}")
    print(f"  D (exit orange)    vs A: ${pnl_delta_d:>+8,.0f}  early trims: {metrics_d['early_trims']}")
    print(f"  E (combo orange)   vs A: ${pnl_delta_e:>+8,.0f}")

    best_label = "B"
    best_delta = pnl_delta_b
    for label, delta in [("C", pnl_delta_c), ("D", pnl_delta_d), ("E", pnl_delta_e)]:
        if delta > best_delta:
            best_label = label
            best_delta = delta
    print(f"\n  BEST: Strategy {best_label} (${best_delta:+,.0f} vs baseline)")

    return metrics_a, metrics_b, metrics_c, metrics_d, metrics_e


def main():
    parser = argparse.ArgumentParser(description="Exit Timing Detector Backtest")
    parser.add_argument("--asset", default="HYPE", help="Asset symbol (default: HYPE)")
    parser.add_argument("--days", type=int, default=365, help="Lookback days (default: 365)")
    parser.add_argument("--rsi-velocity", type=float, default=10.0,
                        help="RSI velocity threshold in pts/2H (default: 10.0)")
    parser.add_argument("--trades", action="store_true", help="Print full trim logs")
    parser.add_argument("--all", action="store_true",
                        help="Run all 4 assets (HYPE, BTC, ETH, SOL)")
    args = parser.parse_args()

    if args.all:
        all_results = {}
        for coin in ["HYPE", "BTC", "ETH", "SOL"]:
            ma, mb, mc, md, me = run_single_asset(
                coin, args.days, args.rsi_velocity, args.trades
            )
            all_results[coin] = (ma, mb, mc, md, me)

        # Cross-asset summary
        print("\n\n" + "=" * 120)
        print("  CROSS-ASSET SUMMARY — EXIT TIMING DETECTOR (ALL 5 STRATEGIES)")
        print("=" * 120)

        print(
            f"\n  {'Asset':<8} {'A: Base':>10} "
            f"{'B: Exit':>10} {'C: Combo':>10} "
            f"{'D: Org Ex':>10} {'E: Org Co':>10} "
            f"{'B Δ':>8} {'C Δ':>8} {'D Δ':>8} {'E Δ':>8}"
        )
        print(f"  {'─' * 104}")

        totals = {"b": 0, "c": 0, "d": 0, "e": 0}

        for coin, (ma, mb, mc, md, me) in all_results.items():
            db = mb["total_pnl_usd"] - ma["total_pnl_usd"]
            dc = mc["total_pnl_usd"] - ma["total_pnl_usd"]
            dd = md["total_pnl_usd"] - ma["total_pnl_usd"]
            de = me["total_pnl_usd"] - ma["total_pnl_usd"]
            totals["b"] += db
            totals["c"] += dc
            totals["d"] += dd
            totals["e"] += de
            print(
                f"  {coin:<8} "
                f"${ma['total_pnl_usd']:>+8,.0f} "
                f"${mb['total_pnl_usd']:>+8,.0f} "
                f"${mc['total_pnl_usd']:>+8,.0f} "
                f"${md['total_pnl_usd']:>+8,.0f} "
                f"${me['total_pnl_usd']:>+8,.0f} "
                f"${db:>+6,.0f} "
                f"${dc:>+6,.0f} "
                f"${dd:>+6,.0f} "
                f"${de:>+6,.0f}"
            )

        print(f"  {'─' * 104}")
        print(
            f"  {'TOTAL':<8} {'':>10} {'':>10} {'':>10} {'':>10} {'':>10} "
            f"${totals['b']:>+6,.0f} "
            f"${totals['c']:>+6,.0f} "
            f"${totals['d']:>+6,.0f} "
            f"${totals['e']:>+6,.0f}"
        )

        # Legend
        print(f"\n  Legend:")
        print(f"    B = Exit scanner (yellow 78 + orange 85 on 30m)")
        print(f"    C = Momentum entries + exit scanner (yellow + orange)")
        print(f"    D = Exit scanner ORANGE ONLY (85 on 30m, skip yellow)")
        print(f"    E = Momentum entries + orange-only exit scanner")

        # Find best strategy
        best_key = max(totals, key=totals.get)
        best_labels = {"b": "B (exit all)", "c": "C (combo all)", "d": "D (exit orange)", "e": "E (combo orange)"}
        print(f"\n  BEST CROSS-ASSET: {best_labels[best_key]} at ${totals[best_key]:+,.0f}")

        # Key comparison: orange-only vs all thresholds
        print(f"\n  Orange-only vs all thresholds:")
        print(f"    Exit only:  D=${totals['d']:+,.0f} vs B=${totals['b']:+,.0f} (diff: ${totals['d'] - totals['b']:+,.0f})")
        print(f"    Combined:   E=${totals['e']:+,.0f} vs C=${totals['c']:+,.0f} (diff: ${totals['e'] - totals['c']:+,.0f})")
        print()

    else:
        run_single_asset(args.asset, args.days, args.rsi_velocity, args.trades)
        print()


if __name__ == "__main__":
    main()
