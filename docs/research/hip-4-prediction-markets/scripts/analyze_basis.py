"""
Play 0 basis check: does HL perp funding diverge from Kalshi ATM binary
implied probability in a way that creates delta-neutral edge?

Inputs:
- HL funding history (hourly): hl_funding_<COIN>_<N>d.json
- Kalshi ATM hourly binary timeseries: kalshi_atm_<ASSET>_<SERIES>_<N>d.csv

Method:
For each aligned hour:
  funding_rate_hourly_pct = hl funding rate (already hourly, in raw fraction)
  implied_prob_up = kalshi_yes_mid_open  (probability of close > strike at hour end)
  ATM strike ≈ median of available strikes ≈ opening spot

Theory:
  If perp is fairly priced and binary is fairly priced AND both reflect the
  same forward expectation, then funding rate (cost of long perp) should
  correlate with binary's implied probability of upside (since high
  bullishness drives both: longs pay more funding, binary "above current"
  prices higher).

  Specifically: a positive funding rate of f% per hour means perp price drifts
  up vs spot at f% rate. So the binary "yes above current spot at hour end"
  should price at >50% by approximately N(f / sigma) under naive Gaussian.
  Conversely, binary at 50% with positive funding implies the binary is
  underpricing upside (or perp is overpriced).

Output:
  - aligned hourly CSV
  - summary stats (mean, std of funding vs implied prob, correlation)
  - regime histogram: distribution of (implied_prob - 0.5) vs funding sign

Usage:
    python3 analyze_basis.py --asset BTC --funding-coin BTC --kalshi-csv kalshi_atm_BTC_KXBTCD_30d.csv
"""

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
FINDINGS_DIR = Path(__file__).parent.parent / "findings"


def load_funding(funding_path: Path) -> dict[int, float]:
    """Map hour-floor unix ts -> hourly funding rate (raw fraction)."""
    by_hour = {}
    with funding_path.open() as f:
        rows = json.load(f)
    for r in rows:
        # HL returns time in ms
        t_hour = int(r["time"] // 1000 // 3600 * 3600)
        rate = float(r.get("fundingRate") or 0)
        by_hour[t_hour] = rate
    return by_hour


def load_kalshi(csv_path: Path) -> list[dict]:
    rows = []
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            try:
                r["open_ts"] = int(r["open_ts"])
                r["close_ts"] = int(r["close_ts"])
                r["yes_mid_open"] = float(r["yes_mid_open"])
                r["yes_bid_open"] = float(r["yes_bid_open"])
                r["yes_ask_open"] = float(r["yes_ask_open"])
                r["strike"] = float(r["strike"])
            except Exception:
                continue
            rows.append(r)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--funding-coin", required=True)
    parser.add_argument("--kalshi-csv", required=True)
    parser.add_argument("--days-back", type=int, default=180)
    parser.add_argument("--out-suffix", default="")
    args = parser.parse_args()

    funding_path = DATA_DIR / f"hl_funding_{args.funding_coin}_{args.days_back}d.json"
    kalshi_path = DATA_DIR / args.kalshi_csv
    if not funding_path.exists():
        print(f"missing {funding_path}", file=sys.stderr)
        sys.exit(1)
    if not kalshi_path.exists():
        print(f"missing {kalshi_path}", file=sys.stderr)
        sys.exit(1)

    funding_by_hour = load_funding(funding_path)
    kalshi_rows = load_kalshi(kalshi_path)
    print(f"funding hours: {len(funding_by_hour)}", file=sys.stderr)
    print(f"kalshi atm rows: {len(kalshi_rows)}", file=sys.stderr)

    # Align: for each kalshi row, look up the funding for the hour at open_ts
    aligned = []
    for r in kalshi_rows:
        hour_ts = r["open_ts"] // 3600 * 3600
        f = funding_by_hour.get(hour_ts)
        if f is None:
            continue
        prob = r["yes_mid_open"]
        # If the kalshi binary uses "greater than strike" the ATM yes_mid_open is P(up).
        # implied minus 0.5 = bullish skew of binary
        binary_skew = prob - 0.5
        # funding rate annualized (HL pays funding hourly). 8760 hours per year.
        funding_apr = f * 8760
        aligned.append({
            "hour_ts": hour_ts,
            "asset": r.get("asset") or args.asset,
            "ticker": r["ticker"],
            "strike": r["strike"],
            "yes_mid_open": prob,
            "binary_skew": binary_skew,
            "funding_hourly": f,
            "funding_apr": funding_apr,
            "result": r.get("result"),
        })

    print(f"aligned hours: {len(aligned)}", file=sys.stderr)
    if len(aligned) < 30:
        print("insufficient overlap, aborting", file=sys.stderr)
        sys.exit(2)

    # Stats
    skews = [a["binary_skew"] for a in aligned]
    fundings = [a["funding_apr"] for a in aligned]

    def corr(xs, ys):
        n = len(xs)
        mx = sum(xs) / n
        my = sum(ys) / n
        sx = (sum((x - mx) ** 2 for x in xs) / n) ** 0.5
        sy = (sum((y - my) ** 2 for y in ys) / n) ** 0.5
        if sx == 0 or sy == 0:
            return 0.0
        return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (n * sx * sy)

    print(f"\n== {args.asset} basis stats ==")
    print(f"  binary skew:     mean={statistics.mean(skews):+.4f} std={statistics.stdev(skews):.4f}")
    print(f"  funding APR:     mean={statistics.mean(fundings):+.4f} std={statistics.stdev(fundings):.4f}")
    print(f"  correlation:     {corr(skews, fundings):+.4f}")

    # Regime breakdown: count cases where binary disagrees with funding sign
    agree = 0
    disagree = 0
    flat = 0
    for a in aligned:
        if abs(a["binary_skew"]) < 0.02 or abs(a["funding_apr"]) < 0.05:
            flat += 1
            continue
        if (a["binary_skew"] > 0) == (a["funding_apr"] > 0):
            agree += 1
        else:
            disagree += 1
    total_meaningful = agree + disagree
    print(f"  regime: agree={agree} disagree={disagree} flat={flat}")
    if total_meaningful:
        print(f"          disagree-share={disagree / total_meaningful * 100:.1f}% (of non-flat)")

    # Hit rate by quartile of disagreement
    aligned.sort(key=lambda r: r["binary_skew"] - 0.5 * (r["funding_apr"] / max(abs(min(fundings)), abs(max(fundings)), 1e-9)))
    q1 = aligned[:len(aligned) // 4]
    q4 = aligned[-len(aligned) // 4:]
    def hit_rate(rows):
        hits = sum(1 for r in rows if r.get("result") == "yes")
        n = len(rows)
        return hits / n if n else 0
    print(f"  q1 (binary lower than funding implies): hit rate of yes = {hit_rate(q1):.3f}")
    print(f"  q4 (binary higher than funding implies): hit rate of yes = {hit_rate(q4):.3f}")

    # Persist aligned data
    out_csv = DATA_DIR / f"basis_aligned_{args.asset}{args.out_suffix}.csv"
    with out_csv.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(aligned[0].keys()))
        w.writeheader()
        w.writerows(aligned)
    print(f"\nwrote {out_csv}", file=sys.stderr)


if __name__ == "__main__":
    main()
