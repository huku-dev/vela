"""
Pull Kalshi markets for non-crypto Vela-covered assets to test durability of
Play 0 findings beyond crypto.

Asset coverage we care about (per Vela frontend ASSET_DISPLAY_ORDER):
- SPX (S&P 500): KXINXU, KXINXM, KXINXMAXY, KXINXMINY, INXU, INXM, INXAB, etc.
- GOLD: KXGOLDMON (monthly price)
- OIL (WTI + Brent): WTI, OILW, KXBRENTW, KXBRENTD, KXWTIMIN

Individual equities (AAPL/NVDA/AMZN) have only event-driven Kalshi series, no
real price-target markets. Out of scope here.

Usage:
    python3 discover_kalshi_durability.py
"""

import csv
import json
import sys
import time
from pathlib import Path
from urllib import parse

import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
DATA_DIR = Path(__file__).parent.parent / "data"

# Curated list of price-target series tickers, grouped by asset
ASSET_SERIES = {
    "SPX": [
        "KXINXU",     # above/below
        "KXINXM",     # range
        "KXINXMAXY",  # yearly max
        "KXINXMINY",  # yearly min
        "KXINXPOS",   # positive this year
        "INXU",       # legacy
        "INXM",       # legacy range
        "INXAB",      # close above/below
        "INXY",       # yearly range
    ],
    "GOLD": [
        "KXGOLDMON",  # monthly price
    ],
    "OIL": [
        "WTI",         # daily range
        "OILW",        # weekly
        "KXBRENTW",    # Brent weekly
        "KXBRENTD",    # Brent daily
        "KXWTIMIN",    # WTI yearly low
        "KXWTIMINM",   # WTI monthly low
        "KXHOILMON",   # heating oil monthly
    ],
    "NATGAS": [
        "KXNATGASD",   # daily
        "KXNGAS",      # monthly max/min
        "KXNATGASMON", # monthly
        "NGASW",       # weekly
        "NGAS",        # legacy monthly
        "KXNGASMAX",   # peak
    ],
}


def fetch_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} after {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return {}


def list_markets_for_series(series_ticker: str) -> list[dict]:
    out: list[dict] = []
    cursor = None
    pages = 0
    while pages < 20:
        params = {"series_ticker": series_ticker, "limit": "200"}
        if cursor:
            params["cursor"] = cursor
        url = f"{BASE}/markets?{parse.urlencode(params)}"
        page = fetch_json(url)
        out.extend(page.get("markets", []))
        cursor = page.get("cursor")
        if not cursor:
            break
        pages += 1
    return out


def main():
    DATA_DIR.mkdir(exist_ok=True)
    rows: list[dict] = []
    for asset, tickers in ASSET_SERIES.items():
        print(f"\n== {asset} ==", file=sys.stderr)
        for st in tickers:
            print(f"  pulling {st}", file=sys.stderr)
            try:
                mkts = list_markets_for_series(st)
            except Exception as ex:
                print(f"    failed: {ex}", file=sys.stderr)
                continue
            print(f"    {len(mkts)} markets", file=sys.stderr)
            for m in mkts:
                rows.append({
                    "asset": asset,
                    "ticker": m.get("ticker"),
                    "series_ticker": st,
                    "event_ticker": m.get("event_ticker"),
                    "title": m.get("title"),
                    "subtitle": m.get("subtitle"),
                    "open_time": m.get("open_time"),
                    "close_time": m.get("close_time"),
                    "expiration_time": m.get("expiration_time"),
                    "status": m.get("status"),
                    "result": m.get("result"),
                    "yes_bid": m.get("yes_bid"),
                    "yes_ask": m.get("yes_ask"),
                    "last_price": m.get("last_price"),
                    "volume": m.get("volume"),
                    "open_interest": m.get("open_interest"),
                    "liquidity": m.get("liquidity"),
                    "settlement_value": m.get("settlement_value"),
                })
            time.sleep(0.1)

    print(f"\ntotal rows: {len(rows)}", file=sys.stderr)
    if not rows:
        return

    out_path = DATA_DIR / "kalshi_durability_markets.csv"
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
