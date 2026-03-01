#!/usr/bin/env python3
"""
EMA Spread Sweep — Backtest minimum EMA-9/EMA-21 spread thresholds.
Uses 4H candles from Hyperliquid (matching live signal engine) to test
spread filters of 0%, 0.05%, 0.1%, 0.2%, 0.3%, 0.5%, 1.0%.

A minimum spread filter prevents entries on weak EMA crosses where
EMA-9 barely touches EMA-21 (noise-level, high reversal risk).

Usage:
    python scripts/spread_sweep.py
    python scripts/spread_sweep.py --days 365
    python scripts/spread_sweep.py --asset bitcoin
"""

import argparse
import sys
import time
from datetime import datetime, date as date_type

import pandas as pd
import requests

# Import the backtest engine components
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
    """
    Fetch 4H OHLC data from Hyperliquid — matches the live signal engine's
    4-hour candle resolution. Returns DataFrame with DatetimeIndex.
    """
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(f"No Hyperliquid symbol for '{coingecko_id}'. Known: {list(ASSETS_HL.keys())}")

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
                    raise RuntimeError(f"Hyperliquid API failed after 3 retries: {e}")
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


def run_sweep(asset_id: str, days: int = 365):
    """Run all V8 spread configs against one asset using 4H candles."""
    print(f"\n{'='*70}")
    print(f"  EMA SPREAD SWEEP (4H): {asset_id.upper()} ({days} days)")
    print(f"{'='*70}\n")

    # Fetch 4H data
    try:
        df = fetch_4h_ohlc(asset_id, days=days)
    except Exception as e:
        print(f"  ERROR: {e}")
        return None

    if df is None or df.empty:
        print(f"  ERROR: No data for {asset_id}")
        return None

    print(f"  {len(df)} bars (~{len(df) // 6} trading days)")

    is_btc = asset_id == "bitcoin"

    # Fetch BTC 4H data for crash filter
    btc_df = None
    if not is_btc:
        try:
            btc_df = fetch_4h_ohlc("bitcoin", days=days)
            if btc_df is not None:
                btc_df = calculate_indicators(btc_df)
        except Exception:
            print("  Warning: BTC crash filter unavailable")

    configs = [
        "v8_spread_0",
        "v8_spread_005",
        "v8_spread_01",
        "v8_spread_02",
        "v8_spread_03",
        "v8_spread_05",
        "v8_spread_10",
    ]

    results = []
    baseline_trades_list = None

    for config_name in configs:
        config = NAMED_CONFIGS[config_name]
        spread_pct = config.get("min_ema_spread_pct", 0.0)

        # Calculate indicators
        df_run = calculate_indicators(df.copy(), config=config)

        # Simulate trades
        trades = simulate_trades(
            df_run,
            config=config,
            btc_df=btc_df,
            is_btc=is_btc,
        )

        # Filter to main EMA trades only
        ema_trades = [
            t for t in trades
            if t.get("direction") in ("long", "short")
            and t.get("status") == "closed"
        ]

        if spread_pct == 0.0:
            baseline_trades_list = ema_trades

        total_trades = len(ema_trades)
        if total_trades == 0:
            results.append({
                "config": config["name"],
                "spread_pct": spread_pct,
                "trades": 0, "wins": 0, "losses": 0, "win_rate": 0,
                "total_pnl": 0, "avg_pnl": 0, "max_loss": 0, "avg_loss": 0,
                "stopped_out": 0, "avoided_trades": 0,
            })
            continue

        wins = [t for t in ema_trades if t["pnl_pct"] > 0]
        losses = [t for t in ema_trades if t["pnl_pct"] <= 0]
        total_pnl = sum(t["pnl_usd"] for t in ema_trades)
        avg_pnl = total_pnl / total_trades
        max_loss = min((t["pnl_pct"] for t in ema_trades), default=0)
        loss_pnls = [t["pnl_pct"] for t in losses]
        avg_loss = sum(loss_pnls) / len(loss_pnls) if loss_pnls else 0
        stopped_out = len([
            t for t in ema_trades
            if t.get("exit_signal_reason") in ("stop_loss", "atr_stop_loss")
        ])
        baseline_count = len(baseline_trades_list) if baseline_trades_list else total_trades
        avoided = baseline_count - total_trades

        results.append({
            "config": config["name"],
            "spread_pct": spread_pct,
            "trades": total_trades,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / total_trades * 100, 1),
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(avg_pnl, 2),
            "max_loss": round(max_loss, 2),
            "avg_loss": round(avg_loss, 2),
            "stopped_out": stopped_out,
            "avoided_trades": avoided,
        })

        # Print trade-by-trade detail
        print(f"\n  {config['name']}:")
        for t in ema_trades:
            direction = t["direction"].upper()
            entry = str(t["entry_date"])[:16]
            exit_d = str(t["exit_date"])[:16]
            pnl = t["pnl_pct"]
            pnl_usd = t["pnl_usd"]
            reason = t.get("exit_signal_reason", "?")
            # Show EMA spread at entry (stored in entry_indicators snapshot)
            entry_indicators = t.get("entry_indicators", {}) or {}
            entry_spread = entry_indicators.get("ema_spread_pct", None)
            spread_str = f" spread={entry_spread:.4f}%" if entry_spread is not None else ""
            marker = "SL" if reason in ("stop_loss", "atr_stop_loss") else ("W " if pnl > 0 else "L ")
            print(f"    {marker} {direction:5s} {entry} -> {exit_d}  {pnl:+.2f}% (${pnl_usd:+.2f})  [{reason}]{spread_str}")

        # Show which baseline trades were filtered out
        if spread_pct > 0 and baseline_trades_list:
            baseline_entries = {(str(t["entry_date"])[:16], t["direction"]) for t in baseline_trades_list}
            current_entries = {(str(t["entry_date"])[:16], t["direction"]) for t in ema_trades}
            filtered = baseline_entries - current_entries

            if filtered:
                print(f"\n    FILTERED OUT ({len(filtered)} trades):")
                for bt in baseline_trades_list:
                    key = (str(bt["entry_date"])[:16], bt["direction"])
                    if key in filtered:
                        bt_indicators = bt.get("entry_indicators", {}) or {}
                        entry_spread = bt_indicators.get("ema_spread_pct", None)
                        spread_info = f" spread={entry_spread:.4f}%" if entry_spread is not None else ""
                        print(
                            f"    ✗ {bt['direction'].upper():5s} {key[0]}  "
                            f"{bt['pnl_pct']:+.2f}% (${bt['pnl_usd']:+.2f}){spread_info}"
                        )

    return results


def print_comparison(asset_id: str, results: list[dict]):
    """Print comparison table."""
    print(f"\n{'='*115}")
    print(f"  COMPARISON: {asset_id.upper()} (4H candles)")
    print(f"{'='*115}")

    header = (
        f"{'Spread':>10s} | {'Trades':>6s} | {'W':>3s} | {'L':>3s} | "
        f"{'Win%':>5s} | {'Total P&L':>10s} | {'vs Base':>10s} | "
        f"{'Avg P&L':>8s} | {'Max Loss':>9s} | {'Avg Loss':>9s} | {'SL':>3s} | {'Skipped':>7s}"
    )
    print(header)
    print("-" * len(header))

    baseline_pnl = results[0]["total_pnl"] if results else 0

    for r in results:
        delta = r["total_pnl"] - baseline_pnl
        delta_str = f"${delta:+.2f}" if r["spread_pct"] > 0 else "baseline"
        spread_label = f"{r['spread_pct']:.2f}%"
        print(
            f"{spread_label:>10s} | {r['trades']:>6d} | {r['wins']:>3d} | {r['losses']:>3d} | "
            f"{r['win_rate']:>4.1f}% | ${r['total_pnl']:>9.2f} | {delta_str:>10s} | "
            f"${r['avg_pnl']:>7.2f} | {r['max_loss']:>8.2f}% | {r['avg_loss']:>8.2f}% | "
            f"{r['stopped_out']:>3d} | {r['avoided_trades']:>7d}"
        )

    print()


def main():
    parser = argparse.ArgumentParser(description="EMA Spread Sweep (4H candles)")
    parser.add_argument("--days", type=int, default=365, help="Lookback days (default 365)")
    parser.add_argument("--asset", type=str, help="Single asset CoinGecko ID")
    args = parser.parse_args()

    assets = [args.asset] if args.asset else ["hyperliquid", "bitcoin", "ethereum"]

    print(f"\n  Vela EMA Spread Sweep (4H Candles)")
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Lookback: {args.days} days")
    print(f"  Assets: {', '.join(a.upper() for a in assets)}")
    print(f"  Position size: ${POSITION_SIZE_USD}")
    print(f"  Spread thresholds: 0%, 0.05%, 0.1%, 0.2%, 0.3%, 0.5%, 1.0%")
    print(f"  Candle interval: 4H (matches live signal engine)")

    all_results = {}

    for asset_id in assets:
        results = run_sweep(asset_id, days=args.days)
        if results:
            all_results[asset_id] = results
            print_comparison(asset_id, results)

    # Cross-asset summary
    if len(all_results) > 1:
        print(f"\n{'='*115}")
        print(f"  CROSS-ASSET SUMMARY ({', '.join(a.upper() for a in all_results)})")
        print(f"{'='*115}")

        spread_pcts = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0]
        baseline_total = sum(all_results[a][0]["total_pnl"] for a in all_results)

        best_delta = float('-inf')
        best_idx = 0

        for i, sp in enumerate(spread_pcts):
            total_pnl = sum(all_results[a][i]["total_pnl"] for a in all_results)
            total_trades = sum(all_results[a][i]["trades"] for a in all_results)
            total_wins = sum(all_results[a][i]["wins"] for a in all_results)
            total_losses = sum(all_results[a][i]["losses"] for a in all_results)
            total_avoided = sum(all_results[a][i]["avoided_trades"] for a in all_results)
            total_sl = sum(all_results[a][i]["stopped_out"] for a in all_results)
            win_rate = round(total_wins / total_trades * 100, 1) if total_trades > 0 else 0

            delta = total_pnl - baseline_total
            if i > 0 and delta > best_delta:
                best_delta = delta
                best_idx = i
            delta_str = f" ({delta:+.0f})" if sp > 0 else ""

            print(
                f"  {sp:>5.2f}%: {total_trades:>3d} trades ({total_wins}W/{total_losses}L, "
                f"{win_rate}%), ${total_pnl:>9.2f} P&L{delta_str}, "
                f"{total_sl} stop-losses, {total_avoided} avoided"
            )

        best_sp = spread_pcts[best_idx]
        if best_delta > 0:
            print(f"\n  RECOMMENDATION: {best_sp:.2f}% min spread (+${best_delta:.2f} vs baseline)")
        elif best_delta == 0:
            print(f"\n  RESULT: No spread filter impact in this period")
        else:
            print(f"\n  RESULT: All spread filters reduce P&L — filter not recommended for this period")

    print(f"\n  Done.\n")


if __name__ == "__main__":
    main()
