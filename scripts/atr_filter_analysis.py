#!/usr/bin/env python3
"""
ATR Filter Analysis
====================
Analyzes the ATR > 8% entry filter across all positions from the PROD_ACTUAL
backtest config. Shows:
  1. Distribution of ATR% at entry across all positions
  2. Per-asset ATR% distribution
  3. Trades removed by ATR > 8% filter: asset, direction, entry date, P&L, exit reason
  4. Per-asset breakdown of the filter's effect
  5. Threshold sweep: 5%, 6%, 7%, 8%, 10% — trades removed and P&L impact
  6. Average ATR% for winners vs losers

Uses 730-day 4H candle data from Hyperliquid (matching production signal engine).

Usage:
    python scripts/atr_filter_analysis.py
"""

import sys
import time
from collections import defaultdict
from datetime import datetime

import pandas as pd
import requests

# Import from the backtest engine
from backtest import (
    PROD_ACTUAL,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    ASSETS_HL,
    HYPERLIQUID_INFO_URL,
    POSITION_SIZE_USD,
)

HL_SLEEP_SECONDS = 2
DAYS = 730


# ---------------------------------------------------------------------------
# Data fetching (4H candles)
# ---------------------------------------------------------------------------

def fetch_4h_ohlc(coingecko_id: str, days: int = 730) -> pd.DataFrame:
    """Fetch 4H OHLC data from Hyperliquid."""
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(f"No Hyperliquid symbol for '{coingecko_id}'")

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of 4H candles for '{symbol}' from Hyperliquid...")

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
                    raise RuntimeError(f"Hyperliquid API failed: {e}")
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
    df["date"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True)
    df = df.drop_duplicates(subset="date", keep="last")
    df = df.set_index("date").sort_index()
    df = df.drop(columns=["timestamp_ms"])

    print(f"  Got {len(df)} 4H candles ({df.index[0]} to {df.index[-1]})")
    return df


# ---------------------------------------------------------------------------
# Position grouping: main trade + trims -> position-level P&L
# ---------------------------------------------------------------------------

def group_into_positions(trades: list[dict]) -> list[dict]:
    """
    Group trades into positions. A position is a main entry (long/short) plus
    all its associated trims, ladder trims, pullback re-entries, and the final
    close. Returns one record per position with aggregated P&L.
    """
    positions = []
    current_pos = None

    for t in trades:
        direction = t.get("direction", "")
        status = t.get("status", "")

        # BB2 trades are separate positions
        if t.get("position_type") in ("bb2", "bb2_30m"):
            # BB2 is its own position
            positions.append({
                "asset": t.get("asset", "unknown"),
                "direction": direction,
                "position_type": "bb2",
                "entry_date": t.get("entry_date", ""),
                "entry_price": t.get("entry_price", 0),
                "exit_date": t.get("exit_date", ""),
                "exit_reason": t.get("exit_signal_reason", ""),
                "pnl_usd": t.get("pnl_usd", 0),
                "pnl_pct": t.get("pnl_pct", 0),
                "entry_atr_pct": t.get("entry_atr_pct", float("nan")),
                "trades": [t],
            })
            continue

        # Trim and re-entry trades belong to the current position
        if direction in ("trim", "pullback_reentry"):
            if current_pos is not None:
                current_pos["trades"].append(t)
                current_pos["pnl_usd"] += t.get("pnl_usd", 0)
            continue

        # Main trade (long or short)
        if direction in ("long", "short"):
            if status == "closed":
                # Standalone closed trade — if we have an open position, close it first
                if current_pos is not None:
                    positions.append(current_pos)
                    current_pos = None

                # This is a new position that opened and closed
                positions.append({
                    "asset": t.get("asset", "unknown"),
                    "direction": direction,
                    "position_type": t.get("position_type", "main"),
                    "entry_date": t.get("entry_date", ""),
                    "entry_price": t.get("entry_price", 0),
                    "exit_date": t.get("exit_date", ""),
                    "exit_reason": t.get("exit_signal_reason", ""),
                    "pnl_usd": t.get("pnl_usd", 0),
                    "pnl_pct": t.get("pnl_pct", 0),
                    "entry_atr_pct": t.get("entry_atr_pct", float("nan")),
                    "trades": [t],
                })
            elif status == "open":
                # Start tracking a new open position
                if current_pos is not None:
                    positions.append(current_pos)
                current_pos = {
                    "asset": t.get("asset", "unknown"),
                    "direction": direction,
                    "position_type": t.get("position_type", "main"),
                    "entry_date": t.get("entry_date", ""),
                    "entry_price": t.get("entry_price", 0),
                    "exit_date": "",
                    "exit_reason": "",
                    "pnl_usd": t.get("pnl_usd", 0),
                    "pnl_pct": t.get("pnl_pct", 0),
                    "entry_atr_pct": t.get("entry_atr_pct", float("nan")),
                    "trades": [t],
                }

    # Don't forget the last open position
    if current_pos is not None:
        positions.append(current_pos)

    return positions


# ---------------------------------------------------------------------------
# Analysis helpers
# ---------------------------------------------------------------------------

def percentile_str(values: list[float], pcts: list[int] = [10, 25, 50, 75, 90]) -> str:
    if not values:
        return "no data"
    s = pd.Series(values)
    parts = [f"p{p}={s.quantile(p/100):.2f}%" for p in pcts]
    return f"  min={s.min():.2f}%  " + "  ".join(parts) + f"  max={s.max():.2f}%"


def main():
    print(f"\n{'='*80}")
    print(f"  ATR FILTER ANALYSIS")
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Config: PROD_ACTUAL (fixed 8% stop, no grace)")
    print(f"  Assets: {', '.join(ASSETS_HL.values())}")
    print(f"  Lookback: {DAYS} days (4H candles)")
    print(f"  Position size: ${POSITION_SIZE_USD}")
    print(f"{'='*80}\n")

    # ── Step 1: Fetch data for all assets ──
    asset_data = {}
    btc_df = None

    for cg_id, symbol in ASSETS_HL.items():
        try:
            df = fetch_4h_ohlc(cg_id, days=DAYS)
            df = calculate_indicators(df, config=PROD_ACTUAL)
            asset_data[cg_id] = df
            if cg_id == "bitcoin":
                btc_df = df
        except Exception as e:
            print(f"  ERROR fetching {symbol}: {e}")
        time.sleep(HL_SLEEP_SECONDS)

    if not asset_data:
        print("ERROR: No data fetched. Exiting.")
        sys.exit(1)

    # ── Step 2: Run PROD_ACTUAL and collect all trades ──
    all_positions = []

    for cg_id, df in asset_data.items():
        symbol = ASSETS_HL[cg_id]
        is_btc = cg_id == "bitcoin"
        this_btc_df = None if is_btc else btc_df

        trades = simulate_trades(
            df,
            config=PROD_ACTUAL,
            btc_df=this_btc_df,
            is_btc=is_btc,
        )

        # Tag trades with asset
        for t in trades:
            t["asset"] = symbol

        positions = group_into_positions(trades)
        all_positions.extend(positions)

    # Filter to closed main positions only (skip open and bb2)
    closed_positions = [
        p for p in all_positions
        if p.get("exit_date")
        and p.get("position_type", "main") == "main"
    ]

    # Also include bb2 positions for completeness
    closed_bb2 = [
        p for p in all_positions
        if p.get("exit_date")
        and p.get("position_type") == "bb2"
    ]

    all_closed = closed_positions + closed_bb2

    print(f"\n  Total closed positions: {len(all_closed)} (main: {len(closed_positions)}, bb2: {len(closed_bb2)})")

    # Extract ATR% at entry for all positions
    atr_values = []
    for p in all_closed:
        atr = p.get("entry_atr_pct", float("nan"))
        if pd.notna(atr):
            atr_values.append(atr)

    print(f"  Positions with valid ATR at entry: {len(atr_values)} / {len(all_closed)}")

    # ── SECTION 1: Distribution of ATR% at entry ──
    print(f"\n{'='*80}")
    print(f"  1. DISTRIBUTION OF ATR% AT ENTRY (all positions)")
    print(f"{'='*80}")
    print(f"  {percentile_str(atr_values)}")
    print(f"  Mean: {pd.Series(atr_values).mean():.2f}%  Std: {pd.Series(atr_values).std():.2f}%")

    # Histogram buckets
    buckets = [(0, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 10), (10, 15), (15, 100)]
    print(f"\n  ATR% bucket   | Count | % of total")
    print(f"  {'-'*45}")
    for lo, hi in buckets:
        count = sum(1 for v in atr_values if lo <= v < hi)
        pct = count / len(atr_values) * 100 if atr_values else 0
        bar = "#" * int(pct / 2)
        label = f"{lo}-{hi}%" if hi < 100 else f"{lo}%+"
        print(f"  {label:>8s}      | {count:>5d} | {pct:>5.1f}%  {bar}")

    # ── SECTION 2: Per-asset ATR% distribution ──
    print(f"\n{'='*80}")
    print(f"  2. PER-ASSET ATR% DISTRIBUTION")
    print(f"{'='*80}")

    asset_atrs = defaultdict(list)
    for p in all_closed:
        atr = p.get("entry_atr_pct", float("nan"))
        if pd.notna(atr):
            asset_atrs[p["asset"]].append(atr)

    for asset in sorted(asset_atrs.keys()):
        vals = asset_atrs[asset]
        s = pd.Series(vals)
        above_8 = sum(1 for v in vals if v > 8)
        print(f"\n  {asset} ({len(vals)} positions):")
        print(f"    Mean: {s.mean():.2f}%  Median: {s.median():.2f}%  Std: {s.std():.2f}%")
        print(f"    {percentile_str(vals)}")
        print(f"    Above 8%: {above_8} ({above_8/len(vals)*100:.1f}%)")

    # ── SECTION 3: Trades removed by ATR > 8% filter ──
    print(f"\n{'='*80}")
    print(f"  3. TRADES REMOVED BY ATR > 8% FILTER")
    print(f"{'='*80}")

    removed = [p for p in all_closed if pd.notna(p.get("entry_atr_pct", float("nan"))) and p["entry_atr_pct"] > 8]
    kept = [p for p in all_closed if pd.notna(p.get("entry_atr_pct", float("nan"))) and p["entry_atr_pct"] <= 8]
    no_atr = [p for p in all_closed if pd.isna(p.get("entry_atr_pct", float("nan")))]

    print(f"\n  Removed: {len(removed)} | Kept: {len(kept)} | No ATR data: {len(no_atr)}")

    removed_pnl = sum(p["pnl_usd"] for p in removed)
    kept_pnl = sum(p["pnl_usd"] for p in kept)
    total_pnl = sum(p["pnl_usd"] for p in all_closed)

    print(f"  Removed P&L: ${removed_pnl:+.2f}")
    print(f"  Kept P&L:    ${kept_pnl:+.2f}")
    print(f"  Total P&L:   ${total_pnl:+.2f}")
    print(f"  Filter impact: ${-removed_pnl:+.2f} (positive = filter helps)")

    if removed:
        print(f"\n  {'Asset':>5s} {'Dir':>6s} {'Entry Date':>20s} {'ATR%':>6s} {'P&L $':>9s} {'P&L %':>7s} {'Exit Reason':<30s}")
        print(f"  {'-'*90}")
        for p in sorted(removed, key=lambda x: x["entry_date"]):
            print(
                f"  {p['asset']:>5s} {p['direction']:>6s} {p['entry_date'][:16]:>20s} "
                f"{p['entry_atr_pct']:>5.1f}% ${p['pnl_usd']:>+8.2f} {p['pnl_pct']:>+6.2f}% "
                f"{p['exit_reason']:<30s}"
            )

    # ── SECTION 4: Does ATR > 8% hold up per-asset? ──
    print(f"\n{'='*80}")
    print(f"  4. ATR > 8% FILTER — PER-ASSET BREAKDOWN")
    print(f"{'='*80}")

    for asset in sorted(asset_atrs.keys()):
        asset_removed = [p for p in removed if p["asset"] == asset]
        asset_kept = [p for p in kept if p["asset"] == asset]
        r_pnl = sum(p["pnl_usd"] for p in asset_removed)
        k_pnl = sum(p["pnl_usd"] for p in asset_kept)
        r_wins = sum(1 for p in asset_removed if p["pnl_usd"] > 0)
        r_losses = sum(1 for p in asset_removed if p["pnl_usd"] <= 0)
        print(f"\n  {asset}:")
        print(f"    Removed: {len(asset_removed)} trades ({r_wins}W / {r_losses}L), P&L ${r_pnl:+.2f}")
        print(f"    Kept:    {len(asset_kept)} trades, P&L ${k_pnl:+.2f}")
        if asset_removed:
            print(f"    Filter impact: ${-r_pnl:+.2f} (positive = helps)")

    # ── SECTION 5: ATR threshold sweep ──
    print(f"\n{'='*80}")
    print(f"  5. ATR THRESHOLD SWEEP (5%, 6%, 7%, 8%, 10%)")
    print(f"{'='*80}")

    thresholds = [5, 6, 7, 8, 10]
    valid_positions = [p for p in all_closed if pd.notna(p.get("entry_atr_pct", float("nan")))]
    baseline_pnl = sum(p["pnl_usd"] for p in valid_positions)
    baseline_count = len(valid_positions)
    baseline_wins = sum(1 for p in valid_positions if p["pnl_usd"] > 0)

    print(f"\n  Baseline (no filter): {baseline_count} trades, ${baseline_pnl:+.2f} P&L, "
          f"{baseline_wins}W ({baseline_wins/baseline_count*100:.1f}% win rate)")

    print(f"\n  {'Threshold':>10s} | {'Removed':>7s} | {'Removed P&L':>12s} | {'Kept':>5s} | {'Kept P&L':>10s} | {'Impact':>10s} | {'Kept Win%':>9s}")
    print(f"  {'-'*80}")

    for threshold in thresholds:
        t_removed = [p for p in valid_positions if p["entry_atr_pct"] > threshold]
        t_kept = [p for p in valid_positions if p["entry_atr_pct"] <= threshold]
        r_pnl = sum(p["pnl_usd"] for p in t_removed)
        k_pnl = sum(p["pnl_usd"] for p in t_kept)
        impact = -r_pnl  # positive = filter helps
        k_wins = sum(1 for p in t_kept if p["pnl_usd"] > 0)
        k_wr = k_wins / len(t_kept) * 100 if t_kept else 0

        r_wins = sum(1 for p in t_removed if p["pnl_usd"] > 0)
        r_wr = r_wins / len(t_removed) * 100 if t_removed else 0

        print(
            f"  ATR > {threshold}%   | {len(t_removed):>7d} | ${r_pnl:>+10.2f} | {len(t_kept):>5d} | ${k_pnl:>+9.2f} | ${impact:>+9.2f} | {k_wr:>8.1f}%"
        )

    # Per-asset threshold sweep
    print(f"\n  Per-asset impact at each threshold:")
    for asset in sorted(asset_atrs.keys()):
        asset_pos = [p for p in valid_positions if p["asset"] == asset]
        if not asset_pos:
            continue
        a_baseline = sum(p["pnl_usd"] for p in asset_pos)
        parts = [f"{asset}: base ${a_baseline:+.0f}"]
        for threshold in thresholds:
            t_removed = [p for p in asset_pos if p["entry_atr_pct"] > threshold]
            r_pnl = sum(p["pnl_usd"] for p in t_removed)
            parts.append(f">{threshold}%: {len(t_removed)}rem/${-r_pnl:+.0f}")
        print(f"    {'  |  '.join(parts)}")

    # ── SECTION 6: Average ATR% for winners vs losers ──
    print(f"\n{'='*80}")
    print(f"  6. ATR% AT ENTRY: WINNERS VS LOSERS")
    print(f"{'='*80}")

    winners = [p for p in valid_positions if p["pnl_usd"] > 0]
    losers = [p for p in valid_positions if p["pnl_usd"] <= 0]

    w_atrs = [p["entry_atr_pct"] for p in winners]
    l_atrs = [p["entry_atr_pct"] for p in losers]

    w_s = pd.Series(w_atrs) if w_atrs else pd.Series(dtype=float)
    l_s = pd.Series(l_atrs) if l_atrs else pd.Series(dtype=float)

    print(f"\n  Winners ({len(winners)} positions):")
    print(f"    Mean ATR%: {w_s.mean():.2f}%  Median: {w_s.median():.2f}%  Std: {w_s.std():.2f}%")
    print(f"    {percentile_str(w_atrs)}")

    print(f"\n  Losers ({len(losers)} positions):")
    print(f"    Mean ATR%: {l_s.mean():.2f}%  Median: {l_s.median():.2f}%  Std: {l_s.std():.2f}%")
    print(f"    {percentile_str(l_atrs)}")

    diff = l_s.mean() - w_s.mean()
    print(f"\n  Delta (losers - winners): {diff:+.2f}% ATR at entry")
    if diff > 0:
        print(f"  Losers tend to enter at HIGHER volatility (ATR filter has directional value)")
    else:
        print(f"  Losers do NOT enter at higher volatility (ATR filter may not add value)")

    # Per-asset winner/loser ATR comparison
    print(f"\n  Per-asset winner vs loser ATR%:")
    print(f"  {'Asset':>5s} | {'Win Avg':>8s} | {'Win Med':>8s} | {'Loss Avg':>8s} | {'Loss Med':>8s} | {'Delta':>7s}")
    print(f"  {'-'*55}")
    for asset in sorted(asset_atrs.keys()):
        a_w = [p["entry_atr_pct"] for p in winners if p["asset"] == asset]
        a_l = [p["entry_atr_pct"] for p in losers if p["asset"] == asset]
        if not a_w and not a_l:
            continue
        w_avg = pd.Series(a_w).mean() if a_w else 0
        w_med = pd.Series(a_w).median() if a_w else 0
        l_avg = pd.Series(a_l).mean() if a_l else 0
        l_med = pd.Series(a_l).median() if a_l else 0
        delta = l_avg - w_avg
        print(f"  {asset:>5s} | {w_avg:>7.2f}% | {w_med:>7.2f}% | {l_avg:>7.2f}% | {l_med:>7.2f}% | {delta:>+6.2f}%")

    print(f"\n{'='*80}")
    print(f"  ANALYSIS COMPLETE")
    print(f"{'='*80}\n")


if __name__ == "__main__":
    main()
