#!/usr/bin/env python3
"""
BB2 (Bollinger Band 2) Analysis on 30-Minute Candles
=====================================================
Fetches 30-min OHLC from Hyperliquid, simulates BB2 mean-reversion trades,
and tests multiple hold limits, stop-loss levels, and bull/bear regimes.

Usage:
    python3 scripts/bb2_analysis_30m.py
"""

import json
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SYMBOLS = {"BTC": "BTC", "ETH": "ETH", "HYPE": "HYPE", "SOL": "SOL"}
API_URL = "https://api.hyperliquid.xyz/info"
TARGET_DAYS = 730
CHUNK_DAYS = 100  # ~100 days per request (5000 candles @ 30min = ~104 days)
POSITION_SIZE = 1000.0
SLEEP_BETWEEN_REQUESTS = 2.0

HOLD_LIMITS = {
    "4h": 8,
    "8h": 16,
    "12h": 24,
    "16h": 32,
    "24h": 48,
}

STOP_LOSSES = [1.5, 2.0, 3.0, 4.0, 5.0]

# Date-based regime split (UTC timestamps)
BULL_START = datetime(2024, 3, 1, tzinfo=timezone.utc)
BULL_END = datetime(2025, 10, 1, tzinfo=timezone.utc)
# Bear/choppy: Oct 2025 - Mar 2026


# ---------------------------------------------------------------------------
# Data Fetching
# ---------------------------------------------------------------------------

def fetch_30m_candles(symbol: str) -> pd.DataFrame:
    """Fetch 30-min candles from Hyperliquid with pagination."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=TARGET_DAYS)
    all_candles = []
    chunk_delta = timedelta(days=CHUNK_DAYS)

    current_start = start
    request_count = 0

    while current_start < now:
        current_end = min(current_start + chunk_delta, now)
        start_ms = int(current_start.timestamp() * 1000)
        end_ms = int(current_end.timestamp() * 1000)

        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol,
                "interval": "30m",
                "startTime": start_ms,
                "endTime": end_ms,
            },
        }

        if request_count > 0:
            time.sleep(SLEEP_BETWEEN_REQUESTS)

        try:
            resp = requests.post(API_URL, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if data:
                all_candles.extend(data)
                print(f"  {symbol}: fetched {len(data)} candles "
                      f"({current_start.strftime('%Y-%m-%d')} to {current_end.strftime('%Y-%m-%d')})")
            else:
                print(f"  {symbol}: no data for "
                      f"{current_start.strftime('%Y-%m-%d')} to {current_end.strftime('%Y-%m-%d')}")
        except Exception as e:
            print(f"  {symbol}: error fetching {current_start.strftime('%Y-%m-%d')}: {e}")

        request_count += 1
        current_start = current_end

    if not all_candles:
        return pd.DataFrame()

    df = pd.DataFrame(all_candles)
    # Hyperliquid returns: t (timestamp ms), T (close time ms), s (symbol),
    # i (interval), o, h, l, c, v (volume)
    df["timestamp"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    for col in ["o", "h", "l", "c", "v"]:
        df[col] = df[col].astype(float)
    df = df.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
    df = df.sort_values("timestamp").drop_duplicates(subset=["timestamp"]).reset_index(drop=True)

    print(f"  {symbol}: {len(df)} total candles, "
          f"{df['timestamp'].iloc[0].strftime('%Y-%m-%d')} to {df['timestamp'].iloc[-1].strftime('%Y-%m-%d')}")
    return df[["timestamp", "open", "high", "low", "close", "volume"]]


# ---------------------------------------------------------------------------
# Indicator Computation
# ---------------------------------------------------------------------------

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Compute BB, RSI, ADX, ATR, SMA-50, volume MA on 30-min data."""
    close = df["close"]
    high = df["high"]
    low = df["low"]

    # Bollinger Bands (20, 2)
    bb_sma = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    df["bb_upper"] = bb_sma + 2 * bb_std
    df["bb_lower"] = bb_sma - 2 * bb_std
    df["bb_mid"] = bb_sma

    # RSI(14)
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1.0 / 14, min_periods=14).mean()
    avg_loss = loss.ewm(alpha=1.0 / 14, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    # ATR(14)
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1.0 / 14, min_periods=14).mean()

    # ADX(14)
    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)
    atr_smooth = tr.ewm(alpha=1.0 / 14, min_periods=14).mean()
    plus_di = 100 * (plus_dm.ewm(alpha=1.0 / 14, min_periods=14).mean() / atr_smooth)
    minus_di = 100 * (minus_dm.ewm(alpha=1.0 / 14, min_periods=14).mean() / atr_smooth)
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan) * 100
    df["adx"] = dx.ewm(alpha=1.0 / 14, min_periods=14).mean()

    # SMA-50
    df["sma50"] = close.rolling(50).mean()

    # Volume MA(20)
    df["vol_ma20"] = df["volume"].rolling(20).mean()

    return df


def compute_daily_sma50(df: pd.DataFrame) -> pd.DataFrame:
    """Resample 30-min data to daily and compute SMA-50 for regime detection."""
    daily = df.set_index("timestamp").resample("1D").agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"
    }).dropna()
    daily["sma50_daily"] = daily["close"].rolling(50).mean()
    return daily


# ---------------------------------------------------------------------------
# BB2 Signal Detection
# ---------------------------------------------------------------------------

def detect_bb2_signals(df: pd.DataFrame) -> pd.DataFrame:
    """Detect BB2 entry signals: touch/cross below lower band (long) or above upper band (short)."""
    signals = []
    for i in range(1, len(df)):
        row = df.iloc[i]
        if pd.isna(row["bb_lower"]) or pd.isna(row["bb_upper"]) or pd.isna(row["rsi"]):
            continue

        # Long signal: close touches or crosses below lower BB
        if row["close"] <= row["bb_lower"]:
            signals.append({
                "signal_idx": i,
                "timestamp": row["timestamp"],
                "direction": "long",
                "signal_close": row["close"],
                "bb_lower": row["bb_lower"],
                "bb_upper": row["bb_upper"],
                "rsi": row["rsi"],
            })

        # Short signal: close touches or crosses above upper BB
        elif row["close"] >= row["bb_upper"]:
            signals.append({
                "signal_idx": i,
                "timestamp": row["timestamp"],
                "direction": "short",
                "signal_close": row["close"],
                "bb_lower": row["bb_lower"],
                "bb_upper": row["bb_upper"],
                "rsi": row["rsi"],
            })

    return pd.DataFrame(signals) if signals else pd.DataFrame()


# ---------------------------------------------------------------------------
# Trade Simulation
# ---------------------------------------------------------------------------

def simulate_trades(
    df: pd.DataFrame,
    signals: pd.DataFrame,
    hold_limit_bars: int,
    stop_loss_pct: float,
    daily_sma: Optional[pd.DataFrame] = None,
) -> list[dict]:
    """Simulate BB2 trades with given hold limit and stop loss."""
    if signals.empty:
        return []

    trades = []
    last_exit_idx = -1  # prevent overlapping trades

    for _, sig in signals.iterrows():
        entry_idx = sig["signal_idx"] + 1  # enter on next bar
        if entry_idx >= len(df) or entry_idx <= last_exit_idx:
            continue

        entry_bar = df.iloc[entry_idx]
        entry_price = entry_bar["open"]  # enter at open of next bar
        entry_time = entry_bar["timestamp"]
        direction = sig["direction"]

        # Determine regime
        regime = "unknown"
        if daily_sma is not None:
            entry_date = entry_time.normalize()
            mask = daily_sma.index <= entry_date
            if mask.any():
                daily_row = daily_sma.loc[mask].iloc[-1]
                if pd.notna(daily_row.get("sma50_daily")):
                    regime = "bull" if daily_row["close"] > daily_row["sma50_daily"] else "bear"

        # Date-based regime
        date_regime = "bull" if BULL_START <= entry_time <= BULL_END else "bear"

        # Simulate bar-by-bar
        exit_reason = "expiry"
        exit_price = None
        exit_time = None
        exit_idx = None

        max_bars = min(hold_limit_bars, len(df) - entry_idx - 1)
        for j in range(1, max_bars + 1):
            bar_idx = entry_idx + j
            bar = df.iloc[bar_idx]

            # Check stop loss using high/low
            if direction == "long":
                pnl_pct = (bar["low"] - entry_price) / entry_price * 100
                if pnl_pct <= -stop_loss_pct:
                    exit_reason = "stop"
                    exit_price = entry_price * (1 - stop_loss_pct / 100)
                    exit_time = bar["timestamp"]
                    exit_idx = bar_idx
                    break
            else:  # short
                pnl_pct = (entry_price - bar["high"]) / entry_price * 100
                if pnl_pct <= -stop_loss_pct:
                    exit_reason = "stop"
                    exit_price = entry_price * (1 + stop_loss_pct / 100)
                    exit_time = bar["timestamp"]
                    exit_idx = bar_idx
                    break

            # Check RSI target (mean reversion: RSI crosses 50)
            if pd.notna(bar.get("rsi")):
                if direction == "long" and bar["rsi"] >= 50:
                    exit_reason = "target"
                    exit_price = bar["close"]
                    exit_time = bar["timestamp"]
                    exit_idx = bar_idx
                    break
                elif direction == "short" and bar["rsi"] <= 50:
                    exit_reason = "target"
                    exit_price = bar["close"]
                    exit_time = bar["timestamp"]
                    exit_idx = bar_idx
                    break

        # If no exit yet, use expiry at close of last bar
        if exit_price is None:
            final_idx = min(entry_idx + max_bars, len(df) - 1)
            exit_price = df.iloc[final_idx]["close"]
            exit_time = df.iloc[final_idx]["timestamp"]
            exit_idx = final_idx

        last_exit_idx = exit_idx

        # Compute P&L
        if direction == "long":
            pnl_pct_final = (exit_price - entry_price) / entry_price * 100
        else:
            pnl_pct_final = (entry_price - exit_price) / entry_price * 100

        pnl_dollar = POSITION_SIZE * pnl_pct_final / 100
        bars_held = exit_idx - entry_idx

        trades.append({
            "entry_time": entry_time,
            "exit_time": exit_time,
            "direction": direction,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "pnl_pct": pnl_pct_final,
            "pnl_dollar": pnl_dollar,
            "exit_reason": exit_reason,
            "bars_held": bars_held,
            "regime_sma": regime,
            "regime_date": date_regime,
            "rsi_at_entry": sig["rsi"],
        })

    return trades


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_separator(char="=", width=80):
    print(char * width)


def report_trades(trades: list[dict], label: str):
    """Print summary stats for a set of trades."""
    if not trades:
        print(f"  {label}: No trades")
        return

    df = pd.DataFrame(trades)
    total = len(df)
    wins = (df["pnl_dollar"] > 0).sum()
    losses = (df["pnl_dollar"] <= 0).sum()
    win_rate = wins / total * 100 if total > 0 else 0
    total_pnl = df["pnl_dollar"].sum()
    avg_pnl = df["pnl_dollar"].mean()
    avg_win = df.loc[df["pnl_dollar"] > 0, "pnl_dollar"].mean() if wins > 0 else 0
    avg_loss = df.loc[df["pnl_dollar"] <= 0, "pnl_dollar"].mean() if losses > 0 else 0
    avg_bars = df["bars_held"].mean()

    longs = df[df["direction"] == "long"]
    shorts = df[df["direction"] == "short"]

    print(f"\n  {label}")
    print(f"  {'Trades:':<20} {total:>6}  |  Win rate: {win_rate:.1f}%")
    print(f"  {'Total P&L:':<20} ${total_pnl:>+9.2f}  |  Avg P&L: ${avg_pnl:>+.2f}")
    print(f"  {'Avg win:':<20} ${avg_win:>+9.2f}  |  Avg loss: ${avg_loss:>+.2f}")
    print(f"  {'Avg bars held:':<20} {avg_bars:>6.1f}")
    print(f"  {'Longs:':<20} {len(longs):>6}  P&L: ${longs['pnl_dollar'].sum():>+.2f}")
    print(f"  {'Shorts:':<20} {len(shorts):>6}  P&L: ${shorts['pnl_dollar'].sum():>+.2f}")

    # Exit reason breakdown
    for reason in ["target", "stop", "expiry"]:
        subset = df[df["exit_reason"] == reason]
        if len(subset) > 0:
            r_pnl = subset["pnl_dollar"].sum()
            r_wr = (subset["pnl_dollar"] > 0).sum() / len(subset) * 100
            print(f"  Exit {reason:<10}: {len(subset):>4} trades, "
                  f"P&L ${r_pnl:>+9.2f}, WR {r_wr:.1f}%")


def report_regime(trades: list[dict], regime_col: str, label: str):
    """Report trades split by regime."""
    if not trades:
        return
    df = pd.DataFrame(trades)
    print(f"\n  {label}")
    for regime in sorted(df[regime_col].unique()):
        subset = df[df[regime_col] == regime]
        total = len(subset)
        if total == 0:
            continue
        wins = (subset["pnl_dollar"] > 0).sum()
        wr = wins / total * 100
        pnl = subset["pnl_dollar"].sum()
        avg = subset["pnl_dollar"].mean()
        print(f"    {regime.upper():<10}: {total:>4} trades, WR {wr:.1f}%, "
              f"P&L ${pnl:>+9.2f}, Avg ${avg:>+.2f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print_separator()
    print("BB2 ANALYSIS ON 30-MINUTE CANDLES")
    print(f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Assets: {', '.join(SYMBOLS.keys())}")
    print(f"Hold limits: {', '.join(HOLD_LIMITS.keys())}")
    print(f"Stop losses: {', '.join(f'{s}%' for s in STOP_LOSSES)}")
    print_separator()

    # Collect all trades per asset (with default 3% stop, for hold-limit analysis)
    all_trades_by_hold: dict[str, list[dict]] = {k: [] for k in HOLD_LIMITS}
    # For stop-loss sensitivity (use 8h hold limit)
    all_trades_by_stop: dict[float, list[dict]] = {s: [] for s in STOP_LOSSES}
    # Per-asset storage for detailed reporting
    asset_trades_by_hold: dict[str, dict[str, list[dict]]] = {}

    for symbol, hl_symbol in SYMBOLS.items():
        print(f"\n{'='*80}")
        print(f"Fetching {symbol} 30-min candles...")
        print(f"{'='*80}")

        df = fetch_30m_candles(hl_symbol)
        if df.empty or len(df) < 100:
            print(f"  Insufficient data for {symbol}, skipping.")
            continue

        print(f"\nComputing indicators for {symbol}...")
        df = compute_indicators(df)

        print(f"Computing daily SMA-50 for regime detection...")
        daily_sma = compute_daily_sma50(df)

        print(f"Detecting BB2 signals...")
        signals = detect_bb2_signals(df)
        if signals.empty:
            print(f"  No BB2 signals found for {symbol}")
            continue
        print(f"  Found {len(signals)} BB2 signals ({(signals['direction'] == 'long').sum()} long, "
              f"{(signals['direction'] == 'short').sum()} short)")

        asset_trades_by_hold[symbol] = {}

        # --- Hold limit sweep (3% stop) ---
        for hold_name, hold_bars in HOLD_LIMITS.items():
            trades = simulate_trades(df, signals, hold_bars, 3.0, daily_sma)
            all_trades_by_hold[hold_name].extend(trades)
            asset_trades_by_hold[symbol][hold_name] = trades

        # --- Stop loss sweep (8h = 16 bars hold) ---
        for stop_pct in STOP_LOSSES:
            trades = simulate_trades(df, signals, 16, stop_pct, daily_sma)
            all_trades_by_stop[stop_pct].extend(trades)

        # Free memory
        del df, signals, daily_sma

    # ======================================================================
    # REPORTING
    # ======================================================================

    print("\n")
    print_separator("=", 80)
    print("RESULTS: HOLD LIMIT COMPARISON (3% stop loss)")
    print_separator("=", 80)

    for hold_name in HOLD_LIMITS:
        trades = all_trades_by_hold[hold_name]
        report_trades(trades, f"Hold limit: {hold_name} (all assets)")

    # Per-asset breakdown for each hold limit
    print("\n")
    print_separator("=", 80)
    print("PER-ASSET BREAKDOWN BY HOLD LIMIT (3% stop)")
    print_separator("=", 80)

    for hold_name in HOLD_LIMITS:
        print(f"\n--- {hold_name} ---")
        for symbol in SYMBOLS:
            if symbol in asset_trades_by_hold and hold_name in asset_trades_by_hold[symbol]:
                trades = asset_trades_by_hold[symbol][hold_name]
                report_trades(trades, f"{symbol}")

    # ======================================================================
    # STOP LOSS SENSITIVITY
    # ======================================================================

    print("\n")
    print_separator("=", 80)
    print("RESULTS: STOP LOSS SENSITIVITY (8h hold limit)")
    print_separator("=", 80)

    for stop_pct in STOP_LOSSES:
        trades = all_trades_by_stop[stop_pct]
        report_trades(trades, f"Stop: {stop_pct}% (all assets)")

    # ======================================================================
    # BULL vs BEAR (SMA-based regime)
    # ======================================================================

    print("\n")
    print_separator("=", 80)
    print("RESULTS: BULL vs BEAR (SMA-50 regime, 8h hold, 3% stop)")
    print_separator("=", 80)

    # Use 8h trades
    trades_8h = all_trades_by_hold["8h"]
    report_regime(trades_8h, "regime_sma", "SMA-50 regime (price vs daily SMA-50)")
    report_regime(trades_8h, "regime_date", "Date-based regime (pre/post Oct 2025)")

    # Per-asset regime breakdown
    for symbol in SYMBOLS:
        if symbol in asset_trades_by_hold and "8h" in asset_trades_by_hold[symbol]:
            trades = asset_trades_by_hold[symbol]["8h"]
            if trades:
                print(f"\n  --- {symbol} ---")
                report_regime(trades, "regime_sma", f"  {symbol} SMA-50 regime")
                report_regime(trades, "regime_date", f"  {symbol} date-based regime")

    # ======================================================================
    # SUMMARY TABLE
    # ======================================================================

    print("\n")
    print_separator("=", 80)
    print("SUMMARY TABLE: Hold Limit x Stop Loss (Total P&L, all assets)")
    print_separator("=", 80)

    # We have full data for 3% stop across hold limits, and 8h hold across stops.
    # Print what we have.
    print(f"\n{'Hold':<8}", end="")
    for s in STOP_LOSSES:
        print(f"  {'Stop '+str(s)+'%':>12}", end="")
    print()
    print("-" * (8 + 14 * len(STOP_LOSSES)))

    # For the 8h row, we have all stop losses
    # For other rows, we only have 3% stop
    for hold_name in HOLD_LIMITS:
        print(f"{hold_name:<8}", end="")
        for s in STOP_LOSSES:
            if hold_name == "8h":
                trades = all_trades_by_stop[s]
                pnl = sum(t["pnl_dollar"] for t in trades) if trades else 0
                n = len(trades)
                print(f"  ${pnl:>+8.0f}({n:>3})", end="")
            elif s == 3.0:
                trades = all_trades_by_hold[hold_name]
                pnl = sum(t["pnl_dollar"] for t in trades) if trades else 0
                n = len(trades)
                print(f"  ${pnl:>+8.0f}({n:>3})", end="")
            else:
                print(f"  {'---':>12}", end="")
        print()

    # ======================================================================
    # VERDICT
    # ======================================================================

    print("\n")
    print_separator("=", 80)
    print("VERDICT")
    print_separator("=", 80)

    best_hold = None
    best_hold_pnl = -999999
    for hold_name in HOLD_LIMITS:
        trades = all_trades_by_hold[hold_name]
        pnl = sum(t["pnl_dollar"] for t in trades) if trades else 0
        if pnl > best_hold_pnl:
            best_hold_pnl = pnl
            best_hold = hold_name

    best_stop = None
    best_stop_pnl = -999999
    for s in STOP_LOSSES:
        trades = all_trades_by_stop[s]
        pnl = sum(t["pnl_dollar"] for t in trades) if trades else 0
        if pnl > best_stop_pnl:
            best_stop_pnl = pnl
            best_stop = s

    print(f"\n  Best hold limit (3% stop):   {best_hold} -> P&L ${best_hold_pnl:>+.2f}")
    print(f"  Best stop loss (8h hold):    {best_stop}% -> P&L ${best_stop_pnl:>+.2f}")

    total_8h_3pct = sum(t["pnl_dollar"] for t in all_trades_by_hold["8h"])
    n_8h = len(all_trades_by_hold["8h"])
    print(f"\n  Current prod config (8h, 3% stop): {n_8h} trades, P&L ${total_8h_3pct:>+.2f}")

    if total_8h_3pct < 0 and best_hold_pnl < 0 and best_stop_pnl < 0:
        print("\n  CONCLUSION: BB2 is net negative across ALL tested configurations.")
        print("  Recommendation: DISABLE BB2 or restrict to bull-regime only.")
    elif total_8h_3pct < 0:
        if best_hold_pnl > 0:
            print(f"\n  CONCLUSION: BB2 is negative at 8h but positive at {best_hold}.")
            print(f"  Consider switching hold limit to {best_hold}.")
        if best_stop_pnl > 0:
            print(f"\n  CONCLUSION: BB2 is negative at 3% stop but positive at {best_stop}%.")
            print(f"  Consider switching stop loss to {best_stop}%.")
    else:
        print("\n  CONCLUSION: BB2 is profitable at current config.")

    print_separator()


if __name__ == "__main__":
    main()
