"""
v2: Pull Kalshi ATM hourly binaries using actual HL spot price for ATM selection.

Improvement over v1: instead of "median of available strikes", use the HL
spot price at the hour's open to find the truly closest strike. Removes the
strike-grid bias that inflated q4 hit rates in v1.

Usage:
    python3 pull_kalshi_atm_v2.py --series KXBTCD --asset BTC --funding-coin BTC --days-back 60
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


def load_hl_spot_open_by_hour(coin: str, days_back: int) -> dict[int, float]:
    """Map hour-floor unix ts -> HL open price for that hour."""
    p = DATA_DIR / f"hl_candles_{coin}_1h_{days_back}d.json"
    if not p.exists():
        # try 90d fallback
        p = DATA_DIR / f"hl_candles_{coin}_1h_90d.json"
    candles = json.load(p.open())
    out: dict[int, float] = {}
    for c in candles:
        # HL candle: t = open ms, T = close ms, o = open, c = close
        t_hour = int(c["t"] // 1000 // 3600 * 3600)
        out[t_hour] = float(c["o"])
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", required=True)
    parser.add_argument("--days-back", type=int, default=60)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--funding-coin", required=True, help="HL coin label for spot lookup (BTC, ETH, xyz:GOLD...)")
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days_back)
    cutoff_ms = cutoff.timestamp() * 1000

    spot_by_hour = load_hl_spot_open_by_hour(args.funding_coin, args.days_back)
    print(f"loaded {len(spot_by_hour)} HL spot hours for {args.funding_coin}", file=sys.stderr)

    print(f"listing settled {args.series}...", file=sys.stderr)
    settled = list_series_markets(args.series, "settled")
    print(f"  {len(settled)} settled total", file=sys.stderr)

    in_window = []
    for m in settled:
        try:
            close_dt = datetime.fromisoformat(m.get("close_time").replace("Z", "+00:00"))
        except Exception:
            continue
        if close_dt.timestamp() * 1000 < cutoff_ms:
            continue
        try:
            m["_strike"] = float(m.get("floor_strike") or m.get("cap_strike") or 0)
            m["_close_ts"] = int(close_dt.timestamp())
            m["_open_ts"] = int(datetime.fromisoformat(m.get("open_time").replace("Z", "+00:00")).timestamp())
        except Exception:
            continue
        if not m["_strike"]:
            continue
        in_window.append(m)
    print(f"  {len(in_window)} in window", file=sys.stderr)

    by_hour: dict[int, list[dict]] = {}
    for m in in_window:
        by_hour.setdefault(m["_open_ts"] // 3600 * 3600, []).append(m)
    print(f"  {len(by_hour)} unique open-hours", file=sys.stderr)

    rows = []
    hours_sorted = sorted(by_hour.keys())
    for i, h in enumerate(hours_sorted):
        if i % 100 == 0:
            print(f"  hour {i + 1}/{len(hours_sorted)}", file=sys.stderr)
        spot = spot_by_hour.get(h)
        if not spot:
            continue
        cands = by_hour[h]
        # Pick strike closest to spot
        cands.sort(key=lambda m: abs(m["_strike"] - spot))
        atm = cands[0]
        moneyness = (atm["_strike"] - spot) / spot
        # Skip if "ATM" is not actually close (>2% off spot is a coverage gap)
        if abs(moneyness) > 0.02:
            continue
        try:
            candles = fetch_candles(args.series, atm["ticker"], atm["_open_ts"] - 60, atm["_close_ts"] + 60, 1)
        except Exception:
            continue
        if not candles:
            continue
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
            "ticker": atm["ticker"],
            "strike": atm["_strike"],
            "spot_open": spot,
            "moneyness": moneyness,
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

    print(f"\n{len(rows)} ATM rows after spot-anchoring", file=sys.stderr)
    if not rows:
        return

    out_path = DATA_DIR / f"kalshi_atm_v2_{args.asset}_{args.series}_{args.days_back}d.csv"
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
