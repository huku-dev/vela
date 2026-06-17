"""
For each regenerated Vela signal, find active Polymarket BTC/ETH strike-grid
binaries and extract binary skew at spot via the implied-probability surface.

Polymarket strike-grid pattern:
  "Will the price of Bitcoin be above $X on [date]?" (one market per strike)
  Each market has clobTokenIds for YES/NO; query CLOB price-history for prices.

Usage:
    python3 align_signals_with_polymarket.py --asset BTC --signals-csv signals_BTC_365d.csv
"""

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent.parent / "data"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"


def fetch_json(url: str, retries: int = 3, timeout: int = 30):
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def list_markets_for_window(asset_keyword: str, ts_seconds: int, max_horizon_days: int = 2):
    """Find Polymarket strike-grid markets covering ts_seconds.

    Pattern matched: "Will the price of <asset> be above $X on <date>?"
    where startDate <= ts < endDate and (endDate - ts) <= max_horizon_days.
    """
    asset_upper = asset_keyword.upper()
    # Tight window: 2 days ahead. Vela's evaluation horizon is 24h.
    ts_dt = datetime.fromtimestamp(ts_seconds, tz=timezone.utc)
    end_min = (ts_dt - timedelta(hours=2)).strftime("%Y-%m-%d")
    end_max = (ts_dt + timedelta(days=max_horizon_days)).strftime("%Y-%m-%d")

    markets = []
    offset = 0
    while True:
        url = f"{GAMMA}/markets?limit=500&closed=true&end_date_min={end_min}&end_date_max={end_max}&offset={offset}"
        try:
            batch = fetch_json(url)
        except Exception:
            break
        if not batch:
            break
        for m in batch:
            q = (m.get("question", "") or "").upper()
            if asset_upper not in q:
                continue
            if "ABOVE $" not in q or "PRICE" not in q:
                continue
            # Extract strike
            mt = re.search(r"ABOVE \$([\d,\.]+)", q)
            if not mt:
                continue
            strike_str = mt.group(1).replace(",", "")
            try:
                strike = float(strike_str)
            except Exception:
                continue
            try:
                start = datetime.fromisoformat(m.get("startDate", "").replace("Z", "+00:00"))
                end = datetime.fromisoformat(m.get("endDate", "").replace("Z", "+00:00"))
            except Exception:
                continue
            if start.timestamp() > ts_seconds or end.timestamp() <= ts_seconds:
                continue
            tokens = json.loads(m.get("clobTokenIds") or "[]")
            if not tokens:
                continue
            markets.append({
                "id": m.get("id"),
                "question": m.get("question"),
                "strike": strike,
                "start_ts": int(start.timestamp()),
                "end_ts": int(end.timestamp()),
                "yes_token": tokens[0],
                "volume": float(m.get("volume") or 0),
            })
        if len(batch) < 500:
            break
        offset += 500
        if offset > 20000:  # safety, larger to catch padded API
            break
    return markets


def fetch_yes_price_at(yes_token: str, ts_seconds: int, window_seconds: int = 3600):
    """Query CLOB price-history near ts_seconds, return the closest price."""
    start_ts = ts_seconds - window_seconds
    end_ts = ts_seconds + window_seconds
    url = f"{CLOB}/prices-history?market={yes_token}&startTs={start_ts}&endTs={end_ts}&fidelity=60"
    try:
        data = fetch_json(url, timeout=20)
    except Exception:
        return None
    history = data.get("history") or []
    if not history:
        return None
    # Find closest in time
    closest = min(history, key=lambda r: abs(r["t"] - ts_seconds))
    return float(closest["p"])


def compute_skew(strikes_with_yes_prices: list[dict], spot: float, ts_seconds: int):
    """Build implied-prob surface and extract skew at spot.

    Each strike has p = market's YES price = market-implied P(close > strike).
    Sort by strike, interpolate at spot, derive skew.
    """
    rows = sorted(strikes_with_yes_prices, key=lambda r: r["strike"])
    if len(rows) < 3:
        return None
    if spot <= rows[0]["strike"] or spot >= rows[-1]["strike"]:
        return None
    # Linear interpolation
    for i in range(len(rows) - 1):
        if rows[i]["strike"] <= spot <= rows[i + 1]["strike"]:
            x0, y0 = rows[i]["strike"], rows[i]["p_yes"]
            x1, y1 = rows[i + 1]["strike"], rows[i + 1]["p_yes"]
            t = (spot - x0) / (x1 - x0) if x1 > x0 else 0
            prob_at_spot = y0 + t * (y1 - y0)
            # tau in hours from this strike's market end
            end_ts = rows[i]["end_ts"]
            tau_h = (end_ts - ts_seconds) / 3600
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
    parser.add_argument("--asset", required=True, help="BTC or ETH")
    parser.add_argument("--signals-csv", required=True)
    parser.add_argument("--asset-keyword", default=None,
                        help="Override question keyword. Default: 'Bitcoin' for BTC, 'Ethereum' for ETH")
    args = parser.parse_args()

    keyword = args.asset_keyword or {"BTC": "Bitcoin", "ETH": "Ethereum"}.get(args.asset.upper(), args.asset)
    DATA_DIR.mkdir(exist_ok=True)
    src = DATA_DIR / args.signals_csv
    rows = list(csv.DictReader(src.open()))
    print(f"loaded {len(rows)} signals", file=sys.stderr)

    enriched = []
    for i, r in enumerate(rows):
        ts_ms = int(r["ts"])
        ts_s = ts_ms // 1000
        spot = float(r["entry_price"])
        ts_str = datetime.fromtimestamp(ts_s, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        print(f"  [{i+1}/{len(rows)}] {args.asset} {r['side']} {ts_str} spot={spot:.0f}", file=sys.stderr)

        # Find candidate markets
        markets = list_markets_for_window(keyword, ts_s)
        if not markets:
            print(f"    no markets in window", file=sys.stderr)
            r.update({"pm_skew": "", "pm_skew_normalized": "", "pm_n_strikes": 0,
                     "pm_tau_h": "", "pm_prob_at_spot": "", "pm_coverage": "no_market"})
            enriched.append(r)
            continue
        # Group by end_ts; pick the closest end_date to t+24h (matches our 24h horizon)
        # Use the soonest end_date >= ts + 12h (skip ones expiring same hour as it's hourly cadence noise)
        target = ts_s + 24 * 3600
        markets.sort(key=lambda m: abs(m["end_ts"] - target))
        target_end = markets[0]["end_ts"]
        # Keep all markets ending at the same date (the strike grid)
        grid = [m for m in markets if abs(m["end_ts"] - target_end) < 24 * 3600]
        if len(grid) < 3:
            print(f"    grid too thin: {len(grid)}", file=sys.stderr)
            r.update({"pm_skew": "", "pm_skew_normalized": "", "pm_n_strikes": len(grid),
                     "pm_tau_h": "", "pm_prob_at_spot": "", "pm_coverage": "thin"})
            enriched.append(r)
            continue

        # Fetch YES prices for each strike
        priced = []
        for m in grid:
            p = fetch_yes_price_at(m["yes_token"], ts_s)
            if p is None or p <= 0 or p >= 1:
                continue
            priced.append({"strike": m["strike"], "p_yes": p, "end_ts": m["end_ts"], "volume": m["volume"]})
            time.sleep(0.05)
        if len(priced) < 3:
            print(f"    insufficient pricing: got {len(priced)}/{len(grid)}", file=sys.stderr)
            r.update({"pm_skew": "", "pm_skew_normalized": "", "pm_n_strikes": len(priced),
                     "pm_tau_h": "", "pm_prob_at_spot": "", "pm_coverage": "thin_pricing"})
            enriched.append(r)
            continue

        info = compute_skew(priced, spot, ts_s)
        if not info:
            print(f"    surface fail (spot outside grid?)", file=sys.stderr)
            r.update({"pm_skew": "", "pm_skew_normalized": "", "pm_n_strikes": len(priced),
                     "pm_tau_h": "", "pm_prob_at_spot": "", "pm_coverage": "spot_outside"})
            enriched.append(r)
            continue

        print(f"    prob@spot={info['prob_at_spot']:.3f}  skew_norm={info['skew_normalized']:+.4f}  τ={info['tau_h']:.1f}h  strikes={info['n_strikes']}", file=sys.stderr)
        r.update({
            "pm_skew": f"{info['skew']:.4f}",
            "pm_skew_normalized": f"{info['skew_normalized']:.4f}",
            "pm_n_strikes": info["n_strikes"],
            "pm_tau_h": f"{info['tau_h']:.2f}",
            "pm_prob_at_spot": f"{info['prob_at_spot']:.4f}",
            "pm_coverage": "ok",
        })
        enriched.append(r)

    out = DATA_DIR / f"signals_{args.asset}_with_polymarket.csv"
    with out.open("w", newline="") as f:
        if enriched:
            fieldnames = list(enriched[0].keys())
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(enriched)
    print(f"\nwrote {out}", file=sys.stderr)
    have = sum(1 for r in enriched if r.get("pm_skew"))
    print(f"signals with PM skew: {have}/{len(enriched)}", file=sys.stderr)


if __name__ == "__main__":
    main()
