#!/usr/bin/env python3
"""
loser_analysis_4h.py — Deep analysis of losing positions on 4H bars.
=====================================================================
Runs PROD_ACTUAL on 4H candles (730 days), groups trades into positions
(main + trims), computes entry-time features, and finds what separates
winners from losers. Outputs actionable filter candidates.

Usage:
    python scripts/loser_analysis_4h.py
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

ASSETS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
    "solana": "SOL",
}
DAYS = 730


# ===================================================================
# 1. Fetch 4H candles (reused from backtest_4h.py)
# ===================================================================

def fetch_4h_ohlc(coingecko_id: str, days: int = DAYS) -> pd.DataFrame:
    import requests
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
                    raise RuntimeError(f"HL API failed after 3 retries for {symbol}: {e}")
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


# ===================================================================
# 2. Group trades into positions
# ===================================================================

def group_into_positions(trades: list[dict], asset: str) -> list[dict]:
    """
    Group trades into positions. A position = main trade (long/short) +
    associated trims matched by (asset, entry_date, entry_price).
    Position P&L = close P&L + sum of trim P&Ls.
    """
    positions = []
    # Find main trades (long/short, not bb2_ or trim)
    mains = [t for t in trades if t.get("direction") in ("long", "short")]
    trims = [t for t in trades if t.get("direction") == "trim"]
    bb2s = [t for t in trades if t.get("direction", "").startswith("bb2_")]

    for main_trade in mains:
        entry_date = main_trade.get("entry_date")
        entry_price = main_trade.get("entry_price")
        direction = main_trade.get("direction")

        # Find matching trims
        matching_trims = [
            t for t in trims
            if t.get("entry_date") == entry_date
            and t.get("entry_price") == entry_price
        ]

        trim_pnl = sum(t.get("pnl_usd", 0) for t in matching_trims)
        main_pnl = main_trade.get("pnl_usd", 0)
        total_pnl = main_pnl + trim_pnl

        positions.append({
            "asset": asset,
            "direction": direction,
            "entry_date": entry_date,
            "entry_price": entry_price,
            "exit_date": main_trade.get("exit_date"),
            "exit_price": main_trade.get("exit_price"),
            "exit_reason": main_trade.get("exit_signal_reason", ""),
            "entry_bar_index": main_trade.get("entry_bar_index", 0),
            "main_pnl": main_pnl,
            "trim_pnl": trim_pnl,
            "total_pnl": total_pnl,
            "main_pnl_pct": main_trade.get("pnl_pct", 0),
            "n_trims": len(matching_trims),
            "had_trims": len(matching_trims) > 0,
            "entry_indicators": main_trade.get("entry_indicators", {}),
            "exit_indicators": main_trade.get("exit_indicators", {}),
            "remaining_pct": main_trade.get("remaining_pct", 100),
            "status": main_trade.get("status", ""),
        })

    # Also include bb2 trades as standalone positions
    for bb2 in bb2s:
        positions.append({
            "asset": asset,
            "direction": bb2.get("direction"),
            "entry_date": bb2.get("entry_date"),
            "entry_price": bb2.get("entry_price"),
            "exit_date": bb2.get("exit_date"),
            "exit_price": bb2.get("exit_price"),
            "exit_reason": bb2.get("exit_signal_reason", ""),
            "entry_bar_index": bb2.get("entry_bar_index", 0),
            "main_pnl": bb2.get("pnl_usd", 0),
            "trim_pnl": 0,
            "total_pnl": bb2.get("pnl_usd", 0),
            "main_pnl_pct": bb2.get("pnl_pct", 0),
            "n_trims": 0,
            "had_trims": False,
            "entry_indicators": bb2.get("entry_indicators", {}),
            "exit_indicators": bb2.get("exit_indicators", {}),
            "remaining_pct": 100,
            "status": bb2.get("status", ""),
        })

    return positions


# ===================================================================
# 3. Compute entry-time features
# ===================================================================

def compute_entry_features(positions: list[dict], dfs: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    For each position, look up the indicator DataFrame at entry time
    and compute rich features.
    """
    rows = []
    for pos in positions:
        asset = pos["asset"]
        df = dfs.get(asset)
        if df is None:
            continue

        entry_bar = pos["entry_bar_index"]
        if entry_bar < 0 or entry_bar >= len(df):
            continue

        row = df.iloc[entry_bar]
        price = row["close"]
        direction = pos["direction"]
        is_long = direction in ("long", "bb2_long")

        # Basic indicators at entry
        rsi = row.get("rsi_14", np.nan)
        adx = row.get("adx", np.nan)
        ema9 = row.get("ema_9", np.nan)
        ema21 = row.get("ema_21", np.nan)
        sma50 = row.get("sma_50", np.nan)
        atr = row.get("atr_14", np.nan)
        vol = row.get("volume", np.nan)
        vma20 = row.get("vma_20", np.nan)
        vol_ratio = row.get("volume_ratio", np.nan)

        # EMA spread %
        ema_spread_pct = row.get("ema_spread_pct", np.nan)

        # ATR as % of price
        atr_pct = row.get("atr_pct", np.nan)

        # Price Bollinger Bands (compute from df)
        if entry_bar >= 20:
            close_window = df["close"].iloc[max(0, entry_bar-19):entry_bar+1]
            bb_sma = close_window.mean()
            bb_std = close_window.std()
            if bb_std > 0:
                bb_upper = bb_sma + 2 * bb_std
                bb_lower = bb_sma - 2 * bb_std
                bb_width_pct = ((bb_upper - bb_lower) / bb_sma) * 100
                bb_position = (price - bb_lower) / (bb_upper - bb_lower) if (bb_upper - bb_lower) > 0 else 0.5
            else:
                bb_width_pct = np.nan
                bb_position = np.nan
        else:
            bb_width_pct = np.nan
            bb_position = np.nan

        # Distance from SMA-50
        dist_sma50_pct = ((price - sma50) / sma50 * 100) if not pd.isna(sma50) and sma50 > 0 else np.nan

        # 20-bar momentum
        if entry_bar >= 20:
            price_20_ago = df["close"].iloc[entry_bar - 20]
            momentum_20bar = ((price - price_20_ago) / price_20_ago) * 100 if price_20_ago > 0 else np.nan
        else:
            momentum_20bar = np.nan

        # Consecutive same-direction bars before entry
        consecutive = 0
        for i in range(entry_bar - 1, max(entry_bar - 30, -1), -1):
            if i < 0:
                break
            bar_close = df["close"].iloc[i]
            bar_open = df["open"].iloc[i]
            if is_long:
                if bar_close > bar_open:
                    consecutive += 1
                else:
                    break
            else:
                if bar_close < bar_open:
                    consecutive += 1
                else:
                    break

        # Hour of day
        idx = df.index[entry_bar]
        hour_of_day = idx.hour if hasattr(idx, "hour") else np.nan

        # Trend alignment: price above SMA-50 matches long, below matches short
        if not pd.isna(sma50) and sma50 > 0:
            if is_long:
                trend_aligned = 1 if price > sma50 else 0
            else:
                trend_aligned = 1 if price < sma50 else 0
        else:
            trend_aligned = np.nan

        # Signal age: bars since last signal change
        # Look backwards for the previous different signal color
        current_color = row.get("signal_color", "grey")
        signal_age = 0
        for i in range(entry_bar - 1, max(entry_bar - 200, -1), -1):
            if i < 0:
                break
            prev_color = df.iloc[i].get("signal_color", "grey")
            if prev_color == current_color:
                signal_age += 1
            else:
                break

        # Hold duration (bars)
        exit_date_str = pos.get("exit_date")
        entry_date_str = pos.get("entry_date")
        if exit_date_str and entry_date_str:
            try:
                ed = pd.Timestamp(entry_date_str)
                xd = pd.Timestamp(exit_date_str)
                hold_hours = (xd - ed).total_seconds() / 3600
            except Exception:
                hold_hours = np.nan
        else:
            hold_hours = np.nan

        # Month of entry (for temporal clustering)
        try:
            entry_month = pd.Timestamp(entry_date_str).strftime("%Y-%m")
        except Exception:
            entry_month = "unknown"

        rows.append({
            "asset": asset,
            "direction": direction,
            "is_long": is_long,
            "entry_date": entry_date_str,
            "exit_date": exit_date_str,
            "entry_price": pos["entry_price"],
            "exit_price": pos.get("exit_price"),
            "exit_reason": pos["exit_reason"],
            "total_pnl": pos["total_pnl"],
            "main_pnl": pos["main_pnl"],
            "trim_pnl": pos["trim_pnl"],
            "main_pnl_pct": pos["main_pnl_pct"],
            "n_trims": pos["n_trims"],
            "had_trims": pos["had_trims"],
            "hold_hours": hold_hours,
            "entry_month": entry_month,
            # ── Features at entry ──
            "rsi_at_entry": rsi,
            "adx_at_entry": adx,
            "ema_spread_pct": ema_spread_pct,
            "bb_width_pct": bb_width_pct,
            "atr_pct": atr_pct,
            "vol_ratio": vol_ratio,
            "dist_sma50_pct": dist_sma50_pct,
            "momentum_20bar": momentum_20bar,
            "bb_position": bb_position,
            "consecutive_bars": consecutive,
            "hour_of_day": hour_of_day,
            "trend_aligned": trend_aligned,
            "signal_age": signal_age,
        })

    return pd.DataFrame(rows)


# ===================================================================
# 4. Analysis functions
# ===================================================================

FEATURES = [
    "rsi_at_entry", "adx_at_entry", "ema_spread_pct", "bb_width_pct",
    "atr_pct", "vol_ratio", "dist_sma50_pct", "momentum_20bar",
    "bb_position", "consecutive_bars", "hour_of_day", "trend_aligned",
    "signal_age",
]


def print_section(title: str):
    print(f"\n{'='*78}")
    print(f"  {title}")
    print(f"{'='*78}")


def analyze_groups(df: pd.DataFrame):
    """Split into 4 P&L groups and compare features."""
    print_section("GROUP ANALYSIS: Feature means by P&L bucket")

    big_win = df[df["total_pnl"] > 50]
    small_win = df[(df["total_pnl"] > 0) & (df["total_pnl"] <= 50)]
    small_loss = df[(df["total_pnl"] > -50) & (df["total_pnl"] <= 0)]
    big_loss = df[df["total_pnl"] <= -50]

    groups = {
        "Big Winners (>$50)": big_win,
        "Small Winners ($0-$50)": small_win,
        "Small Losers (-$50-$0)": small_loss,
        "Big Losers (<-$50)": big_loss,
    }

    print(f"\n  Group sizes:")
    for name, g in groups.items():
        avg_pnl = g["total_pnl"].mean() if len(g) > 0 else 0
        total = g["total_pnl"].sum() if len(g) > 0 else 0
        print(f"    {name}: {len(g)} positions, avg P&L ${avg_pnl:+.2f}, total ${total:+.2f}")

    # Feature means comparison
    print(f"\n  {'Feature':<20s} {'Big Win':>10s} {'Sm Win':>10s} {'Sm Loss':>10s} {'Big Loss':>10s} {'Corr w/PnL':>10s} {'T-stat':>8s} {'p-val':>8s}")
    print(f"  {'-'*20} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")

    for feat in FEATURES:
        vals = []
        for name, g in groups.items():
            if len(g) > 0 and feat in g.columns:
                v = g[feat].dropna().mean()
                vals.append(f"{v:>10.3f}" if not pd.isna(v) else f"{'N/A':>10s}")
            else:
                vals.append(f"{'N/A':>10s}")

        # Correlation with total_pnl
        valid = df[[feat, "total_pnl"]].dropna()
        if len(valid) > 5:
            corr = valid[feat].corr(valid["total_pnl"])
            corr_str = f"{corr:>+10.4f}"
        else:
            corr_str = f"{'N/A':>10s}"

        # T-test: big winners vs big losers (Welch's t-test, manual)
        bw_vals = big_win[feat].dropna()
        bl_vals = big_loss[feat].dropna()
        if len(bw_vals) >= 3 and len(bl_vals) >= 3:
            n1, n2 = len(bw_vals), len(bl_vals)
            m1, m2 = bw_vals.mean(), bl_vals.mean()
            v1, v2 = bw_vals.var(ddof=1), bl_vals.var(ddof=1)
            se = math.sqrt(v1/n1 + v2/n2) if (v1/n1 + v2/n2) > 0 else 1e-10
            t_stat = (m1 - m2) / se
            t_str = f"{t_stat:>8.2f}"
            p_str = f"{'--':>8s}"  # p-value omitted (no scipy)
        else:
            t_str = f"{'N/A':>8s}"
            p_str = f"{'N/A':>8s}"

        print(f"  {feat:<20s} {vals[0]} {vals[1]} {vals[2]} {vals[3]} {corr_str} {t_str} {p_str}")


def analyze_filters(df: pd.DataFrame):
    """Test individual and compound filters to improve P&L."""
    print_section("FILTER ANALYSIS: Individual filters")

    baseline_trades = len(df)
    baseline_wins = len(df[df["total_pnl"] > 0])
    baseline_wr = baseline_wins / baseline_trades * 100 if baseline_trades > 0 else 0
    baseline_pnl = df["total_pnl"].sum()

    print(f"\n  Baseline: {baseline_trades} positions, {baseline_wr:.1f}% win rate, ${baseline_pnl:+.2f} total P&L")
    print()

    filters = [
        # ADX filters
        ("ADX < 22", lambda r: r["adx_at_entry"] < 22),
        ("ADX < 25", lambda r: r["adx_at_entry"] < 25),
        ("ADX < 28", lambda r: r["adx_at_entry"] < 28),
        ("ADX < 30", lambda r: r["adx_at_entry"] < 30),
        ("ADX > 50", lambda r: r["adx_at_entry"] > 50),
        # RSI filters
        ("RSI 45-55 (chop zone)", lambda r: 45 <= r["rsi_at_entry"] <= 55),
        ("RSI extreme (>70 or <30)", lambda r: r["rsi_at_entry"] > 70 or r["rsi_at_entry"] < 30),
        # Volume
        ("vol_ratio < 0.5", lambda r: r["vol_ratio"] < 0.5),
        ("vol_ratio < 0.7", lambda r: r["vol_ratio"] < 0.7),
        ("vol_ratio < 0.8", lambda r: r["vol_ratio"] < 0.8),
        ("vol_ratio < 1.0", lambda r: r["vol_ratio"] < 1.0),
        # EMA spread
        ("|ema_spread| < 0.1%", lambda r: abs(r["ema_spread_pct"]) < 0.1),
        ("|ema_spread| < 0.2%", lambda r: abs(r["ema_spread_pct"]) < 0.2),
        ("|ema_spread| < 0.5%", lambda r: abs(r["ema_spread_pct"]) < 0.5),
        # ATR (volatility)
        ("atr_pct > 5%", lambda r: r["atr_pct"] > 5),
        ("atr_pct > 8%", lambda r: r["atr_pct"] > 8),
        ("atr_pct < 1%", lambda r: r["atr_pct"] < 1),
        # BB position
        ("BB pos > 0.9 (near upper)", lambda r: r["bb_position"] > 0.9),
        ("BB pos < 0.1 (near lower)", lambda r: r["bb_position"] < 0.1),
        # BB width
        ("BB width < 3%", lambda r: r["bb_width_pct"] < 3),
        ("BB width > 15%", lambda r: r["bb_width_pct"] > 15),
        # Momentum
        ("momentum_20bar > 10%", lambda r: r["momentum_20bar"] > 10),
        ("momentum_20bar < -10%", lambda r: r["momentum_20bar"] < -10),
        # Trend alignment
        ("NOT trend aligned", lambda r: r["trend_aligned"] == 0),
        # Signal age
        ("signal_age > 10 bars", lambda r: r["signal_age"] > 10),
        ("signal_age > 20 bars", lambda r: r["signal_age"] > 20),
        # Consecutive bars
        ("consecutive_bars >= 5", lambda r: r["consecutive_bars"] >= 5),
        ("consecutive_bars >= 3", lambda r: r["consecutive_bars"] >= 3),
        # SMA50 distance
        ("dist_sma50 > 10%", lambda r: abs(r["dist_sma50_pct"]) > 10),
        ("dist_sma50 > 15%", lambda r: abs(r["dist_sma50_pct"]) > 15),
        # Hold time (too short)
        ("hold < 12h", lambda r: r.get("hold_hours", 999) < 12),
    ]

    results = []
    print(f"  {'Filter (skip when true)':<32s} {'Removed':>8s} {'Remain':>7s} {'WinRate':>8s} {'TotalPnL':>10s} {'Improve':>10s} {'AvgPnL':>8s}")
    print(f"  {'-'*32} {'-'*8} {'-'*7} {'-'*8} {'-'*10} {'-'*10} {'-'*8}")

    for name, cond in filters:
        try:
            mask = df.apply(cond, axis=1).fillna(False)
        except Exception:
            continue
        removed = mask.sum()
        remaining = df[~mask]
        n_remain = len(remaining)
        if n_remain == 0:
            continue
        wins = len(remaining[remaining["total_pnl"] > 0])
        wr = wins / n_remain * 100
        total = remaining["total_pnl"].sum()
        improve = total - baseline_pnl
        avg_pnl = remaining["total_pnl"].mean()

        results.append((name, removed, n_remain, wr, total, improve, avg_pnl))
        print(f"  {name:<32s} {removed:>8d} {n_remain:>7d} {wr:>7.1f}% {total:>+10.2f} {improve:>+10.2f} {avg_pnl:>+8.2f}")

    # Sort by improvement
    results.sort(key=lambda x: x[5], reverse=True)
    print(f"\n  Top 10 filters by P&L improvement:")
    print(f"  {'Filter':<32s} {'Removed':>8s} {'Improve':>10s} {'NewWR':>8s}")
    print(f"  {'-'*32} {'-'*8} {'-'*10} {'-'*8}")
    for name, removed, n_remain, wr, total, improve, avg_pnl in results[:10]:
        print(f"  {name:<32s} {removed:>8d} {improve:>+10.2f} {wr:>7.1f}%")

    return results


def analyze_compound_filters(df: pd.DataFrame, top_filters: list):
    """Test combinations of the top individual filters."""
    print_section("COMPOUND FILTER ANALYSIS")

    baseline_pnl = df["total_pnl"].sum()
    baseline_wr = len(df[df["total_pnl"] > 0]) / len(df) * 100

    # Define compound filter candidates
    compounds = [
        ("ADX<25 + vol<0.8", lambda r: r["adx_at_entry"] < 25 or r["vol_ratio"] < 0.8),
        ("ADX<25 + NOT trend aligned", lambda r: r["adx_at_entry"] < 25 or r["trend_aligned"] == 0),
        ("vol<0.7 + |ema_spread|<0.2%", lambda r: r["vol_ratio"] < 0.7 or abs(r["ema_spread_pct"]) < 0.2),
        ("ADX<25 + signal_age>10", lambda r: r["adx_at_entry"] < 25 or r["signal_age"] > 10),
        ("NOT aligned + vol<0.8", lambda r: r["trend_aligned"] == 0 or r["vol_ratio"] < 0.8),
        ("ADX<28 + vol<0.7 + NOT aligned", lambda r: r["adx_at_entry"] < 28 or r["vol_ratio"] < 0.7 or r["trend_aligned"] == 0),
        ("ADX<25 + |ema_spread|<0.2%", lambda r: r["adx_at_entry"] < 25 or abs(r["ema_spread_pct"]) < 0.2),
        ("ADX<22 + vol<0.5", lambda r: r["adx_at_entry"] < 22 or r["vol_ratio"] < 0.5),
        ("atr_pct>8% + NOT aligned", lambda r: r["atr_pct"] > 8 or r["trend_aligned"] == 0),
        ("momentum>10% + BB pos>0.9", lambda r: r["momentum_20bar"] > 10 or r["bb_position"] > 0.9),
        ("dist_sma50>15% (overextended)", lambda r: abs(r["dist_sma50_pct"]) > 15),
        ("ADX<25 AND vol<1.0", lambda r: r["adx_at_entry"] < 25 and r["vol_ratio"] < 1.0),
        ("NOT aligned AND ADX<30", lambda r: r["trend_aligned"] == 0 and r["adx_at_entry"] < 30),
        ("signal_age>10 AND vol<0.8", lambda r: r["signal_age"] > 10 and r["vol_ratio"] < 0.8),
        ("BB width<3% (tight range)", lambda r: r["bb_width_pct"] < 3),
        ("consec>=3 + momentum>10%", lambda r: r["consecutive_bars"] >= 3 and r["momentum_20bar"] > 10),
    ]

    print(f"\n  Baseline: {len(df)} positions, {baseline_wr:.1f}% WR, ${baseline_pnl:+.2f} P&L")
    print()
    print(f"  {'Compound Filter (skip any true)':<40s} {'Rem':>5s} {'Keep':>5s} {'WR':>7s} {'PnL':>10s} {'Improv':>10s}")
    print(f"  {'-'*40} {'-'*5} {'-'*5} {'-'*7} {'-'*10} {'-'*10}")

    compound_results = []
    for name, cond in compounds:
        try:
            mask = df.apply(cond, axis=1).fillna(False)
        except Exception:
            continue
        removed = mask.sum()
        remaining = df[~mask]
        n_remain = len(remaining)
        if n_remain == 0 or n_remain == len(df):
            continue
        wins = len(remaining[remaining["total_pnl"] > 0])
        wr = wins / n_remain * 100
        total = remaining["total_pnl"].sum()
        improve = total - baseline_pnl
        compound_results.append((name, removed, n_remain, wr, total, improve))
        print(f"  {name:<40s} {removed:>5d} {n_remain:>5d} {wr:>6.1f}% {total:>+10.2f} {improve:>+10.2f}")

    compound_results.sort(key=lambda x: x[5], reverse=True)
    print(f"\n  Top 5 compound filters by improvement:")
    for name, removed, n_remain, wr, total, improve in compound_results[:5]:
        print(f"    {name}: remove {removed}, keep {n_remain}, WR {wr:.1f}%, P&L ${total:+.2f} ({improve:+.2f})")


def analyze_temporal(df: pd.DataFrame):
    """Monthly breakdown, asset breakdown, regime analysis."""
    print_section("TEMPORAL ANALYSIS: Monthly and per-asset breakdown")

    # Monthly breakdown
    monthly = df.groupby("entry_month").agg(
        count=("total_pnl", "count"),
        total_pnl=("total_pnl", "sum"),
        avg_pnl=("total_pnl", "mean"),
        win_rate=("total_pnl", lambda x: (x > 0).sum() / len(x) * 100 if len(x) > 0 else 0),
        losers=("total_pnl", lambda x: (x <= 0).sum()),
    ).sort_index()

    print(f"\n  Monthly breakdown:")
    print(f"  {'Month':<10s} {'Trades':>7s} {'Losers':>7s} {'WinRate':>8s} {'TotalPnL':>10s} {'AvgPnL':>9s}")
    print(f"  {'-'*10} {'-'*7} {'-'*7} {'-'*8} {'-'*10} {'-'*9}")
    for month, row in monthly.iterrows():
        print(f"  {month:<10s} {int(row['count']):>7d} {int(row['losers']):>7d} {row['win_rate']:>7.1f}% {row['total_pnl']:>+10.2f} {row['avg_pnl']:>+9.2f}")

    # Per-asset breakdown
    print_section("ASSET ANALYSIS: Are certain assets consistently worse?")
    asset_stats = df.groupby("asset").agg(
        count=("total_pnl", "count"),
        total_pnl=("total_pnl", "sum"),
        avg_pnl=("total_pnl", "mean"),
        win_rate=("total_pnl", lambda x: (x > 0).sum() / len(x) * 100 if len(x) > 0 else 0),
        avg_hold=("hold_hours", "mean"),
        big_losers=("total_pnl", lambda x: (x <= -50).sum()),
    )
    print(f"\n  {'Asset':<6s} {'Trades':>7s} {'WinRate':>8s} {'TotalPnL':>10s} {'AvgPnL':>9s} {'AvgHold':>8s} {'BigLoss':>8s}")
    print(f"  {'-'*6} {'-'*7} {'-'*8} {'-'*10} {'-'*9} {'-'*8} {'-'*8}")
    for asset, row in asset_stats.iterrows():
        hold_str = f"{row['avg_hold']:.0f}h" if not pd.isna(row['avg_hold']) else "N/A"
        print(f"  {asset:<6s} {int(row['count']):>7d} {row['win_rate']:>7.1f}% {row['total_pnl']:>+10.2f} {row['avg_pnl']:>+9.2f} {hold_str:>8s} {int(row['big_losers']):>8d}")

    # Per-asset direction breakdown
    print(f"\n  Per-asset direction breakdown:")
    for asset in df["asset"].unique():
        sub = df[df["asset"] == asset]
        for direction in ["long", "short"]:
            d = sub[sub["direction"] == direction]
            if len(d) == 0:
                continue
            wr = (d["total_pnl"] > 0).sum() / len(d) * 100
            print(f"    {asset} {direction}: {len(d)} trades, WR {wr:.1f}%, total ${d['total_pnl'].sum():+.2f}, avg ${d['total_pnl'].mean():+.2f}")


def analyze_regime(df: pd.DataFrame, indicator_dfs: dict[str, pd.DataFrame]):
    """Market regime analysis: trending vs choppy periods."""
    print_section("REGIME ANALYSIS: Trending vs Choppy markets")

    # Classify each position's entry market regime using ADX
    regimes = {
        "Strong Trend (ADX>30)": df[df["adx_at_entry"] > 30],
        "Moderate Trend (20<ADX<=30)": df[(df["adx_at_entry"] > 20) & (df["adx_at_entry"] <= 30)],
        "Choppy (ADX<=20)": df[df["adx_at_entry"] <= 20],
    }

    print(f"\n  By ADX regime at entry:")
    print(f"  {'Regime':<30s} {'Trades':>7s} {'WinRate':>8s} {'TotalPnL':>10s} {'AvgPnL':>9s}")
    print(f"  {'-'*30} {'-'*7} {'-'*8} {'-'*10} {'-'*9}")
    for name, g in regimes.items():
        if len(g) == 0:
            continue
        wr = (g["total_pnl"] > 0).sum() / len(g) * 100
        print(f"  {name:<30s} {len(g):>7d} {wr:>7.1f}% {g['total_pnl'].sum():>+10.2f} {g['total_pnl'].mean():>+9.2f}")

    # Volatility regime
    vol_regimes = {
        "Low vol (atr<2%)": df[df["atr_pct"] < 2],
        "Medium vol (2-5%)": df[(df["atr_pct"] >= 2) & (df["atr_pct"] < 5)],
        "High vol (5-10%)": df[(df["atr_pct"] >= 5) & (df["atr_pct"] < 10)],
        "Extreme vol (>10%)": df[df["atr_pct"] >= 10],
    }

    print(f"\n  By volatility regime (ATR%):")
    print(f"  {'Regime':<30s} {'Trades':>7s} {'WinRate':>8s} {'TotalPnL':>10s} {'AvgPnL':>9s}")
    print(f"  {'-'*30} {'-'*7} {'-'*8} {'-'*10} {'-'*9}")
    for name, g in vol_regimes.items():
        if len(g) == 0:
            continue
        wr = (g["total_pnl"] > 0).sum() / len(g) * 100
        print(f"  {name:<30s} {len(g):>7d} {wr:>7.1f}% {g['total_pnl'].sum():>+10.2f} {g['total_pnl'].mean():>+9.2f}")


def analyze_exit_reasons(df: pd.DataFrame):
    """What closes losing trades? Stop loss, signal reversal, trend break?"""
    print_section("EXIT REASON ANALYSIS: What closes losers?")

    losers = df[df["total_pnl"] <= 0]
    winners = df[df["total_pnl"] > 0]

    for label, subset in [("ALL LOSERS", losers), ("ALL WINNERS", winners)]:
        print(f"\n  {label} ({len(subset)} positions):")
        if len(subset) == 0:
            print("    (none)")
            continue
        exit_counts = subset["exit_reason"].value_counts()
        total = len(subset)
        for reason, count in exit_counts.items():
            avg_pnl = subset[subset["exit_reason"] == reason]["total_pnl"].mean()
            print(f"    {reason:<30s}: {count:>5d} ({count/total*100:>5.1f}%) avg P&L ${avg_pnl:+.2f}")

    # Big losers specifically
    big_losers = df[df["total_pnl"] <= -50]
    print(f"\n  BIG LOSERS (<-$50, n={len(big_losers)}):")
    if len(big_losers) > 0:
        exit_counts = big_losers["exit_reason"].value_counts()
        for reason, count in exit_counts.items():
            avg_pnl = big_losers[big_losers["exit_reason"] == reason]["total_pnl"].mean()
            print(f"    {reason:<30s}: {count:>5d} avg P&L ${avg_pnl:+.2f}")


def analyze_pnl_trajectory(positions: list[dict], dfs: dict[str, pd.DataFrame]):
    """How quickly do losers start losing? Bars until underwater and stay underwater."""
    print_section("P&L TRAJECTORY: How fast do losers go underwater?")

    # For each position, walk through bars from entry to exit
    # Track: bars until first loss, bars until permanently underwater
    trajectory_data = []

    for pos in positions:
        if pos["total_pnl"] >= 0:
            continue  # only analyze losers
        if pos.get("status") != "closed":
            continue

        asset = pos["asset"]
        df = dfs.get(asset)
        if df is None:
            continue

        entry_bar = pos.get("entry_bar_index", 0)
        entry_price = pos["entry_price"]
        direction = pos["direction"]
        is_long = direction in ("long", "bb2_long")

        # Find exit bar
        exit_date_str = pos.get("exit_date")
        if not exit_date_str:
            continue

        try:
            exit_ts = pd.Timestamp(exit_date_str)
            if exit_ts.tzinfo is None:
                exit_ts = exit_ts.tz_localize("UTC")
        except Exception:
            continue

        # Walk bars
        bars_to_first_loss = None
        bars_to_permanent_loss = None
        max_profit_pct = 0
        bars_in_profit = 0
        total_bars = 0

        for i in range(entry_bar + 1, min(entry_bar + 500, len(df))):
            bar_time = df.index[i]
            if bar_time > exit_ts:
                break
            total_bars += 1

            price = df.iloc[i]["close"]
            if is_long:
                pnl_pct = ((price - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - price) / entry_price) * 100

            if pnl_pct > max_profit_pct:
                max_profit_pct = pnl_pct

            if pnl_pct > 0:
                bars_in_profit += 1

            if pnl_pct < 0 and bars_to_first_loss is None:
                bars_to_first_loss = total_bars

        # Check if it was ever profitable
        trajectory_data.append({
            "asset": asset,
            "direction": direction,
            "total_pnl": pos["total_pnl"],
            "total_bars": total_bars,
            "bars_to_first_loss": bars_to_first_loss if bars_to_first_loss is not None else 0,
            "max_profit_pct": max_profit_pct,
            "bars_in_profit": bars_in_profit,
            "pct_bars_in_profit": (bars_in_profit / total_bars * 100) if total_bars > 0 else 0,
            "hold_hours": total_bars * 4,
        })

    if not trajectory_data:
        print("\n  No loser trajectory data available.")
        return

    tdf = pd.DataFrame(trajectory_data)

    # Never profitable vs had some profit
    never_profitable = tdf[tdf["max_profit_pct"] <= 0]
    had_profit = tdf[tdf["max_profit_pct"] > 0]

    print(f"\n  Loser trajectory summary ({len(tdf)} losing positions):")
    print(f"    Never profitable (max profit <= 0%): {len(never_profitable)} ({len(never_profitable)/len(tdf)*100:.1f}%)")
    print(f"    Had some profit before losing:       {len(had_profit)} ({len(had_profit)/len(tdf)*100:.1f}%)")

    if len(never_profitable) > 0:
        print(f"\n    Never-profitable losers:")
        print(f"      Avg bars to first loss: {never_profitable['bars_to_first_loss'].mean():.1f} ({never_profitable['bars_to_first_loss'].mean()*4:.0f}h)")
        print(f"      Avg total bars held:    {never_profitable['total_bars'].mean():.1f} ({never_profitable['total_bars'].mean()*4:.0f}h)")
        print(f"      Avg P&L:                ${never_profitable['total_pnl'].mean():+.2f}")

    if len(had_profit) > 0:
        print(f"\n    Had-profit-then-lost:")
        print(f"      Avg max profit seen:    {had_profit['max_profit_pct'].mean():+.2f}%")
        print(f"      Avg bars in profit:     {had_profit['bars_in_profit'].mean():.1f} ({had_profit['bars_in_profit'].mean()*4:.0f}h)")
        print(f"      Avg % of bars in profit:{had_profit['pct_bars_in_profit'].mean():.1f}%")
        print(f"      Avg P&L:                ${had_profit['total_pnl'].mean():+.2f}")

    # Distribution of bars to first loss
    print(f"\n  Bars to first loss distribution (all losers):")
    buckets = [(0, 1, "Immediate (bar 0-1)"), (2, 5, "Quick (2-5 bars)"),
               (6, 12, "Medium (6-12 bars)"), (13, 30, "Slow (13-30 bars)"),
               (31, 999, "Very slow (31+ bars)")]
    for lo, hi, label in buckets:
        count = len(tdf[(tdf["bars_to_first_loss"] >= lo) & (tdf["bars_to_first_loss"] <= hi)])
        pct = count / len(tdf) * 100 if len(tdf) > 0 else 0
        print(f"    {label:<25s}: {count:>5d} ({pct:>5.1f}%)")

    # Max profit distribution for losers that had profit
    if len(had_profit) > 0:
        print(f"\n  Max profit reached before losing (had-profit subset):")
        profit_buckets = [(0, 1, "0-1%"), (1, 3, "1-3%"), (3, 5, "3-5%"),
                          (5, 10, "5-10%"), (10, 20, "10-20%"), (20, 100, "20%+")]
        for lo, hi, label in profit_buckets:
            count = len(had_profit[(had_profit["max_profit_pct"] > lo) & (had_profit["max_profit_pct"] <= hi)])
            pct = count / len(had_profit) * 100
            print(f"    {label:<15s}: {count:>5d} ({pct:>5.1f}%)")


def analyze_direction(df: pd.DataFrame):
    """Long vs Short performance."""
    print_section("DIRECTION ANALYSIS: Long vs Short")

    for direction in ["long", "short"]:
        sub = df[df["direction"] == direction]
        if len(sub) == 0:
            continue
        wr = (sub["total_pnl"] > 0).sum() / len(sub) * 100
        print(f"\n  {direction.upper()} positions: {len(sub)}, WR {wr:.1f}%, total ${sub['total_pnl'].sum():+.2f}, avg ${sub['total_pnl'].mean():+.2f}")

        # By trend alignment
        aligned = sub[sub["trend_aligned"] == 1]
        not_aligned = sub[sub["trend_aligned"] == 0]
        if len(aligned) > 0:
            wr_a = (aligned["total_pnl"] > 0).sum() / len(aligned) * 100
            print(f"    Trend-aligned:     {len(aligned)} trades, WR {wr_a:.1f}%, avg ${aligned['total_pnl'].mean():+.2f}")
        if len(not_aligned) > 0:
            wr_na = (not_aligned["total_pnl"] > 0).sum() / len(not_aligned) * 100
            print(f"    Counter-trend:     {len(not_aligned)} trades, WR {wr_na:.1f}%, avg ${not_aligned['total_pnl'].mean():+.2f}")

    # BB2 trades
    bb2 = df[df["direction"].str.startswith("bb2_")]
    if len(bb2) > 0:
        wr = (bb2["total_pnl"] > 0).sum() / len(bb2) * 100
        print(f"\n  BB2 positions: {len(bb2)}, WR {wr:.1f}%, total ${bb2['total_pnl'].sum():+.2f}, avg ${bb2['total_pnl'].mean():+.2f}")


def worst_trades_detail(df: pd.DataFrame):
    """Print details of the 20 worst trades."""
    print_section("WORST 20 POSITIONS (by total P&L)")

    worst = df.nsmallest(20, "total_pnl")
    print(f"\n  {'#':<3s} {'Asset':<6s} {'Dir':<6s} {'Entry Date':<20s} {'Entry$':>9s} {'Exit$':>9s} {'ExitReason':<20s} {'Trims':>5s} {'PnL':>10s} {'RSI':>5s} {'ADX':>5s} {'VolR':>5s} {'Algn':>4s}")
    print(f"  {'-'*3} {'-'*6} {'-'*6} {'-'*20} {'-'*9} {'-'*9} {'-'*20} {'-'*5} {'-'*10} {'-'*5} {'-'*5} {'-'*5} {'-'*4}")

    for i, (_, row) in enumerate(worst.iterrows(), 1):
        aligned = "Y" if row.get("trend_aligned") == 1 else "N"
        print(f"  {i:<3d} {row['asset']:<6s} {row['direction']:<6s} {str(row.get('entry_date','')):<20s} "
              f"{row.get('entry_price',0):>9.2f} {row.get('exit_price',0):>9.2f} "
              f"{str(row.get('exit_reason','')):<20s} {row.get('n_trims',0):>5d} "
              f"{row['total_pnl']:>+10.2f} "
              f"{row.get('rsi_at_entry',0):>5.1f} {row.get('adx_at_entry',0):>5.1f} "
              f"{row.get('vol_ratio',0):>5.2f} {aligned:>4s}")


# ===================================================================
# 5. Main
# ===================================================================

def main():
    print("=" * 78)
    print("VELA LOSER ANALYSIS — 4H Bars, PROD_ACTUAL config")
    print(f"Assets: {', '.join(ASSETS.values())} | Period: {DAYS} days | Position: ${POSITION_SIZE_USD}")
    print("=" * 78)

    # ── Fetch data ──
    print("\n[1/6] Fetching 4H candle data from Hyperliquid...\n")
    raw_data: dict[str, pd.DataFrame] = {}
    for cg_id, symbol in ASSETS.items():
        raw_data[cg_id] = fetch_4h_ohlc(cg_id, DAYS)
        if cg_id != list(ASSETS.keys())[-1]:
            time.sleep(2)

    # ── Compute indicators + signals ──
    print("\n[2/6] Computing indicators and signals on 4H bars...\n")
    config = {**PROD_ACTUAL}
    indicator_dfs: dict[str, pd.DataFrame] = {}
    signal_dfs: dict[str, pd.DataFrame] = {}

    for cg_id, symbol in ASSETS.items():
        df_ind = calculate_indicators(raw_data[cg_id], config=config)
        indicator_dfs[cg_id] = df_ind
        df_sig = generate_signals(df_ind, config=config)
        signal_dfs[cg_id] = df_sig
        greens = (df_sig["signal_color"] == "green").sum() if "signal_color" in df_sig.columns else 0
        reds = (df_sig["signal_color"] == "red").sum() if "signal_color" in df_sig.columns else 0
        greys = (df_sig["signal_color"] == "grey").sum() if "signal_color" in df_sig.columns else 0
        print(f"  {symbol}: {len(df_sig)} bars | GREEN={greens} RED={reds} GREY={greys}")

    btc_df = signal_dfs.get("bitcoin")

    # ── Simulate trades ──
    print("\n[3/6] Simulating trades with PROD_ACTUAL...\n")
    all_trades: dict[str, list[dict]] = {}
    all_positions: list[dict] = []

    for cg_id, symbol in ASSETS.items():
        df_sig = signal_dfs[cg_id]
        is_btc = (cg_id == "bitcoin")
        trades = simulate_trades(
            df_sig, config=config,
            btc_df=btc_df if not is_btc else None,
            is_btc=is_btc,
        )
        all_trades[symbol] = trades

        # Group into positions
        positions = group_into_positions(trades, symbol)
        all_positions.extend(positions)

        main = [t for t in trades if t.get("direction") in ("long", "short")]
        trims = [t for t in trades if t.get("direction") == "trim"]
        total_pnl = sum(t.get("pnl_usd", 0) for t in trades)
        wins = len([t for t in main if t.get("pnl_usd", 0) > 0])
        wr = wins / len(main) * 100 if main else 0
        print(f"  {symbol}: {len(main)} main trades, {len(trims)} trims, {len(positions)} positions, ${total_pnl:+.2f}, {wr:.1f}% WR")

    # ── Compute entry features ──
    print("\n[4/6] Computing entry-time features for all positions...\n")
    # We need the signal_dfs keyed by symbol
    symbol_dfs = {}
    for cg_id, symbol in ASSETS.items():
        symbol_dfs[symbol] = signal_dfs[cg_id]

    features_df = compute_entry_features(all_positions, symbol_dfs)

    total_pos = len(features_df)
    total_pnl = features_df["total_pnl"].sum()
    winners = len(features_df[features_df["total_pnl"] > 0])
    wr = winners / total_pos * 100 if total_pos > 0 else 0

    print(f"  Total positions: {total_pos}")
    print(f"  Winners: {winners} ({wr:.1f}%)")
    print(f"  Losers:  {total_pos - winners} ({100 - wr:.1f}%)")
    print(f"  Total P&L: ${total_pnl:+.2f}")
    print(f"  Avg P&L per position: ${features_df['total_pnl'].mean():+.2f}")

    # ── Run all analyses ──
    print("\n[5/6] Running analyses...\n")

    # 5a: Group analysis
    analyze_groups(features_df)

    # 5b: Direction analysis
    analyze_direction(features_df)

    # 5c: Exit reason analysis
    analyze_exit_reasons(features_df)

    # 5d: Temporal analysis
    analyze_temporal(features_df)

    # 5e: Regime analysis
    analyze_regime(features_df, indicator_dfs)

    # 5f: P&L trajectory
    analyze_pnl_trajectory(all_positions, symbol_dfs)

    # 5g: Worst trades
    worst_trades_detail(features_df)

    # 5h: Filter analysis
    print("\n[6/6] Testing filters...\n")
    top_filters = analyze_filters(features_df)
    analyze_compound_filters(features_df, top_filters)

    # ── Summary ──
    print_section("EXECUTIVE SUMMARY")
    print(f"""
  Positions analyzed: {total_pos}
  Win rate: {wr:.1f}%
  Total P&L: ${total_pnl:+.2f}

  Key findings (review the sections above for detail):
  1. GROUP ANALYSIS: Compare feature means across P&L buckets.
     Look for features with large differences between big winners and big losers.
  2. FILTER ANALYSIS: Sorted by P&L improvement.
     The top filters show the most impactful single-feature gates.
  3. COMPOUND FILTERS: Combinations that may perform better.
  4. TEMPORAL: Which months/assets cluster losses.
  5. EXIT REASONS: What mechanism closes losers (stop vs trailing vs reversal).
  6. TRAJECTORY: How quickly losers go underwater.
""")


if __name__ == "__main__":
    main()
