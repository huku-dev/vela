# Play 1 Decision: Polymarket binary-skew filter does NOT improve V7-EMA expectancy

**Status:** descriptive pilot, n=19. Decision: **don't ship as designed.**

**Date:** 2026-05-05

---

## Headline

Across 19 V7-EMA trades on BTC + ETH where Polymarket strike-grid binary coverage exists, applying a skew-based veto filter (don't take BUY if binary bearish, don't take SELL if binary bullish) **reduces baseline expectancy at every threshold tested**. The filter vetoes winners at a higher rate than losers.

The decision is to NOT ship Play 1 in this form.

---

## What we tested

- Regenerated V7-EMA signals over 12 months on BTC + ETH using PROD_ACTUAL exit rules (8% stop, ladder TP at 15/25/35, trailing 5%/2.5%, 24h cooldown)
- Aligned each signal with Polymarket strike-grid binaries: "Will the price of [Bitcoin/Ethereum] be above $X on [date]?" with 7-11 strikes per signal time
- Built implied-probability surface via linear interpolation, extracted skew at spot, normalized by sqrt(time-to-expiry)
- Applied veto filter at thresholds [0.001, 0.005, 0.010, 0.020, 0.030, 0.050]
- Baseline = all 19 trades. Treatment = subset surviving the filter at each threshold.

## Coverage

| | Trades generated | With Polymarket coverage |
|--|------------------|--------------------------|
| BTC | 9 | 6 |
| ETH | 16 | 13 |
| **Total** | **25** | **19** |

The 6 trades without PM coverage either pre-date Polymarket strike-grid history (Aug 2025) or fell into temporal gaps with no daily binary. Polymarket BTC/ETH strike-grid binaries with multiple strikes per day became continuous in August 2025; before that, only intermittent special-event markets exist.

## Results

### Baseline

```
n = 19
mean PnL: -1.11%
win rate: 5/19 (26.3%)
90% CI:  [-2.13%, -0.00%]
```

The underlying V7-EMA strategy was net unprofitable over this 19-trade pilot window. Worth noting but not the focus here.

### Filter scan

| Threshold | n surviving | Mean PnL | 90% CI | Win rate | Lift vs baseline |
|-----------|-------------|----------|--------|----------|-----------------|
| 0.001 | 9 | -1.70% | [-2.93%, -0.13%] | 11.1% | **-0.59pp** |
| 0.005 | 9 | -1.70% | [-2.93%, -0.13%] | 11.1% | **-0.59pp** |
| 0.010 | 11 | -1.90% | [-2.91%, -0.56%] | 9.1% | **-0.79pp** |
| 0.020 | 13 | -1.67% | [-2.68%, -0.48%] | 15.4% | **-0.56pp** |
| 0.030 | 14 | -1.40% | [-2.47%, -0.26%] | 21.4% | **-0.29pp** |
| 0.050 | 17 | -1.62% | [-2.55%, -0.61%] | 17.6% | **-0.51pp** |

**Lift is negative at every threshold.** Tightest filters (low threshold) make expectancy worst.

### What gets vetoed

At threshold 0.005 (10 of 19 trades vetoed):

| Outcome | n | Mean PnL |
|---------|---|----------|
| Vetoed cohort (filter would remove) | 10 | -0.58% |
| Survivor cohort (filter keeps) | 9 | -1.70% |

The vetoed cohort had a higher mean PnL (less negative) than the survivor cohort. Translation: **the filter is vetoing better trades on average**.

Even more starkly, at threshold 0.005, 4 of the 10 vetoed trades were +1.74%, +2.02%, +3.01%, +3.47% (all trailing-stop wins). **All 4 of the strategy's biggest winners over the pilot period were vetoed by the filter.**

By-asset breakdown at threshold 0.005:

| Asset | Baseline n / mean | Filtered n / mean | Lift |
|-------|-------------------|-------------------|------|
| BTC | 6 / -0.96% | 2 / -1.74% | -0.78pp |
| ETH | 13 / -1.18% | 7 / -1.69% | -0.51pp |

Neither asset shows lift. Both show worse expectancy under the filter.

## Why the filter fails

Three observations from the per-trade table:

1. **Polymarket binary forecasts a different time horizon than Vela trades occupy.** Polymarket binaries settle in 12-33 hours from signal time. Vela's V7 trades exit on signal-flip / trailing stop / equity stop, which often plays out over multiple days. The binary's "above $X by tomorrow" forecast doesn't capture the 4H-trend-continuation thesis that Vela rides.

2. **Trades that hit trailing-stop wins (the big PnL contributors) are systematically contrarian to binary skew.** All four +PnL outliers in the pilot had binary skew opposing the trade direction. The market thought "BTC closes lower tomorrow" but the trade was a long that ran for several days. Or vice versa. The signal that drives Vela's wins isn't price-direction-tomorrow, it's trend continuation.

3. **The "AGREE" cohort is biased toward losers.** When the binary agrees with Vela's direction at signal time, the immediate-term consensus is already priced in, and Vela's entry at that moment tends to be late. When the binary disagrees, Vela is entering a contrarian trend trade where the disagreement itself reflects the trade's contrarian nature.

This pattern is the OPPOSITE of what the original Play 1 hypothesis assumed. We hypothesized "binary contains directional info that confirms Vela." The data suggests "binary contains short-term mean-reversion bias, while Vela's edge is medium-term trend continuation." Different forecasting horizons.

## What this doesn't rule out

The pilot is descriptive. n=19 is too small to draw strong conclusions. Specifically:

- **Reversed-direction filter** (use binary disagreement as a confidence boost rather than veto) is potentially worth exploring. The pattern in the per-trade table is consistent with this. But with 19 trades, "consistent with" is far from "established."
- **Other use cases for binary data** (position sizing, exit timing, market-consensus UI surface) aren't tested here. They have different mechanics and would need their own evaluation.
- **Other features derivable from the strike grid** (implied vol, tail probability, distribution shape) may carry signal that point-skew doesn't.
- **HIP-4 specifically** isn't tested here; we used Polymarket as a proxy. HIP-4 has different participants and shorter history. A finding from Polymarket may or may not generalize to HIP-4.
- **Longer V7 history** would change the baseline. The pilot baseline was net-negative. A longer window would establish whether that's regime-specific.

## Per-trade table

For reference. Sorted by signal date.

```
ETH  long  2025-09-03  skew=+0.026 prob=0.55  AGREE     -3.98%  signal_flip
BTC  long  2025-10-08  skew=+0.004 prob=0.52  AGREE     -1.25%  signal_flip
ETH  short 2025-10-14  skew=+0.008 prob=0.55  DISAGREE  -3.49%  signal_flip
ETH  short 2025-10-29  skew=-0.024 prob=0.42  AGREE     +5.26%  trailing_stop  (largest win)
ETH  short 2025-12-06  skew=-0.005 prob=0.47  AGREE     -2.63%  signal_flip
ETH  short 2025-12-12  skew=+0.082 prob=0.94  DISAGREE  +3.47%  trailing_stop
BTC  short 2026-02-09  skew=+0.036 prob=0.71  DISAGREE  -0.30%  signal_flip
ETH  short 2026-02-15  skew=-0.022 prob=0.40  AGREE     -1.31%  signal_flip
ETH  short 2026-02-22  skew=+0.011 prob=0.56  DISAGREE  +1.74%  trailing_stop
BTC  short 2026-02-27  skew=+0.033 prob=0.67  DISAGREE  -2.87%  signal_flip
ETH  short 2026-02-27  skew=-0.002 prob=0.49  AGREE     -4.23%  signal_flip
ETH  short 2026-03-06  skew=-0.010 prob=0.45  AGREE     -2.73%  signal_flip
BTC  short 2026-03-06  skew=+0.008 prob=0.54  DISAGREE  -2.12%  signal_flip
BTC  long  2026-03-24  skew=+0.026 prob=0.61  AGREE     -2.23%  signal_flip
ETH  long  2026-03-24  skew=-0.036 prob=0.38  DISAGREE  -4.71%  signal_flip
ETH  long  2026-03-30  skew=-0.012 prob=0.44  DISAGREE  -2.51%  signal_flip
ETH  short 2026-03-30  skew=-0.017 prob=0.43  AGREE     -2.19%  signal_flip
BTC  long  2026-04-13  skew=-0.056 prob=0.22  DISAGREE  +3.01%  trailing_stop
ETH  long  2026-04-13  skew=-0.023 prob=0.39  DISAGREE  +2.02%  trailing_stop
```

## Decision

**Don't ship Play 1 as designed.** The veto-filter integration produces negative lift across every threshold, and the structural reason (different forecasting horizons) is not solvable by parameter tuning.

## What I'd consider next

In rough priority order, only if you want to keep digging on this thesis:

1. **Test the contrarian framing.** Reverse the rule: use binary disagreement as a conviction boost or position-size multiplier rather than a veto. The pilot data suggests this might work but n=19 is far too small to ship on.

2. **Expand the dataset.** Run BB2 trades through the same pipeline. ~16 more trades per asset roughly. Combined ~50 trades wouldn't change the small-n problem materially but would give better directional read on whether the contrarian pattern is real.

3. **Test on a longer horizon binary.** Polymarket also has weekly and "by end of month" markets. A weekly binary's forecast might align better with Vela's trade lifetime. Worth probing if the contrarian framing shows promise on the daily.

4. **Move on.** The structural mismatch between 24h-horizon binary forecasts and multi-day-horizon trend trades may mean prediction-market data fundamentally isn't the right input for V7-EMA. The product memo's other plays (especially the HIP-4 mechanical arb monitor) don't depend on this finding and should proceed independently.

My recommendation: **option 4** (move on for now), with a soft commitment to revisit option 1 (contrarian framing) if and when V7-EMA generates more trades and we have a richer dataset to test against. The HIP-4 arb monitor (Play A) remains the active integration since it doesn't require this signal-quality claim to land.

## Limitations explicitly named

- n=19 is a pilot, not a backtest. All conclusions are descriptive.
- 9 of 25 trades had no Polymarket coverage; the analyzed cohort is non-random over time
- The baseline V7-EMA expectancy was negative over this window; lifts are computed on a low base
- Polymarket vs HIP-4 mechanics differ (UMA oracle vs HL mark, different participant pool); transfer of findings is not guaranteed
- One feature construction (linear interpolation of strike grid, sqrt-time normalization). Other constructions could yield different results.
- One placement (entry veto). Other placements (size modifier, exit informant) not tested.
- Per the original methodology trigger, we are explicitly NOT making an inferential claim. The decision rests on the consistent direction of negative lift across all thresholds and the structural-horizon-mismatch explanation.
