"""
Discover Kalshi BTC and ETH price markets.

Direct-ticker approach: pull /series catalog, filter for known crypto series
(KXBTC*, KXETH*, BTC*, ETH*), then pull markets for each. Much faster than
paging the entire events catalog (which is 60k+ rows mostly non-crypto).

Usage:
    python3 discover_kalshi.py
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

# Strict prefix list: only price-action series, not adjacent meme/regulatory
PRICE_PREFIXES = (
    "KXBTC",  # Bitcoin price-target families
    "KXETH",  # Ethereum price-target families
    "BTC",    # Legacy BTC tickers
    "ETH",    # Legacy ETH tickers
)
# Specific series tickers known to be price-target (curated to filter noise)
EXCLUDE_TOKENS = (
    "MANTIS", "ELONPOST", "STEAKNSHAKE", "SNS", "GTE", "BET", "MEGAETH",
    "ARTIST", "COLLAB", "MEMECOIN", "BANNING", "CONGRESS", "COINBASE",
    "STRATEGY", "SP500", "REGULATION", "REG", "DEPLOY",
)


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


def is_price_series(s: dict) -> bool:
    ticker = (s.get("ticker") or "").upper()
    title = (s.get("title") or "").upper()
    if not any(ticker.startswith(p) for p in PRICE_PREFIXES):
        return False
    if any(tok in ticker or tok in title for tok in EXCLUDE_TOKENS):
        return False
    # also exclude things like "BTC vs ETH" - we want absolute price targets
    if "VS" in title or "RATIO" in title or "FLIP" in title or "HALF" in title:
        return False
    return True


def fetch_all_series() -> list[dict]:
    out = []
    cursor = None
    while True:
        params = {"limit": "500"}
        if cursor:
            params["cursor"] = cursor
        url = f"{BASE}/series?{parse.urlencode(params)}"
        page = fetch_json(url)
        out.extend(page.get("series", []))
        cursor = page.get("cursor")
        if not cursor:
            break
    return out


def list_markets_for_series(series_ticker: str, limit_pages: int = 20) -> list[dict]:
    """Pull all markets under a series, paging by cursor."""
    out: list[dict] = []
    cursor = None
    pages = 0
    while pages < limit_pages:
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
    print("fetching all Kalshi series...", file=sys.stderr)
    series = fetch_all_series()
    print(f"  {len(series)} total series", file=sys.stderr)
    crypto = [s for s in series if is_price_series(s)]
    print(f"  {len(crypto)} crypto price-target series after filter", file=sys.stderr)
    for s in crypto:
        print(f"    {s.get('ticker'):24s}  {s.get('title')}", file=sys.stderr)

    all_markets: list[dict] = []
    for i, s in enumerate(crypto):
        st = s.get("ticker")
        if not st:
            continue
        print(f"  [{i + 1}/{len(crypto)}] pulling {st}", file=sys.stderr)
        try:
            mkts = list_markets_for_series(st)
        except Exception as ex:
            print(f"    failed: {ex}", file=sys.stderr)
            continue
        for m in mkts:
            m["_series_ticker"] = st
            m["_series_title"] = s.get("title")
            all_markets.append(m)
        print(f"    {len(mkts)} markets", file=sys.stderr)
        time.sleep(0.1)

    print(f"\ntotal markets: {len(all_markets)}", file=sys.stderr)
    if not all_markets:
        return

    rows = []
    for m in all_markets:
        rows.append({
            "ticker": m.get("ticker"),
            "series_ticker": m.get("_series_ticker"),
            "series_title": m.get("_series_title"),
            "event_ticker": m.get("event_ticker"),
            "title": m.get("title"),
            "subtitle": m.get("subtitle"),
            "yes_sub_title": m.get("yes_sub_title"),
            "no_sub_title": m.get("no_sub_title"),
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

    out_path = DATA_DIR / "kalshi_btc_eth_markets.csv"
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {out_path}", file=sys.stderr)

    sample_path = DATA_DIR / "sample-kalshi.json"
    with sample_path.open("w") as f:
        json.dump(all_markets[:5], f, indent=2)
    print(f"wrote {sample_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
