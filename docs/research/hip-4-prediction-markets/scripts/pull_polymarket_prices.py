"""
Pull historical price timeseries for a Polymarket market.

Uses the CLOB prices-history endpoint. Each market has 2 outcome tokens
(Yes/No). We pull both for symmetry.

Usage:
    python3 pull_polymarket_prices.py --token-id <id> [--interval 1h]

To pull for all BTC/ETH markets discovered earlier, set --from-csv.
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from urllib import parse

import requests

CLOB_BASE = "https://clob.polymarket.com"
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


def fetch_prices_history(token_id: str, interval: str = "1h", fidelity: int = 60) -> list[dict]:
    """
    Get historical prices for a CLOB token.

    Polymarket's prices-history endpoint accepts either an `interval` param
    (1m / 1w / 1d / max etc) or `startTs` + `endTs`. Returns list of
    {t: timestamp, p: price}.
    """
    params = {"market": token_id, "interval": interval, "fidelity": str(fidelity)}
    url = f"{CLOB_BASE}/prices-history?{parse.urlencode(params)}"
    return fetch_json(url).get("history", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token-id", help="Single CLOB token ID to pull")
    parser.add_argument("--from-csv", help="CSV file from discover_polymarket.py")
    parser.add_argument("--limit", type=int, default=10, help="Max markets to pull when using --from-csv")
    parser.add_argument("--interval", default="max")
    parser.add_argument("--fidelity", type=int, default=60, help="Minutes per data point")
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)

    if args.token_id:
        history = fetch_prices_history(args.token_id, args.interval, args.fidelity)
        print(f"got {len(history)} points")
        sample_path = DATA_DIR / f"sample-prices-{args.token_id[:12]}.json"
        with sample_path.open("w") as f:
            json.dump(history[:50], f, indent=2)
        print(f"sample written to {sample_path}")
        return

    if args.from_csv:
        rows = list(csv.DictReader(open(args.from_csv)))
        # rank by volume, take top N
        rows.sort(key=lambda r: float(r.get("volume") or 0), reverse=True)
        rows = rows[:args.limit]
        print(f"pulling top {len(rows)} markets by volume", file=sys.stderr)

        all_series: dict[str, list[dict]] = {}
        for r in rows:
            try:
                tokens = json.loads(r["clob_token_ids"])
            except Exception:
                continue
            yes_token = tokens[0] if tokens else None
            if not yes_token:
                continue
            print(f"  {r['question'][:80]} ({r['volume']})", file=sys.stderr)
            try:
                hist = fetch_prices_history(yes_token, args.interval, args.fidelity)
                all_series[r["id"]] = {
                    "question": r["question"],
                    "end_date": r["end_date"],
                    "outcome_prices": r["outcome_prices"],
                    "yes_token_id": yes_token,
                    "history": hist,
                }
                print(f"    {len(hist)} points", file=sys.stderr)
            except Exception as e:
                print(f"    failed: {e}", file=sys.stderr)
            time.sleep(0.2)

        out_path = DATA_DIR / "polymarket_prices_history.json"
        with out_path.open("w") as f:
            json.dump(all_series, f, indent=2)
        print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
