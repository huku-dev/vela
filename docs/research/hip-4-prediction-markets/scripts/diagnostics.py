"""
Three rigorous diagnostics on the BB2 + Polymarket result:

1. Sham-filter benchmark: 10,000 random 5-trade vetoes on the BB2 cohort.
   Where does -1.12% (vetoed-cohort mean) sit in that null distribution?

2. PM-skew-alone predictive test: regress 16h-forward BTC/ETH returns on
   pm_skew_normalized. If R² ~ 0, PM skew has no information beyond price.

3. Look-ahead audit: empirical distribution of (clob_tick_time - signal_time)
   on sampled Polymarket ticks. If positive-skewed, we may be using future info.
"""

import csv
import json
import math
import random
import sys
from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent.parent / "data"
random.seed(42)  # determinism for the sham-filter


def load_aligned(asset: str) -> list[dict]:
    p = DATA_DIR / f"signals_{asset}_with_polymarket.csv"
    rows = []
    for r in csv.DictReader(p.open()):
        if not r.get("pm_skew_normalized"):
            continue
        try:
            r["ts"] = int(r["ts"])
            r["net_pnl_pct"] = float(r["net_pnl_pct"])
            r["pm_skew"] = float(r["pm_skew"])
            r["pm_skew_normalized"] = float(r["pm_skew_normalized"])
            r["pm_prob_at_spot"] = float(r["pm_prob_at_spot"])
            r["pm_tau_h"] = float(r["pm_tau_h"])
            r["entry_price"] = float(r["entry_price"])
        except Exception:
            continue
        rows.append(r)
    return rows


def diag1_sham_filter(trades: list[dict], observed_mean: float, k: int = 5, n_iters: int = 10000):
    """How extreme is removing-5-and-their-mean=-1.12% in the null?"""
    pnls = [t["net_pnl_pct"] for t in trades]
    null_means = []
    for _ in range(n_iters):
        sample = random.sample(pnls, k)
        null_means.append(sum(sample) / k)
    null_means.sort()
    # Percentile of observed_mean (lower = more extreme negative)
    rank = sum(1 for v in null_means if v <= observed_mean)
    pct = rank / n_iters
    print(f"\n=== Diagnostic 1: Sham-filter benchmark ===")
    print(f"  Cohort: {len(trades)} trades")
    print(f"  Observed vetoed-cohort mean: {observed_mean:.4f}%")
    print(f"  k=5, n_iters={n_iters}")
    print(f"  Null distribution (mean of 5 random trades):")
    print(f"    min:    {null_means[0]:+.4f}%")
    print(f"    p05:    {null_means[int(n_iters*0.05)]:+.4f}%")
    print(f"    p25:    {null_means[int(n_iters*0.25)]:+.4f}%")
    print(f"    median: {null_means[n_iters//2]:+.4f}%")
    print(f"    p75:    {null_means[int(n_iters*0.75)]:+.4f}%")
    print(f"    p95:    {null_means[int(n_iters*0.95)]:+.4f}%")
    print(f"    max:    {null_means[-1]:+.4f}%")
    print(f"  Observed sits at percentile: {pct*100:.2f}%")
    if pct < 0.05:
        print(f"  → STATISTICALLY EXTREME (left tail, p={pct:.3f})")
    elif pct < 0.10:
        print(f"  → MARGINAL (p={pct:.3f})")
    else:
        print(f"  → INSIDE NULL: vetoed-cohort mean is consistent with random selection (p={pct:.3f})")


def diag2_pm_alone_predictive(trades: list[dict]):
    """Regress signed-skew-aligned-with-direction on net PnL.

    If PM skew has predictive power, |skew_normalized| should correlate with
    realized return in the direction implied by the skew sign.

    More directly: predict 'will the trade direction be correct' as a fn of
    skew_aligned (skew sign matching trade side). Compare vs baseline win rate.
    """
    # Build (skew_aligned_with_side, win) pairs
    # 'skew_aligned' = +skew if trade is long, -skew if trade is short
    # Positive means binary agrees with trade direction.
    xy = []
    for t in trades:
        side_mult = 1 if t["side"] == "long" else -1
        skew_aligned = side_mult * t["pm_skew_normalized"]
        win = 1 if t["net_pnl_pct"] > 0 else 0
        xy.append((skew_aligned, win, t["net_pnl_pct"]))

    # Simple regression: pnl ~ a + b*skew_aligned
    n = len(xy)
    sx = sum(a[0] for a in xy)
    sy = sum(a[2] for a in xy)
    mx = sx / n
    my = sy / n
    num = sum((a[0]-mx)*(a[2]-my) for a in xy)
    den = sum((a[0]-mx)**2 for a in xy)
    b = num / den if den else 0
    a = my - b * mx
    # R²
    ss_tot = sum((p[2]-my)**2 for p in xy)
    ss_res = sum((p[2] - (a + b*p[0]))**2 for p in xy)
    r2 = 1 - ss_res/ss_tot if ss_tot else 0
    # Pearson r
    sxx = sum((p[0]-mx)**2 for p in xy)
    syy = sum((p[2]-my)**2 for p in xy)
    pearson_r = num / (sxx*syy)**0.5 if sxx > 0 and syy > 0 else 0

    print(f"\n=== Diagnostic 2: PM-skew-alone predictive test ===")
    print(f"  Cohort: {n} BB2 trades on BTC+ETH")
    print(f"  Regression: net_pnl_pct ~ a + b * skew_aligned_with_direction")
    print(f"    a (intercept) = {a:+.4f}")
    print(f"    b (slope)     = {b:+.4f}")
    print(f"    Pearson r     = {pearson_r:+.4f}")
    print(f"    R²            = {r2:.5f}")

    # Bin by skew_aligned and compare win rates / mean PnL
    xy.sort(key=lambda v: v[0])
    qsz = n // 4
    print(f"\n  Quartiles by skew_aligned (most disagreeing → most agreeing):")
    print(f"    {'q':<3}{'n':>5}{'avg skew':>12}{'mean PnL':>12}{'win rate':>12}")
    for i in range(4):
        chunk = xy[i*qsz:(i+1)*qsz] if i < 3 else xy[i*qsz:]
        if not chunk: continue
        avg_skew = sum(c[0] for c in chunk) / len(chunk)
        mean_pnl = sum(c[2] for c in chunk) / len(chunk)
        wins = sum(c[1] for c in chunk) / len(chunk)
        print(f"    q{i+1:<2}{len(chunk):>5}{avg_skew:>+12.4f}{mean_pnl:>+12.4f}{wins:>12.3f}")

    if abs(pearson_r) < 0.10:
        print(f"\n  → R² < 1%: PM skew has NEGLIGIBLE linear predictive power on this cohort")
    elif abs(pearson_r) < 0.20:
        print(f"\n  → R² is small but non-zero. Worth a more rigorous test on held-out.")
    else:
        print(f"\n  → R² is meaningful. Real signal present.")


def diag3_lookahead_audit(trades: list[dict]):
    """Empirical distribution of (clob_tick_time - signal_time).

    Re-pulls CLOB ticks for a sample of aligned trades using the same window
    we used originally (signal_time ± 1 hour) and reports how often we
    grabbed a future tick.
    """
    import time
    # Sample 30 trades
    sample = random.sample(trades, min(30, len(trades)))
    lags = []  # seconds (positive = tick is after signal)
    print(f"\n=== Diagnostic 3: Look-ahead audit ===")
    print(f"  Auditing {len(sample)} sampled aligned trades")
    print(f"  Re-pulling CLOB prices-history for one strike each, measuring "
          f"(tick_time - signal_time) for the tick the aligner would have used")

    # We need a Polymarket market and token. For a quick audit, just use the
    # spot strike grid lookup we already did (cached in CSV ticker column).
    # Since CSV doesn't store the token, we re-derive: find market via gamma
    # for the trade window, then sample one strike near spot.
    audited = 0
    for t in sample:
        if audited >= 30: break
        ts_s = t["ts"] // 1000
        spot = t["entry_price"]
        # Find market for asset closing within 48h of ts
        asset_name = "Bitcoin" if t["asset"] == "BTC" else "Ethereum"
        offset = 0
        chosen = None
        for offset in range(0, 5000, 500):
            url = (f"https://gamma-api.polymarket.com/markets"
                   f"?limit=500&closed=true&end_date_min={time.strftime('%Y-%m-%d', time.gmtime(ts_s))}"
                   f"&end_date_max={time.strftime('%Y-%m-%d', time.gmtime(ts_s + 86400*2))}"
                   f"&offset={offset}")
            try:
                batch = requests.get(url, timeout=20).json()
            except Exception:
                break
            if not batch: break
            for m in batch:
                q = (m.get("question","") or "").upper()
                if asset_name.upper() in q and "ABOVE $" in q and "PRICE" in q:
                    try:
                        tokens = json.loads(m.get("clobTokenIds") or "[]")
                        # Get strike from question
                        import re
                        match = re.search(r"\$([\d,]+)", m.get("question",""))
                        if not match: continue
                        strike = float(match.group(1).replace(",",""))
                        if abs(strike - spot) / spot < 0.02 and tokens:
                            chosen = (tokens[0], strike)
                            break
                    except Exception:
                        continue
            if chosen: break
            if len(batch) < 500: break
        if not chosen: continue
        token, strike = chosen
        start_ts = ts_s - 3600
        end_ts = ts_s + 3600
        try:
            r = requests.get(f"https://clob.polymarket.com/prices-history?market={token}"
                            f"&startTs={start_ts}&endTs={end_ts}&fidelity=60", timeout=20)
            history = r.json().get("history", [])
        except Exception:
            continue
        if not history: continue
        # The aligner uses 'closest tick within window' — find that
        ticks_by_distance = sorted(history, key=lambda h: abs(h["t"] - ts_s))
        chosen_tick = ticks_by_distance[0]
        lag = chosen_tick["t"] - ts_s
        lags.append(lag)
        audited += 1
        time.sleep(0.05)

    if not lags:
        print(f"  No lags collected (audit incomplete)")
        return
    lags.sort()
    n = len(lags)
    print(f"  n audited: {n}")
    print(f"  Lag distribution (tick_time - signal_time, in seconds):")
    print(f"    min:    {lags[0]:>8d}s")
    print(f"    p10:    {lags[int(n*0.10)]:>8d}s")
    print(f"    p25:    {lags[int(n*0.25)]:>8d}s")
    print(f"    median: {lags[n//2]:>8d}s")
    print(f"    p75:    {lags[int(n*0.75)]:>8d}s")
    print(f"    p90:    {lags[int(n*0.90)]:>8d}s")
    print(f"    max:    {lags[-1]:>8d}s")
    pct_future = sum(1 for l in lags if l > 0) / n
    print(f"  Share of audited ticks taken from AFTER signal_time: {pct_future*100:.1f}%")
    avg_pos = sum(l for l in lags if l > 0) / max(1, sum(1 for l in lags if l > 0))
    print(f"  Avg lag among future ticks: {avg_pos:.0f}s ({avg_pos/60:.1f} min)")
    if pct_future > 0.6:
        print(f"  → LOOK-AHEAD RISK: majority of sampled ticks are post-signal. Re-run with strict last-tick-before-signal.")
    elif pct_future > 0.4:
        print(f"  → SOME RISK: meaningful share of post-signal ticks. Worth re-running.")
    else:
        print(f"  → LOW RISK: most sampled ticks are pre-signal.")


def main():
    btc = load_aligned("BTC")
    eth = load_aligned("ETH")
    combined = btc + eth
    print(f"Loaded: BTC={len(btc)} ETH={len(eth)} combined={len(combined)} aligned BB2 trades")

    # Observed vetoed-cohort mean = -1.12% per earlier analysis
    diag1_sham_filter(combined, observed_mean=-1.12, k=5, n_iters=10000)

    diag2_pm_alone_predictive(combined)

    diag3_lookahead_audit(combined)


if __name__ == "__main__":
    main()
