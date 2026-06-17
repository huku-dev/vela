"""
Discover Polymarket BTC and ETH price-target markets.

Uses Gamma API for event/market discovery (closed + open). Filters for
crypto price-target markets and dumps a CSV of candidates with metadata.

Usage:
    python3 discover_polymarket.py [--days-back 180]
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from urllib import parse

import requests

GAMMA_BASE = "https://gamma-api.polymarket.com"
DATA_DIR = Path(__file__).parent.parent / "data"


def fetch_json(url: str, retries: int = 3) -> dict | list:
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} after error: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return {}


def discover_markets(days_back: int) -> list[dict]:
    """
    Pull markets matching crypto price targets.

    Gamma API supports filtering by tag and date. We grep the universe for
    BTC / ETH / Bitcoin / Ethereum keywords in the question text since
    Polymarket tagging on crypto-price markets is inconsistent.
    """
    keywords = ["bitcoin", "btc", "ethereum", "eth"]
    candidates: list[dict] = []
    seen_ids: set[str] = set()

    # Gamma /markets supports limit + offset. We page through closed markets
    # in the time window. closed=true gives us settled markets with outcomes.
    offset = 0
    page_size = 500
    while True:
        params = {
            "closed": "true",
            "limit": str(page_size),
            "offset": str(offset),
            "order": "endDate",
            "ascending": "false",
        }
        url = f"{GAMMA_BASE}/markets?{parse.urlencode(params)}"
        print(f"fetching offset={offset}", file=sys.stderr)
        page = fetch_json(url)
        if not page:
            break

        for m in page:
            mid = str(m.get("id"))
            if mid in seen_ids:
                continue
            question = (m.get("question") or "").lower()
            if not any(k in question for k in keywords):
                continue
            # filter to price-target style markets
            if not any(s in question for s in ["price", "reach", "above", "below", "$", "hit"]):
                continue
            seen_ids.add(mid)
            candidates.append({
                "id": mid,
                "slug": m.get("slug"),
                "question": m.get("question"),
                "end_date": m.get("endDate"),
                "start_date": m.get("startDate"),
                "outcomes": m.get("outcomes"),
                "outcome_prices": m.get("outcomePrices"),
                "volume": m.get("volume"),
                "liquidity": m.get("liquidity"),
                "clob_token_ids": m.get("clobTokenIds"),
            })

        if len(page) < page_size:
            break
        offset += page_size

        # belt-and-suspenders cap to avoid runaway in spike mode
        if offset > 20000:
            print("hit safety cap at 20k offset", file=sys.stderr)
            break

    return candidates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days-back", type=int, default=180)
    parser.add_argument("--out", type=str, default="polymarket_btc_eth_markets.csv")
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    candidates = discover_markets(args.days_back)
    print(f"\nfound {len(candidates)} BTC/ETH price-target markets", file=sys.stderr)

    if not candidates:
        return

    out_path = DATA_DIR / args.out
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(candidates[0].keys()))
        writer.writeheader()
        for row in candidates:
            for k, v in row.items():
                if isinstance(v, (list, dict)):
                    row[k] = json.dumps(v)
            writer.writerow(row)
    print(f"wrote {out_path}", file=sys.stderr)

    # also write a small JSON sample of the first 5 for shape inspection
    sample_path = DATA_DIR / "sample-polymarket.json"
    with sample_path.open("w") as f:
        json.dump(candidates[:5], f, indent=2)
    print(f"wrote {sample_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
