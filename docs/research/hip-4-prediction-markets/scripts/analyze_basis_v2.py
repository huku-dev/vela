"""
Basis analysis v2: properly ATM-filter using HL spot.

Loads v1 Kalshi ATM CSV, joins with HL hourly spot, filters to rows where the
v1-picked strike was within tolerance of actual spot (true ATM).
"""

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


def load_funding_by_hour(coin: str, days_back: int) -> dict[int, float]:
    p = DATA_DIR / f"hl_funding_{coin}_{days_back}d.json"
    out = {}
    for r in json.load(p.open()):
        t = int(r["time"] // 1000 // 3600 * 3600)
        out[t] = float(r.get("fundingRate") or 0)
    return out


def load_spot_open_by_hour(coin: str, days_back: int) -> dict[int, float]:
    p = DATA_DIR / f"hl_candles_{coin}_1h_{days_back}d.json"
    out = {}
    for c in json.load(p.open()):
        t = int(c["t"] // 1000 // 3600 * 3600)
        out[t] = float(c["o"])
    return out


def load_kalshi(csv_path: Path) -> list[dict]:
    rows = []
    for r in csv.DictReader(csv_path.open()):
        try:
            r["open_ts"] = int(r["open_ts"])
            r["close_ts"] = int(r["close_ts"])
            r["yes_mid_open"] = float(r["yes_mid_open"])
            r["strike"] = float(r["strike"])
        except Exception:
            continue
        rows.append(r)
    return rows


def corr(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    sx = (sum((x-mx)**2 for x in xs)/n)**0.5
    sy = (sum((y-my)**2 for y in ys)/n)**0.5
    if sx == 0 or sy == 0:
        return 0.0
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys)) / (n*sx*sy)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--funding-coin", required=True)
    parser.add_argument("--candles-coin", required=True)
    parser.add_argument("--kalshi-csv", required=True)
    parser.add_argument("--funding-days", type=int, default=180)
    parser.add_argument("--candles-days", type=int, default=90)
    parser.add_argument("--moneyness-tol", type=float, default=0.005)  # 0.5% of spot
    args = parser.parse_args()

    funding = load_funding_by_hour(args.funding_coin, args.funding_days)
    spot = load_spot_open_by_hour(args.candles_coin, args.candles_days)
    kalshi = load_kalshi(DATA_DIR / args.kalshi_csv)
    print(f"funding hrs={len(funding)}  spot hrs={len(spot)}  kalshi rows={len(kalshi)}", file=sys.stderr)

    aligned = []
    for r in kalshi:
        h = r["open_ts"] // 3600 * 3600
        s = spot.get(h)
        f = funding.get(h)
        if s is None or f is None:
            continue
        moneyness = (r["strike"] - s) / s
        if abs(moneyness) > args.moneyness_tol:
            continue
        # P(close > strike); if strike ≈ spot, this approximates P(up)
        prob_up = r["yes_mid_open"]
        funding_apr = f * 8760  # hourly → annualized
        aligned.append({
            "hour_ts": h,
            "asset": r.get("asset") or args.asset,
            "ticker": r["ticker"],
            "strike": r["strike"],
            "spot_open": s,
            "moneyness": moneyness,
            "prob_up": prob_up,
            "binary_skew": prob_up - 0.5,
            "funding_hourly": f,
            "funding_apr": funding_apr,
            "result": r.get("result"),
        })
    print(f"aligned at moneyness ≤ {args.moneyness_tol*100:.2f}%: {len(aligned)} rows", file=sys.stderr)
    if len(aligned) < 30:
        print("insufficient overlap", file=sys.stderr)
        sys.exit(2)

    skews = [a["binary_skew"] for a in aligned]
    fundings = [a["funding_apr"] for a in aligned]
    moneynesses = [a["moneyness"] for a in aligned]

    print(f"\n== {args.asset} basis stats (true ATM, |moneyness|≤{args.moneyness_tol*100:.2f}%) ==")
    print(f"  n: {len(aligned)} hours")
    print(f"  moneyness: mean={statistics.mean(moneynesses)*100:+.3f}%  std={statistics.stdev(moneynesses)*100:.3f}%")
    print(f"  binary_skew (prob_up − 0.5): mean={statistics.mean(skews):+.4f}  std={statistics.stdev(skews):.4f}")
    print(f"  funding APR: mean={statistics.mean(fundings):+.4f}  std={statistics.stdev(fundings):.4f}")
    print(f"  correlation(skew, funding_apr): {corr(skews, fundings):+.4f}")

    # Hit rate by quartile of binary skew
    aligned.sort(key=lambda r: r["binary_skew"])
    q = len(aligned) // 4
    quartiles = [aligned[:q], aligned[q:2*q], aligned[2*q:3*q], aligned[3*q:]]
    print("\n  quartile hit-rate (yes settles) by ranked binary skew:")
    for i, qr in enumerate(quartiles, 1):
        if not qr:
            continue
        hits = sum(1 for r in qr if r.get("result") == "yes")
        skew_avg = sum(r["binary_skew"] for r in qr) / len(qr)
        funding_avg = sum(r["funding_apr"] for r in qr) / len(qr)
        print(f"    q{i}: n={len(qr)}  avg skew={skew_avg:+.4f}  avg funding APR={funding_avg:+.4f}  hit={hits/len(qr):.3f}")

    # Quartile by funding sign
    aligned.sort(key=lambda r: r["funding_apr"])
    quartiles = [aligned[:q], aligned[q:2*q], aligned[2*q:3*q], aligned[3*q:]]
    print("\n  quartile hit-rate by funding APR (low → high):")
    for i, qr in enumerate(quartiles, 1):
        if not qr:
            continue
        hits = sum(1 for r in qr if r.get("result") == "yes")
        skew_avg = sum(r["binary_skew"] for r in qr) / len(qr)
        funding_avg = sum(r["funding_apr"] for r in qr) / len(qr)
        print(f"    q{i}: n={len(qr)}  avg skew={skew_avg:+.4f}  avg funding APR={funding_avg:+.4f}  hit={hits/len(qr):.3f}")

    # Disagreement regime: binary says up, funding says down (or vice versa)
    dis_bin_up_fund_down = [a for a in aligned if a["binary_skew"] > 0.02 and a["funding_apr"] < -0.02]
    dis_bin_dn_fund_up = [a for a in aligned if a["binary_skew"] < -0.02 and a["funding_apr"] > 0.02]
    agree_up = [a for a in aligned if a["binary_skew"] > 0.02 and a["funding_apr"] > 0.02]
    agree_dn = [a for a in aligned if a["binary_skew"] < -0.02 and a["funding_apr"] < -0.02]
    print(f"\n  agreement regimes:")
    print(f"    both bullish:           n={len(agree_up)}  yes-rate={sum(1 for a in agree_up if a['result']=='yes')/max(1,len(agree_up)):.3f}")
    print(f"    both bearish:           n={len(agree_dn)}  yes-rate={sum(1 for a in agree_dn if a['result']=='yes')/max(1,len(agree_dn)):.3f}")
    print(f"    binary up, funding dn:  n={len(dis_bin_up_fund_down)}  yes-rate={sum(1 for a in dis_bin_up_fund_down if a['result']=='yes')/max(1,len(dis_bin_up_fund_down)):.3f}")
    print(f"    binary dn, funding up:  n={len(dis_bin_dn_fund_up)}  yes-rate={sum(1 for a in dis_bin_dn_fund_up if a['result']=='yes')/max(1,len(dis_bin_dn_fund_up)):.3f}")

    out_csv = DATA_DIR / f"basis_aligned_v2_{args.asset}.csv"
    with out_csv.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(aligned[0].keys()))
        w.writeheader()
        w.writerows(aligned)
    print(f"\nwrote {out_csv}", file=sys.stderr)


if __name__ == "__main__":
    main()
