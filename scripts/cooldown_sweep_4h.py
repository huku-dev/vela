#!/usr/bin/env python3
"""
cooldown_sweep_4h.py — EMA cooldown parameter sweep on 4H bars.
================================================================
Tests 10 cooldown durations (0h to 96h) on PROD_ACTUAL config using
real 4H candle data from Hyperliquid. Position-level metrics with
cooldown-blocked trade analysis.

Usage:
    python scripts/cooldown_sweep_4h.py
"""

import sys
import os
import time
import copy
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
    PROD_ACTUAL,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    POSITION_SIZE_USD,
)

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ASSETS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
    "solana": "SOL",
}

DAYS = 730
POSITION_SIZE = 1000

# Cooldown values: (label, real_hours, bar_count_on_4h)
COOLDOWNS = [
    ("0h",  0,  0),
    ("8h",  8,  2),
    ("12h", 12, 3),
    ("16h", 16, 4),
    ("24h", 24, 6),
    ("32h", 32, 8),
    ("36h", 36, 9),
    ("48h", 48, 12),
    ("72h", 72, 18),
    ("96h", 96, 24),
]

PRODUCTION_BARS = 6  # 24h = 6 bars (current production)


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
# 2. Position-level grouping
# ---------------------------------------------------------------------------

def group_into_positions(trades: list[dict]) -> list[dict]:
    """
    Group trades into positions. A position is a main trade (long/short)
    plus its associated trims (matched by entry_date + entry_price).
    BB2 trades are their own positions.

    Returns list of position dicts with:
      direction, entry_date, entry_price, exit_date, pnl_usd, trim_count, trim_pnl
    """
    positions = []
    # Index trims by (entry_date, entry_price) for matching
    trims_by_key: dict[tuple, list[dict]] = {}
    main_trades = []

    for t in trades:
        direction = t.get("direction", "")
        if direction == "trim":
            key = (t.get("entry_date"), t.get("entry_price"))
            trims_by_key.setdefault(key, []).append(t)
        elif direction in ("long", "short"):
            main_trades.append(t)
        elif direction.startswith("bb2_"):
            # BB2 trades are standalone positions
            positions.append({
                "direction": direction,
                "entry_date": t.get("entry_date"),
                "entry_price": t.get("entry_price"),
                "exit_date": t.get("exit_date"),
                "close_pnl": t.get("pnl_usd", 0),
                "trim_count": 0,
                "trim_pnl": 0,
                "total_pnl": t.get("pnl_usd", 0),
                "is_bb2": True,
            })

    for t in main_trades:
        key = (t.get("entry_date"), t.get("entry_price"))
        matched_trims = trims_by_key.get(key, [])
        trim_pnl = sum(tr.get("pnl_usd", 0) for tr in matched_trims)
        close_pnl = t.get("pnl_usd", 0)
        positions.append({
            "direction": t["direction"],
            "entry_date": t.get("entry_date"),
            "entry_price": t.get("entry_price"),
            "exit_date": t.get("exit_date"),
            "close_pnl": close_pnl,
            "trim_count": len(matched_trims),
            "trim_pnl": trim_pnl,
            "total_pnl": close_pnl + trim_pnl,
            "is_bb2": False,
        })

    return positions


def compute_position_metrics(positions: list[dict]) -> dict:
    """Compute position-level metrics."""
    if not positions:
        return {
            "positions": 0, "win_pct": 0.0, "total_pnl": 0.0,
            "avg_pnl": 0.0, "max_dd": 0.0,
            "bb2_count": 0, "bb2_pnl": 0.0,
            "main_count": 0, "main_pnl": 0.0,
        }

    bb2_positions = [p for p in positions if p["is_bb2"]]
    main_positions = [p for p in positions if not p["is_bb2"]]

    all_pnls = [p["total_pnl"] for p in positions]
    total_pnl = sum(all_pnls)
    wins = sum(1 for pnl in all_pnls if pnl > 0)
    win_pct = wins / len(positions) * 100 if positions else 0

    # Max drawdown on cumulative position P&L
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for pnl in all_pnls:
        cumulative += pnl
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    return {
        "positions": len(positions),
        "win_pct": round(win_pct, 1),
        "total_pnl": round(total_pnl, 2),
        "avg_pnl": round(total_pnl / len(positions), 2) if positions else 0.0,
        "max_dd": round(max_dd, 2),
        "bb2_count": len(bb2_positions),
        "bb2_pnl": round(sum(p["total_pnl"] for p in bb2_positions), 2),
        "main_count": len(main_positions),
        "main_pnl": round(sum(p["total_pnl"] for p in main_positions), 2),
    }


# ---------------------------------------------------------------------------
# 3. Cooldown-blocked trade analysis
# ---------------------------------------------------------------------------

def find_blocked_entries(trades_no_cooldown: list[dict], trades_with_cooldown: list[dict]) -> list[dict]:
    """
    Find trades that exist in the no-cooldown run but not in the cooldown run.
    Match by (direction, entry_date, entry_price) for main trades.
    Returns the no-cooldown trades that were blocked.
    """
    # Build set of (direction, entry_date) from cooldown run
    cooldown_entries = set()
    for t in trades_with_cooldown:
        d = t.get("direction", "")
        if d in ("long", "short"):
            cooldown_entries.add((d, t.get("entry_date")))

    blocked = []
    for t in trades_no_cooldown:
        d = t.get("direction", "")
        if d in ("long", "short"):
            key = (d, t.get("entry_date"))
            if key not in cooldown_entries:
                blocked.append(t)

    return blocked


# ---------------------------------------------------------------------------
# 4. Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 80)
    print("  EMA Cooldown Parameter Sweep — 4H Bars")
    print("  PROD_ACTUAL config, 730 days, $1000 position size")
    print("=" * 80)

    # ── Fetch 4H candle data ──
    print("\n[1/4] Fetching 4H candle data from Hyperliquid...")
    raw_data: dict[str, pd.DataFrame] = {}
    for cg_id, symbol in ASSETS.items():
        raw_data[cg_id] = fetch_4h_ohlc(cg_id, DAYS)
        time.sleep(2)

    # ── Prepare indicator DataFrames per asset per cooldown ──
    print("\n[2/4] Running indicator calculations + signal generation...")

    # Pre-calculate BTC indicators for crash filter (same across cooldowns)
    btc_indicators = calculate_indicators(raw_data["bitcoin"], PROD_ACTUAL)
    btc_df_signals = generate_signals(btc_indicators, PROD_ACTUAL)

    # Store results: cooldown_label -> { asset -> trades }
    all_results: dict[str, dict[str, list[dict]]] = {}
    # Store no-cooldown trades for blocked analysis
    no_cooldown_trades: dict[str, list[dict]] = {}

    for label, hours, bars in COOLDOWNS:
        config = copy.deepcopy(PROD_ACTUAL)
        config["ema_cooldown_bars"] = bars
        config["name"] = f"Cooldown {label} ({bars} bars)"

        asset_trades: dict[str, list[dict]] = {}

        for cg_id, symbol in ASSETS.items():
            df = raw_data[cg_id].copy()
            df = calculate_indicators(df, config)
            df = generate_signals(df, config)

            is_btc = (cg_id == "bitcoin")
            trades = simulate_trades(
                df,
                position_size=POSITION_SIZE,
                config=config,
                btc_df=btc_df_signals if not is_btc else None,
                is_btc=is_btc,
            )
            asset_trades[symbol] = trades

        all_results[label] = asset_trades

        if bars == 0:
            no_cooldown_trades = {sym: list(t_list) for sym, t_list in asset_trades.items()}

        total_trades = sum(len(t) for t in asset_trades.values())
        total_pnl = sum(sum(t.get("pnl_usd", 0) for t in trades) for trades in asset_trades.values())
        print(f"  {label:>4s} ({bars:2d} bars): {total_trades:4d} trades, P&L ${total_pnl:+,.0f}")

    # ── Compute position-level metrics ──
    print("\n[3/4] Computing position-level metrics...")

    # Find the 24h baseline P&L for delta computation
    baseline_label = "24h"
    baseline_pnl = 0.0

    results_table = []

    for label, hours, bars in COOLDOWNS:
        asset_trades = all_results[label]

        # Combine all trades across assets
        combined_trades = []
        for sym, trades in asset_trades.items():
            for t in trades:
                combined_trades.append({**t, "_asset": sym})

        # Sort by entry_date for proper cumulative P&L tracking
        combined_trades.sort(key=lambda t: t.get("entry_date", ""))

        positions = group_into_positions(combined_trades)
        metrics = compute_position_metrics(positions)

        # Count total trades (not positions)
        total_trade_count = len(combined_trades)

        # Blocked trade analysis
        if bars == 0:
            blocked_count = 0
            blocked_pnl = 0.0
        else:
            blocked_all = []
            for sym in ASSETS.values():
                nc_trades = no_cooldown_trades.get(sym, [])
                cd_trades = asset_trades.get(sym, [])
                blocked = find_blocked_entries(nc_trades, cd_trades)
                blocked_all.extend(blocked)
            blocked_count = len(blocked_all)
            blocked_pnl = sum(t.get("pnl_usd", 0) for t in blocked_all)

        row = {
            "label": label,
            "hours": hours,
            "bars": bars,
            "positions": metrics["positions"],
            "win_pct": metrics["win_pct"],
            "total_pnl": metrics["total_pnl"],
            "avg_pnl": metrics["avg_pnl"],
            "max_dd": metrics["max_dd"],
            "bb2_count": metrics["bb2_count"],
            "bb2_pnl": metrics["bb2_pnl"],
            "main_count": metrics["main_count"],
            "main_pnl": metrics["main_pnl"],
            "trades": total_trade_count,
            "blocked_count": blocked_count,
            "blocked_pnl": round(blocked_pnl, 2),
        }

        if label == baseline_label:
            baseline_pnl = metrics["total_pnl"]

        results_table.append(row)

    # Add delta vs 24h
    for row in results_table:
        row["delta_vs_24h"] = round(row["total_pnl"] - baseline_pnl, 2)

    # ── Output ──
    print("\n[4/4] Results\n")
    print("=" * 130)
    print("  MAIN COMPARISON TABLE — Sorted by cooldown duration")
    print("  Config: PROD_ACTUAL (fixed 8% stop, trailing 5%/2.5%, no grace period)")
    print("  Data: 4H bars, 730 days, BTC+ETH+HYPE+SOL, $1000 positions")
    print("=" * 130)

    header = (
        f"  {'Cooldown':>8s} | {'Bars':>4s} | {'Pos':>5s} | {'Win%':>5s} | "
        f"{'Total P&L':>10s} | {'Avg P&L':>8s} | {'MaxDD':>8s} | "
        f"{'BB2#':>4s} | {'BB2 P&L':>8s} | {'Delta 24h':>10s} | "
        f"{'Blocked':>7s} | {'Blk P&L':>8s}"
    )
    print(header)
    print("  " + "-" * 126)

    for row in results_table:
        marker = " <-- PROD" if row["label"] == "24h" else ""
        best_marker = ""
        # Find best total P&L
        best_pnl = max(r["total_pnl"] for r in results_table)
        if row["total_pnl"] == best_pnl:
            best_marker = " ***BEST"

        line = (
            f"  {row['label']:>8s} | {row['bars']:4d} | {row['positions']:5d} | "
            f"{row['win_pct']:5.1f} | {row['total_pnl']:+10.2f} | "
            f"{row['avg_pnl']:+8.2f} | {row['max_dd']:8.2f} | "
            f"{row['bb2_count']:4d} | {row['bb2_pnl']:+8.2f} | "
            f"{row['delta_vs_24h']:+10.2f} | "
            f"{row['blocked_count']:7d} | {row['blocked_pnl']:+8.2f}"
            f"{marker}{best_marker}"
        )
        print(line)

    # ── Per-asset breakdown for top 3 ──
    sorted_by_pnl = sorted(results_table, key=lambda r: r["total_pnl"], reverse=True)
    top_3 = sorted_by_pnl[:3]

    print("\n" + "=" * 100)
    print("  PER-ASSET BREAKDOWN — Top 3 cooldowns by total P&L")
    print("=" * 100)

    for rank, row in enumerate(top_3, 1):
        label = row["label"]
        bars = row["bars"]
        asset_trades = all_results[label]

        print(f"\n  #{rank}: Cooldown {label} ({bars} bars) — Total P&L: ${row['total_pnl']:+,.2f}")
        print(f"  {'Asset':<6s} | {'Pos':>5s} | {'Win%':>5s} | {'Total P&L':>10s} | {'Avg P&L':>8s} | {'MaxDD':>8s} | {'BB2#':>4s} | {'BB2 P&L':>8s}")
        print(f"  {'-'*6}-+-{'-'*5}-+-{'-'*5}-+-{'-'*10}-+-{'-'*8}-+-{'-'*8}-+-{'-'*4}-+-{'-'*8}")

        for sym in ["BTC", "ETH", "HYPE", "SOL"]:
            trades = asset_trades.get(sym, [])
            positions = group_into_positions(trades)
            m = compute_position_metrics(positions)
            print(
                f"  {sym:<6s} | {m['positions']:5d} | {m['win_pct']:5.1f} | "
                f"{m['total_pnl']:+10.2f} | {m['avg_pnl']:+8.2f} | "
                f"{m['max_dd']:8.2f} | {m['bb2_count']:4d} | {m['bb2_pnl']:+8.2f}"
            )

    # ── Blocked trade analysis ──
    print("\n" + "=" * 100)
    print("  COOLDOWN-BLOCKED TRADE ANALYSIS")
    print("  Trades that fired in the 0h (no cooldown) baseline but were suppressed")
    print("  Blocked P&L: what those trades earned in the no-cooldown run")
    print("=" * 100)

    print(f"\n  {'Cooldown':>8s} | {'Blocked':>7s} | {'Blk P&L':>10s} | {'Avg Blk':>8s} | {'Winners':>7s} | {'Losers':>7s} | {'Net Effect':>10s}")
    print(f"  {'-'*8}-+-{'-'*7}-+-{'-'*10}-+-{'-'*8}-+-{'-'*7}-+-{'-'*7}-+-{'-'*10}")

    for label, hours, bars in COOLDOWNS:
        if bars == 0:
            print(f"  {label:>8s} |     --- |        --- |      --- |     --- |     --- |        ---  (baseline)")
            continue

        asset_trades = all_results[label]
        blocked_all = []
        for sym in ASSETS.values():
            nc_trades = no_cooldown_trades.get(sym, [])
            cd_trades = asset_trades.get(sym, [])
            blocked = find_blocked_entries(nc_trades, cd_trades)
            blocked_all.extend(blocked)

        blocked_pnls = [t.get("pnl_usd", 0) for t in blocked_all]
        blocked_pnl = sum(blocked_pnls)
        blocked_winners = sum(1 for p in blocked_pnls if p > 0)
        blocked_losers = sum(1 for p in blocked_pnls if p <= 0)
        avg_blocked = blocked_pnl / len(blocked_all) if blocked_all else 0

        # Net effect: positive means cooldown helped (blocked trades were losers)
        # negative means cooldown hurt (blocked trades were winners)
        net_effect = -blocked_pnl  # removing negative-PnL trades is positive

        print(
            f"  {label:>8s} | {len(blocked_all):7d} | {blocked_pnl:+10.2f} | "
            f"{avg_blocked:+8.2f} | {blocked_winners:7d} | {blocked_losers:7d} | "
            f"{net_effect:+10.2f}"
        )

    # ── Recommendation ──
    print("\n" + "=" * 100)
    print("  RECOMMENDATION")
    print("=" * 100)

    best = sorted_by_pnl[0]
    prod_row = next(r for r in results_table if r["label"] == "24h")

    print(f"\n  Best overall: {best['label']} cooldown ({best['bars']} bars)")
    print(f"    Total P&L:  ${best['total_pnl']:+,.2f}")
    print(f"    Win rate:   {best['win_pct']:.1f}%")
    print(f"    Max DD:     ${best['max_dd']:,.2f}")
    print(f"    vs 24h:     ${best['delta_vs_24h']:+,.2f}")

    print(f"\n  Current production (24h / 6 bars):")
    print(f"    Total P&L:  ${prod_row['total_pnl']:+,.2f}")
    print(f"    Win rate:   {prod_row['win_pct']:.1f}%")
    print(f"    Max DD:     ${prod_row['max_dd']:,.2f}")

    # Check if best has meaningfully better risk-adjusted return
    if best["label"] != "24h":
        pnl_improvement = best["total_pnl"] - prod_row["total_pnl"]
        dd_change = best["max_dd"] - prod_row["max_dd"]
        print(f"\n  Delta: +${pnl_improvement:,.2f} P&L, {'+'if dd_change > 0 else ''}{dd_change:,.2f} max DD")

        if pnl_improvement > 50 and dd_change <= 50:
            print(f"  --> RECOMMEND switching to {best['label']} cooldown ({best['bars']} bars)")
        elif pnl_improvement > 0:
            print(f"  --> Marginal improvement. Consider {best['label']} but verify on out-of-sample data.")
        else:
            print(f"  --> Current 24h cooldown is optimal or near-optimal. No change needed.")
    else:
        print(f"\n  --> Current 24h cooldown is the best. No change needed.")

    print()


if __name__ == "__main__":
    main()
