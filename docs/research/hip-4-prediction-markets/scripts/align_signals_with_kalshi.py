"""
For each regenerated signal, find the active Kalshi binary at signal time and
extract binary skew via the implied-probability surface.

Output: enriched signal CSV with binary_skew_normalized and skew_sign columns.

Usage:
    python3 align_signals_with_kalshi.py --asset BTC --series KXBTCD
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

DATA_DIR = Path(__file__).parent.parent / "data"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"


def fetch_json(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def list_markets_around(series: str, ts_seconds: int) -> list[dict]:
    """List all settled+open Kalshi markets in the series whose lifetime
    contains the given timestamp."""
    # Window: ts ±48h, then filter to markets where open_time <= ts < close_time
    out = []
    cursor = None
    pages = 0
    min_close = ts_seconds
    max_close = ts_seconds + 48 * 3600
    while pages < 30:
        params = {
            "series_ticker": series,
            "min_close_ts": str(min_close),
            "max_close_ts": str(max_close),
            "limit": "200",
        }
        if cursor:
            params["cursor"] = cursor
        url = f"{KALSHI}/markets?{urlencode(params)}"
        data = fetch_json(url)
        if not data:
            break
        out.extend(data.get("markets", []))
        cursor = data.get("cursor")
        if not cursor:
            break
        pages += 1
    # Filter to active at ts
    active = []
    for m in out:
        try:
            from datetime import datetime
            ot = datetime.fromisoformat(m["open_time"].replace("Z", "+00:00")).timestamp()
            ct = datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp()
            if ot <= ts_seconds < ct:
                m["_open_ts"] = ot
                m["_close_ts"] = ct
                m["_strike"] = float(m.get("floor_strike") or m.get("cap_strike") or 0)
                if m["_strike"]:
                    active.append(m)
        except Exception:
            continue
    return active


def fetch_candle_at(series: str, ticker: str, ts_seconds: int):
    """Fetch the 1-min candle for the market at or after ts_seconds. Returns
    yes_bid/yes_ask at that time, or None if no candle."""
    start = ts_seconds - 60
    end = ts_seconds + 600  # search up to 10 min after
    url = f"{KALSHI}/series/{series}/markets/{ticker}/candlesticks?start_ts={start}&end_ts={end}&period_interval=1"
    data = fetch_json(url)
    if not data:
        return None
    candles = data.get("candlesticks", [])
    if not candles:
        return None
    # Find first candle whose end_period_ts >= ts_seconds
    for c in candles:
        end_ts = c.get("end_period_ts", 0)
        if end_ts >= ts_seconds:
            try:
                yb = float(c.get("yes_bid", {}).get("close_dollars") or 0)
                ya = float(c.get("yes_ask", {}).get("close_dollars") or 0)
                return {"yes_bid": yb, "yes_ask": ya}
            except Exception:
                return None
    return None


def compute_skew(markets_at_ts: list[dict], spot: float, ts_seconds: int, series: str) -> dict | None:
    """Build the implied-probability surface from active strikes and extract
    skew at spot. Returns dict with skew, skew_normalized, time_to_expiry_h,
    coverage info, or None if insufficient data."""
    rows = []
    for m in markets_at_ts:
        candle = fetch_candle_at(series, m["ticker"], ts_seconds)
        if not candle:
            continue
        yes_mid = (candle["yes_bid"] + candle["yes_ask"]) / 2 if candle["yes_ask"] else candle["yes_bid"]
        if yes_mid <= 0 or yes_mid >= 1:
            # Edge cases: deeply ITM/OTM, no info
            pass
        rows.append({
            "strike": m["_strike"],
            "yes_mid": yes_mid,
            "close_ts": m["_close_ts"],
        })
        time.sleep(0.05)
    if len(rows) < 3:
        return None
    rows.sort(key=lambda r: r["strike"])
    # Linear interpolate to spot
    if spot <= rows[0]["strike"] or spot >= rows[-1]["strike"]:
        # Spot outside strike range; can't reliably interpolate
        return None
    for i in range(len(rows) - 1):
        if rows[i]["strike"] <= spot <= rows[i + 1]["strike"]:
            x0, y0 = rows[i]["strike"], rows[i]["yes_mid"]
            x1, y1 = rows[i + 1]["strike"], rows[i + 1]["yes_mid"]
            t = (spot - x0) / (x1 - x0) if x1 > x0 else 0
            prob_at_spot = y0 + t * (y1 - y0)
            close_ts = rows[i]["close_ts"]
            tau_h = (close_ts - ts_seconds) / 3600
            if tau_h <= 0:
                return None
            skew = prob_at_spot - 0.5
            skew_normalized = skew / (tau_h ** 0.5)
            return {
                "prob_at_spot": prob_at_spot,
                "skew": skew,
                "skew_normalized": skew_normalized,
                "tau_h": tau_h,
                "n_strikes": len(rows),
                "strike_min": rows[0]["strike"],
                "strike_max": rows[-1]["strike"],
            }
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--series", required=True)
    parser.add_argument("--signals-csv", required=True)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    src = DATA_DIR / args.signals_csv
    rows = list(csv.DictReader(src.open()))
    print(f"loaded {len(rows)} signals from {src.name}", file=sys.stderr)

    enriched = []
    for i, r in enumerate(rows):
        ts_ms = int(r["ts"])
        ts_s = ts_ms // 1000
        spot = float(r["entry_price"])
        print(f"  signal {i+1}/{len(rows)}: {args.asset} {r['side']} ts={ts_s} spot={spot}", file=sys.stderr)

        active = list_markets_around(args.series, ts_s)
        if not active:
            print(f"    no active markets", file=sys.stderr)
            r.update({"skew": "", "skew_normalized": "", "n_strikes": 0, "tau_h": "",
                     "prob_at_spot": "", "kalshi_coverage": "no_market"})
            enriched.append(r)
            continue

        info = compute_skew(active, spot, ts_s, args.series)
        if not info:
            print(f"    insufficient surface", file=sys.stderr)
            r.update({"skew": "", "skew_normalized": "", "n_strikes": len(active),
                     "tau_h": "", "prob_at_spot": "", "kalshi_coverage": "thin"})
            enriched.append(r)
            continue

        print(f"    prob@spot={info['prob_at_spot']:.3f}  skew_norm={info['skew_normalized']:+.4f}  τ={info['tau_h']:.1f}h  strikes={info['n_strikes']}", file=sys.stderr)
        r.update({
            "skew": f"{info['skew']:.4f}",
            "skew_normalized": f"{info['skew_normalized']:.4f}",
            "n_strikes": info["n_strikes"],
            "tau_h": f"{info['tau_h']:.2f}",
            "prob_at_spot": f"{info['prob_at_spot']:.4f}",
            "kalshi_coverage": "ok",
        })
        enriched.append(r)

    out = DATA_DIR / f"signals_{args.asset}_with_kalshi.csv"
    with out.open("w", newline="") as f:
        if enriched:
            fieldnames = list(enriched[0].keys())
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(enriched)
    print(f"\nwrote {out}", file=sys.stderr)
    have_skew = sum(1 for r in enriched if r["skew"])
    print(f"signals with skew: {have_skew}/{len(enriched)}", file=sys.stderr)


if __name__ == "__main__":
    main()
