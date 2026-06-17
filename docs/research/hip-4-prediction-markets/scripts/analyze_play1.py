"""
Play 1 analysis: does a Polymarket-binary-skew filter improve baseline V7-EMA
expectancy under PROD_ACTUAL exit rules?

Decision framework: descriptive only (per scope reduction; n is too small for
inferential tests). Computes baseline vs filtered aggregate expectancy with
bootstrap CI under several skew-threshold rules. Per-trade table for review.

Usage:
    python3 analyze_play1.py
"""

import csv
import json
import random
import statistics
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


def load(name):
    rows = []
    for r in csv.DictReader((DATA_DIR / name).open()):
        if not r.get("pm_skew_normalized"):
            continue
        try:
            r["pm_skew_normalized"] = float(r["pm_skew_normalized"])
            r["pm_prob_at_spot"] = float(r["pm_prob_at_spot"])
            r["net_pnl_pct"] = float(r["net_pnl_pct"])
            r["mfe_pct"] = float(r["mfe_pct"])
            r["mae_pct"] = float(r["mae_pct"])
        except Exception:
            continue
        rows.append(r)
    return rows


def filter_trade(skew_norm: float, side: str, threshold: float) -> bool:
    """Return True if trade SURVIVES the filter."""
    if side == "long" and skew_norm < -threshold:
        return False
    if side == "short" and skew_norm > +threshold:
        return False
    return True


def bootstrap_mean_ci(values, n=10000, alpha=0.10):
    """Block-bootstrap not used here (small n); simple resample with replacement."""
    if not values:
        return 0.0, (0.0, 0.0)
    means = []
    n_orig = len(values)
    rng = random.Random(42)
    for _ in range(n):
        sample = [values[rng.randint(0, n_orig - 1)] for _ in range(n_orig)]
        means.append(sum(sample) / n_orig)
    means.sort()
    lo = means[int(alpha / 2 * n)]
    hi = means[int((1 - alpha / 2) * n)]
    return sum(values) / n_orig, (lo, hi)


def fmt_trade_row(r):
    return (f"  {r['asset']:4s} {r['side']:5s} {r['ts'][:10]:10s} "
            f"skew={r['pm_skew_normalized']:+.4f}  prob@spot={r['pm_prob_at_spot']:.3f}  "
            f"τ={r['pm_tau_h']}h  net_pnl={r['net_pnl_pct']:+.2f}%  exit={r['exit_reason']}")


def main():
    btc = load("signals_BTC_with_polymarket.csv")
    eth = load("signals_ETH_with_polymarket.csv")
    all_trades = btc + eth
    print(f"BTC trades with PM skew: {len(btc)}")
    print(f"ETH trades with PM skew: {len(eth)}")
    print(f"Total: {len(all_trades)}\n")

    print("=" * 100)
    print("PER-TRADE RECORDS")
    print("=" * 100)
    for r in sorted(all_trades, key=lambda x: x['ts']):
        # Convert ts ms to date string
        from datetime import datetime, timezone
        ts_str = datetime.fromtimestamp(int(r['ts']) // 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        skew = r['pm_skew_normalized']
        prob = r['pm_prob_at_spot']
        side = r['side']
        # Does the binary AGREE with the trade direction?
        if side == "long":
            agrees = "AGREE  " if skew >= 0 else "DISAGREE"
        else:
            agrees = "AGREE  " if skew <= 0 else "DISAGREE"
        print(f"  {r['asset']:4s} {side:5s} {ts_str}  skew={skew:+.4f} prob={prob:.3f}  {agrees}  net={r['net_pnl_pct']:+.2f}%  ({r['exit_reason']})")

    # Baseline aggregate
    base_pnls = [r['net_pnl_pct'] for r in all_trades]
    base_mean, base_ci = bootstrap_mean_ci(base_pnls)
    print(f"\nBaseline n={len(base_pnls)}  mean PnL={base_mean:+.3f}%  90% CI=[{base_ci[0]:+.3f}, {base_ci[1]:+.3f}]")
    base_wins = sum(1 for p in base_pnls if p > 0)
    print(f"Baseline win rate: {base_wins}/{len(base_pnls)} = {base_wins/len(base_pnls):.3f}")

    # Filter under multiple thresholds
    print("\n" + "=" * 100)
    print("FILTER SCAN: trade survives if not contradicted by binary skew above threshold")
    print("=" * 100)
    print(f"  {'threshold':<14s} {'n_filtered':<12s} {'mean PnL':<12s} {'90% CI':<25s} {'win rate':<10s} {'lift vs baseline':s}")
    for thr in [0.001, 0.005, 0.010, 0.020, 0.030, 0.050]:
        survivors = [r for r in all_trades if filter_trade(r['pm_skew_normalized'], r['side'], thr)]
        if not survivors:
            print(f"  {thr:.3f}: 0 trades survive")
            continue
        pnls = [r['net_pnl_pct'] for r in survivors]
        mean, ci = bootstrap_mean_ci(pnls)
        wins = sum(1 for p in pnls if p > 0)
        lift = mean - base_mean
        wr = wins / len(survivors)
        print(f"  {thr:<14.4f} {len(survivors):<12d} {mean:+.3f}%      [{ci[0]:+.3f}, {ci[1]:+.3f}]    {wr:.3f}      {lift:+.3f}pp")

    # By-asset breakdown at threshold 0.005 (the natural midpoint where most signals retain)
    print("\n" + "=" * 100)
    print("BY-ASSET BREAKDOWN at threshold = 0.005")
    print("=" * 100)
    for asset_name, asset_trades in [("BTC", btc), ("ETH", eth)]:
        survivors = [r for r in asset_trades if filter_trade(r['pm_skew_normalized'], r['side'], 0.005)]
        base_pnls_a = [r['net_pnl_pct'] for r in asset_trades]
        if base_pnls_a:
            base_mean_a, _ = bootstrap_mean_ci(base_pnls_a)
        else:
            base_mean_a = 0
        if survivors:
            pnls_a = [r['net_pnl_pct'] for r in survivors]
            mean_a, ci_a = bootstrap_mean_ci(pnls_a)
            wins_a = sum(1 for p in pnls_a if p > 0)
            lift_a = mean_a - base_mean_a
            print(f"  {asset_name}: baseline n={len(asset_trades)} mean={base_mean_a:+.3f}%  filtered n={len(survivors)} mean={mean_a:+.3f}% lift={lift_a:+.3f}pp  win={wins_a}/{len(survivors)}")
        else:
            print(f"  {asset_name}: baseline n={len(asset_trades)} mean={base_mean_a:+.3f}%  filtered n=0 (all vetoed)")

    # Vetoed-only summary: when filter vetoed a trade, what was its outcome?
    print("\n" + "=" * 100)
    print("VETOED TRADES at threshold = 0.005 — what would the filter have removed?")
    print("=" * 100)
    vetoed = [r for r in all_trades if not filter_trade(r['pm_skew_normalized'], r['side'], 0.005)]
    print(f"n vetoed: {len(vetoed)}")
    if vetoed:
        veto_pnls = [r['net_pnl_pct'] for r in vetoed]
        veto_mean, veto_ci = bootstrap_mean_ci(veto_pnls)
        veto_wins = sum(1 for p in veto_pnls if p > 0)
        print(f"vetoed mean PnL: {veto_mean:+.3f}%  90% CI=[{veto_ci[0]:+.3f}, {veto_ci[1]:+.3f}]  wins={veto_wins}/{len(vetoed)}")
        print(f"\nVetoed trades:")
        for r in sorted(vetoed, key=lambda x: x['net_pnl_pct']):
            from datetime import datetime, timezone
            ts_str = datetime.fromtimestamp(int(r['ts']) // 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            print(f"  {r['asset']} {r['side']} {ts_str}  skew={r['pm_skew_normalized']:+.4f}  net={r['net_pnl_pct']:+.2f}%  ({r['exit_reason']})")


if __name__ == "__main__":
    main()
