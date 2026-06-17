# Play 1 Decision: KILL

**Date:** 2026-05-05
**Status:** locked. Play 1 (prediction-market binary skew as signal-engine filter) does not justify shipping based on available evidence.

---

## Bottom line

Polymarket binary skew has no detectable signal as a filter on Vela's V7 or BB2 entries over the 12-month evaluation window. The single positive lift observed (BB2 +0.02pp) is statistically indistinguishable from zero, fails a randomization control, and rests on a feature with R² ≈ 0.15% against forward returns. Methodology audit also identified a look-ahead bias in the aligner that the result didn't survive correcting for at the level of evidence available.

No ship. No further parameterization. Workstream closed for now.

---

## Evidence summary

### V7 (4H EMA, multi-day hold)

- n = 19 BB2 trades with Polymarket coverage
- Baseline mean PnL: -1.11% (90% CI [-2.13%, -0.00%])
- Filter at threshold 0.005: mean PnL -1.70%, **lift -0.59pp**
- All 4 trailing-stop wins were vetoed by the filter

V7 trades hold for days; Polymarket binaries settle 12-33h out. Horizon mismatch. Filter removes winners systematically.

### BB2 (4H RSI BB, ~16h typical hold)

- n = 208 BB2 trades with Polymarket coverage (101 BTC + 107 ETH)
- Baseline mean PnL: -0.30% (90% CI [-0.47%, -0.12%])
- Filter at threshold 0.005: mean PnL -0.28% (CI [-0.45%, -0.10%]), **lift +0.02pp**
- 5 trades vetoed (3 hit BB2 stop, 2 of those are correlated BTC/ETH on same date)

CI overlap is near-total. Two-sample p~0.85. Lift is direction-of-effect only, not evidence of effect.

### Diagnostic 1: Sham-filter benchmark

Random 5-trade vetoes on the BB2 cohort, 10,000 iterations:

| Percentile | Null mean PnL |
|------------|---------------|
| p05 | -1.31% |
| p10 | ~-1.12% |
| p25 | -0.77% |
| median | -0.36% |
| p75 | +0.11% |
| p95 | +0.93% |

Observed vetoed-cohort mean of -1.12% sits at the **10.2nd percentile**. Marginally left-tail, not statistically extreme. Consistent with random selection at p = 0.102.

### Diagnostic 2: PM-skew-alone predictive test

Linear regression of net_pnl_pct on skew_aligned_with_direction over the 208-trade BB2 cohort:

- Pearson r: +0.039
- R²: **0.00153 (0.15% of variance)**
- Slope: +1.49, intercept: -0.36

Quartile breakdown (most disagreeing → most agreeing):

| Quartile | n | avg skew | mean PnL | win rate |
|----------|---|----------|----------|----------|
| q1 | 52 | +0.006 | -0.58% | 0.33 |
| q2 | 52 | +0.025 | -0.28% | 0.44 |
| q3 | 52 | +0.042 | +0.20% | 0.50 |
| q4 | 52 | +0.091 | -0.54% | 0.40 |

**Non-monotonic.** A real signal would produce monotonic improvement across quartiles. q4 (binary agrees most strongly with trade direction) is WORSE than q3, breaking the pattern. Consistent with noise.

### Diagnostic 3: Look-ahead audit

Audited 25 of the 208 aligned trades by re-pulling CLOB prices-history with ±1h window and measuring (tick_time - signal_time):

| Percentile | Lag (seconds) |
|------------|---------------|
| p10 | -3552 |
| p25 | +7 |
| median | +13 |
| p75 | +18 |
| p90 | +37 |

**84% of sampled ticks are post-signal.** Median lag +13 seconds after signal time. The aligner systematically grabbed future ticks because Polymarket strike books are sparse and the closest tick to signal time is often the first liquidity event after.

The lag is small (seconds on a 16h trade), so the bias is unlikely to flip a real signal to null or vice versa. But it's a methodology defect that the result didn't withstand correcting for at the level of evidence we have.

---

## Conclusions

1. The horizon-match hypothesis (V7 fails / BB2 succeeds because BB2 horizon better matches Polymarket binary horizon) was post-hoc and is not supported by Diagnostic 2's R² = 0.15%. If horizon match were the mechanism, PM skew would have measurable predictive power on the BB2 cohort. It doesn't.

2. The +0.02pp BB2 lift was a direction-of-effect read on a sample with overlapping CIs. The reviewer's adversarial pass identified this correctly. I should have caught it before reporting the lift as encouraging.

3. The vetoed-cohort -1.12% mean is consistent with random selection of 5 trades from the cohort. Without the randomization control, the "3.7x worse than baseline" framing was overreach.

4. The methodology bug (post-signal ticks) is small in magnitude but indicates the aligner should be rewritten for any future related work. Strict last-tick-before-signal is the correct approach.

---

## What this leaves on the table

**Play 1 (binary as signal input):** killed for now. May resurrect if:
- HIP-4 matures and provides same-venue data with stricter timing
- A different feature construction (Black-Scholes-style, kernel smoothing, raw prob_at_spot without normalization) shows monotonic predictive power in Diagnostic 2
- A different strategy or asset cohort shows monotonic predictive power
- The product question changes (e.g., user-facing market consensus display, which doesn't require predictive power, only display value)

**Play A (HIP-4 mechanical arb monitor):** unchanged, still on the roadmap. Research infrastructure with Henry-tradeable surface. Independent of Play 1's outcome.

**Cross-venue arb monitoring (HIP-4 vs Kalshi vs Polymarket):** unchanged. Wait for HIP-4 liquidity.

---

## Process notes / lessons

For future research workstreams in this category:

1. **Randomization control is mandatory** for any "removed cohort vs baseline" claim, not optional. Should be in the methodology doc, not added after reviewer pressure.

2. **Predictive power on the feature alone** should be tested before testing its utility as a filter. If the feature has no predictive power on its own, the filter result is mathematically constrained to be noise.

3. **Look-ahead audit** is mandatory whenever we sample external time-series at a specific timestamp via fuzzy windowing. Default to strict last-tick-before-signal.

4. **CI overlap is the headline.** When CIs overlap near-totally, "lift" point estimates are not evidence. Should not be reported as encouraging.

5. **Direction-of-effect ≠ effect.** This was the pattern I fell into twice in this workstream (vetoed-cohort, BB2 lift). Both times the reviewer caught it. The discipline is to ask "what's the null hypothesis distribution and where does my observed value sit" before forming any directional claim.

6. **Pre-registered diagnostics**, not post-hoc. The three diagnostics that produced the kill (sham filter, PM-skew-alone, look-ahead audit) should have been in the methodology doc as mandatory pre-launch checks, not as response to reviewer pressure.

These go into the next methodology doc as standing requirements.
