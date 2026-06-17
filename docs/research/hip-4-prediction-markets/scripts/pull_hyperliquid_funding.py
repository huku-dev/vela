"""
Pull Hyperliquid historical funding rates for BTC and ETH perps.

HL uses a POST-based info endpoint at https://api.hyperliquid.xyz/info.
We request `fundingHistory` for each coin over a window.

Usage:
    python3 pull_hyperliquid_funding.py --coin BTC --days-back 180
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

INFO_URL = "https://api.hyperliquid.xyz/info"
DATA_DIR = Path(__file__).parent.parent / "data"


def post_json(payload: dict, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            r = requests.post(INFO_URL, json=payload, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} after {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return []


def fetch_funding_history(coin: str, start_ms: int, end_ms: int) -> list[dict]:
    """
    Returns list of {coin, fundingRate, premium, time} entries at hourly cadence.
    HL caps responses; we page in 7-day chunks.
    """
    out: list[dict] = []
    chunk_ms = 7 * 24 * 60 * 60 * 1000
    cur = start_ms
    while cur < end_ms:
        chunk_end = min(cur + chunk_ms, end_ms)
        payload = {
            "type": "fundingHistory",
            "coin": coin,
            "startTime": cur,
            "endTime": chunk_end,
        }
        page = post_json(payload)
        out.extend(page)
        cur = chunk_end
        time.sleep(0.1)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--days-back", type=int, default=180)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days_back)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    print(f"fetching {args.coin} funding {start.isoformat()} → {end.isoformat()}", file=sys.stderr)
    history = fetch_funding_history(args.coin, start_ms, end_ms)
    print(f"  {len(history)} hourly funding entries", file=sys.stderr)

    out_path = DATA_DIR / f"hl_funding_{args.coin}_{args.days_back}d.json"
    with out_path.open("w") as f:
        json.dump(history, f)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
