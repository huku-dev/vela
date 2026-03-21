#!/usr/bin/env python3
"""
Momentum Filter Analysis + Bar-1 Loser Analysis
================================================
TASK 1: Investigate whether a momentum > +/-10% filter cuts winners.
        Explore adaptive exit timing for high-momentum entries.
TASK 2: Find predictive features for "never profitable from bar 1" trades.

Uses PROD_ACTUAL config on 4H Hyperliquid candle data (730 days).
"""

import sys
import os
import time
from datetime import datetime, timezone
from collections import defaultdict

import pandas as pd
import numpy as np
import math

# ---------------------------------------------------------------------------
# Import from backtest.py
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
    POSITION_SIZE_USD,
)

import requests

ASSETS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
    "solana": "SOL",
}
DAYS = 730


# ---------------------------------------------------------------------------
# 1. Fetch 4H candles (reused from backtest_4h.py pattern)
# ---------------------------------------------------------------------------

def fetch_4h_ohlc(coingecko_id: str, days: int = DAYS) -> pd.DataFrame:
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(f"No Hyperliquid symbol for '{coingecko_id}'")

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days}d of 4H candles for {symbol}...")

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
                    print(f"  Rate limited. Waiting {wait}s ({attempt+1}/3)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"HL API failed for {symbol}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"HL rate limit exceeded for {symbol}")

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
        raise ValueError(f"No 4H candle data for {symbol}")

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
    df = df.drop(columns=["timestamp_ms"])

    cutoff = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    df = df[df.index >= cutoff]

    print(f"  Got {len(df)} 4H candles ({df.index[0].strftime('%Y-%m-%d')} to {df.index[-1].strftime('%Y-%m-%d')})")
    return df


# ---------------------------------------------------------------------------
# 2. Group trades into positions
# ---------------------------------------------------------------------------

def group_into_positions(trades: list[dict], asset: str) -> list[dict]:
    """
    Group trades into positions. A position = the main close trade + any trims
    that share the same entry_date and entry_price (and direction family).
    Position total_pnl = close pnl_usd + sum of trim pnl_usd.
    """
    # Separate main trades (long/short) from trims
    main_trades = [t for t in trades if t.get("direction") in ("long", "short") and t.get("status") == "closed" and "exit_date" in t]
    trim_trades = [t for t in trades if t.get("direction") == "trim" and t.get("status") == "closed"]

    positions = []
    for mt in main_trades:
        direction = mt["direction"]
        entry_date = mt["entry_date"]
        entry_price = mt["entry_price"]

        # Find matching trims
        matching_trims = [
            t for t in trim_trades
            if t["entry_date"] == entry_date
            and t["entry_price"] == entry_price
        ]

        close_pnl = mt.get("pnl_usd", 0.0)
        trim_pnl = sum(t.get("pnl_usd", 0.0) for t in matching_trims)
        total_pnl = close_pnl + trim_pnl

        positions.append({
            "asset": asset,
            "direction": direction,
            "entry_date": entry_date,
            "entry_price": entry_price,
            "exit_date": mt.get("exit_date"),
            "exit_price": mt.get("exit_price"),
            "exit_reason": mt.get("exit_signal_reason", ""),
            "close_pnl": close_pnl,
            "trim_pnl": trim_pnl,
            "total_pnl": total_pnl,
            "pnl_pct": mt.get("pnl_pct", 0.0),
            "entry_indicators": mt.get("entry_indicators", {}),
            "num_trims": len(matching_trims),
        })

    return positions


# ---------------------------------------------------------------------------
# 3. Compute entry features for each position
# ---------------------------------------------------------------------------

def compute_entry_features(positions: list[dict], candle_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    For each position, compute features at entry from the 4H candle data.
    Returns a DataFrame with one row per position and all features.
    """
    rows = []
    for pos in positions:
        asset = pos["asset"]
        df = candle_data.get(asset)
        if df is None:
            continue

        entry_date_str = pos["entry_date"]
        # Find the entry bar index in df
        entry_dt = pd.Timestamp(entry_date_str, tz="UTC") if "T" in entry_date_str or "+" in entry_date_str else pd.Timestamp(entry_date_str + "T00:00:00", tz="UTC")

        # Find closest bar at or before entry
        mask = df.index <= entry_dt
        if mask.sum() == 0:
            # Try to find nearest
            mask = df.index >= entry_dt
            if mask.sum() == 0:
                continue

        if mask.sum() > 0:
            entry_idx = df.index[mask][-1]
        else:
            entry_idx = df.index[0]

        entry_bar_loc = df.index.get_loc(entry_idx)

        row_data = df.iloc[entry_bar_loc]

        # 20-bar momentum: price change over last 20 bars as %
        if entry_bar_loc >= 20:
            price_20_ago = df.iloc[entry_bar_loc - 20]["close"]
            momentum_20 = ((row_data["close"] - price_20_ago) / price_20_ago) * 100
        else:
            momentum_20 = np.nan

        # BB width %
        if "rsi_bb_upper" in df.columns and "rsi_bb_lower" in df.columns:
            bb_upper = row_data.get("rsi_bb_upper", np.nan)
            bb_lower = row_data.get("rsi_bb_lower", np.nan)
            bb_width = bb_upper - bb_lower if not (pd.isna(bb_upper) or pd.isna(bb_lower)) else np.nan
        else:
            bb_width = np.nan

        # BB position: where RSI sits within BB (0 = lower, 1 = upper)
        if not pd.isna(bb_width) and bb_width > 0:
            bb_position = (row_data["rsi_14"] - bb_lower) / bb_width
        else:
            bb_position = np.nan

        # Distance from SMA-50 as %
        sma50 = row_data.get("sma_50", np.nan)
        if not pd.isna(sma50) and sma50 > 0:
            dist_sma50_pct = ((row_data["close"] - sma50) / sma50) * 100
        else:
            dist_sma50_pct = np.nan

        # Consecutive same-direction bars before entry
        direction = pos["direction"]
        consec = 0
        for lookback in range(1, min(entry_bar_loc, 50)):
            prev_bar = df.iloc[entry_bar_loc - lookback]
            if direction == "long" and prev_bar["close"] > prev_bar["open"]:
                consec += 1
            elif direction == "short" and prev_bar["close"] < prev_bar["open"]:
                consec += 1
            else:
                break

        # Hour of day
        hour_of_day = entry_idx.hour if hasattr(entry_idx, "hour") else 0

        rows.append({
            **pos,
            "rsi_at_entry": row_data.get("rsi_14", np.nan),
            "adx_at_entry": row_data.get("adx", np.nan),
            "ema_spread_pct": row_data.get("ema_spread_pct", np.nan),
            "bb_width_pct": bb_width,
            "atr_pct": row_data.get("atr_pct", np.nan),
            "vol_ratio": row_data.get("volume_ratio", np.nan),
            "dist_sma50_pct": dist_sma50_pct,
            "momentum_20bar": momentum_20,
            "bb_position": bb_position,
            "consecutive_same_dir_bars": consec,
            "hour_of_day": hour_of_day,
            "entry_bar_loc": entry_bar_loc,
        })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# 4. "Never profitable" analysis
# ---------------------------------------------------------------------------

def classify_profitability(pos_df: pd.DataFrame, candle_data: dict[str, pd.DataFrame]) -> pd.Series:
    """
    For each position, check if it was EVER profitable during its lifetime.
    Returns a Series with categories: 'never_profitable', 'was_profitable_then_lost', 'winner'
    """
    categories = []

    for _, pos in pos_df.iterrows():
        asset = pos["asset"]
        df = candle_data.get(asset)
        if df is None:
            categories.append("unknown")
            continue

        entry_price = pos["entry_price"]
        direction = pos["direction"]

        entry_date_str = pos["entry_date"]
        exit_date_str = pos.get("exit_date", "")

        entry_dt = pd.Timestamp(entry_date_str, tz="UTC") if "T" in entry_date_str or "+" in entry_date_str else pd.Timestamp(entry_date_str + "T00:00:00", tz="UTC")

        if exit_date_str:
            exit_dt = pd.Timestamp(exit_date_str, tz="UTC") if "T" in exit_date_str or "+" in exit_date_str else pd.Timestamp(exit_date_str + "T00:00:00", tz="UTC")
        else:
            exit_dt = df.index[-1]

        # Get bars during position lifetime
        lifetime_bars = df[(df.index >= entry_dt) & (df.index <= exit_dt)]

        if len(lifetime_bars) <= 1:
            # Only entry bar, can't determine
            if pos["total_pnl"] > 0:
                categories.append("winner")
            else:
                categories.append("never_profitable")
            continue

        # Skip the entry bar itself
        post_entry = lifetime_bars.iloc[1:]

        was_ever_profitable = False
        if direction == "long":
            # Conservative: any bar's close > entry_price
            if (post_entry["close"] > entry_price).any():
                was_ever_profitable = True
        elif direction == "short":
            # Conservative: any bar's close < entry_price
            if (post_entry["close"] < entry_price).any():
                was_ever_profitable = True

        if pos["total_pnl"] > 0:
            categories.append("winner")
        elif was_ever_profitable:
            categories.append("was_profitable_then_lost")
        else:
            categories.append("never_profitable")

    return pd.Series(categories, index=pos_df.index)


# ---------------------------------------------------------------------------
# 5. Quick-exit simulation for high-momentum entries
# ---------------------------------------------------------------------------

def simulate_quick_exits(pos_df: pd.DataFrame, candle_data: dict[str, pd.DataFrame],
                         momentum_threshold: float = 10.0,
                         exit_bars_list: list[int] = None) -> dict:
    """
    For positions with |momentum| > threshold, simulate exiting after N bars.
    Returns {exit_bars: {total_pnl, avg_pnl, n_trades, ...}}
    """
    if exit_bars_list is None:
        exit_bars_list = [2, 4, 6, 8, 12]

    high_mom = pos_df[pos_df["momentum_20bar"].abs() > momentum_threshold].copy()
    if len(high_mom) == 0:
        return {}

    results = {}
    # Also compute "default" (actual) P&L for comparison
    default_pnl = high_mom["total_pnl"].sum()
    default_avg = high_mom["total_pnl"].mean()
    results["default"] = {
        "total_pnl": round(default_pnl, 2),
        "avg_pnl": round(default_avg, 2),
        "n_trades": len(high_mom),
        "winners": (high_mom["total_pnl"] > 0).sum(),
        "losers": (high_mom["total_pnl"] <= 0).sum(),
    }

    for exit_bars in exit_bars_list:
        pnls = []
        for _, pos in high_mom.iterrows():
            asset = pos["asset"]
            df = candle_data.get(asset)
            if df is None:
                continue

            entry_bar_loc = pos["entry_bar_loc"]
            target_bar_loc = entry_bar_loc + exit_bars

            if target_bar_loc >= len(df):
                target_bar_loc = len(df) - 1

            target_bar = df.iloc[target_bar_loc]
            exit_price = target_bar["close"]
            entry_price = pos["entry_price"]
            direction = pos["direction"]

            if direction == "long":
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - exit_price) / entry_price) * 100

            pnl_usd = pnl_pct / 100 * POSITION_SIZE_USD
            pnls.append(pnl_usd)

        total = sum(pnls)
        avg = np.mean(pnls) if pnls else 0
        winners = sum(1 for p in pnls if p > 0)
        losers = sum(1 for p in pnls if p <= 0)

        results[f"{exit_bars}_bars"] = {
            "total_pnl": round(total, 2),
            "avg_pnl": round(avg, 2),
            "n_trades": len(pnls),
            "winners": winners,
            "losers": losers,
        }

    return results


# ===========================================================================
# MAIN
# ===========================================================================

def main():
    print("=" * 80)
    print("MOMENTUM FILTER ANALYSIS + BAR-1 LOSER ANALYSIS")
    print("Config: PROD_ACTUAL on 4H candles, 730 days, BTC/ETH/HYPE/SOL")
    print("=" * 80)

    # -----------------------------------------------------------------------
    # Step 1: Fetch data
    # -----------------------------------------------------------------------
    print("\n--- STEP 1: Fetching 4H candle data ---\n")
    candle_data_raw: dict[str, pd.DataFrame] = {}
    candle_data_ind: dict[str, pd.DataFrame] = {}

    for cg_id, symbol in ASSETS.items():
        df = fetch_4h_ohlc(cg_id, DAYS)
        candle_data_raw[symbol] = df.copy()
        df_ind = calculate_indicators(df, PROD_ACTUAL)
        candle_data_ind[symbol] = df_ind
        time.sleep(2)

    # -----------------------------------------------------------------------
    # Step 2: Run backtest, group into positions
    # -----------------------------------------------------------------------
    print("\n--- STEP 2: Running PROD_ACTUAL backtest ---\n")
    all_positions = []

    for cg_id, symbol in ASSETS.items():
        df_ind = candle_data_ind[symbol]
        df_sig = generate_signals(df_ind, PROD_ACTUAL)
        trades = simulate_trades(df_sig, POSITION_SIZE_USD, PROD_ACTUAL)
        positions = group_into_positions(trades, symbol)
        print(f"  {symbol}: {len(positions)} positions, {len(trades)} total trade records")
        all_positions.extend(positions)

    print(f"\nTotal positions across all assets: {len(all_positions)}")

    # -----------------------------------------------------------------------
    # Step 3: Compute entry features
    # -----------------------------------------------------------------------
    print("\n--- STEP 3: Computing entry features ---\n")
    pos_df = compute_entry_features(all_positions, candle_data_ind)
    print(f"Positions with features: {len(pos_df)}")
    print(f"  Longs: {(pos_df['direction'] == 'long').sum()}")
    print(f"  Shorts: {(pos_df['direction'] == 'short').sum()}")
    print(f"  Winners (total_pnl > 0): {(pos_df['total_pnl'] > 0).sum()}")
    print(f"  Losers (total_pnl <= 0): {(pos_df['total_pnl'] <= 0).sum()}")
    print(f"  Total P&L: ${pos_df['total_pnl'].sum():.2f}")

    # ===================================================================
    # TASK 1: MOMENTUM FILTER ANALYSIS
    # ===================================================================
    print("\n" + "=" * 80)
    print("TASK 1: MOMENTUM FILTER ANALYSIS")
    print("=" * 80)

    valid_mom = pos_df[pos_df["momentum_20bar"].notna()].copy()
    print(f"\nPositions with valid 20-bar momentum: {len(valid_mom)}")

    # (a) Momentum distribution
    print("\n--- (a) Momentum Distribution ---\n")
    for threshold in [5, 10, 15, 20]:
        above = (valid_mom["momentum_20bar"] > threshold).sum()
        below = (valid_mom["momentum_20bar"] < -threshold).sum()
        total = len(valid_mom)
        print(f"  Momentum > +{threshold}%: {above} ({above/total*100:.1f}%)")
        print(f"  Momentum < -{threshold}%: {below} ({below/total*100:.1f}%)")

    print(f"\n  Momentum stats:")
    print(f"    Mean: {valid_mom['momentum_20bar'].mean():.2f}%")
    print(f"    Median: {valid_mom['momentum_20bar'].median():.2f}%")
    print(f"    Std: {valid_mom['momentum_20bar'].std():.2f}%")
    print(f"    Min: {valid_mom['momentum_20bar'].min():.2f}%, Max: {valid_mom['momentum_20bar'].max():.2f}%")

    # (b) High momentum positions breakdown
    print("\n--- (b) |Momentum| > 10% Breakdown ---\n")
    high_mom_10 = valid_mom[valid_mom["momentum_20bar"].abs() > 10]
    low_mom_10 = valid_mom[valid_mom["momentum_20bar"].abs() <= 10]

    if len(high_mom_10) > 0:
        hm_winners = (high_mom_10["total_pnl"] > 0).sum()
        hm_losers = (high_mom_10["total_pnl"] <= 0).sum()
        hm_total_pnl = high_mom_10["total_pnl"].sum()
        hm_avg_pnl = high_mom_10["total_pnl"].mean()
        print(f"  High momentum (|mom| > 10%): {len(high_mom_10)} positions")
        print(f"    Winners: {hm_winners} ({hm_winners/len(high_mom_10)*100:.1f}%)")
        print(f"    Losers: {hm_losers} ({hm_losers/len(high_mom_10)*100:.1f}%)")
        print(f"    Total P&L: ${hm_total_pnl:.2f}")
        print(f"    Avg P&L: ${hm_avg_pnl:.2f}")
    else:
        print("  No positions with |momentum| > 10%")

    print(f"\n  Low momentum (|mom| <= 10%): {len(low_mom_10)} positions")
    if len(low_mom_10) > 0:
        lm_winners = (low_mom_10["total_pnl"] > 0).sum()
        lm_losers = (low_mom_10["total_pnl"] <= 0).sum()
        print(f"    Winners: {lm_winners} ({lm_winners/len(low_mom_10)*100:.1f}%)")
        print(f"    Losers: {lm_losers} ({lm_losers/len(low_mom_10)*100:.1f}%)")
        print(f"    Total P&L: ${low_mom_10['total_pnl'].sum():.2f}")
        print(f"    Avg P&L: ${low_mom_10['total_pnl'].mean():.2f}")

    # (c) Big winners at high momentum
    print("\n--- (c) Big Winners (P&L > $50) at High Momentum ---\n")
    big_winners_high_mom = valid_mom[(valid_mom["total_pnl"] > 50) & (valid_mom["momentum_20bar"].abs() > 10)]
    if len(big_winners_high_mom) > 0:
        for _, bw in big_winners_high_mom.iterrows():
            print(f"  {bw['asset']} {bw['direction']:5s} | Entry: {bw['entry_date'][:10]} @ ${bw['entry_price']:.2f} | "
                  f"P&L: ${bw['total_pnl']:.2f} | Momentum: {bw['momentum_20bar']:+.1f}%")
    else:
        print("  No big winners (>$50) entered at |momentum| > 10%")

    # Also check: big winners at ANY momentum level
    print("\n  All big winners (P&L > $50) for context:")
    big_winners = valid_mom[valid_mom["total_pnl"] > 50].sort_values("total_pnl", ascending=False)
    for _, bw in big_winners.iterrows():
        print(f"  {bw['asset']} {bw['direction']:5s} | Entry: {bw['entry_date'][:10]} @ ${bw['entry_price']:.2f} | "
              f"P&L: ${bw['total_pnl']:.2f} | Momentum: {bw['momentum_20bar']:+.1f}%")

    # (d) Compare: remove vs tighter exits
    print("\n--- (d) Remove High-Momentum vs Tighter Exits ---\n")

    baseline_pnl = valid_mom["total_pnl"].sum()
    print(f"  Baseline (all trades): ${baseline_pnl:.2f} ({len(valid_mom)} positions)")

    if len(high_mom_10) > 0:
        filtered_pnl = low_mom_10["total_pnl"].sum()
        print(f"  After removing |mom|>10%: ${filtered_pnl:.2f} ({len(low_mom_10)} positions)")
        print(f"  Impact of removing: ${filtered_pnl - baseline_pnl:+.2f}")

    # (6) Quick-exit simulation for high-momentum entries
    print("\n--- (6) Quick-Exit Timing for High-Momentum Entries ---\n")
    quick_exit_results = simulate_quick_exits(pos_df, candle_data_ind, 10.0)
    if quick_exit_results:
        print(f"  {'Exit After':<15s} {'Total P&L':>12s} {'Avg P&L':>10s} {'Winners':>8s} {'Losers':>8s} {'Win%':>8s}")
        print(f"  {'-'*63}")
        for key, res in quick_exit_results.items():
            label = key.replace("_bars", " bars") if "_" in key else key
            wr = res["winners"] / res["n_trades"] * 100 if res["n_trades"] > 0 else 0
            print(f"  {label:<15s} ${res['total_pnl']:>10.2f} ${res['avg_pnl']:>8.2f} {res['winners']:>8d} {res['losers']:>8d} {wr:>7.1f}%")

    # (7) Threshold sweep
    print("\n--- (7) Momentum Threshold Sweep ---\n")
    print(f"  {'Threshold':<12s} {'Filtered':>10s} {'Their P&L':>12s} {'Remaining P&L':>14s} {'Delta':>10s} {'FilteredW':>10s} {'FilteredL':>10s}")
    print(f"  {'-'*80}")
    for thresh in [5, 7, 10, 15, 20]:
        filtered = valid_mom[valid_mom["momentum_20bar"].abs() > thresh]
        remaining = valid_mom[valid_mom["momentum_20bar"].abs() <= thresh]
        f_pnl = filtered["total_pnl"].sum()
        r_pnl = remaining["total_pnl"].sum()
        f_winners = (filtered["total_pnl"] > 0).sum()
        f_losers = (filtered["total_pnl"] <= 0).sum()
        delta = r_pnl - baseline_pnl
        print(f"  |mom|>{thresh:>2d}%    {len(filtered):>10d} ${f_pnl:>10.2f} ${r_pnl:>12.2f} ${delta:>8.2f}  {f_winners:>10d} {f_losers:>10d}")

    # Quick exit for each threshold
    print("\n--- Quick-Exit Comparison at Different Momentum Thresholds ---\n")
    for thresh in [5, 7, 10, 15]:
        results = simulate_quick_exits(pos_df, candle_data_ind, thresh, [4, 8, 12])
        if not results:
            continue
        print(f"  Momentum threshold: |mom| > {thresh}%")
        for key, res in results.items():
            label = key.replace("_bars", " bars") if "_" in key else key
            print(f"    {label:<15s}: ${res['total_pnl']:>8.2f} total, ${res['avg_pnl']:>6.2f} avg, {res['winners']}W/{res['losers']}L")
        print()

    # ===================================================================
    # TASK 2: BAR-1 LOSER ANALYSIS
    # ===================================================================
    print("\n" + "=" * 80)
    print("TASK 2: 'NEVER PROFITABLE FROM BAR 1' ANALYSIS")
    print("=" * 80)

    # Classify positions
    print("\n--- Classifying position profitability ---\n")
    pos_df["profit_class"] = classify_profitability(pos_df, candle_data_ind)

    for cls in ["winner", "was_profitable_then_lost", "never_profitable", "unknown"]:
        n = (pos_df["profit_class"] == cls).sum()
        if n > 0:
            total = pos_df[pos_df["profit_class"] == cls]["total_pnl"].sum()
            print(f"  {cls}: {n} positions, total P&L: ${total:.2f}")

    # Feature comparison
    features = [
        "rsi_at_entry", "adx_at_entry", "ema_spread_pct", "bb_width_pct",
        "atr_pct", "vol_ratio", "dist_sma50_pct", "momentum_20bar",
        "bb_position", "consecutive_same_dir_bars", "hour_of_day",
    ]

    winners = pos_df[pos_df["profit_class"] == "winner"]
    never_prof = pos_df[pos_df["profit_class"] == "never_profitable"]
    was_prof = pos_df[pos_df["profit_class"] == "was_profitable_then_lost"]

    print("\n--- (4) Feature Comparison: Winners vs Never-Profitable ---\n")
    print(f"  {'Feature':<26s} {'Winner Mean':>12s} {'NeverProf Mean':>14s} {'Diff':>10s} {'t-stat':>10s} {'p-value':>10s} {'Sig?':>6s}")
    print(f"  {'-'*90}")

    def welch_ttest(a: pd.Series, b: pd.Series) -> tuple[float, float]:
        """Welch's t-test (unequal variance). Returns (t_stat, p_value)."""
        na, nb = len(a), len(b)
        ma, mb = a.mean(), b.mean()
        va, vb = a.var(ddof=1), b.var(ddof=1)
        se = math.sqrt(va / na + vb / nb)
        if se == 0:
            return 0.0, 1.0
        t = (ma - mb) / se
        # Welch-Satterthwaite degrees of freedom
        num = (va / na + vb / nb) ** 2
        denom = (va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)
        df = num / denom if denom > 0 else 1
        # Approximate two-tailed p-value using normal distribution for large df
        # For small df we'd need a t-distribution CDF, but normal is good enough here
        z = abs(t)
        # Abramowitz & Stegun approximation for normal CDF
        p_one_tail = 0.5 * math.erfc(z / math.sqrt(2))
        p_val = 2 * p_one_tail
        return t, min(p_val, 1.0)

    significant_features = []
    for feat in features:
        w_vals = winners[feat].dropna()
        n_vals = never_prof[feat].dropna()

        if len(w_vals) < 3 or len(n_vals) < 3:
            print(f"  {feat:<26s} {'(insufficient data)':>40s}")
            continue

        w_mean = w_vals.mean()
        n_mean = n_vals.mean()
        diff = n_mean - w_mean

        t_stat, p_val = welch_ttest(w_vals, n_vals)
        sig = "*" if p_val < 0.05 else ("**" if p_val < 0.01 else "")

        print(f"  {feat:<26s} {w_mean:>12.3f} {n_mean:>14.3f} {diff:>+10.3f} {t_stat:>10.2f} {p_val:>10.4f} {sig:>6s}")

        if p_val < 0.10:
            significant_features.append((feat, t_stat, p_val, w_mean, n_mean))

    if was_prof is not None and len(was_prof) > 3:
        print(f"\n  (Also: 'was profitable then lost' group mean comparison)")
        for feat in features:
            w_vals = winners[feat].dropna()
            wp_vals = was_prof[feat].dropna()
            if len(w_vals) < 3 or len(wp_vals) < 3:
                continue
            print(f"  {feat:<26s}  Winner: {w_vals.mean():>8.3f}  WasProf: {wp_vals.mean():>8.3f}  Diff: {wp_vals.mean()-w_vals.mean():>+8.3f}")

    # (5) T-test ranking
    print("\n--- (5) Features ranked by significance ---\n")
    significant_features.sort(key=lambda x: x[2])
    for feat, t, p, wm, nm in significant_features:
        direction = "higher" if nm > wm else "lower"
        print(f"  {feat}: p={p:.4f}, never-profitable {direction} (W:{wm:.3f} vs NP:{nm:.3f})")

    # (6) Test individual filters
    print("\n--- (6) Individual Feature Filters ---\n")

    # Generate candidate filters based on direction of significant features
    candidate_filters = []

    # Always test these standard ones:
    candidate_filters.extend([
        ("RSI > 65", lambda r: r["rsi_at_entry"] > 65),
        ("RSI < 35", lambda r: r["rsi_at_entry"] < 35),
        ("RSI > 70 or < 30", lambda r: (r["rsi_at_entry"] > 70) | (r["rsi_at_entry"] < 30)),
        ("ADX < 15", lambda r: r["adx_at_entry"] < 15),
        ("ADX > 35", lambda r: r["adx_at_entry"] > 35),
        ("|momentum| > 10%", lambda r: r["momentum_20bar"].abs() > 10),
        ("|momentum| > 15%", lambda r: r["momentum_20bar"].abs() > 15),
        ("vol_ratio < 0.5", lambda r: r["vol_ratio"] < 0.5),
        ("vol_ratio < 0.8", lambda r: r["vol_ratio"] < 0.8),
        ("atr_pct > 5%", lambda r: r["atr_pct"] > 5),
        ("atr_pct > 8%", lambda r: r["atr_pct"] > 8),
        ("|ema_spread| > 3%", lambda r: r["ema_spread_pct"].abs() > 3),
        ("|dist_sma50| > 10%", lambda r: r["dist_sma50_pct"].abs() > 10),
        ("bb_position > 0.9", lambda r: r["bb_position"] > 0.9),
        ("bb_position < 0.1", lambda r: r["bb_position"] < 0.1),
    ])

    # Compound filters
    candidate_filters.extend([
        ("ADX<15 + |mom|>10%", lambda r: (r["adx_at_entry"] < 15) | (r["momentum_20bar"].abs() > 10)),
        ("vol<0.8 + RSI extreme", lambda r: (r["vol_ratio"] < 0.8) & ((r["rsi_at_entry"] > 65) | (r["rsi_at_entry"] < 35))),
        ("ADX<20 + atr>5%", lambda r: (r["adx_at_entry"] < 20) & (r["atr_pct"] > 5)),
    ])

    # Use valid data
    eval_df = pos_df[pos_df["profit_class"].isin(["winner", "never_profitable", "was_profitable_then_lost"])].copy()
    total_never = (eval_df["profit_class"] == "never_profitable").sum()
    total_winners = (eval_df["profit_class"] == "winner").sum()

    print(f"  Evaluation set: {len(eval_df)} positions ({total_winners} winners, {total_never} never-profitable)")
    print(f"\n  {'Filter':<30s} {'Caught':>8s} {'NP Caught':>10s} {'W Lost':>8s} {'Precision':>10s} {'Recall':>10s} {'Net P&L':>10s}")
    print(f"  {'-'*88}")

    for name, filter_fn in candidate_filters:
        try:
            mask = filter_fn(eval_df)
            caught = mask.sum()
            if caught == 0:
                continue

            caught_np = (eval_df[mask]["profit_class"] == "never_profitable").sum()
            caught_w = (eval_df[mask]["profit_class"] == "winner").sum()
            precision = caught_np / caught * 100 if caught > 0 else 0
            recall = caught_np / total_never * 100 if total_never > 0 else 0

            # Net P&L impact: sum of P&L of filtered trades (if positive, filtering hurts)
            net_pnl = eval_df[mask]["total_pnl"].sum()

            print(f"  {name:<30s} {caught:>8d} {caught_np:>10d} {caught_w:>8d} {precision:>9.1f}% {recall:>9.1f}% ${net_pnl:>8.2f}")
        except Exception as e:
            print(f"  {name:<30s} ERROR: {e}")

    # ===================================================================
    # TASK 2 continued: ADX Bucket Analysis
    # ===================================================================
    print("\n" + "=" * 80)
    print("ADX BUCKET ANALYSIS")
    print("=" * 80)

    adx_valid = pos_df[pos_df["adx_at_entry"].notna()].copy()
    adx_buckets = [
        ("0-15", 0, 15),
        ("15-20", 15, 20),
        ("20-25", 20, 25),
        ("25-30", 25, 30),
        ("30-35", 30, 35),
        ("35+", 35, 999),
    ]

    print(f"\n  {'ADX Bucket':<12s} {'N':>6s} {'Total P&L':>12s} {'Avg P&L':>10s} {'Win%':>8s} {'Winners':>8s} {'Losers':>8s} {'Avg Mom':>10s}")
    print(f"  {'-'*80}")

    for label, lo, hi in adx_buckets:
        bucket = adx_valid[(adx_valid["adx_at_entry"] >= lo) & (adx_valid["adx_at_entry"] < hi)]
        if len(bucket) == 0:
            print(f"  {label:<12s} {0:>6d} {'---':>12s}")
            continue
        total = bucket["total_pnl"].sum()
        avg = bucket["total_pnl"].mean()
        winners = (bucket["total_pnl"] > 0).sum()
        losers = (bucket["total_pnl"] <= 0).sum()
        wr = winners / len(bucket) * 100
        avg_mom = bucket["momentum_20bar"].mean() if bucket["momentum_20bar"].notna().any() else 0
        print(f"  {label:<12s} {len(bucket):>6d} ${total:>10.2f} ${avg:>8.2f} {wr:>7.1f}% {winners:>8d} {losers:>8d} {avg_mom:>+9.1f}%")

    # ADX x Momentum interaction
    print("\n--- ADX x Momentum Interaction ---\n")
    print(f"  {'ADX Bucket':<12s} {'Low Mom':<20s} {'High Mom (|>10%|)':<20s}")
    print(f"  {'-'*55}")
    for label, lo, hi in adx_buckets:
        bucket = adx_valid[(adx_valid["adx_at_entry"] >= lo) & (adx_valid["adx_at_entry"] < hi)]
        if len(bucket) == 0:
            continue
        low_m = bucket[bucket["momentum_20bar"].abs() <= 10]
        high_m = bucket[bucket["momentum_20bar"].abs() > 10]
        low_s = f"n={len(low_m)}, ${low_m['total_pnl'].sum():.0f}" if len(low_m) > 0 else "n=0"
        high_s = f"n={len(high_m)}, ${high_m['total_pnl'].sum():.0f}" if len(high_m) > 0 else "n=0"
        print(f"  {label:<12s} {low_s:<20s} {high_s:<20s}")

    # Never-profitable by ADX bucket
    print(f"\n--- Never-Profitable Rate by ADX Bucket ---\n")
    for label, lo, hi in adx_buckets:
        bucket = adx_valid[(adx_valid["adx_at_entry"] >= lo) & (adx_valid["adx_at_entry"] < hi)]
        if len(bucket) == 0:
            continue
        np_count = (bucket["profit_class"] == "never_profitable").sum()
        np_rate = np_count / len(bucket) * 100 if len(bucket) > 0 else 0
        print(f"  {label:<12s}: {np_count}/{len(bucket)} ({np_rate:.1f}%) never profitable")

    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()
