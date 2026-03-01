#!/usr/bin/env python3
"""
ADX Spread-Scaling Sweep — Backtest graduated ADX thresholds based on EMA spread.
Uses 4H candles from Hyperliquid (matching live signal engine).

Instead of hard-filtering low-spread crosses, this raises the ADX requirement
when EMA spread is low — demanding stronger trend confirmation for weak crosses
while keeping trade volume higher.

Includes direction-aware variants where shorts have gentler scaling
(low-spread shorts historically win 48.6% vs longs 29.7%).

Usage:
    python scripts/adx_sweep.py
    python scripts/adx_sweep.py --days 365
    python scripts/adx_sweep.py --asset bitcoin
"""

import argparse
import sys
import time
from datetime import datetime

import pandas as pd
import requests

from backtest import (
    NAMED_CONFIGS,
    calculate_indicators,
    simulate_trades,
    POSITION_SIZE_USD,
    HYPERLIQUID_INFO_URL,
    ASSETS_HL,
    HL_SLEEP_SECONDS,
)


def fetch_4h_ohlc(coingecko_id: str, days: int = 365) -> pd.DataFrame:
    """Fetch 4H OHLC data from Hyperliquid."""
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(f"No Hyperliquid symbol for '{coingecko_id}'. Known: {list(ASSETS_HL.keys())}")

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of 4H candles for '{symbol}'...")

    all_candles = []
    current_start = start_ms

    while current_start < end_ms:
        payload = {
            "type": "candleSnapshot",
            "req": {"coin": symbol, "interval": "4h", "startTime": current_start, "endTime": end_ms},
        }
        for attempt in range(3):
            try:
                resp = requests.post(HYPERLIQUID_INFO_URL, json=payload, timeout=30)
                if resp.status_code == 429:
                    time.sleep(10 * (attempt + 1))
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"API failed: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Rate limited for {symbol}")

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
        raise ValueError(f"No data for {symbol}")

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


def run_sweep(asset_id: str, days: int = 365):
    """Run all V8b ADX scaling configs against one asset."""
    print(f"\n{'='*70}")
    print(f"  ADX SPREAD-SCALING SWEEP (4H): {asset_id.upper()} ({days} days)")
    print(f"{'='*70}\n")

    try:
        df = fetch_4h_ohlc(asset_id, days=days)
    except Exception as e:
        print(f"  ERROR: {e}")
        return None

    if df is None or df.empty:
        return None

    is_btc = asset_id == "bitcoin"
    btc_df = None
    if not is_btc:
        try:
            btc_df = fetch_4h_ohlc("bitcoin", days=days)
            if btc_df is not None:
                btc_df = calculate_indicators(btc_df)
        except Exception:
            print("  Warning: BTC crash filter unavailable")

    configs = [
        "v8b_baseline",
        "v8b_gentle",
        "v8b_moderate",
        "v8b_aggressive",
        "v8b_two_tier",
        "v8b_bottom_only",
        "v8b_wide",
        "v8b_directional_mod",
        "v8b_directional_agg",
    ]

    results = []
    baseline_trades_list = None

    for config_name in configs:
        config = NAMED_CONFIGS[config_name]

        df_run = calculate_indicators(df.copy(), config=config)
        trades = simulate_trades(df_run, config=config, btc_df=btc_df, is_btc=is_btc)

        ema_trades = [
            t for t in trades
            if t.get("direction") in ("long", "short") and t.get("status") == "closed"
        ]

        if config_name == "v8b_baseline":
            baseline_trades_list = ema_trades

        total = len(ema_trades)
        if total == 0:
            results.append({
                "config": config["name"], "trades": 0, "wins": 0, "losses": 0,
                "win_rate": 0, "total_pnl": 0, "avg_pnl": 0,
                "long_trades": 0, "long_wins": 0, "short_trades": 0, "short_wins": 0,
                "stopped_out": 0, "avoided_trades": 0,
            })
            continue

        wins = [t for t in ema_trades if t["pnl_pct"] > 0]
        losses = [t for t in ema_trades if t["pnl_pct"] <= 0]
        total_pnl = sum(t["pnl_usd"] for t in ema_trades)

        long_trades = [t for t in ema_trades if t["direction"] == "long"]
        short_trades = [t for t in ema_trades if t["direction"] == "short"]
        long_wins = len([t for t in long_trades if t["pnl_pct"] > 0])
        short_wins = len([t for t in short_trades if t["pnl_pct"] > 0])

        stopped_out = len([
            t for t in ema_trades
            if t.get("exit_signal_reason") in ("stop_loss", "atr_stop_loss")
        ])

        baseline_count = len(baseline_trades_list) if baseline_trades_list else total
        avoided = baseline_count - total

        results.append({
            "config": config["name"],
            "trades": total,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / total * 100, 1),
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(total_pnl / total, 2),
            "long_trades": len(long_trades),
            "long_wins": long_wins,
            "short_trades": len(short_trades),
            "short_wins": short_wins,
            "stopped_out": stopped_out,
            "avoided_trades": avoided,
        })

        # Trade-by-trade detail
        print(f"\n  {config['name']}:")
        for t in ema_trades:
            direction = t["direction"].upper()
            entry = str(t["entry_date"])[:16]
            exit_d = str(t["exit_date"])[:16]
            pnl = t["pnl_pct"]
            pnl_usd = t["pnl_usd"]
            reason = t.get("exit_signal_reason", "?")
            entry_indicators = t.get("entry_indicators", {}) or {}
            entry_spread = entry_indicators.get("ema_spread_pct", None)
            entry_adx = entry_indicators.get("adx_4h", None)
            spread_str = f" spread={entry_spread:.4f}%" if entry_spread is not None else ""
            adx_str = f" ADX={entry_adx:.1f}" if entry_adx is not None else ""
            marker = "SL" if reason in ("stop_loss", "atr_stop_loss") else ("W " if pnl > 0 else "L ")
            print(
                f"    {marker} {direction:5s} {entry} -> {exit_d}  "
                f"{pnl:+.2f}% (${pnl_usd:+.2f})  [{reason}]{spread_str}{adx_str}"
            )

        # Show filtered trades
        if baseline_trades_list and avoided > 0:
            baseline_entries = {(str(t["entry_date"])[:16], t["direction"]) for t in baseline_trades_list}
            current_entries = {(str(t["entry_date"])[:16], t["direction"]) for t in ema_trades}
            filtered = baseline_entries - current_entries

            if filtered:
                print(f"\n    FILTERED ({len(filtered)} trades):")
                for bt in baseline_trades_list:
                    key = (str(bt["entry_date"])[:16], bt["direction"])
                    if key in filtered:
                        bi = bt.get("entry_indicators", {}) or {}
                        sp = bi.get("ema_spread_pct")
                        adx = bi.get("adx_4h")
                        sp_str = f" spread={sp:.4f}%" if sp is not None else ""
                        adx_str = f" ADX={adx:.1f}" if adx is not None else ""
                        print(
                            f"    x {bt['direction'].upper():5s} {key[0]}  "
                            f"{bt['pnl_pct']:+.2f}% (${bt['pnl_usd']:+.2f}){sp_str}{adx_str}"
                        )

    return results


def print_comparison(asset_id: str, results: list[dict]):
    """Print comparison table."""
    print(f"\n{'='*130}")
    print(f"  COMPARISON: {asset_id.upper()} (4H candles)")
    print(f"{'='*130}")

    header = (
        f"{'Config':>50s} | {'Trades':>6s} | {'W':>3s} | {'L':>3s} | "
        f"{'Win%':>5s} | {'P&L':>10s} | {'vs Base':>10s} | "
        f"{'Longs':>7s} | {'Shorts':>7s} | {'SL':>3s} | {'Skip':>4s}"
    )
    print(header)
    print("-" * len(header))

    baseline_pnl = results[0]["total_pnl"] if results else 0

    for r in results:
        delta = r["total_pnl"] - baseline_pnl
        delta_str = f"${delta:+.2f}" if r["avoided_trades"] > 0 else "baseline"
        long_str = f"{r['long_wins']}/{r['long_trades']}" if r['long_trades'] > 0 else "0/0"
        short_str = f"{r['short_wins']}/{r['short_trades']}" if r['short_trades'] > 0 else "0/0"
        print(
            f"{r['config']:>50s} | {r['trades']:>6d} | {r['wins']:>3d} | {r['losses']:>3d} | "
            f"{r['win_rate']:>4.1f}% | ${r['total_pnl']:>9.2f} | {delta_str:>10s} | "
            f"{long_str:>7s} | {short_str:>7s} | {r['stopped_out']:>3d} | {r['avoided_trades']:>4d}"
        )

    print()


def main():
    parser = argparse.ArgumentParser(description="ADX Spread-Scaling Sweep (4H candles)")
    parser.add_argument("--days", type=int, default=365, help="Lookback days (default 365)")
    parser.add_argument("--asset", type=str, help="Single asset CoinGecko ID")
    args = parser.parse_args()

    assets = [args.asset] if args.asset else ["hyperliquid", "bitcoin", "ethereum"]

    print(f"\n  Vela ADX Spread-Scaling Sweep (4H Candles)")
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Lookback: {args.days} days")
    print(f"  Assets: {', '.join(a.upper() for a in assets)}")
    print(f"  Position size: ${POSITION_SIZE_USD}")
    print(f"  Base ADX threshold: 20")
    print(f"  Configs: baseline, gentle(+3/6/9), moderate(+5/10/15), aggressive(+7/14/21),")
    print(f"           two-tier(+5/15), bottom-only(+10<0.05%), wide(+5/10/15/20),")
    print(f"           directional-mod (longs+5/10/15, shorts+3/6/9),")
    print(f"           directional-agg (longs+7/14/21, shorts+3/6/9)")

    all_results = {}

    for asset_id in assets:
        results = run_sweep(asset_id, days=args.days)
        if results:
            all_results[asset_id] = results
            print_comparison(asset_id, results)

    # Cross-asset summary
    if len(all_results) > 1:
        print(f"\n{'='*130}")
        print(f"  CROSS-ASSET SUMMARY ({', '.join(a.upper() for a in all_results)})")
        print(f"{'='*130}")

        config_names = [
            "v8b_baseline", "v8b_gentle", "v8b_moderate", "v8b_aggressive",
            "v8b_two_tier", "v8b_bottom_only", "v8b_wide",
            "v8b_directional_mod", "v8b_directional_agg",
        ]

        baseline_total = sum(all_results[a][0]["total_pnl"] for a in all_results)
        best_delta = float('-inf')
        best_name = ""

        for i, cn in enumerate(config_names):
            totals = {
                "trades": 0, "wins": 0, "losses": 0, "pnl": 0.0,
                "long_trades": 0, "long_wins": 0, "short_trades": 0, "short_wins": 0,
                "sl": 0, "avoided": 0,
            }
            for a in all_results:
                r = all_results[a][i]
                totals["trades"] += r["trades"]
                totals["wins"] += r["wins"]
                totals["losses"] += r["losses"]
                totals["pnl"] += r["total_pnl"]
                totals["long_trades"] += r["long_trades"]
                totals["long_wins"] += r["long_wins"]
                totals["short_trades"] += r["short_trades"]
                totals["short_wins"] += r["short_wins"]
                totals["sl"] += r["stopped_out"]
                totals["avoided"] += r["avoided_trades"]

            win_rate = round(totals["wins"] / totals["trades"] * 100, 1) if totals["trades"] > 0 else 0
            long_wr = round(totals["long_wins"] / totals["long_trades"] * 100, 1) if totals["long_trades"] > 0 else 0
            short_wr = round(totals["short_wins"] / totals["short_trades"] * 100, 1) if totals["short_trades"] > 0 else 0
            delta = totals["pnl"] - baseline_total
            delta_str = f" ({delta:+.0f})" if i > 0 else ""

            if i > 0 and delta > best_delta:
                best_delta = delta
                best_name = NAMED_CONFIGS[cn]["name"]

            label = NAMED_CONFIGS[cn]["name"].replace("V8b: ", "")
            print(
                f"  {label:>48s}: {totals['trades']:>3d} trades "
                f"({totals['wins']}W/{totals['losses']}L, {win_rate}%), "
                f"${totals['pnl']:>9.2f} P&L{delta_str}, "
                f"Longs {totals['long_wins']}/{totals['long_trades']} ({long_wr}%), "
                f"Shorts {totals['short_wins']}/{totals['short_trades']} ({short_wr}%), "
                f"{totals['sl']} SL, {totals['avoided']} skipped"
            )

        if best_delta > 0:
            print(f"\n  RECOMMENDATION: {best_name} (+${best_delta:.2f} vs baseline)")
        else:
            print(f"\n  RESULT: No ADX scaling improves P&L in this period")

    print(f"\n  Done.\n")


if __name__ == "__main__":
    main()
