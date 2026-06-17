"""
Pull Hyperliquid hourly candles for a coin. Used for hour-open spot prices.

Usage:
    python3 pull_hl_candles.py --coin BTC --days-back 90
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
            time.sleep(2 ** attempt)
    return []


def fetch_candles(coin: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    out: list[dict] = []
    chunk_ms = 4000 * 60 * 60 * 1000  # 4000h per request (HL caps at 5000)
    cur = start_ms
    while cur < end_ms:
        chunk_end = min(cur + chunk_ms, end_ms)
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": coin,
                "interval": interval,
                "startTime": cur,
                "endTime": chunk_end,
            },
        }
        page = post_json(payload)
        out.extend(page)
        if not page:
            break
        cur = chunk_end + 1
        time.sleep(0.1)
    # Dedupe
    seen = set()
    deduped = []
    for c in out:
        t = c.get("t")
        if t in seen:
            continue
        seen.add(t)
        deduped.append(c)
    return deduped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--days-back", type=int, default=180)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days_back)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    print(f"fetching {args.coin} {args.interval} candles {args.days_back}d", file=sys.stderr)
    candles = fetch_candles(args.coin, args.interval, start_ms, end_ms)
    print(f"  {len(candles)} candles", file=sys.stderr)

    out_path = DATA_DIR / f"hl_candles_{args.coin}_{args.interval}_{args.days_back}d.json"
    with out_path.open("w") as f:
        json.dump(candles, f)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
