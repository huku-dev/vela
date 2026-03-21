#!/usr/bin/env python3
"""
strategy_comparison_4h.py — Compare ALL strategy configs on 4H candle data.
===========================================================================
Previous backtests ran on daily bars, making indicators 6x less reactive than
production (which runs on 4H bars). This script re-evaluates every strategy
variant on 4H data with POSITION-LEVEL metrics (grouping trims into their
parent position) to find strategies that were incorrectly rejected.

Output:
  1. Comparison table sorted by total P&L with delta vs PROD_ACTUAL
  2. Per-asset breakdown for top 3 configs

Usage:
    python scripts/strategy_comparison_4h.py
"""

import sys
import os
import time
from datetime import datetime, timezone

import pandas as pd
import numpy as np

# ---------------------------------------------------------------------------
# Import from backtest.py
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(__file__))
from backtest import (
    HYPERLIQUID_INFO_URL,
    HL_SLEEP_SECONDS,
    ASSETS_HL,
    POSITION_SIZE_USD,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    # Configs
    SIGNAL_CONFIG,
    IMPROVED_CONFIG,
    V5_BASE,
    V5A_LADDER,
    V5B_PULLBACK,
    V5D_BB_IMPROVED,
    V5E_LADDER_PULLBACK,
    V5F_FULL_SUITE,
    V6A_TRAILING_STOP,
    V6_ADOPTED,
    V6D_TRAILING_BOTH,
    V7_COOLDOWN_0,
    V7_COOLDOWN_4H,
    V7_COOLDOWN_8H,
    V7_COOLDOWN_12H,
    V7_COOLDOWN_24H,
    V7_COOLDOWN_48H,
    V9_ATR_1_3X,
    V9_ATR_1_5X,
    V9_ATR_1_75X,
    V9_ATR_2_0X,
    PROD_ACTUAL,
)

import requests

# ---------------------------------------------------------------------------
# Assets & parameters
# ---------------------------------------------------------------------------

ASSETS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
    "solana": "SOL",
}

DAYS = 730
CANDLES_PER_DAY = 6  # 24h / 4h

# All configs to compare — curated set of distinct strategies
CONFIGS_TO_TEST = [
    ("SIGNAL_CONFIG (v1)", SIGNAL_CONFIG),
    ("IMPROVED (v3)", IMPROVED_CONFIG),
    ("V5_BASE", V5_BASE),
    ("V5a Ladder", V5A_LADDER),
    ("V5b Pullback", V5B_PULLBACK),
    ("V5d BB2", V5D_BB_IMPROVED),
    ("V5e Ladder+PB", V5E_LADDER_PULLBACK),
    ("V5f Full Suite", V5F_FULL_SUITE),
    ("V6a Trail Short", V6A_TRAILING_STOP),
    ("V6 Adopted", V6_ADOPTED),
    ("V6d Trail Both", V6D_TRAILING_BOTH),
    ("V7 No Cooldown", V7_COOLDOWN_0),
    ("V7 4h CD", V7_COOLDOWN_4H),
    ("V7 8h CD", V7_COOLDOWN_8H),
    ("V7 12h CD", V7_COOLDOWN_12H),
    ("V7 24h CD", V7_COOLDOWN_24H),
    ("V7 48h CD", V7_COOLDOWN_48H),
    ("V9 ATR 1.3x", V9_ATR_1_3X),
    ("V9 ATR 1.5x", V9_ATR_1_5X),
    ("V9 ATR 1.75x", V9_ATR_1_75X),
    ("V9 ATR 2.0x", V9_ATR_2_0X),
    ("PROD_ACTUAL", PROD_ACTUAL),
]


# ---------------------------------------------------------------------------
# 1. Fetch 4H candles from Hyperliquid
# ---------------------------------------------------------------------------

def fetch_4h_ohlc(coingecko_id: str, days: int = DAYS) -> pd.DataFrame:
    """Fetch 4-hour OHLC from Hyperliquid candleSnapshot API."""
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
        time.sleep(2)

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
# 2. Position-level metrics (group trims into parent positions)
# ---------------------------------------------------------------------------

def group_into_positions(trades: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Group trades into positions. A position = a main trade (direction in
    'long', 'short') + its associated trims (matched by entry_date + entry_price).

    BB2 trades (direction starts with 'bb2_') are tracked separately.

    Returns:
        (positions, bb2_trades) where each position dict has:
          - direction: 'long' or 'short'
          - entry_date, entry_price, exit_date, exit_price
          - close_pnl: P&L from the main close
          - trim_pnl: sum of trim P&Ls
          - total_pnl: close_pnl + trim_pnl
          - trim_count: number of trims
    """
    positions = []
    bb2_trades = []

    # Separate by type
    main_trades = []
    trims = []

    for t in trades:
        d = t.get("direction", "")
        if d in ("long", "short"):
            main_trades.append(t)
        elif d == "trim":
            trims.append(t)
        elif d.startswith("bb2_"):
            bb2_trades.append(t)
        # Skip reentry, bb_long, bb_short (old BB system) — they're noise

    # Match trims to their parent position by entry_date + entry_price
    for mt in main_trades:
        key_date = mt.get("entry_date", "")
        key_price = mt.get("entry_price", 0)

        matched_trims = [
            t for t in trims
            if t.get("entry_date") == key_date
            and t.get("entry_price") == key_price
        ]

        close_pnl = mt.get("pnl_usd", 0)
        trim_pnl = sum(t.get("pnl_usd", 0) for t in matched_trims)

        positions.append({
            "direction": mt["direction"],
            "entry_date": key_date,
            "entry_price": key_price,
            "exit_date": mt.get("exit_date", ""),
            "exit_price": mt.get("exit_price", 0),
            "close_pnl": close_pnl,
            "trim_pnl": trim_pnl,
            "total_pnl": close_pnl + trim_pnl,
            "trim_count": len(matched_trims),
        })

    return positions, bb2_trades


def compute_position_metrics(trades: list[dict]) -> dict:
    """
    Compute position-level metrics from a list of raw trades.
    Groups trades into positions first, then computes stats.
    """
    positions, bb2_trades = group_into_positions(trades)

    if not positions and not bb2_trades:
        return {
            "positions": 0,
            "win_pct": 0.0,
            "total_pnl": 0.0,
            "avg_pnl": 0.0,
            "max_dd": 0.0,
            "bb2_count": 0,
            "bb2_pnl": 0.0,
            "trimmed": 0,
            "trim_pnl": 0.0,
        }

    # Position wins
    wins = sum(1 for p in positions if p["total_pnl"] > 0)
    win_pct = (wins / len(positions) * 100) if positions else 0.0

    # Total P&L = position P&Ls + BB2 P&Ls
    pos_pnl = sum(p["total_pnl"] for p in positions)
    bb2_pnl = sum(t.get("pnl_usd", 0) for t in bb2_trades)
    total_pnl = pos_pnl + bb2_pnl

    # Avg P&L per position (excluding BB2)
    avg_pnl = pos_pnl / len(positions) if positions else 0.0

    # Max drawdown on cumulative position P&L (chronological order)
    # Build timeline: positions + bb2, sorted by exit date
    all_pnl_events = []
    for p in positions:
        all_pnl_events.append((p["exit_date"] or p["entry_date"], p["total_pnl"]))
    for t in bb2_trades:
        all_pnl_events.append((t.get("exit_date", t.get("entry_date", "")), t.get("pnl_usd", 0)))
    all_pnl_events.sort(key=lambda x: x[0] or "")

    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for _, pnl in all_pnl_events:
        cumulative += pnl
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    # Trimmed positions
    trimmed = sum(1 for p in positions if p["trim_count"] > 0)
    trim_pnl = sum(p["trim_pnl"] for p in positions)

    return {
        "positions": len(positions),
        "win_pct": round(win_pct, 1),
        "total_pnl": round(total_pnl, 2),
        "avg_pnl": round(avg_pnl, 2),
        "max_dd": round(max_dd, 2),
        "bb2_count": len(bb2_trades),
        "bb2_pnl": round(bb2_pnl, 2),
        "trimmed": trimmed,
        "trim_pnl": round(trim_pnl, 2),
    }


# ---------------------------------------------------------------------------
# 3. Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 110)
    print("VELA 4H STRATEGY COMPARISON — All Configs on 4H Bars (Ground Truth)")
    print(f"Assets: {', '.join(ASSETS.values())} | Period: {DAYS} days | Position: ${POSITION_SIZE_USD}")
    print(f"Metrics: POSITION-LEVEL (trims grouped into parent, BB2 tracked separately)")
    print("=" * 110)

    # ── Fetch data ──
    print(f"\n[1/4] Fetching 4H candle data from Hyperliquid...\n")
    raw_data: dict[str, pd.DataFrame] = {}
    asset_list = list(ASSETS.items())
    for i, (cg_id, symbol) in enumerate(asset_list):
        raw_data[cg_id] = fetch_4h_ohlc(cg_id, DAYS)
        if i < len(asset_list) - 1:
            time.sleep(2)

    # ── Run all configs ──
    print(f"\n[2/4] Running {len(CONFIGS_TO_TEST)} configs across {len(ASSETS)} assets...\n")

    # Pre-compute indicators per asset (shared across configs)
    indicator_dfs: dict[str, pd.DataFrame] = {}
    for cg_id in ASSETS:
        indicator_dfs[cg_id] = calculate_indicators(raw_data[cg_id], config=CONFIGS_TO_TEST[0][1])

    # results[config_label] = {"all": all_trades, "BTC": btc_trades, ...}
    results: dict[str, dict[str, list[dict]]] = {}
    metrics: dict[str, dict] = {}

    for config_idx, (label, config) in enumerate(CONFIGS_TO_TEST):
        all_trades = []
        per_asset_trades: dict[str, list[dict]] = {}

        for cg_id, symbol in ASSETS.items():
            df_ind = indicator_dfs[cg_id]
            df_sig = generate_signals(df_ind, config=config)
            is_btc = (cg_id == "bitcoin")

            # BTC df for crash filter (use bitcoin's signal df)
            btc_sig = generate_signals(indicator_dfs["bitcoin"], config=config) if not is_btc else None

            trades = simulate_trades(
                df_sig,
                config=config,
                btc_df=btc_sig if not is_btc else None,
                is_btc=is_btc,
            )
            per_asset_trades[symbol] = trades
            all_trades.extend(trades)

        results[label] = per_asset_trades
        m = compute_position_metrics(all_trades)
        metrics[label] = m

        progress = f"[{config_idx + 1}/{len(CONFIGS_TO_TEST)}]"
        print(f"  {progress} {label:<25s} | {m['positions']:>3d} pos | ${m['total_pnl']:>+9.2f} | {m['win_pct']:>5.1f}% win | DD ${m['max_dd']:>.0f}")

    # ── Find PROD_ACTUAL baseline for delta column ──
    prod_metrics = metrics.get("PROD_ACTUAL", {})
    prod_pnl = prod_metrics.get("total_pnl", 0)

    # ── Comparison table sorted by total P&L ──
    print("\n" + "=" * 110)
    print("[3/4] COMPARISON TABLE (sorted by Total P&L, position-level metrics)")
    print("=" * 110)

    sorted_configs = sorted(metrics.items(), key=lambda x: x[1]["total_pnl"], reverse=True)

    header = (
        f"{'Config':<25s} | {'Pos':>4s} | {'Win%':>5s} | {'Total P&L':>10s} | {'Avg P&L':>8s} | "
        f"{'MaxDD':>8s} | {'BB2#':>4s} | {'BB2 P&L':>8s} | {'Trim#':>5s} | {'Trim P&L':>9s} | {'vs PROD':>9s}"
    )
    print(header)
    print("-" * len(header))

    for label, m in sorted_configs:
        delta = m["total_pnl"] - prod_pnl
        delta_str = f"${delta:>+8.2f}" if label != "PROD_ACTUAL" else "baseline"

        marker = " <-- PROD" if label == "PROD_ACTUAL" else ""
        print(
            f"{label:<25s} | {m['positions']:>4d} | {m['win_pct']:>5.1f} | "
            f"${m['total_pnl']:>+9.2f} | ${m['avg_pnl']:>+7.2f} | "
            f"${m['max_dd']:>7.2f} | {m['bb2_count']:>4d} | ${m['bb2_pnl']:>+7.2f} | "
            f"{m['trimmed']:>5d} | ${m['trim_pnl']:>+8.2f} | {delta_str}{marker}"
        )

    # ── Per-asset breakdown for top 3 ──
    print("\n" + "=" * 110)
    print("[4/4] PER-ASSET BREAKDOWN — Top 3 Configs")
    print("=" * 110)

    top_3_labels = [label for label, _ in sorted_configs[:3]]

    for rank, label in enumerate(top_3_labels, 1):
        per_asset = results[label]
        print(f"\n  #{rank}: {label}")
        print(f"  {'Asset':<6s} | {'Pos':>4s} | {'Win%':>5s} | {'Total P&L':>10s} | {'Avg P&L':>8s} | {'MaxDD':>8s} | {'BB2#':>4s} | {'BB2 P&L':>8s} | {'Trim#':>5s} | {'Trim P&L':>9s}")
        print(f"  {'-'*6}-+-{'-'*4}-+-{'-'*5}-+-{'-'*10}-+-{'-'*8}-+-{'-'*8}-+-{'-'*4}-+-{'-'*8}-+-{'-'*5}-+-{'-'*9}")

        for symbol in ASSETS.values():
            trades = per_asset.get(symbol, [])
            m = compute_position_metrics(trades)
            print(
                f"  {symbol:<6s} | {m['positions']:>4d} | {m['win_pct']:>5.1f} | "
                f"${m['total_pnl']:>+9.2f} | ${m['avg_pnl']:>+7.2f} | "
                f"${m['max_dd']:>7.2f} | {m['bb2_count']:>4d} | ${m['bb2_pnl']:>+7.2f} | "
                f"{m['trimmed']:>5d} | ${m['trim_pnl']:>+8.2f}"
            )

    # ── Summary ──
    print("\n" + "=" * 110)
    best_label, best_m = sorted_configs[0]
    worst_label, worst_m = sorted_configs[-1]
    print(f"BEST:  {best_label} — ${best_m['total_pnl']:+.2f} (delta vs PROD: ${best_m['total_pnl'] - prod_pnl:+.2f})")
    print(f"WORST: {worst_label} — ${worst_m['total_pnl']:+.2f} (delta vs PROD: ${worst_m['total_pnl'] - prod_pnl:+.2f})")
    print(f"PROD:  PROD_ACTUAL — ${prod_pnl:+.2f}")
    print("=" * 110)


if __name__ == "__main__":
    main()
