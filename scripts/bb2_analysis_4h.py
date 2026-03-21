#!/usr/bin/env python3
"""
BB2 Trade Analysis — Feature Engineering & Filter Discovery
============================================================
Analyzes BB2 (Bollinger Band 2) trades from the PROD_ACTUAL backtest config
on 4H candle data to identify what separates winners from losers.

Outputs:
  - Overall BB2 stats (count, win%, total P&L, avg P&L)
  - Per-asset BB2 breakdown
  - Feature analysis table (mean winner vs loser, t-test, correlation)
  - Filter simulation results
  - Recommendation for which filters to implement

Usage:
    python3 scripts/bb2_analysis_4h.py
"""

import sys
import time
from datetime import datetime, timezone

import math

import numpy as np
import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Import from backtest.py
# ---------------------------------------------------------------------------
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from backtest import (
    PROD_ACTUAL,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    ASSETS_HL,
    HYPERLIQUID_INFO_URL,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DAYS = 730
POSITION_SIZE_USD = 1000
HL_SLEEP = 2

# Assets to analyze
ASSETS = ["bitcoin", "ethereum", "hyperliquid", "solana"]


# ---------------------------------------------------------------------------
# Fetch 4H candle data from Hyperliquid
# ---------------------------------------------------------------------------
def fetch_4h_candles(coingecko_id: str, days: int = 730) -> pd.DataFrame:
    """Fetch 4H OHLCV candles from Hyperliquid candleSnapshot API."""
    symbol = ASSETS_HL[coingecko_id]
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of 4H candles for {symbol}...")

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
                    raise RuntimeError(f"Hyperliquid API failed for {symbol}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Rate limit exceeded for {symbol}")

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
        time.sleep(HL_SLEEP)

    if not all_candles:
        raise ValueError(f"No candle data for {symbol}")

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
    df["date"] = df["datetime"].dt.date
    # For 4H bars, use datetime as index (not date — multiple bars per day)
    df = df.drop_duplicates(subset="timestamp_ms", keep="last")
    # Use integer index to avoid duplicate date keys that break calculate_indicators
    df = df.sort_values("timestamp_ms").reset_index(drop=True)
    df = df.drop(columns=["timestamp_ms"])

    # Trim to requested range
    from datetime import date as date_type
    cutoff = date_type.fromtimestamp(start_ms / 1000)
    df = df[df["date"] >= cutoff].reset_index(drop=True)

    print(f"  Got {len(df)} 4H candles ({df['date'].iloc[0]} to {df['date'].iloc[-1]})")
    return df


# ---------------------------------------------------------------------------
# Compute features for each BB2 trade at entry time
# ---------------------------------------------------------------------------
def compute_bb2_features(
    bb2_trades: list[dict],
    all_trades: list[dict],
    df: pd.DataFrame,
    asset: str,
) -> list[dict]:
    """
    For each BB2 trade, compute features at the bar of entry.
    Returns list of dicts with trade info + features.
    """
    enriched = []

    for trade in bb2_trades:
        entry_bar_idx = trade.get("entry_bar_index", None)
        if entry_bar_idx is None or entry_bar_idx >= len(df):
            continue

        row = df.iloc[entry_bar_idx]
        price = row["close"]
        direction = trade["direction"]
        is_long = direction == "bb2_long"

        # --- Core indicators at entry ---
        rsi = row.get("rsi_14", np.nan)
        adx = row.get("adx", np.nan)
        atr_pct = row.get("atr_pct", np.nan)
        sma50 = row.get("sma_50", np.nan)
        volume_ratio = row.get("volume_ratio", np.nan)

        # --- BB width as % of price ---
        rsi_bb2_upper = row.get("rsi_bb2_upper", np.nan)
        rsi_bb2_lower = row.get("rsi_bb2_lower", np.nan)
        bb_width = rsi_bb2_upper - rsi_bb2_lower if not (pd.isna(rsi_bb2_upper) or pd.isna(rsi_bb2_lower)) else np.nan

        # --- Distance from SMA-50 as % ---
        dist_sma50_pct = ((price - sma50) / sma50) * 100 if not pd.isna(sma50) and sma50 > 0 else np.nan

        # --- Price position within recent 20-bar range ---
        if entry_bar_idx >= 20:
            recent_slice = df.iloc[entry_bar_idx - 20 : entry_bar_idx]
            range_high = recent_slice["high"].max()
            range_low = recent_slice["low"].min()
            if range_high > range_low:
                price_position = (price - range_low) / (range_high - range_low)
            else:
                price_position = 0.5
        else:
            price_position = np.nan

        # --- Consecutive bars in same direction before entry ---
        # Count consecutive bars where close moves in the BB2 trade direction
        consec = 0
        if entry_bar_idx > 0:
            for j in range(entry_bar_idx - 1, max(entry_bar_idx - 20, -1), -1):
                prev_close = df.iloc[j]["close"]
                curr_close = df.iloc[j + 1]["close"] if j + 1 < len(df) else price
                if is_long and curr_close < prev_close:
                    consec += 1  # price dropping (expected before BB2 long)
                elif not is_long and curr_close > prev_close:
                    consec += 1  # price rising (expected before BB2 short)
                else:
                    break

        # --- Time features ---
        dt = row.get("datetime", None)
        hour_of_day = dt.hour if dt is not None and hasattr(dt, "hour") else np.nan
        day_of_week = dt.weekday() if dt is not None and hasattr(dt, "weekday") else np.nan

        # --- EMA spread at entry ---
        ema_spread = row.get("ema_spread_pct", np.nan)

        # --- RSI delta (velocity) ---
        rsi_delta = row.get("rsi_delta", np.nan)

        # --- Main position context ---
        # Check if a main (non-BB2) trade is open at this bar
        main_open = False
        main_direction = "none"
        main_winning = False
        for t in all_trades:
            if t["direction"] in ("long", "short"):
                t_entry_bar = t.get("entry_bar_index", -1)
                t_exit_date = t.get("exit_date", None)
                # Approximate: trade is open if entry_bar <= current bar
                # and either still open or exit_date >= entry_date of BB2
                if t_entry_bar <= entry_bar_idx:
                    # Check if it was still open at BB2 entry
                    if t_exit_date is None:
                        main_open = True
                        main_direction = t["direction"]
                        entry_p = t["entry_price"]
                        if main_direction == "long":
                            main_winning = price > entry_p
                        else:
                            main_winning = price < entry_p
                        break
                    else:
                        # Check if exit was after BB2 entry
                        bb2_entry_date = trade["entry_date"]
                        if t_exit_date >= bb2_entry_date:
                            main_open = True
                            main_direction = t["direction"]
                            entry_p = t["entry_price"]
                            if main_direction == "long":
                                main_winning = price > entry_p
                            else:
                                main_winning = price < entry_p
                            break

        # --- Daily return at entry ---
        daily_return = row.get("daily_return_pct", np.nan)

        enriched.append({
            "asset": asset,
            "direction": direction,
            "entry_date": trade["entry_date"],
            "exit_date": trade.get("exit_date", ""),
            "entry_price": trade["entry_price"],
            "exit_price": trade.get("exit_price", np.nan),
            "pnl_pct": trade.get("pnl_pct", 0),
            "pnl_usd": trade.get("pnl_usd", 0),
            "exit_reason": trade.get("exit_signal_reason", ""),
            "is_winner": trade.get("pnl_usd", 0) > 0,
            # Features
            "bb_width": bb_width,
            "rsi": rsi,
            "adx": adx,
            "vol_ratio": volume_ratio,
            "dist_sma50_pct": dist_sma50_pct,
            "atr_pct": atr_pct,
            "main_position_open": main_open,
            "main_direction": main_direction,
            "main_winning": main_winning,
            "hour_of_day": hour_of_day,
            "day_of_week": day_of_week,
            "consec_bars_same_dir": consec,
            "price_position_20bar": price_position,
            "ema_spread_pct": ema_spread,
            "rsi_delta": rsi_delta,
            "daily_return_pct": daily_return,
        })

    return enriched


# ---------------------------------------------------------------------------
# Feature analysis: winners vs losers
# ---------------------------------------------------------------------------
def _welch_ttest(a: np.ndarray, b: np.ndarray):
    """Welch's t-test (unequal variance) using numpy only. Returns (t_stat, p_value)."""
    n1, n2 = len(a), len(b)
    m1, m2 = a.mean(), b.mean()
    v1, v2 = a.var(ddof=1), b.var(ddof=1)
    se = math.sqrt(v1 / n1 + v2 / n2) if (v1 / n1 + v2 / n2) > 0 else 1e-10
    t_stat = (m1 - m2) / se
    # Welch-Satterthwaite degrees of freedom
    num = (v1 / n1 + v2 / n2) ** 2
    den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1) if (n1 > 1 and n2 > 1) else 1
    df = num / den if den > 0 else 1
    # Approximate two-tailed p-value using normal distribution for large df
    # For small df, this is an approximation — good enough for our purposes
    z = abs(t_stat)
    # Use complementary error function for p-value approximation
    p_val = math.erfc(z / math.sqrt(2))
    return t_stat, p_val


def _pearsonr(x: np.ndarray, y: np.ndarray):
    """Pearson correlation. Returns (r, p_value)."""
    n = len(x)
    if n < 3:
        return np.nan, np.nan
    mx, my = x.mean(), y.mean()
    dx, dy = x - mx, y - my
    ss_xy = (dx * dy).sum()
    ss_xx = (dx * dx).sum()
    ss_yy = (dy * dy).sum()
    if ss_xx == 0 or ss_yy == 0:
        return 0.0, 1.0
    r = ss_xy / math.sqrt(ss_xx * ss_yy)
    # t-statistic for correlation
    if abs(r) >= 1.0:
        return r, 0.0
    t_stat = r * math.sqrt((n - 2) / (1 - r * r))
    p_val = math.erfc(abs(t_stat) / math.sqrt(2))
    return r, p_val


def analyze_features(df_trades: pd.DataFrame) -> pd.DataFrame:
    """Compare feature distributions between winners and losers."""
    numeric_features = [
        "bb_width", "rsi", "adx", "vol_ratio", "dist_sma50_pct",
        "atr_pct", "consec_bars_same_dir", "price_position_20bar",
        "ema_spread_pct", "rsi_delta", "daily_return_pct",
        "hour_of_day", "day_of_week",
    ]

    winners = df_trades[df_trades["is_winner"]]
    losers = df_trades[~df_trades["is_winner"]]

    results = []
    for feat in numeric_features:
        w_vals = winners[feat].dropna().values.astype(float)
        l_vals = losers[feat].dropna().values.astype(float)

        if len(w_vals) < 2 or len(l_vals) < 2:
            continue

        w_mean = float(np.mean(w_vals))
        l_mean = float(np.mean(l_vals))

        # Welch's t-test
        t_stat, p_val = _welch_ttest(w_vals, l_vals)

        # Correlation with P&L
        combined = df_trades[[feat, "pnl_usd"]].dropna()
        if len(combined) > 2:
            corr, corr_p = _pearsonr(combined[feat].values.astype(float), combined["pnl_usd"].values.astype(float))
        else:
            corr, corr_p = np.nan, np.nan

        results.append({
            "feature": feat,
            "winner_mean": round(w_mean, 4),
            "loser_mean": round(l_mean, 4),
            "diff": round(w_mean - l_mean, 4),
            "t_stat": round(t_stat, 3),
            "p_value": round(p_val, 4),
            "significant": "***" if p_val < 0.01 else ("**" if p_val < 0.05 else ("*" if p_val < 0.10 else "")),
            "corr_with_pnl": round(corr, 4) if not np.isnan(corr) else np.nan,
            "corr_p": round(corr_p, 4) if not np.isnan(corr_p) else np.nan,
        })

    # Also analyze boolean features
    for feat in ["main_position_open", "main_winning"]:
        w_rate = float(winners[feat].mean()) if len(winners) > 0 else np.nan
        l_rate = float(losers[feat].mean()) if len(losers) > 0 else np.nan

        # Simple proportion z-test approximation
        n_w = len(winners)
        n_l = len(losers)
        if n_w > 0 and n_l > 0 and not (np.isnan(w_rate) or np.isnan(l_rate)):
            p_pooled = (w_rate * n_w + l_rate * n_l) / (n_w + n_l)
            if p_pooled > 0 and p_pooled < 1:
                se = math.sqrt(p_pooled * (1 - p_pooled) * (1/n_w + 1/n_l))
                z = (w_rate - l_rate) / se if se > 0 else 0
                p_val = math.erfc(abs(z) / math.sqrt(2))
            else:
                z, p_val = 0, 1.0
        else:
            z, p_val = 0, 1.0

        results.append({
            "feature": feat,
            "winner_mean": round(w_rate, 4) if not np.isnan(w_rate) else np.nan,
            "loser_mean": round(l_rate, 4) if not np.isnan(l_rate) else np.nan,
            "diff": round(w_rate - l_rate, 4) if not (np.isnan(w_rate) or np.isnan(l_rate)) else np.nan,
            "t_stat": round(z, 3),
            "p_value": round(p_val, 4),
            "significant": "***" if p_val < 0.01 else ("**" if p_val < 0.05 else ("*" if p_val < 0.10 else "")),
            "corr_with_pnl": np.nan,
            "corr_p": np.nan,
        })

    return pd.DataFrame(results).sort_values("p_value")


# ---------------------------------------------------------------------------
# Filter simulation
# ---------------------------------------------------------------------------
def simulate_filter(df_trades: pd.DataFrame, mask: pd.Series, name: str) -> dict:
    """Simulate applying a filter (mask = True means KEEP the trade)."""
    kept = df_trades[mask]
    removed = df_trades[~mask]

    kept_count = len(kept)
    total = len(df_trades)
    if kept_count == 0:
        return {
            "filter": name,
            "trades_kept": 0,
            "trades_removed": total,
            "pct_kept": 0,
            "total_pnl": 0,
            "avg_pnl": 0,
            "win_rate": 0,
            "removed_pnl": round(removed["pnl_usd"].sum(), 2),
            "improvement": 0,
        }

    baseline_pnl = df_trades["pnl_usd"].sum()
    filtered_pnl = kept["pnl_usd"].sum()

    return {
        "filter": name,
        "trades_kept": kept_count,
        "trades_removed": total - kept_count,
        "pct_kept": round(kept_count / total * 100, 1),
        "total_pnl": round(filtered_pnl, 2),
        "avg_pnl": round(kept["pnl_usd"].mean(), 2),
        "win_rate": round(kept["is_winner"].mean() * 100, 1),
        "removed_pnl": round(removed["pnl_usd"].sum(), 2),
        "improvement": round(filtered_pnl - baseline_pnl, 2),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 80)
    print("BB2 TRADE ANALYSIS — 4H CANDLES, PROD_ACTUAL CONFIG")
    print(f"Config: {PROD_ACTUAL.get('name', 'PROD_ACTUAL')}")
    print(f"Lookback: {DAYS} days | Position size: ${POSITION_SIZE_USD}")
    print("=" * 80)
    print()

    # Step 1: Fetch data
    asset_data = {}
    for asset in ASSETS:
        print(f"\n--- {asset.upper()} ---")
        df = fetch_4h_candles(asset, DAYS)
        asset_data[asset] = df
        time.sleep(HL_SLEEP)

    # Step 2: Run pipeline and extract BB2 trades
    all_bb2_enriched = []
    btc_df_indicators = None

    # Calculate BTC indicators first (needed for crash filter on altcoins)
    print("\n\nRunning indicator pipeline...")
    asset_dfs = {}
    for asset in ASSETS:
        df = asset_data[asset]
        df = calculate_indicators(df, PROD_ACTUAL)
        df = generate_signals(df, PROD_ACTUAL)
        asset_dfs[asset] = df
        if asset == "bitcoin":
            btc_df_indicators = df

    print("\nRunning trade simulation...")
    for asset in ASSETS:
        df = asset_dfs[asset]
        is_btc = asset == "bitcoin"
        all_trades = simulate_trades(
            df,
            position_size=POSITION_SIZE_USD,
            config=PROD_ACTUAL,
            btc_df=btc_df_indicators,
            is_btc=is_btc,
        )

        # Extract BB2 trades
        bb2_trades = [t for t in all_trades if t.get("direction", "").startswith("bb2_")]

        print(f"  {ASSETS_HL[asset]}: {len(all_trades)} total trades, {len(bb2_trades)} BB2 trades")

        # Compute features
        enriched = compute_bb2_features(bb2_trades, all_trades, df, asset)
        all_bb2_enriched.extend(enriched)

    if not all_bb2_enriched:
        print("\nNo BB2 trades found. Check that PROD_ACTUAL has bb_improved=True.")
        sys.exit(1)

    df_bb2 = pd.DataFrame(all_bb2_enriched)

    # =====================================================================
    # OUTPUT SECTION
    # =====================================================================

    print("\n")
    print("=" * 80)
    print("SECTION 1: OVERALL BB2 STATS")
    print("=" * 80)

    closed = df_bb2[df_bb2["exit_date"] != ""]
    total_trades = len(closed)
    winners = closed[closed["is_winner"]]
    losers = closed[~closed["is_winner"]]
    total_pnl = closed["pnl_usd"].sum()
    avg_pnl = closed["pnl_usd"].mean()
    win_rate = len(winners) / total_trades * 100 if total_trades > 0 else 0

    print(f"  Total BB2 trades (closed): {total_trades}")
    print(f"  Winners: {len(winners)} | Losers: {len(losers)}")
    print(f"  Win rate: {win_rate:.1f}%")
    print(f"  Total P&L: ${total_pnl:.2f}")
    print(f"  Avg P&L per trade: ${avg_pnl:.2f}")
    print(f"  Avg winner P&L: ${winners['pnl_usd'].mean():.2f}" if len(winners) > 0 else "  No winners")
    print(f"  Avg loser P&L: ${losers['pnl_usd'].mean():.2f}" if len(losers) > 0 else "  No losers")
    print(f"  Best trade: ${closed['pnl_usd'].max():.2f} ({closed.loc[closed['pnl_usd'].idxmax(), 'pnl_pct']:.1f}%)")
    print(f"  Worst trade: ${closed['pnl_usd'].min():.2f} ({closed.loc[closed['pnl_usd'].idxmin(), 'pnl_pct']:.1f}%)")

    # Direction split
    bb2_long = closed[closed["direction"] == "bb2_long"]
    bb2_short = closed[closed["direction"] == "bb2_short"]
    print(f"\n  BB2 Longs:  {len(bb2_long)} trades, "
          f"win {bb2_long['is_winner'].mean()*100:.1f}%, "
          f"P&L ${bb2_long['pnl_usd'].sum():.2f}, "
          f"avg ${bb2_long['pnl_usd'].mean():.2f}" if len(bb2_long) > 0 else "\n  BB2 Longs: 0 trades")
    print(f"  BB2 Shorts: {len(bb2_short)} trades, "
          f"win {bb2_short['is_winner'].mean()*100:.1f}%, "
          f"P&L ${bb2_short['pnl_usd'].sum():.2f}, "
          f"avg ${bb2_short['pnl_usd'].mean():.2f}" if len(bb2_short) > 0 else "  BB2 Shorts: 0 trades")

    # Exit reason breakdown
    print("\n  Exit reasons:")
    for reason, group in closed.groupby("exit_reason"):
        print(f"    {reason}: {len(group)} trades, P&L ${group['pnl_usd'].sum():.2f}, "
              f"win {group['is_winner'].mean()*100:.0f}%")

    # =====================================================================
    print("\n")
    print("=" * 80)
    print("SECTION 2: PER-ASSET BB2 BREAKDOWN")
    print("=" * 80)

    for asset in ASSETS:
        symbol = ASSETS_HL[asset]
        subset = closed[closed["asset"] == asset]
        if len(subset) == 0:
            print(f"\n  {symbol}: No BB2 trades")
            continue

        w = subset[subset["is_winner"]]
        l = subset[~subset["is_winner"]]
        print(f"\n  {symbol}: {len(subset)} trades | "
              f"Win {len(w)}/{len(subset)} ({len(w)/len(subset)*100:.0f}%) | "
              f"P&L ${subset['pnl_usd'].sum():.2f} | "
              f"Avg ${subset['pnl_usd'].mean():.2f}")

        # Per-direction
        for d in ["bb2_long", "bb2_short"]:
            ds = subset[subset["direction"] == d]
            if len(ds) > 0:
                dw = ds[ds["is_winner"]]
                print(f"    {d}: {len(ds)} trades, "
                      f"win {len(dw)/len(ds)*100:.0f}%, "
                      f"P&L ${ds['pnl_usd'].sum():.2f}")

    # =====================================================================
    print("\n")
    print("=" * 80)
    print("SECTION 3: FEATURE ANALYSIS (WINNERS vs LOSERS)")
    print("=" * 80)
    print("  (p < 0.01 = ***, p < 0.05 = **, p < 0.10 = *)")
    print()

    feature_df = analyze_features(closed)

    # Print as formatted table
    print(f"  {'Feature':<25} {'Win Mean':>10} {'Loss Mean':>10} {'Diff':>8} "
          f"{'t-stat':>8} {'p-val':>8} {'Sig':>4} {'Corr':>8} {'Corr p':>8}")
    print("  " + "-" * 95)
    for _, r in feature_df.iterrows():
        print(f"  {r['feature']:<25} {r['winner_mean']:>10.4f} {r['loser_mean']:>10.4f} "
              f"{r['diff']:>8.4f} {r['t_stat']:>8.3f} {r['p_value']:>8.4f} {r['significant']:>4} "
              f"{r['corr_with_pnl']:>8.4f} {r['corr_p']:>8.4f}" if not pd.isna(r.get('corr_with_pnl', np.nan)) else
              f"  {r['feature']:<25} {r['winner_mean']:>10.4f} {r['loser_mean']:>10.4f} "
              f"{r['diff']:>8.4f} {r['t_stat']:>8.3f} {r['p_value']:>8.4f} {r['significant']:>4} "
              f"{'n/a':>8} {'n/a':>8}")

    # =====================================================================
    print("\n")
    print("=" * 80)
    print("SECTION 4: TOP DISCRIMINATING FEATURES")
    print("=" * 80)

    sig_features = feature_df[feature_df["p_value"] < 0.10]
    if len(sig_features) > 0:
        print("\n  Statistically significant features (p < 0.10):")
        for _, r in sig_features.iterrows():
            direction = "higher" if r["diff"] > 0 else "lower"
            print(f"    {r['significant']} {r['feature']}: winners have {direction} values "
                  f"({r['winner_mean']:.4f} vs {r['loser_mean']:.4f}, p={r['p_value']:.4f})")
    else:
        print("\n  No features significant at p < 0.10.")
        print("  Showing top 5 by lowest p-value:")
        for _, r in feature_df.head(5).iterrows():
            direction = "higher" if r["diff"] > 0 else "lower"
            print(f"    {r['feature']}: winners have {direction} values "
                  f"({r['winner_mean']:.4f} vs {r['loser_mean']:.4f}, p={r['p_value']:.4f})")

    # Strong correlations
    corr_features = feature_df[feature_df["corr_with_pnl"].abs() > 0.1].dropna(subset=["corr_with_pnl"])
    if len(corr_features) > 0:
        print("\n  Features with |correlation| > 0.1 with P&L:")
        for _, r in corr_features.sort_values("corr_with_pnl", key=abs, ascending=False).iterrows():
            print(f"    {r['feature']}: r={r['corr_with_pnl']:.4f} (p={r['corr_p']:.4f})")

    # =====================================================================
    print("\n")
    print("=" * 80)
    print("SECTION 5: FILTER SIMULATIONS")
    print("=" * 80)

    # Baseline
    baseline = simulate_filter(closed, pd.Series(True, index=closed.index), "BASELINE (no filter)")

    # Build filters based on feature analysis
    filters = []

    # Filter 1: RSI not too extreme (avoid entries at RSI extremes)
    # For longs, RSI should be low but not crashed; for shorts, high but not peaked
    mask1 = (
        ((closed["direction"] == "bb2_long") & (closed["rsi"] > 25) & (closed["rsi"] < 45)) |
        ((closed["direction"] == "bb2_short") & (closed["rsi"] > 55) & (closed["rsi"] < 75))
    )
    filters.append(("RSI moderate (25-45 long, 55-75 short)", mask1))

    # Filter 2: Wider BB bands (more volatile = more mean-reversion potential)
    if closed["bb_width"].notna().sum() > 0:
        bb_median = closed["bb_width"].median()
        mask2 = closed["bb_width"] > bb_median
        filters.append((f"BB width > median ({bb_median:.1f})", mask2))

    # Filter 3: Higher ADX (trending markets)
    mask3 = closed["adx"] > 25
    filters.append(("ADX > 25 (strong trend)", mask3))

    # Filter 4: Lower ADX (ranging markets = better for mean reversion)
    mask4 = closed["adx"] < 25
    filters.append(("ADX < 25 (ranging market)", mask4))

    # Filter 5: Above-average volume
    mask5 = closed["vol_ratio"] > 1.0
    filters.append(("Volume ratio > 1.0", mask5))

    # Filter 6: ATR not too high (moderate volatility)
    if closed["atr_pct"].notna().sum() > 0:
        atr_p75 = closed["atr_pct"].quantile(0.75)
        mask6 = closed["atr_pct"] < atr_p75
        filters.append((f"ATR% < 75th pctl ({atr_p75:.2f}%)", mask6))

    # Filter 7: No main position open (avoid doubling up)
    mask7 = ~closed["main_position_open"]
    filters.append(("No main position open", mask7))

    # Filter 8: Main position winning (aligned momentum)
    mask8 = closed["main_position_open"] & closed["main_winning"]
    filters.append(("Main position open AND winning", mask8))

    # Filter 9: Price not at range extreme (room to revert)
    mask9 = (closed["price_position_20bar"] > 0.2) & (closed["price_position_20bar"] < 0.8)
    filters.append(("Price mid-range (20-80% of 20-bar range)", mask9))

    # Filter 10: Consecutive bars alignment (momentum buildup)
    mask10 = closed["consec_bars_same_dir"] >= 2
    filters.append(("2+ consecutive bars in expected direction", mask10))

    # Filter 11: Combined - best features
    # Low ADX + wider BB + moderate RSI
    mask11 = mask4 & mask2 if closed["bb_width"].notna().sum() > 0 else mask4
    filters.append(("COMBO: ADX < 25 + BB width > median", mask11))

    # Filter 12: Combo - volume + moderate ATR
    mask12 = mask5 & mask6 if closed["atr_pct"].notna().sum() > 0 else mask5
    filters.append(("COMBO: Volume > 1.0 + ATR < 75th pctl", mask12))

    # Filter 13: Longs only
    mask13 = closed["direction"] == "bb2_long"
    filters.append(("BB2 LONGS ONLY", mask13))

    # Filter 14: Shorts only
    mask14 = closed["direction"] == "bb2_short"
    filters.append(("BB2 SHORTS ONLY", mask14))

    # Run all filters
    results = [baseline]
    for name, mask in filters:
        results.append(simulate_filter(closed, mask, name))

    results_df = pd.DataFrame(results)

    print(f"\n  {'Filter':<50} {'Kept':>5} {'Rmvd':>5} {'%Kept':>6} "
          f"{'TotalPnL':>10} {'AvgPnL':>8} {'WinR%':>6} {'vs Base':>9}")
    print("  " + "-" * 100)
    for _, r in results_df.iterrows():
        marker = ""
        if r["filter"] != "BASELINE (no filter)" and r["improvement"] > 0:
            marker = " <-- BETTER"
        print(f"  {r['filter']:<50} {r['trades_kept']:>5} {r['trades_removed']:>5} "
              f"{r['pct_kept']:>5.1f}% {r['total_pnl']:>10.2f} {r['avg_pnl']:>8.2f} "
              f"{r['win_rate']:>5.1f}% {r['improvement']:>+9.2f}{marker}")

    # =====================================================================
    print("\n")
    print("=" * 80)
    print("SECTION 6: RECOMMENDATIONS")
    print("=" * 80)

    # Find best filters
    non_baseline = results_df[results_df["filter"] != "BASELINE (no filter)"]
    best_improvement = non_baseline.sort_values("improvement", ascending=False)

    print("\n  Top 5 filters by P&L improvement over baseline:")
    for i, (_, r) in enumerate(best_improvement.head(5).iterrows()):
        print(f"    {i+1}. {r['filter']}")
        print(f"       P&L: ${r['total_pnl']:.2f} ({r['improvement']:+.2f} vs baseline) | "
              f"Trades: {r['trades_kept']} | Win rate: {r['win_rate']:.1f}%")

    # Best by avg P&L (minimum 10 trades)
    enough_trades = non_baseline[non_baseline["trades_kept"] >= 10]
    if len(enough_trades) > 0:
        best_avg = enough_trades.sort_values("avg_pnl", ascending=False)
        print("\n  Top 3 filters by avg P&L per trade (min 10 trades):")
        for i, (_, r) in enumerate(best_avg.head(3).iterrows()):
            print(f"    {i+1}. {r['filter']}")
            print(f"       Avg P&L: ${r['avg_pnl']:.2f} | "
                  f"Trades: {r['trades_kept']} | Win rate: {r['win_rate']:.1f}%")

    print("\n  IMPLEMENTATION NOTE:")
    print("  BB2 trades on 4H bars may not represent 30-min production BB2 behavior.")
    print("  The features and filter thresholds found here should be validated on")
    print("  30-min data before deploying to production.")
    print()


if __name__ == "__main__":
    main()
