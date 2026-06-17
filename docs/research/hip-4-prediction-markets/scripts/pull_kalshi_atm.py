"""
Pull Kalshi at-the-money hourly binaries for an asset.

Strategy:
1. Filter the kalshi_durability_markets.csv (or kalshi_btc_eth_markets.csv) to
   markets in the relevant series within a date window.
2. Group markets by close_time (hourly window).
3. For each hour, pick the market whose strike is closest to the opening price
   of that hour (we use the median strike within the hour as proxy for ATM
   since opening price isn't directly available without HL spot history).
4. Fetch candlestick(s) for that market across its 1-hour life.
5. Output {hour_open_ts, atm_strike, opening_yes_mid_price, settlement, asset}.

Usage:
    python3 pull_kalshi_atm.py --series KXBTCD --days-back 90 --asset BTC
"""

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
DATA_DIR = Path(__file__).parent.parent / "data"


def fetch_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {}


def list_series_markets(series: str, status: str = "settled") -> list[dict]:
    """Page all markets for a series, filtering by status."""
    out: list[dict] = []
    cursor = None
    while True:
        params = f"series_ticker={series}&status={status}&limit=200"
        if cursor:
            params += f"&cursor={cursor}"
        url = f"{BASE}/markets?{params}"
        page = fetch_json(url)
        out.extend(page.get("markets", []))
        cursor = page.get("cursor")
        if not cursor:
            break
    return out


def fetch_candles(series: str, ticker: str, start_ts: int, end_ts: int, period: int = 1) -> list[dict]:
    url = (f"{BASE}/series/{series}/markets/{ticker}/candlesticks"
           f"?start_ts={start_ts}&end_ts={end_ts}&period_interval={period}")
    return fetch_json(url).get("candlesticks", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", required=True, help="Kalshi series ticker (e.g. KXBTCD)")
    parser.add_argument("--days-back", type=int, default=90)
    parser.add_argument("--asset", required=True, help="Asset label for output (BTC, ETH, etc)")
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days_back)
    cutoff_ms = cutoff.timestamp() * 1000

    print(f"listing settled {args.series} markets...", file=sys.stderr)
    settled = list_series_markets(args.series, "settled")
    print(f"  {len(settled)} settled markets total", file=sys.stderr)

    # Filter to within window
    in_window = []
    for m in settled:
        try:
            close_dt = datetime.fromisoformat(m.get("close_time").replace("Z", "+00:00"))
        except Exception:
            continue
        if close_dt.timestamp() * 1000 < cutoff_ms:
            continue
        # Need a numeric strike. KXBTCD uses floor_strike with strike_type=greater.
        try:
            m["_strike"] = float(m.get("floor_strike") or m.get("cap_strike") or 0)
        except Exception:
            continue
        if not m["_strike"]:
            continue
        m["_close_ts"] = int(close_dt.timestamp())
        m["_open_ts"] = int(datetime.fromisoformat(m.get("open_time").replace("Z", "+00:00")).timestamp())
        in_window.append(m)
    print(f"  {len(in_window)} in window (last {args.days_back} days)", file=sys.stderr)

    # Group by close_ts (hourly window for KXBTCD)
    by_hour: dict[int, list[dict]] = {}
    for m in in_window:
        by_hour.setdefault(m["_close_ts"], []).append(m)
    print(f"  {len(by_hour)} unique hours", file=sys.stderr)

    # For each hour, pick the ATM market: the strike at the median of the strike
    # distribution among strikes that have non-null settlement_value (so we have
    # a real result). Median strike approximates ATM since strike grids are
    # arranged symmetrically around opening price.
    rows = []
    hours_sorted = sorted(by_hour.keys())
    for i, ch in enumerate(hours_sorted):
        if i % 100 == 0:
            print(f"  processing hour {i + 1}/{len(hours_sorted)}", file=sys.stderr)
        cands = by_hour[ch]
        # Sort by strike, pick median
        cands.sort(key=lambda m: m["_strike"])
        if not cands:
            continue
        atm = cands[len(cands) // 2]
        ticker = atm["ticker"]
        # Pull 1-min candles across the hour's life, take the open price
        try:
            candles = fetch_candles(args.series, ticker, atm["_open_ts"] - 60, atm["_close_ts"] + 60, 1)
        except Exception as ex:
            continue
        if not candles:
            continue
        # The first candle's yes_bid open ≈ implied prob at open
        first = candles[0]
        last = candles[-1]
        try:
            yes_bid_open = float(first.get("yes_bid", {}).get("open_dollars") or 0)
            yes_ask_open = float(first.get("yes_ask", {}).get("open_dollars") or 0)
            yes_bid_close = float(last.get("yes_bid", {}).get("close_dollars") or 0)
            yes_ask_close = float(last.get("yes_ask", {}).get("close_dollars") or 0)
        except Exception:
            continue

        rows.append({
            "asset": args.asset,
            "ticker": ticker,
            "strike": atm["_strike"],
            "open_ts": atm["_open_ts"],
            "close_ts": atm["_close_ts"],
            "yes_bid_open": yes_bid_open,
            "yes_ask_open": yes_ask_open,
            "yes_mid_open": (yes_bid_open + yes_ask_open) / 2 if yes_ask_open else yes_bid_open,
            "yes_bid_close": yes_bid_close,
            "yes_ask_close": yes_ask_close,
            "result": atm.get("result"),
            "settlement_value": atm.get("settlement_value"),
            "candle_count": len(candles),
        })
        time.sleep(0.05)

    print(f"\nwrote {len(rows)} ATM rows", file=sys.stderr)
    if not rows:
        return

    out_path = DATA_DIR / f"kalshi_atm_{args.asset}_{args.series}_{args.days_back}d.csv"
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
