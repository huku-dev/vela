#!/usr/bin/env python3
"""
Bad Trade Analysis
==================
Deep-dive into losing trades to find filterable commonalities.
Uses the same data + config as scaling_in_backtest.py.

Analyzes:
  1. Feature distributions in losers vs winners (with statistical significance)
  2. Cluster analysis: are there distinct "types" of bad trades?
  3. Compound filters: which combinations of features best predict losers?
  4. Exit reason analysis: how do losers exit vs winners?
  5. Time-of-entry patterns: do losers cluster in certain market regimes?

Usage:
    python3 scripts/bad_trade_analysis.py
    python3 scripts/bad_trade_analysis.py --days 730
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

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

ACTIVE_CONFIG = V9_ATR_2_0X


def compute_trade_features(df: pd.DataFrame, trades: list[dict]) -> pd.DataFrame:
    """Compute comprehensive features for each trade at entry time."""
    rows = []

    for trade in trades:
        # Find entry index
        entry_date = str(trade["entry_date"])[:10]
        entry_idx = None
        for pos in range(len(df)):
            if str(df.index[pos])[:10] == entry_date:
                entry_idx = pos
                break
        if entry_idx is None or entry_idx < 20:
            continue

        # Find exit index
        exit_date = str(trade["exit_date"])[:10]
        exit_idx = None
        for pos in range(len(df)):
            if str(df.index[pos])[:10] == exit_date:
                exit_idx = pos
                break
        if exit_idx is None:
            exit_idx = entry_idx + 1

        row = df.iloc[entry_idx]
        entry_price = trade["entry_price"]
        direction = trade["direction"]
        pnl_pct = trade["pnl_pct"]
        pnl_usd = trade["pnl_usd"]
        hold_days = max(1, exit_idx - entry_idx)

        # ── Entry conditions ──
        rsi = row.get("rsi_14", np.nan)
        adx = row.get("adx", np.nan)
        ema9 = row.get("ema_9", np.nan)
        ema21 = row.get("ema_21", np.nan)
        ema_spread = abs(ema9 - ema21) / ema21 * 100 if ema21 and ema21 > 0 and not np.isnan(ema9) and not np.isnan(ema21) else np.nan
        vol_ratio = row.get("volume_ratio", np.nan) if "volume_ratio" in df.columns else np.nan

        # ── Volatility regime ──
        lookback = df.iloc[max(0, entry_idx - 20):entry_idx + 1]["close"]
        bb_mid = lookback.mean()
        bb_std = lookback.std()
        bb_width = (2 * bb_std / bb_mid * 100) if bb_mid > 0 else np.nan
        atr_pct = row.get("atr_pct", np.nan) if "atr_pct" in df.columns else np.nan

        # ── Trend context ──
        sma50 = row.get("sma_50", np.nan)
        dist_sma50 = ((entry_price - sma50) / sma50 * 100) if not np.isnan(sma50) and sma50 > 0 else np.nan

        # Price vs 10d range
        if entry_idx >= 10:
            high_10d = df.iloc[entry_idx - 10:entry_idx]["high"].max()
            low_10d = df.iloc[entry_idx - 10:entry_idx]["low"].min()
            price_vs_range = (entry_price - low_10d) / (high_10d - low_10d) if high_10d > low_10d else np.nan
        else:
            price_vs_range = np.nan

        # 5d momentum
        if entry_idx >= 5:
            price_5d = df.iloc[entry_idx - 5]["close"]
            momentum_5d = (entry_price - price_5d) / price_5d * 100
        else:
            momentum_5d = np.nan

        # 3d RSI slope
        if entry_idx >= 3 and "rsi_14" in df.columns:
            rsi_3d = df.iloc[entry_idx - 3].get("rsi_14", np.nan)
            rsi_slope = (rsi - rsi_3d) / 3 if not np.isnan(rsi_3d) and not np.isnan(rsi) else np.nan
        else:
            rsi_slope = np.nan

        # ── Volume context ──
        if "volume" in df.columns:
            vol_5d = df.iloc[max(0, entry_idx - 5):entry_idx + 1]["volume"].mean()
            vol_20d = df.iloc[max(0, entry_idx - 20):entry_idx + 1]["volume"].mean()
            vol_trend = vol_5d / vol_20d if vol_20d > 0 else np.nan
        else:
            vol_trend = np.nan

        # ── Consecutive days ──
        consec_green = 0
        consec_red = 0
        for i in range(entry_idx - 1, max(0, entry_idx - 10) - 1, -1):
            r = df.iloc[i]
            if r["close"] > r["open"]:
                if consec_red == 0:
                    consec_green += 1
                else:
                    break
            else:
                if consec_green == 0:
                    consec_red += 1
                else:
                    break

        # ── Price behavior in first 1-2 bars after entry ──
        if entry_idx + 1 < len(df):
            next_bar = df.iloc[entry_idx + 1]
            bar1_move = (next_bar["close"] - entry_price) / entry_price * 100
            if direction == "short":
                bar1_move = -bar1_move  # Normalize: positive = trade direction
        else:
            bar1_move = np.nan

        if entry_idx + 2 < len(df):
            bar2 = df.iloc[entry_idx + 2]
            bar2_move = (bar2["close"] - entry_price) / entry_price * 100
            if direction == "short":
                bar2_move = -bar2_move
        else:
            bar2_move = np.nan

        # ── Max adverse excursion (worst point during trade) ──
        if exit_idx > entry_idx:
            trade_prices = df.iloc[entry_idx:exit_idx + 1]["close"].values
            if direction == "long":
                mae = (entry_price - min(trade_prices)) / entry_price * 100
                mfe = (max(trade_prices) - entry_price) / entry_price * 100
            else:
                mae = (max(trade_prices) - entry_price) / entry_price * 100
                mfe = (entry_price - min(trade_prices)) / entry_price * 100
        else:
            mae = np.nan
            mfe = np.nan

        # ── Was this a late entry? (EMA cross was N bars ago) ──
        # Check how many bars back the actual EMA cross was
        bars_since_cross = 0
        if "ema_9" in df.columns and "ema_21" in df.columns:
            for lookback_i in range(entry_idx - 1, max(0, entry_idx - 10) - 1, -1):
                prev = df.iloc[lookback_i]
                if direction == "long":
                    if prev.get("ema_9", 0) <= prev.get("ema_21", 0):
                        break
                else:
                    if prev.get("ema_9", 0) >= prev.get("ema_21", 0):
                        break
                bars_since_cross += 1

        # ── Exit type heuristic ──
        # Infer from pnl and hold time
        exit_type = "unknown"
        if hold_days <= 2 and pnl_pct < -5:
            exit_type = "stop_loss_quick"
        elif pnl_pct < -5:
            exit_type = "stop_loss"
        elif hold_days <= 2:
            exit_type = "quick_reversal"
        elif pnl_pct > 0:
            exit_type = "profitable_exit"
        else:
            exit_type = "gradual_loss"

        rows.append({
            "asset": trade.get("asset", "?"),
            "direction": direction,
            "entry_date": entry_date,
            "exit_date": exit_date,
            "entry_price": entry_price,
            "exit_price": trade["exit_price"],
            "pnl_pct": pnl_pct,
            "pnl_usd": pnl_usd,
            "hold_days": hold_days,
            "is_winner": pnl_usd > 0,
            # Entry conditions
            "rsi": rsi,
            "adx": adx,
            "ema_spread": ema_spread,
            "vol_ratio": vol_ratio,
            # Volatility
            "bb_width": bb_width,
            "atr_pct": atr_pct,
            # Trend
            "dist_sma50": dist_sma50,
            "price_vs_range_10d": price_vs_range,
            "momentum_5d": momentum_5d,
            "rsi_slope": rsi_slope,
            # Volume
            "vol_trend": vol_trend,
            # Consecutive days
            "consec_green": consec_green,
            "consec_red": consec_red,
            # Post-entry behavior
            "bar1_move": bar1_move,
            "bar2_move": bar2_move,
            # Excursion
            "mae": mae,
            "mfe": mfe,
            # Entry timing
            "bars_since_cross": bars_since_cross,
            # Exit
            "exit_type": exit_type,
        })

    return pd.DataFrame(rows)


def print_feature_comparison(df: pd.DataFrame):
    """Compare feature distributions between winners and losers."""
    print("\n" + "=" * 100)
    print("FEATURE COMPARISON: WINNERS vs LOSERS")
    print("=" * 100)

    winners = df[df["is_winner"]]
    losers = df[~df["is_winner"]]
    print(f"\nTotal: {len(df)} trades | Winners: {len(winners)} | Losers: {len(losers)}")
    print(f"Avg winner: {winners['pnl_pct'].mean():+.2f}% (${winners['pnl_usd'].mean():+.2f})")
    print(f"Avg loser:  {losers['pnl_pct'].mean():+.2f}% (${losers['pnl_usd'].mean():+.2f})")

    numeric_features = [
        "rsi", "adx", "ema_spread", "vol_ratio", "bb_width", "atr_pct",
        "dist_sma50", "price_vs_range_10d", "momentum_5d", "rsi_slope",
        "vol_trend", "consec_green", "consec_red", "bar1_move", "bar2_move",
        "mae", "mfe", "bars_since_cross", "hold_days"
    ]

    print(f"\n{'Feature':<22} {'Win avg':>10} {'Win med':>10} {'Lose avg':>10} {'Lose med':>10} {'Diff%':>8} {'Corr':>8} {'Actionable?':>14}")
    print("─" * 100)

    actionable = []

    for feat in numeric_features:
        if feat not in df.columns:
            continue
        w = winners[feat].dropna()
        l = losers[feat].dropna()
        if len(w) < 5 or len(l) < 5:
            continue

        w_avg = w.mean()
        w_med = w.median()
        l_avg = l.mean()
        l_med = l.median()
        diff_pct = ((w_avg - l_avg) / abs(l_avg) * 100) if l_avg != 0 else 0

        valid = df[[feat, "pnl_pct"]].dropna()
        corr = valid[feat].corr(valid["pnl_pct"]) if len(valid) > 5 else 0

        # Is this actionable? (known at entry time, meaningful difference)
        post_entry = feat in ("bar1_move", "bar2_move", "mae", "mfe", "hold_days")
        is_actionable = not post_entry and abs(corr) > 0.10
        tag = "POST-ENTRY" if post_entry else ("✅ YES" if is_actionable else "")

        if is_actionable:
            actionable.append((feat, corr, w_avg, l_avg, diff_pct))

        print(f"{feat:<22} {w_avg:>10.2f} {w_med:>10.2f} {l_avg:>10.2f} {l_med:>10.2f} {diff_pct:>+7.1f}% {corr:>+7.3f} {tag:>14}")

    return actionable


def print_exit_analysis(df: pd.DataFrame):
    """Analyze how losers exit vs winners."""
    print("\n" + "=" * 100)
    print("EXIT TYPE ANALYSIS")
    print("=" * 100)

    for etype in sorted(df["exit_type"].unique()):
        subset = df[df["exit_type"] == etype]
        n = len(subset)
        pct = n / len(df) * 100
        avg_pnl = subset["pnl_pct"].mean()
        avg_hold = subset["hold_days"].mean()
        win_rate = (subset["pnl_usd"] > 0).sum() / n * 100 if n > 0 else 0
        print(f"  {etype:<25} {n:>4} trades ({pct:>5.1f}%) | avg P&L: {avg_pnl:>+6.2f}% | hold: {avg_hold:>4.1f}d | win rate: {win_rate:>5.1f}%")


def print_direction_analysis(df: pd.DataFrame):
    """Analyze losers by direction."""
    print("\n" + "=" * 100)
    print("DIRECTION ANALYSIS")
    print("=" * 100)

    for direction in ["long", "short"]:
        subset = df[df["direction"] == direction]
        if len(subset) == 0:
            continue
        winners = subset[subset["is_winner"]]
        losers = subset[~subset["is_winner"]]
        print(f"\n  {direction.upper()}: {len(subset)} trades, {len(winners)} wins ({len(winners)/len(subset)*100:.0f}%), {len(losers)} losses")
        if len(losers) > 0:
            print(f"    Avg loser: {losers['pnl_pct'].mean():+.2f}%, avg hold: {losers['hold_days'].mean():.1f}d")
            print(f"    Avg winner: {winners['pnl_pct'].mean():+.2f}%, avg hold: {winners['hold_days'].mean():.1f}d")
            # RSI comparison
            print(f"    RSI at entry — losers: {losers['rsi'].mean():.1f}, winners: {winners['rsi'].mean():.1f}")
            print(f"    ADX at entry — losers: {losers['adx'].mean():.1f}, winners: {winners['adx'].mean():.1f}")
            print(f"    EMA spread   — losers: {losers['ema_spread'].mean():.2f}%, winners: {winners['ema_spread'].mean():.2f}%")


def print_worst_trades(df: pd.DataFrame, n: int = 15):
    """Show the N worst trades with all features."""
    print("\n" + "=" * 100)
    print(f"WORST {n} TRADES — DETAILED PROFILES")
    print("=" * 100)

    worst = df.nsmallest(n, "pnl_usd")
    for _, t in worst.iterrows():
        print(f"\n  {t['asset']} {t['direction'].upper()} | {t['entry_date']} → {t['exit_date']} | P&L: {t['pnl_pct']:+.2f}% (${t['pnl_usd']:+.2f}) | Hold: {t['hold_days']}d")
        print(f"    Entry: RSI={t['rsi']:.1f}, ADX={t['adx']:.1f}, EMA spread={t['ema_spread']:.2f}%, vol_ratio={t['vol_ratio']:.2f}")
        print(f"    Context: BB width={t['bb_width']:.2f}%, momentum 5d={t['momentum_5d']:+.2f}%, dist SMA50={t['dist_sma50']:+.2f}%")
        print(f"    Post-entry: bar1 {t['bar1_move']:+.2f}%, bar2 {t['bar2_move']:+.2f}%, MAE={t['mae']:.2f}%, MFE={t['mfe']:.2f}%")
        print(f"    Bars since EMA cross: {t['bars_since_cross']}, exit type: {t['exit_type']}")


def print_compound_filters(df: pd.DataFrame, actionable_features: list):
    """Test compound filters that could screen out bad trades."""
    print("\n" + "=" * 100)
    print("COMPOUND FILTER ANALYSIS — What if we rejected these trades?")
    print("=" * 100)

    total = len(df)
    total_pnl = df["pnl_usd"].sum()
    total_wins = (df["pnl_usd"] > 0).sum()

    filters = [
        ("ADX < 22 (weak trend)", df["adx"] < 22),
        ("ADX < 25 (moderate trend gate)", df["adx"] < 25),
        ("EMA spread < 0.3%", df["ema_spread"] < 0.3),
        ("EMA spread < 0.5%", df["ema_spread"] < 0.5),
        ("EMA spread < 1.0%", df["ema_spread"] < 1.0),
        ("Vol ratio < 0.7 (low volume)", df["vol_ratio"] < 0.7),
        ("BB width > 15% (high volatility)", df["bb_width"] > 15),
        ("BB width > 20% (very high vol)", df["bb_width"] > 20),
        ("Momentum against direction (long: -5d mom < -2%)",
         ((df["direction"] == "long") & (df["momentum_5d"] < -2)) |
         ((df["direction"] == "short") & (df["momentum_5d"] > 2))),
        ("RSI slope against direction (long: slope < -2)",
         ((df["direction"] == "long") & (df["rsi_slope"] < -2)) |
         ((df["direction"] == "short") & (df["rsi_slope"] > 2))),
        ("Late entry: bars_since_cross >= 5", df["bars_since_cross"] >= 5),
        ("Late entry: bars_since_cross >= 4", df["bars_since_cross"] >= 4),
        ("Consec red >= 3 before long entry",
         (df["direction"] == "long") & (df["consec_red"] >= 3)),
        ("ADX < 25 AND EMA spread < 0.5%", (df["adx"] < 25) & (df["ema_spread"] < 0.5)),
        ("ADX < 25 AND vol ratio < 0.8", (df["adx"] < 25) & (df["vol_ratio"] < 0.8)),
        ("EMA spread < 0.3% AND BB width > 15%", (df["ema_spread"] < 0.3) & (df["bb_width"] > 15)),
        ("ADX < 22 AND momentum against direction",
         (df["adx"] < 22) & (
             ((df["direction"] == "long") & (df["momentum_5d"] < -2)) |
             ((df["direction"] == "short") & (df["momentum_5d"] > 2))
         )),
    ]

    print(f"\nBaseline: {total} trades, ${total_pnl:+.2f} P&L, {total_wins}/{total} wins ({total_wins/total*100:.0f}%)")
    print(f"\n{'Filter':<55} {'Rejected':>10} {'Kept':>8} {'New P&L':>12} {'Delta':>10} {'Rej Win%':>10} {'Kept Win%':>10}")
    print("─" * 120)

    for label, mask in filters:
        rejected = df[mask]
        kept = df[~mask]
        if len(rejected) == 0 or len(kept) == 0:
            continue

        rej_count = len(rejected)
        kept_count = len(kept)
        kept_pnl = kept["pnl_usd"].sum()
        delta = kept_pnl - total_pnl
        rej_winrate = (rejected["pnl_usd"] > 0).sum() / len(rejected) * 100
        kept_winrate = (kept["pnl_usd"] > 0).sum() / len(kept) * 100

        # Flag if filter mainly removes losers (good) vs winners (bad)
        rej_losers = (~rejected["is_winner"]).sum()
        rej_pct_losers = rej_losers / len(rejected) * 100

        flag = ""
        if delta > 0 and rej_pct_losers > 60:
            flag = " ✅ GOOD"
        elif delta < 0:
            flag = " ❌ HURTS"

        print(f"  {label:<55} {rej_count:>6} ({rej_pct_losers:.0f}%L) {kept_count:>6} ${kept_pnl:>+10.2f} ${delta:>+8.2f} {rej_winrate:>8.0f}% {kept_winrate:>9.0f}%{flag}")


def print_asset_loser_profiles(df: pd.DataFrame):
    """Per-asset breakdown of losing trade characteristics."""
    print("\n" + "=" * 100)
    print("PER-ASSET LOSER PROFILES")
    print("=" * 100)

    for asset in sorted(df["asset"].unique()):
        adf = df[df["asset"] == asset]
        losers = adf[~adf["is_winner"]]
        winners = adf[adf["is_winner"]]

        if len(losers) < 3:
            continue

        total_loss = losers["pnl_usd"].sum()
        print(f"\n  {asset.upper()}: {len(losers)} losers (${total_loss:+.2f}), {len(winners)} winners")

        # Most common exit types for losers
        for etype in losers["exit_type"].value_counts().head(3).index:
            n = (losers["exit_type"] == etype).sum()
            avg = losers[losers["exit_type"] == etype]["pnl_pct"].mean()
            print(f"    Exit: {etype}: {n} trades, avg {avg:+.2f}%")

        # Key feature differences for this asset
        key_feats = ["rsi", "adx", "ema_spread", "bb_width", "momentum_5d", "bars_since_cross"]
        for feat in key_feats:
            if feat not in adf.columns:
                continue
            w_avg = winners[feat].mean() if len(winners) > 0 else np.nan
            l_avg = losers[feat].mean()
            if not np.isnan(w_avg) and not np.isnan(l_avg) and abs(w_avg) > 0.01:
                diff = ((w_avg - l_avg) / abs(w_avg)) * 100
                if abs(diff) > 15:  # Only show meaningful differences
                    print(f"    {feat}: winners={w_avg:.2f}, losers={l_avg:.2f} ({diff:+.0f}% diff)")


def main():
    parser = argparse.ArgumentParser(description="Bad trade analysis")
    parser.add_argument("--days", type=int, default=730, help="Lookback days")
    args = parser.parse_args()

    print("=" * 100)
    print("BAD TRADE DEEP ANALYSIS")
    print(f"Config: {ACTIVE_CONFIG.get('name', 'V9_ATR_2_0X')}")
    print(f"Lookback: {args.days} days")
    print("=" * 100)

    # Fetch data
    all_trades = []
    all_dfs = {}

    # BTC first for crash filter
    print("\nFetching bitcoin...")
    btc_df = fetch_ohlc("bitcoin", args.days)
    btc_df = calculate_indicators(btc_df, ACTIVE_CONFIG)
    btc_df = generate_signals(btc_df, ACTIVE_CONFIG)
    print(f"  Got {len(btc_df)} candles")
    time.sleep(2)

    for cg_id, hl_sym in ASSETS_HL.items():
        print(f"Fetching {cg_id}...")
        is_btc = cg_id == "bitcoin"

        if is_btc:
            df = btc_df
        else:
            df = fetch_ohlc(cg_id, args.days)
            df = calculate_indicators(df, ACTIVE_CONFIG)
            df = generate_signals(df, ACTIVE_CONFIG)
            time.sleep(2)

        print(f"  Got {len(df)} candles")

        trades = simulate_trades(
            df, POSITION_SIZE_USD, ACTIVE_CONFIG,
            btc_df=btc_df if not is_btc else None,
            is_btc=is_btc,
        )

        # Only closed trades
        closed = [t for t in trades if t.get("status") == "closed"]
        for t in closed:
            t["asset"] = cg_id

        all_trades.extend(closed)
        all_dfs[cg_id] = df

    print(f"\nTotal closed trades: {len(all_trades)}")

    # Compute features
    all_features = []
    for cg_id, df in all_dfs.items():
        asset_trades = [t for t in all_trades if t["asset"] == cg_id]
        features_df = compute_trade_features(df, asset_trades)
        all_features.append(features_df)

    combined = pd.concat(all_features, ignore_index=True)
    print(f"Trades with features: {len(combined)}")

    # Run analyses
    actionable = print_feature_comparison(combined)
    print_exit_analysis(combined)
    print_direction_analysis(combined)
    print_worst_trades(combined, n=15)
    print_compound_filters(combined, actionable)
    print_asset_loser_profiles(combined)

    print(f"\n{'=' * 100}")
    print("DONE")
    print(f"{'=' * 100}")


if __name__ == "__main__":
    main()
