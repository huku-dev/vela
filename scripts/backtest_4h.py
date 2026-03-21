#!/usr/bin/env python3
"""
backtest_4h.py — Ground-truth backtest on 4H candle data from Hyperliquid.
==========================================================================
Production runs on 4H bars, so this is the authoritative backtest.
Previous daily-bar results are unreliable because indicator periods (EMA-9,
EMA-21, RSI-14, etc.) operate on BARS, not calendar time. On 4H bars,
EMA-9 = 36 hours of lookback — matching what production actually computes.

Configs tested:
  A) PROD_ACTUAL baseline (fixed 8% stop, trailing 5%/2.5%, no grace)
  B) PROD_ACTUAL + trailing_stop_delay_bars=42 (7-day delay)
  C) PROD_ACTUAL + trailing_stop_delay_bars=18 (3-day delay)
  D) PROD_ACTUAL + no trailing stop at all

Usage:
    python scripts/backtest_4h.py
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
    PROD_ACTUAL,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    POSITION_SIZE_USD,
)

# Assets to backtest (CoinGecko ID -> display name)
ASSETS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
    "solana": "SOL",
}

DAYS = 730
CANDLES_REQUESTED = DAYS * 6  # 4380 — fits in one HL request (< 5000)

# Daily baseline reference (from PROD_ACTUAL on daily bars)
DAILY_REF = {"main_trades": 97, "pnl_usd": 790, "win_rate": 52.6}


# ---------------------------------------------------------------------------
# 1. Fetch 4H candles from Hyperliquid
# ---------------------------------------------------------------------------

def fetch_4h_ohlc(coingecko_id: str, days: int = DAYS) -> pd.DataFrame:
    """
    Fetch 4-hour OHLC data from Hyperliquid's candleSnapshot API.
    Max 5,000 candles per request. 730 days * 6 = 4,380 (fits in one request).
    """
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(f"No Hyperliquid symbol for '{coingecko_id}'")

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days}d of 4H candles for {symbol}...")

    import requests
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
# 2. Configs
# ---------------------------------------------------------------------------

def build_configs() -> list[tuple[str, dict]]:
    """Return (label, config) tuples for the 4 test variants."""
    # A) PROD_ACTUAL baseline
    config_a = {**PROD_ACTUAL, "name": "A) PROD_ACTUAL baseline"}

    # B) + trailing_stop_delay_bars=42 (7 days * 6 bars/day)
    config_b = {
        **PROD_ACTUAL,
        "name": "B) + trail delay 42 bars (7d)",
        "trailing_stop_delay_bars": 42,
    }

    # C) + trailing_stop_delay_bars=18 (3 days * 6 bars/day)
    config_c = {
        **PROD_ACTUAL,
        "name": "C) + trail delay 18 bars (3d)",
        "trailing_stop_delay_bars": 18,
    }

    # D) No trailing stop at all
    config_d = {
        **PROD_ACTUAL,
        "name": "D) No trailing stop",
        "trailing_stop_delay_bars": 0,
        "trailing_stop_short": False,
        "trailing_stop_long": False,
    }

    return [
        ("A) PROD_ACTUAL", config_a),
        ("B) Trail delay 7d", config_b),
        ("C) Trail delay 3d", config_c),
        ("D) No trailing", config_d),
    ]


# ---------------------------------------------------------------------------
# 3. Metrics computation
# ---------------------------------------------------------------------------

def compute_metrics(trades: list[dict], label: str, hours_per_bar: int = 4) -> dict:
    """Compute comprehensive metrics for a list of trades."""
    if not trades:
        return {
            "label": label, "total_trades": 0, "main_trades": 0,
            "longs": 0, "shorts": 0, "trims": 0, "bb2": 0,
            "pnl_usd": 0.0, "win_rate": 0.0, "avg_pnl": 0.0,
            "avg_hold_hours": 0.0, "max_drawdown": 0.0,
            "longest_losing_streak": 0, "worst_trade": 0.0, "best_trade": 0.0,
            "green_signals": 0, "red_signals": 0, "grey_signals": 0,
        }

    longs = [t for t in trades if t.get("direction") == "long"]
    shorts = [t for t in trades if t.get("direction") == "short"]
    trims = [t for t in trades if t.get("direction") == "trim"]
    bb2 = [t for t in trades if t.get("direction", "").startswith("bb2_")]
    main = [t for t in trades if t.get("direction") in ("long", "short")]

    total_pnl = sum(t.get("pnl_usd", 0) for t in trades)
    wins = [t for t in main if t.get("pnl_usd", 0) > 0]
    win_rate = len(wins) / len(main) * 100 if main else 0

    # Avg P&L per main trade
    avg_pnl = total_pnl / len(main) if main else 0

    # Avg hold time in hours (using bar index if available)
    hold_bars = []
    for t in main:
        entry_bar = t.get("entry_bar_index", 0)
        exit_bar = t.get("exit_bar_index", entry_bar)
        # If exit_bar_index not available, estimate from dates
        if exit_bar == entry_bar and t.get("entry_date") and t.get("exit_date"):
            try:
                ed = pd.Timestamp(t["entry_date"])
                xd = pd.Timestamp(t["exit_date"])
                hold_bars.append((xd - ed).total_seconds() / 3600)  # already in hours
            except Exception:
                hold_bars.append(0)
        else:
            hold_bars.append((exit_bar - entry_bar) * hours_per_bar)
    avg_hold_hours = np.mean(hold_bars) if hold_bars else 0

    # Max drawdown (peak-to-trough cumulative P&L)
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in trades:
        cumulative += t.get("pnl_usd", 0)
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    # Longest losing streak (main trades only)
    streak = 0
    max_streak = 0
    for t in main:
        if t.get("pnl_usd", 0) <= 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0

    # Best/worst single trade
    all_pnls = [t.get("pnl_usd", 0) for t in trades]
    worst = min(all_pnls) if all_pnls else 0
    best = max(all_pnls) if all_pnls else 0

    return {
        "label": label,
        "total_trades": len(trades),
        "main_trades": len(main),
        "longs": len(longs),
        "shorts": len(shorts),
        "trims": len(trims),
        "bb2": len(bb2),
        "pnl_usd": round(total_pnl, 2),
        "win_rate": round(win_rate, 1),
        "avg_pnl": round(avg_pnl, 2),
        "avg_hold_hours": round(avg_hold_hours, 1),
        "max_drawdown": round(max_dd, 2),
        "longest_losing_streak": max_streak,
        "worst_trade": round(worst, 2),
        "best_trade": round(best, 2),
    }


def compute_signal_counts(df: pd.DataFrame) -> dict:
    """Count green/red/grey signals in the indicator DataFrame."""
    if "signal_color" not in df.columns:
        return {"green": 0, "red": 0, "grey": 0}
    vc = df["signal_color"].value_counts()
    return {
        "green": int(vc.get("green", 0)),
        "red": int(vc.get("red", 0)),
        "grey": int(vc.get("grey", 0)),
    }


def per_asset_breakdown(all_trades: dict[str, list[dict]], label: str) -> None:
    """Print per-asset metrics for one config."""
    print(f"\n  Per-asset breakdown ({label}):")
    print(f"  {'Asset':<6s} {'Main':>5s} {'L':>4s} {'S':>4s} {'Trim':>5s} {'BB2':>4s} {'P&L $':>9s} {'Win%':>6s} {'AvgHold':>8s} {'MaxDD':>8s}")
    print(f"  {'-'*6} {'-'*5} {'-'*4} {'-'*4} {'-'*5} {'-'*4} {'-'*9} {'-'*6} {'-'*8} {'-'*8}")
    for asset_name, trades in all_trades.items():
        m = compute_metrics(trades, asset_name)
        hold_str = f"{m['avg_hold_hours']:.0f}h"
        print(f"  {asset_name:<6s} {m['main_trades']:>5d} {m['longs']:>4d} {m['shorts']:>4d} {m['trims']:>5d} {m['bb2']:>4d} {m['pnl_usd']:>+9.2f} {m['win_rate']:>5.1f}% {hold_str:>8s} {m['max_drawdown']:>8.2f}")


# ---------------------------------------------------------------------------
# 4. Bear market isolation
# ---------------------------------------------------------------------------

BEAR_CUTOFF = pd.Timestamp("2025-10-15", tz="UTC")

def filter_bear_trades(trades: list[dict]) -> list[dict]:
    """Filter to trades entered after Oct 15, 2025."""
    result = []
    for t in trades:
        entry_date = t.get("entry_date", "")
        try:
            ed = pd.Timestamp(entry_date)
            if ed.tzinfo is None:
                ed = ed.tz_localize("UTC")
            if ed >= BEAR_CUTOFF:
                result.append(t)
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# 5. Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 78)
    print("VELA 4H BACKTEST — Ground Truth")
    print(f"Assets: {', '.join(ASSETS.values())} | Period: {DAYS} days | Position: ${POSITION_SIZE_USD}")
    print(f"Indicator periods: EMA-9/21, RSI-14, SMA-50, ADX-14 (on 4H bars, as production)")
    print("=" * 78)

    # ── Fetch data ──
    print("\n[1/5] Fetching 4H candle data from Hyperliquid...\n")
    raw_data: dict[str, pd.DataFrame] = {}
    for cg_id, symbol in ASSETS.items():
        raw_data[cg_id] = fetch_4h_ohlc(cg_id, DAYS)
        if cg_id != list(ASSETS.keys())[-1]:
            time.sleep(HL_SLEEP_SECONDS)

    # ── Compute indicators ──
    print("\n[2/5] Computing indicators on 4H bars...\n")
    configs = build_configs()
    # We only need to compute indicators once per asset (indicators don't depend on trade config)
    indicator_dfs: dict[str, pd.DataFrame] = {}
    signal_dfs: dict[str, pd.DataFrame] = {}
    # Use config_a for indicator computation (all configs share same indicator params)
    base_config = configs[0][1]
    for cg_id, symbol in ASSETS.items():
        df_ind = calculate_indicators(raw_data[cg_id], config=base_config)
        indicator_dfs[cg_id] = df_ind
        df_sig = generate_signals(df_ind, config=base_config)
        signal_dfs[cg_id] = df_sig
        sc = compute_signal_counts(df_sig)
        print(f"  {symbol}: {len(df_sig)} bars | GREEN={sc['green']} RED={sc['red']} GREY={sc['grey']}")

    # BTC df for altcoin crash filter
    btc_df = signal_dfs.get("bitcoin")

    # ── Run trades for each config ──
    print("\n[3/5] Simulating trades across 4 configs...\n")
    # results[config_label] = {asset_name: trades_list}
    results: dict[str, dict[str, list[dict]]] = {}
    aggregated: dict[str, list[dict]] = {}  # config_label -> all trades

    for config_label, config in configs:
        results[config_label] = {}
        all_trades_for_config = []
        for cg_id, symbol in ASSETS.items():
            # Re-generate signals with this config (signals depend on config for evaluate_signal)
            df_ind = indicator_dfs[cg_id]
            df_sig = generate_signals(df_ind, config=config)
            is_btc = (cg_id == "bitcoin")
            trades = simulate_trades(
                df_sig,
                config=config,
                btc_df=btc_df if not is_btc else None,
                is_btc=is_btc,
            )
            results[config_label][symbol] = trades
            all_trades_for_config.extend(trades)
        aggregated[config_label] = all_trades_for_config
        m = compute_metrics(all_trades_for_config, config_label)
        print(f"  {config_label}: {m['main_trades']} main trades, ${m['pnl_usd']:+.2f} P&L, {m['win_rate']:.1f}% win")

    # ── Comparison table ──
    print("\n" + "=" * 78)
    print("[4/5] COMPARISON TABLE")
    print("=" * 78)

    metrics_list = []
    for config_label, _ in configs:
        m = compute_metrics(aggregated[config_label], config_label)
        metrics_list.append(m)

    header = f"  {'Metric':<24s}"
    for m in metrics_list:
        header += f" {m['label'][:18]:>18s}"
    header += f" {'Daily ref':>12s}"
    print(header)
    print(f"  {'-'*24}" + f" {'-'*18}" * len(metrics_list) + f" {'-'*12}")

    rows = [
        ("Total trades", "total_trades", "d"),
        ("Main trades (L+S)", "main_trades", "d"),
        ("  Longs", "longs", "d"),
        ("  Shorts", "shorts", "d"),
        ("Trims", "trims", "d"),
        ("BB2 trades", "bb2", "d"),
        ("Total P&L $", "pnl_usd", "+.2f"),
        ("Win rate %", "win_rate", ".1f"),
        ("Avg P&L per trade $", "avg_pnl", "+.2f"),
        ("Avg hold (hours)", "avg_hold_hours", ".0f"),
        ("Max drawdown $", "max_drawdown", ".2f"),
        ("Longest losing streak", "longest_losing_streak", "d"),
        ("Worst single trade $", "worst_trade", "+.2f"),
        ("Best single trade $", "best_trade", "+.2f"),
    ]

    for row_label, key, fmt in rows:
        line = f"  {row_label:<24s}"
        for m in metrics_list:
            val = m.get(key, 0)
            formatted = f"{val:{fmt}}"
            line += f" {formatted:>18s}"
        # Daily ref column
        if key == "main_trades":
            line += f" {DAILY_REF['main_trades']:>12d}"
        elif key == "pnl_usd":
            ref_str = f"{DAILY_REF['pnl_usd']:+.2f}"
            line += f" {ref_str:>12s}"
        elif key == "win_rate":
            line += f" {DAILY_REF['win_rate']:>12.1f}"
        else:
            line += f" {'--':>12s}"
        print(line)

    # vs Daily comparison row
    m_a = metrics_list[0]  # PROD_ACTUAL baseline
    print(f"\n  --- vs Daily (PROD_ACTUAL baseline) ---")
    print(f"  Main trades: {m_a['main_trades']} (4H) vs {DAILY_REF['main_trades']} (daily) = {m_a['main_trades'] - DAILY_REF['main_trades']:+d}")
    print(f"  P&L:         ${m_a['pnl_usd']:+.2f} (4H) vs ${DAILY_REF['pnl_usd']:+.2f} (daily) = ${m_a['pnl_usd'] - DAILY_REF['pnl_usd']:+.2f}")
    print(f"  Win rate:    {m_a['win_rate']:.1f}% (4H) vs {DAILY_REF['win_rate']:.1f}% (daily) = {m_a['win_rate'] - DAILY_REF['win_rate']:+.1f}pp")

    # ── Per-asset breakdown for each config ──
    for config_label, _ in configs:
        per_asset_breakdown(results[config_label], config_label)

    # ── Signal frequency ──
    print(f"\n  Signal frequency (from PROD_ACTUAL indicators):")
    total_green = total_red = total_grey = 0
    for cg_id, symbol in ASSETS.items():
        sc = compute_signal_counts(signal_dfs[cg_id])
        total_green += sc["green"]
        total_red += sc["red"]
        total_grey += sc["grey"]
        total = sc["green"] + sc["red"] + sc["grey"]
        print(f"  {symbol}: GREEN={sc['green']} ({sc['green']/total*100:.1f}%) RED={sc['red']} ({sc['red']/total*100:.1f}%) GREY={sc['grey']} ({sc['grey']/total*100:.1f}%)")
    total_all = total_green + total_red + total_grey
    print(f"  ALL: GREEN={total_green} ({total_green/total_all*100:.1f}%) RED={total_red} ({total_red/total_all*100:.1f}%) GREY={total_grey} ({total_grey/total_all*100:.1f}%)")

    # ── Bear market isolation ──
    print("\n" + "=" * 78)
    print("[5/5] BEAR MARKET ISOLATION (entries after Oct 15, 2025)")
    print("=" * 78)

    for config_label in ["A) PROD_ACTUAL", "B) Trail delay 7d"]:
        bear_trades = filter_bear_trades(aggregated[config_label])
        m = compute_metrics(bear_trades, f"{config_label} (bear)")
        print(f"\n  {config_label} — bear period:")
        print(f"    Main trades: {m['main_trades']} (L={m['longs']}, S={m['shorts']})")
        print(f"    Total P&L:   ${m['pnl_usd']:+.2f}")
        print(f"    Win rate:    {m['win_rate']:.1f}%")
        print(f"    Avg P&L:     ${m['avg_pnl']:+.2f}/trade")
        print(f"    Avg hold:    {m['avg_hold_hours']:.0f}h")
        print(f"    Max DD:      ${m['max_drawdown']:.2f}")
        print(f"    Worst trade: ${m['worst_trade']:+.2f}")
        print(f"    Best trade:  ${m['best_trade']:+.2f}")
        print(f"    Losing streak: {m['longest_losing_streak']}")
        print(f"    BB2 trades:  {m['bb2']}")
        print(f"    Trims:       {m['trims']}")

        # Per-asset bear breakdown
        bear_per_asset = {}
        for symbol in ASSETS.values():
            asset_trades = results[config_label].get(symbol, [])
            bear_per_asset[symbol] = filter_bear_trades(asset_trades)

        print(f"    Per-asset:")
        for symbol, bt in bear_per_asset.items():
            bm = compute_metrics(bt, symbol)
            print(f"      {symbol}: {bm['main_trades']} trades, ${bm['pnl_usd']:+.2f}, {bm['win_rate']:.1f}% win")

    print("\n" + "=" * 78)
    print("DONE. This is the ground truth for Vela's production strategy on 4H bars.")
    print("=" * 78)


if __name__ == "__main__":
    main()
