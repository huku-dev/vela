#!/usr/bin/env python3
"""
Scaling-In Backtest + Candle Pattern Exploration
=================================================
Tests two strategies for adding to positions:
  Option 1: Signal-driven adds (RSI bounce, pullback recovery, volume spike)
  Option 2: Tranched entry (50/50, 70/30 splits on dip)

Also explores candle data for return-correlated patterns that could
improve the overall signal model (not just adds).

Uses simulate_trades() from backtest.py for proper signal persistence,
stop-losses, trims, and bidirectional trading.

Usage:
    python3 scripts/scaling_in_backtest.py
    python3 scripts/scaling_in_backtest.py --asset bitcoin
    python3 scripts/scaling_in_backtest.py --days 365
"""

import argparse
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

# Use V9_ATR_2_0X — the production baseline with full feature set
# (profit ladder, pullback re-entry, BB2 improved trades, trailing stops,
#  late entry, EMA cooldown, ATR dynamic stop-loss, grace period, volume confirmation)
ACTIVE_CONFIG = V9_ATR_2_0X

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Strengthening criteria for Option 1
STRENGTHEN_RSI_DIP = 8         # RSI must drop this many points
STRENGTHEN_RSI_RECOVER = 4     # Then recover this many points
STRENGTHEN_PRICE_DIP_PCT = 2.0 # Price pullback % from signal-period high
STRENGTHEN_PRICE_RECOVER = 0.5 # Must recover 50% of dip
STRENGTHEN_VOL_SPIKE = 1.5     # Volume spike relative to 20-day average

# Tranched entry params for Option 2
TRANCHE_DIP_THRESHOLDS = [1.0, 1.5, 2.0, 2.5, 3.0]
TRANCHE_WINDOW_DAYS = 3  # Look for dip within this many days

# Add size as fraction of original
ADD_SIZE_FRACTION = 0.5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def date_to_idx(df: pd.DataFrame, date_str: str) -> int:
    """Find the bar index (positional, 0-based) closest to a date string."""
    target = str(date_str)[:10]

    # Try matching against index values (works for DatetimeIndex, date objects, strings)
    for pos in range(len(df)):
        if str(df.index[pos])[:10] == target:
            return pos

    # Check 'date' column as fallback
    if "date" in df.columns:
        for pos in range(len(df)):
            if str(df.iloc[pos]["date"])[:10] == target:
                return pos

    return 0


def enrich_trades_with_idx(df: pd.DataFrame, trades: list[dict]) -> list[dict]:
    """Add entry_idx and exit_idx to trades from simulate_trades()."""
    enriched = []
    for t in trades:
        # Only use main trades (not trims/partial)
        if t.get("status") not in ("closed",):
            continue
        entry_idx = date_to_idx(df, t["entry_date"])
        exit_idx = date_to_idx(df, t["exit_date"])
        if exit_idx <= entry_idx:
            exit_idx = entry_idx + 1
        enriched.append({
            **t,
            "entry_idx": entry_idx,
            "exit_idx": exit_idx,
            "hold_days": exit_idx - entry_idx,
        })
    return enriched


# ---------------------------------------------------------------------------
# Option 1: Signal-Driven Adds
# ---------------------------------------------------------------------------

def find_strengthening_events(df: pd.DataFrame, entry_idx: int, exit_idx: int,
                              direction: str,
                              rsi_dip_override: int | None = None,
                              price_dip_override: float | None = None) -> list[dict]:
    """
    Within an active signal period, find moments where the signal 'strengthens'.
    Returns list of {idx, type, price} for each strengthening event.
    """
    events = []
    rsi_dip = rsi_dip_override if rsi_dip_override is not None else STRENGTHEN_RSI_DIP
    rsi_recover = rsi_dip // 2  # Recovery = half the dip threshold
    price_dip = price_dip_override if price_dip_override is not None else STRENGTHEN_PRICE_DIP_PCT

    if exit_idx - entry_idx < 3:
        return events  # Too short for strengthening

    period = df.iloc[entry_idx:exit_idx + 1]
    prices = period["close"].values

    # --- RSI Bounce ---
    if "rsi_14" in period.columns:
        rsi = period["rsi_14"].values
        for i in range(2, len(period)):
            if np.isnan(rsi[i]) or np.isnan(rsi[i-1]):
                continue
            if direction == "long":
                window_start = max(0, i - 5)
                recent_max = np.nanmax(rsi[window_start:i])
                if (recent_max - rsi[i - 1]) >= rsi_dip and \
                   (rsi[i] - rsi[i - 1]) >= rsi_recover:
                    events.append({
                        "idx": entry_idx + i,
                        "type": "rsi_bounce",
                        "price": prices[i],
                    })
            else:  # short
                window_start = max(0, i - 5)
                recent_min = np.nanmin(rsi[window_start:i])
                if (rsi[i - 1] - recent_min) >= rsi_dip and \
                   (rsi[i - 1] - rsi[i]) >= rsi_recover:
                    events.append({
                        "idx": entry_idx + i,
                        "type": "rsi_bounce",
                        "price": prices[i],
                    })

    # --- Price Pullback Recovery ---
    if direction == "long":
        running_high = prices[0]
        in_dip = False
        dip_low = prices[0]
        for i in range(1, len(period)):
            running_high = max(running_high, prices[i])
            dip_pct = (running_high - prices[i]) / running_high * 100
            if dip_pct >= price_dip and not in_dip:
                in_dip = True
                dip_low = prices[i]
            elif in_dip:
                dip_low = min(dip_low, prices[i])
                if running_high > dip_low:
                    recovery = (prices[i] - dip_low) / (running_high - dip_low)
                    if recovery >= STRENGTHEN_PRICE_RECOVER:
                        events.append({
                            "idx": entry_idx + i,
                            "type": "pullback_recovery",
                            "price": prices[i],
                        })
                        in_dip = False
                        running_high = prices[i]
    else:  # short
        running_low = prices[0]
        in_spike = False
        spike_high = prices[0]
        for i in range(1, len(period)):
            running_low = min(running_low, prices[i])
            spike_pct = (prices[i] - running_low) / running_low * 100 if running_low > 0 else 0
            if spike_pct >= price_dip and not in_spike:
                in_spike = True
                spike_high = prices[i]
            elif in_spike:
                spike_high = max(spike_high, prices[i])
                if spike_high > running_low:
                    recovery = (spike_high - prices[i]) / (spike_high - running_low)
                    if recovery >= STRENGTHEN_PRICE_RECOVER:
                        events.append({
                            "idx": entry_idx + i,
                            "type": "pullback_recovery",
                            "price": prices[i],
                        })
                        in_spike = False
                        running_low = prices[i]

    # --- Volume Spike ---
    if "volume_ratio" in period.columns:
        vol_ratios = period["volume_ratio"].values
        for i in range(1, len(period)):
            if np.isnan(vol_ratios[i]):
                continue
            if vol_ratios[i] >= STRENGTHEN_VOL_SPIKE:
                price_up = prices[i] > prices[i - 1]
                if (direction == "long" and price_up) or (direction == "short" and not price_up):
                    events.append({
                        "idx": entry_idx + i,
                        "type": "volume_spike",
                        "price": prices[i],
                    })

    return events


def simulate_option1(df: pd.DataFrame, trades: list[dict],
                     allowed_types: list[str] | None = None,
                     only_winners: bool = False,
                     rsi_dip: int | None = None,
                     price_dip_pct: float | None = None) -> list[dict]:
    """
    Simulate signal-driven adds (max 1 add per trade, 50% of original size).

    Args:
        allowed_types: Filter to only these event types (e.g. ["rsi_bounce", "pullback_recovery"])
        only_winners: If True, only add on trades that are currently in profit at add time
        rsi_dip: Override STRENGTHEN_RSI_DIP for this run
        price_dip_pct: Override STRENGTHEN_PRICE_DIP_PCT for this run
    """
    results = []

    for trade in trades:
        entry_idx = trade["entry_idx"]
        exit_idx = trade["exit_idx"]
        direction = trade["direction"]
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"]
        base_pnl_pct = trade["pnl_pct"]
        base_pnl_usd = trade["pnl_usd"]

        # Apply overrides for this run
        saved_rsi = None
        saved_price = None
        if rsi_dip is not None:
            saved_rsi = globals().get("_orig_rsi_dip")
            globals()["_orig_rsi_dip"] = STRENGTHEN_RSI_DIP
        if price_dip_pct is not None:
            saved_price = globals().get("_orig_price_dip")
            globals()["_orig_price_dip"] = STRENGTHEN_PRICE_DIP_PCT

        events = find_strengthening_events(
            df, entry_idx, exit_idx, direction,
            rsi_dip_override=rsi_dip,
            price_dip_override=price_dip_pct,
        )

        # Filter by allowed types
        if allowed_types:
            events = [e for e in events if e["type"] in allowed_types]

        if not events:
            results.append({
                "asset": trade.get("asset_name", trade.get("asset", "?")),
                "direction": direction,
                "entry_date": trade["entry_date"],
                "hold_days": trade["hold_days"],
                "base_pnl_pct": base_pnl_pct,
                "base_pnl_usd": base_pnl_usd,
                "add_triggered": False,
                "add_type": None,
                "add_price": None,
                "scaled_pnl_usd": base_pnl_usd,
                "improvement_usd": 0,
            })
            continue

        # Use first event only (max 1 add per trade)
        event = events[0]
        add_price = event["price"]

        # Only-winners gate: check if trade is in profit at the add point
        if only_winners:
            if direction == "long":
                unrealized = (add_price - entry_price) / entry_price
            else:
                unrealized = (entry_price - add_price) / entry_price
            if unrealized <= 0:
                results.append({
                    "asset": trade.get("asset_name", trade.get("asset", "?")),
                    "direction": direction,
                    "entry_date": trade["entry_date"],
                    "hold_days": trade["hold_days"],
                    "base_pnl_pct": base_pnl_pct,
                    "base_pnl_usd": base_pnl_usd,
                    "add_triggered": False,
                    "add_type": None,
                    "add_price": None,
                    "scaled_pnl_usd": base_pnl_usd,
                    "improvement_usd": 0,
                })
                continue

        add_size = POSITION_SIZE_USD * ADD_SIZE_FRACTION

        if direction == "long":
            add_pnl = add_size * (exit_price - add_price) / add_price
        else:
            add_pnl = add_size * (add_price - exit_price) / add_price

        scaled_pnl_usd = base_pnl_usd + add_pnl

        results.append({
            "asset": trade.get("asset_name", trade.get("asset", "?")),
            "direction": direction,
            "entry_date": trade["entry_date"],
            "hold_days": trade["hold_days"],
            "base_pnl_pct": base_pnl_pct,
            "base_pnl_usd": base_pnl_usd,
            "add_triggered": True,
            "add_type": event["type"],
            "add_price": add_price,
            "scaled_pnl_usd": scaled_pnl_usd,
            "improvement_usd": scaled_pnl_usd - base_pnl_usd,
        })

    return results


# ---------------------------------------------------------------------------
# Option 2: Tranched Entry
# ---------------------------------------------------------------------------

def simulate_option2(df: pd.DataFrame, trades: list[dict]) -> dict:
    """Simulate 50/50 split entry with various dip thresholds."""
    all_results = {}

    for threshold in TRANCHE_DIP_THRESHOLDS:
        results = []
        for trade in trades:
            entry_idx = trade["entry_idx"]
            exit_idx = trade["exit_idx"]
            direction = trade["direction"]
            entry_price = trade["entry_price"]
            exit_price = trade["exit_price"]
            base_pnl_usd = trade["pnl_usd"]

            half_size = POSITION_SIZE_USD / 2
            window_end = min(entry_idx + TRANCHE_WINDOW_DAYS, exit_idx)
            dip_found = False
            dip_price = None

            for i in range(entry_idx + 1, window_end + 1):
                if i >= len(df):
                    break
                price = df.iloc[i]["close"]
                if direction == "long":
                    dip_pct = (entry_price - price) / entry_price * 100
                    if dip_pct >= threshold:
                        dip_found = True
                        dip_price = price
                        break
                else:
                    spike_pct = (price - entry_price) / entry_price * 100
                    if spike_pct >= threshold:
                        dip_found = True
                        dip_price = price
                        break

            if dip_found:
                if direction == "long":
                    pnl_1 = half_size * (exit_price - entry_price) / entry_price
                    pnl_2 = half_size * (exit_price - dip_price) / dip_price
                else:
                    pnl_1 = half_size * (entry_price - exit_price) / entry_price
                    pnl_2 = half_size * (dip_price - exit_price) / dip_price
                scaled_pnl_usd = pnl_1 + pnl_2
            else:
                # Only first tranche fills
                if direction == "long":
                    scaled_pnl_usd = half_size * (exit_price - entry_price) / entry_price
                else:
                    scaled_pnl_usd = half_size * (entry_price - exit_price) / entry_price

            results.append({
                "asset": trade.get("asset_name", trade.get("asset", "?")),
                "direction": direction,
                "entry_date": trade["entry_date"],
                "base_pnl_usd": base_pnl_usd,
                "dip_filled": dip_found,
                "dip_price": dip_price,
                "scaled_pnl_usd": scaled_pnl_usd,
                "improvement_usd": scaled_pnl_usd - base_pnl_usd,
            })

        all_results[threshold] = results

    return all_results


# ---------------------------------------------------------------------------
# Candle Pattern Exploration (for overall signal model improvement)
# ---------------------------------------------------------------------------

def explore_candle_patterns(df: pd.DataFrame, trades: list[dict]) -> list[dict]:
    """
    For each trade, compute features at entry time.
    Then correlate with trade returns to find what predicts winners vs losers.
    """
    features = []

    for trade in trades:
        idx = trade["entry_idx"]
        if idx < 20 or idx >= len(df):
            continue

        row = df.iloc[idx]
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"]
        direction = trade["direction"]
        pnl_pct = trade["pnl_pct"]

        # --- Feature 1: Bollinger Band Width (volatility squeeze indicator) ---
        lookback = df.iloc[max(0, idx - 20):idx + 1]["close"]
        bb_mid = lookback.mean()
        bb_std = lookback.std()
        bb_width = (2 * bb_std / bb_mid * 100) if bb_mid > 0 else np.nan

        # --- Feature 2: ATR % (volatility regime) ---
        atr_pct = row.get("atr_pct", np.nan) if "atr_pct" in df.columns else np.nan

        # --- Feature 3: Volume trend (5d vs 20d — accumulation/distribution) ---
        if "volume" in df.columns and df.iloc[max(0, idx - 5):idx + 1]["volume"].sum() > 0:
            vol_5d = df.iloc[max(0, idx - 5):idx + 1]["volume"].mean()
            vol_20d = df.iloc[max(0, idx - 20):idx + 1]["volume"].mean()
            vol_trend = vol_5d / vol_20d if vol_20d > 0 else np.nan
        else:
            vol_trend = np.nan

        # --- Feature 4: Distance from SMA-50 (trend extension) ---
        sma50 = row.get("sma_50", np.nan)
        dist_sma50_pct = ((entry_price - sma50) / sma50 * 100) if not np.isnan(sma50) and sma50 > 0 else np.nan

        # --- Feature 5: Consecutive directional days before entry ---
        consec_green = 0
        consec_red = 0
        for i in range(idx - 1, max(0, idx - 10) - 1, -1):
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

        # --- Feature 6: RSI at entry ---
        rsi_at_entry = row.get("rsi_14", np.nan)

        # --- Feature 7: ADX at entry (trend strength) ---
        adx_at_entry = row.get("adx", np.nan)

        # --- Feature 8: EMA spread at entry ---
        ema_spread = row.get("ema_spread_pct", np.nan)

        # --- Feature 9: Candle body size (5-day avg — conviction indicator) ---
        recent_bodies = []
        for i in range(max(0, idx - 5), idx + 1):
            r = df.iloc[i]
            body = abs(r["close"] - r["open"]) / r["open"] * 100 if r["open"] > 0 else 0
            recent_bodies.append(body)
        avg_body_pct = np.mean(recent_bodies) if recent_bodies else np.nan

        # --- Feature 10: High-low range (5-day avg — intraday volatility) ---
        recent_ranges = []
        for i in range(max(0, idx - 5), idx + 1):
            r = df.iloc[i]
            hl_range = (r["high"] - r["low"]) / r["low"] * 100 if r["low"] > 0 else 0
            recent_ranges.append(hl_range)
        avg_range_pct = np.mean(recent_ranges) if recent_ranges else np.nan

        # --- Feature 11: 5-day momentum going into signal ---
        if idx >= 5:
            price_5d_ago = df.iloc[idx - 5]["close"]
            momentum_5d = (entry_price - price_5d_ago) / price_5d_ago * 100
        else:
            momentum_5d = np.nan

        # --- Feature 12: Volume ratio at entry ---
        vol_ratio_entry = row.get("volume_ratio", np.nan) if "volume_ratio" in df.columns else np.nan

        # --- Feature 13: BB position (where price sits in Bollinger Band) ---
        if bb_std > 0:
            bb_upper = bb_mid + 2 * bb_std
            bb_lower = bb_mid - 2 * bb_std
            bb_position = (entry_price - bb_lower) / (bb_upper - bb_lower)
        else:
            bb_position = np.nan

        # --- Feature 14: RSI slope (momentum of momentum) ---
        if idx >= 3 and "rsi_14" in df.columns:
            rsi_3d_ago = df.iloc[idx - 3].get("rsi_14", np.nan)
            rsi_now = row.get("rsi_14", np.nan)
            rsi_slope = (rsi_now - rsi_3d_ago) / 3 if not np.isnan(rsi_3d_ago) and not np.isnan(rsi_now) else np.nan
        else:
            rsi_slope = np.nan

        # --- Feature 15: Price vs 10-day high/low (breakout detection) ---
        if idx >= 10:
            high_10d = df.iloc[idx - 10:idx]["high"].max()
            low_10d = df.iloc[idx - 10:idx]["low"].min()
            if high_10d > low_10d:
                price_vs_range_10d = (entry_price - low_10d) / (high_10d - low_10d)
            else:
                price_vs_range_10d = np.nan
        else:
            price_vs_range_10d = np.nan

        # --- Feature 16: Gap from previous close ---
        if idx >= 1:
            prev_close = df.iloc[idx - 1]["close"]
            gap_pct = (row["open"] - prev_close) / prev_close * 100 if prev_close > 0 else np.nan
        else:
            gap_pct = np.nan

        # --- Feature 17: Upper/lower wick ratio (rejection signals) ---
        body_top = max(row["open"], row["close"])
        body_bottom = min(row["open"], row["close"])
        candle_range = row["high"] - row["low"]
        if candle_range > 0:
            upper_wick = (row["high"] - body_top) / candle_range
            lower_wick = (body_bottom - row["low"]) / candle_range
        else:
            upper_wick = np.nan
            lower_wick = np.nan

        # --- Feature 18: Close vs open direction alignment with signal ---
        entry_candle_bullish = 1 if row["close"] > row["open"] else 0
        signal_aligned = 1 if (direction == "long" and entry_candle_bullish) or \
                              (direction == "short" and not entry_candle_bullish) else 0

        features.append({
            "asset": trade.get("asset_name", trade.get("asset", "?")),
            "direction": direction,
            "entry_date": trade["entry_date"],
            "pnl_pct": pnl_pct,
            "pnl_usd": trade["pnl_usd"],
            "hold_days": trade["hold_days"],
            "bb_width": bb_width,
            "atr_pct": atr_pct,
            "vol_trend": vol_trend,
            "dist_sma50_pct": dist_sma50_pct,
            "consec_green": consec_green,
            "consec_red": consec_red,
            "rsi_at_entry": rsi_at_entry,
            "adx_at_entry": adx_at_entry,
            "ema_spread_pct": ema_spread,
            "avg_body_pct": avg_body_pct,
            "avg_range_pct": avg_range_pct,
            "momentum_5d": momentum_5d,
            "vol_ratio_entry": vol_ratio_entry,
            "bb_position": bb_position,
            "rsi_slope": rsi_slope,
            "price_vs_range_10d": price_vs_range_10d,
            "gap_pct": gap_pct,
            "upper_wick": upper_wick,
            "lower_wick": lower_wick,
            "signal_aligned": signal_aligned,
        })

    return features


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_option1_report(results: list[dict]):
    print("\n" + "=" * 80)
    print("OPTION 1: SIGNAL-DRIVEN ADDS (50% of original, max 1 per trade)")
    print("=" * 80)

    df = pd.DataFrame(results)
    if df.empty:
        print("No trades found.")
        return

    total_trades = len(df)
    adds_triggered = df["add_triggered"].sum()
    add_rate = adds_triggered / total_trades * 100

    print(f"\nTotal trades: {total_trades}")
    print(f"Adds triggered: {int(adds_triggered)} ({add_rate:.0f}%)")
    print(f"Avg hold days: {df['hold_days'].mean():.1f}")

    if adds_triggered > 0:
        adds = df[df["add_triggered"]]
        print(f"\nAdd type breakdown:")
        for atype in adds["add_type"].value_counts().index:
            count = (adds["add_type"] == atype).sum()
            avg_imp = adds[adds["add_type"] == atype]["improvement_usd"].mean()
            print(f"  {atype}: {count} times, avg improvement: ${avg_imp:+.2f}")

        # Adds on winning vs losing trades
        adds_on_winners = adds[adds["base_pnl_usd"] > 0]
        adds_on_losers = adds[adds["base_pnl_usd"] <= 0]
        print(f"\n  Adds on winning trades: {len(adds_on_winners)} (avg imp: ${adds_on_winners['improvement_usd'].mean():+.2f})" if len(adds_on_winners) > 0 else "")
        print(f"  Adds on losing trades:  {len(adds_on_losers)} (avg imp: ${adds_on_losers['improvement_usd'].mean():+.2f})" if len(adds_on_losers) > 0 else "")

    print(f"\n{'Metric':<35} {'Single Entry':>15} {'With Adds':>15} {'Delta':>12}")
    print("-" * 80)

    base_total = df["base_pnl_usd"].sum()
    scaled_total = df["scaled_pnl_usd"].sum()
    print(f"{'Total P&L (USD)':<35} {'$' + f'{base_total:.2f}':>15} {'$' + f'{scaled_total:.2f}':>15} {'$' + f'{scaled_total - base_total:+.2f}':>12}")

    base_avg = df["base_pnl_pct"].mean()
    print(f"{'Avg return per trade (%)':<35} {f'{base_avg:.2f}%':>15}")

    base_wins = (df["base_pnl_usd"] > 0).sum()
    scaled_wins = (df["scaled_pnl_usd"] > 0).sum()
    print(f"{'Win rate':<35} {f'{base_wins}/{total_trades}':>15} {f'{scaled_wins}/{total_trades}':>15}")

    if adds_triggered > 0:
        bad_adds = df[df["add_triggered"] & (df["improvement_usd"] < 0)]
        if len(bad_adds) > 0:
            worst = bad_adds["improvement_usd"].min()
            print(f"\n⚠️  Adds that made losses worse: {len(bad_adds)}/{int(adds_triggered)}")
            print(f"   Worst case: ${worst:.2f}")
        else:
            print(f"\n✅ All adds improved P&L")

    print(f"\nPer-asset breakdown:")
    for asset in sorted(df["asset"].unique()):
        asset_df = df[df["asset"] == asset]
        base = asset_df["base_pnl_usd"].sum()
        scaled = asset_df["scaled_pnl_usd"].sum()
        n_adds = asset_df["add_triggered"].sum()
        n_trades = len(asset_df)
        print(f"  {asset}: {n_trades} trades, base ${base:+.2f} → scaled ${scaled:+.2f} (delta ${scaled - base:+.2f}, {int(n_adds)} adds)")


def print_option2_report(all_results: dict):
    print("\n" + "=" * 80)
    print("OPTION 2: TRANCHED ENTRY (50/50 SPLIT)")
    print("=" * 80)

    print(f"\n{'Dip %':>8} {'Fill Rate':>12} {'Base P&L':>12} {'Split P&L':>12} {'Delta':>12} {'Avg Imp (filled)':>18}")
    print("-" * 80)

    for threshold, results in sorted(all_results.items()):
        df = pd.DataFrame(results)
        if df.empty:
            continue

        fill_rate = df["dip_filled"].sum() / len(df) * 100
        base_total = df["base_pnl_usd"].sum()
        scaled_total = df["scaled_pnl_usd"].sum()
        delta = scaled_total - base_total
        filled = df[df["dip_filled"]]
        avg_improve = filled["improvement_usd"].mean() if len(filled) > 0 else 0

        print(f"{f'{threshold:.1f}%':>8} {f'{fill_rate:.0f}%':>12} {f'${base_total:.2f}':>12} {f'${scaled_total:.2f}':>12} {f'${delta:+.2f}':>12} {f'${avg_improve:+.2f}':>18}")

    print(f"\n⚠️  KEY INSIGHT: When dip doesn't fill, you're only 50% invested.")
    print(f"   Low fill rates mean you systematically undersize winning trades.")
    print(f"   Compare 'Delta' — negative means you lost more from being undersized")
    print(f"   than you gained from better entry prices on filled tranches.")


def print_pattern_report(features: list[dict]):
    print("\n" + "=" * 80)
    print("CANDLE PATTERN EXPLORATION — RETURN CORRELATIONS")
    print("=" * 80)

    df = pd.DataFrame(features)
    if df.empty:
        print("No data.")
        return

    numeric_cols = [
        "bb_width", "atr_pct", "vol_trend", "dist_sma50_pct",
        "consec_green", "consec_red", "rsi_at_entry", "adx_at_entry",
        "ema_spread_pct", "avg_body_pct", "avg_range_pct",
        "momentum_5d", "vol_ratio_entry", "bb_position", "rsi_slope",
        "price_vs_range_10d", "gap_pct", "upper_wick", "lower_wick",
        "signal_aligned", "hold_days"
    ]

    print(f"\nTotal trades analyzed: {len(df)}")
    print(f"Winners: {(df['pnl_pct'] > 0).sum()}, Losers: {(df['pnl_pct'] <= 0).sum()}")
    print(f"Avg return: {df['pnl_pct'].mean():+.2f}%")

    winners = df[df["pnl_pct"] > 0]
    losers = df[df["pnl_pct"] <= 0]

    print(f"\n{'Feature':<25} {'Corr w/ Return':>15} {'Avg (Win)':>12} {'Avg (Lose)':>12} {'Diff':>10} {'Signal':>12}")
    print("-" * 90)

    significant_features = []

    for col in numeric_cols:
        if col not in df.columns:
            continue
        valid = df[[col, "pnl_pct"]].dropna()
        if len(valid) < 5:
            continue

        corr = valid[col].corr(valid["pnl_pct"])
        avg_win = winners[col].mean() if len(winners) > 0 else np.nan
        avg_lose = losers[col].mean() if len(losers) > 0 else np.nan
        diff = avg_win - avg_lose if not np.isnan(avg_win) and not np.isnan(avg_lose) else np.nan

        abs_corr = abs(corr) if not np.isnan(corr) else 0
        if abs_corr > 0.3:
            signal = "🟢 STRONG"
            significant_features.append((col, corr, avg_win, avg_lose))
        elif abs_corr > 0.15:
            signal = "🟡 MODERATE"
            significant_features.append((col, corr, avg_win, avg_lose))
        else:
            signal = "⚪ weak"

        corr_str = f"{corr:+.3f}" if not np.isnan(corr) else "N/A"
        win_str = f"{avg_win:.2f}" if not np.isnan(avg_win) else "N/A"
        lose_str = f"{avg_lose:.2f}" if not np.isnan(avg_lose) else "N/A"
        diff_str = f"{diff:+.2f}" if not np.isnan(diff) else "N/A"
        print(f"{col:<25} {corr_str:>15} {win_str:>12} {lose_str:>12} {diff_str:>10} {signal:>12}")

    # Quintile analysis for significant features
    if significant_features:
        print(f"\n{'─' * 90}")
        print(f"QUINTILE ANALYSIS — Features with |corr| > 0.15")
        print(f"{'─' * 90}")

        for col, corr, _, _ in significant_features:
            valid = df[[col, "pnl_pct"]].dropna()
            if len(valid) < 10:
                continue
            try:
                valid["quintile"] = pd.qcut(valid[col], 5, labels=["Q1(low)", "Q2", "Q3", "Q4", "Q5(high)"], duplicates="drop")
                print(f"\n  {col} (corr: {corr:+.3f}):")
                for q in sorted(valid["quintile"].unique()):
                    q_data = valid[valid["quintile"] == q]
                    avg_ret = q_data["pnl_pct"].mean()
                    win_rate = (q_data["pnl_pct"] > 0).sum() / len(q_data) * 100
                    print(f"    {q}: avg return {avg_ret:+.2f}%, win rate {win_rate:.0f}% (n={len(q_data)})")
            except Exception:
                pass

    # Direction breakdown
    print(f"\n{'─' * 90}")
    print(f"DIRECTION BREAKDOWN")
    for direction in ["long", "short"]:
        dir_df = df[df["direction"] == direction]
        if len(dir_df) == 0:
            continue
        avg_ret = dir_df["pnl_pct"].mean()
        win_rate = (dir_df["pnl_pct"] > 0).sum() / len(dir_df) * 100
        avg_hold = dir_df["hold_days"].mean()
        print(f"  {direction.upper()}: {len(dir_df)} trades, avg return {avg_ret:+.2f}%, win rate {win_rate:.0f}%, avg hold {avg_hold:.1f}d")

    # Per-asset breakdown
    print(f"\n{'─' * 90}")
    print(f"PER-ASSET BREAKDOWN")
    for asset in sorted(df["asset"].unique()):
        asset_df = df[df["asset"] == asset]
        avg_ret = asset_df["pnl_pct"].mean()
        win_rate = (asset_df["pnl_pct"] > 0).sum() / len(asset_df) * 100
        avg_hold = asset_df["hold_days"].mean()
        total_pnl = asset_df["pnl_usd"].sum()
        print(f"  {asset}: {len(asset_df)} trades, avg {avg_ret:+.2f}%, win rate {win_rate:.0f}%, hold {avg_hold:.1f}d, total ${total_pnl:+.2f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scaling-in backtest + candle pattern exploration")
    parser.add_argument("--asset", type=str, help="Single asset (e.g., bitcoin)")
    parser.add_argument("--days", type=int, default=730, help="Lookback days")
    args = parser.parse_args()

    assets = {args.asset: ASSETS_HL[args.asset]} if args.asset else ASSETS_HL

    config_name = ACTIVE_CONFIG.get("name", "V9_ATR_2_0X")
    print("=" * 80)
    print(f"SCALING-IN BACKTEST + CANDLE PATTERN EXPLORATION")
    print(f"Config: {config_name}")
    print(f"Assets: {', '.join(assets.keys())}")
    print(f"Lookback: {args.days} days | Position: ${POSITION_SIZE_USD} | Add: {ADD_SIZE_FRACTION*100:.0f}%")
    print("=" * 80)

    all_trades = []
    all_dfs = {}

    # Fetch BTC first for altcoin crash filtering
    btc_df = None
    if "bitcoin" in assets or len(assets) > 1:
        print(f"\n{'─' * 40}")
        print(f"Fetching bitcoin (for crash filter)...")
        try:
            btc_df = fetch_ohlc("bitcoin", args.days)
            if btc_df is not None and len(btc_df) >= 50:
                btc_df = calculate_indicators(btc_df, ACTIVE_CONFIG)
                btc_df = generate_signals(btc_df, ACTIVE_CONFIG)
                print(f"  Got {len(btc_df)} candles")
            else:
                print(f"  ❌ Insufficient BTC data")
                btc_df = None
        except Exception as e:
            print(f"  ❌ Failed to fetch BTC: {e}")
        time.sleep(2)

    for cg_id, hl_sym in assets.items():
        print(f"\n{'─' * 40}")
        print(f"Fetching {cg_id} ({hl_sym})...")

        is_btc = cg_id == "bitcoin"

        if is_btc and btc_df is not None:
            df = btc_df
            print(f"  Using pre-fetched BTC data ({len(df)} candles)")
        else:
            try:
                df = fetch_ohlc(cg_id, args.days)
            except Exception as e:
                print(f"  ❌ Failed to fetch: {e}")
                continue

            if df is None or len(df) < 50:
                print(f"  ❌ Insufficient data ({len(df) if df is not None else 0} rows)")
                continue

            print(f"  Got {len(df)} candles")
            df = calculate_indicators(df, ACTIVE_CONFIG)
            df = generate_signals(df, ACTIVE_CONFIG)

        # Use simulate_trades for proper signal persistence + stop-losses
        trades = simulate_trades(
            df, POSITION_SIZE_USD, ACTIVE_CONFIG,
            btc_df=btc_df if not is_btc else None,
            is_btc=is_btc,
        )
        trades = enrich_trades_with_idx(df, trades)

        # Tag with asset name
        for t in trades:
            t["asset"] = cg_id

        long_count = sum(1 for t in trades if t["direction"] == "long")
        short_count = sum(1 for t in trades if t["direction"] == "short")
        avg_hold = np.mean([t["hold_days"] for t in trades]) if trades else 0
        print(f"  Found {len(trades)} trades ({long_count} long, {short_count} short, avg hold {avg_hold:.1f}d)")

        all_trades.extend(trades)
        all_dfs[cg_id] = df

        if not is_btc:
            time.sleep(2)

    if not all_trades:
        print("\n❌ No trades found.")
        return

    print(f"\n{'=' * 80}")
    print(f"TOTAL: {len(all_trades)} trades across {len(all_dfs)} assets")
    base_pnl = sum(t["pnl_usd"] for t in all_trades)
    base_wins = sum(1 for t in all_trades if t["pnl_usd"] > 0)
    print(f"Baseline: ${base_pnl:+.2f} total P&L, {base_wins}/{len(all_trades)} wins")
    print(f"{'=' * 80}")

    def run_o1(label: str, **kwargs) -> list[dict]:
        """Run Option 1 simulation across all assets with given params."""
        combined = []
        for cg_id, df_asset in all_dfs.items():
            asset_trades = [t for t in all_trades if t["asset"] == cg_id]
            combined.extend(simulate_option1(df_asset, asset_trades, **kwargs))
        return combined

    def summarize_o1(label: str, results: list[dict], show_detail: bool = False):
        """Print a compact summary of an Option 1 run."""
        rdf = pd.DataFrame(results)
        total_trades = len(rdf)
        adds = rdf[rdf["add_triggered"]]
        n_adds = len(adds)
        base_total = rdf["base_pnl_usd"].sum()
        scaled_total = rdf["scaled_pnl_usd"].sum()
        delta = scaled_total - base_total
        scaled_wins = (rdf["scaled_pnl_usd"] > 0).sum()
        bad_adds = len(adds[adds["improvement_usd"] < 0]) if n_adds > 0 else 0

        print(f"  {label:<55} adds:{n_adds:>3}/{total_trades}  base:${base_total:>8.2f}  scaled:${scaled_total:>8.2f}  delta:${delta:>+8.2f}  wins:{scaled_wins}/{total_trades}  bad_adds:{bad_adds}/{n_adds}")

        if show_detail and n_adds > 0:
            # Per-type breakdown
            for atype in sorted(adds["add_type"].unique()):
                type_adds = adds[adds["add_type"] == atype]
                avg_imp = type_adds["improvement_usd"].mean()
                n_bad = len(type_adds[type_adds["improvement_usd"] < 0])
                print(f"    {atype:<25} {len(type_adds):>3} adds, avg imp: ${avg_imp:>+7.2f}, bad: {n_bad}/{len(type_adds)}")
            # Per-asset breakdown
            for asset in sorted(rdf["asset"].unique()):
                adf = rdf[rdf["asset"] == asset]
                a_adds = adf[adf["add_triggered"]]
                a_base = adf["base_pnl_usd"].sum()
                a_scaled = adf["scaled_pnl_usd"].sum()
                print(f"    {asset:<25} {len(adf):>3} trades, base:${a_base:>+8.2f} scaled:${a_scaled:>+8.2f} delta:${a_scaled-a_base:>+8.2f} ({len(a_adds)} adds)")

    # =========================================================================
    # SECTION A: Winners-only gate
    # =========================================================================
    print(f"\n{'=' * 80}")
    print("OPTION 1A: ALL TRADES vs WINNERS-ONLY GATE")
    print("(Pullback recovery + RSI bounce + volume spike, default thresholds)")
    print(f"{'=' * 80}\n")

    r_all = run_o1("all_types_all_trades")
    r_winners = run_o1("all_types_winners_only", only_winners=True)
    summarize_o1("All trades (baseline adds)", r_all, show_detail=True)
    summarize_o1("Winners-only gate", r_winners, show_detail=True)

    # =========================================================================
    # SECTION B: No volume spike (pullback + RSI only)
    # =========================================================================
    print(f"\n{'=' * 80}")
    print("OPTION 1B: PULLBACK + RSI ONLY (no volume spike)")
    print(f"{'=' * 80}\n")

    r_no_vol = run_o1("no_vol_all", allowed_types=["pullback_recovery", "rsi_bounce"])
    r_no_vol_win = run_o1("no_vol_winners", allowed_types=["pullback_recovery", "rsi_bounce"], only_winners=True)
    summarize_o1("Pullback+RSI, all trades", r_no_vol, show_detail=True)
    summarize_o1("Pullback+RSI, winners only", r_no_vol_win, show_detail=True)

    # =========================================================================
    # SECTION C: RSI dip threshold sweep (10, 15, 20 points)
    # =========================================================================
    print(f"\n{'=' * 80}")
    print("OPTION 1C: RSI DIP THRESHOLD SWEEP (pullback+RSI, all trades)")
    print(f"{'=' * 80}\n")

    for rsi_thresh in [8, 10, 15, 20]:
        r = run_o1(f"rsi_dip_{rsi_thresh}", allowed_types=["pullback_recovery", "rsi_bounce"], rsi_dip=rsi_thresh)
        summarize_o1(f"RSI dip >= {rsi_thresh} pts", r)

    print()
    print("  With winners-only gate:")
    for rsi_thresh in [8, 10, 15, 20]:
        r = run_o1(f"rsi_dip_{rsi_thresh}_win", allowed_types=["pullback_recovery", "rsi_bounce"], rsi_dip=rsi_thresh, only_winners=True)
        summarize_o1(f"RSI dip >= {rsi_thresh} pts (winners)", r)

    # =========================================================================
    # SECTION D: Price pullback threshold sweep (2%, 2.5%, 3%, 4%, 5%)
    # =========================================================================
    print(f"\n{'=' * 80}")
    print("OPTION 1D: PRICE PULLBACK THRESHOLD SWEEP (pullback+RSI, all trades)")
    print(f"{'=' * 80}\n")

    for pb_thresh in [2.0, 2.5, 3.0, 4.0, 5.0]:
        r = run_o1(f"pb_{pb_thresh}", allowed_types=["pullback_recovery", "rsi_bounce"], price_dip_pct=pb_thresh)
        summarize_o1(f"Pullback >= {pb_thresh}%", r)

    print()
    print("  With winners-only gate:")
    for pb_thresh in [2.0, 2.5, 3.0, 4.0, 5.0]:
        r = run_o1(f"pb_{pb_thresh}_win", allowed_types=["pullback_recovery", "rsi_bounce"], price_dip_pct=pb_thresh, only_winners=True)
        summarize_o1(f"Pullback >= {pb_thresh}% (winners)", r)

    # =========================================================================
    # SECTION E: Best combo (from visual inspection of above)
    # =========================================================================
    print(f"\n{'=' * 80}")
    print("OPTION 1E: COMBINED SWEEP — RSI x PULLBACK (winners-only, no vol spike)")
    print(f"{'=' * 80}\n")

    for rsi_thresh in [8, 10, 15]:
        for pb_thresh in [2.0, 3.0, 4.0, 5.0]:
            r = run_o1(f"rsi{rsi_thresh}_pb{pb_thresh}_win",
                       allowed_types=["pullback_recovery", "rsi_bounce"],
                       only_winners=True, rsi_dip=rsi_thresh, price_dip_pct=pb_thresh)
            summarize_o1(f"RSI>={rsi_thresh} + PB>={pb_thresh}% (winners)", r)

    print(f"\n{'=' * 80}")
    print("DONE")
    print(f"{'=' * 80}")


if __name__ == "__main__":
    main()
