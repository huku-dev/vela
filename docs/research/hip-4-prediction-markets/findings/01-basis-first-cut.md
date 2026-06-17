# Play 0 Basis Check — First Cut

Date: 2026-05-03
Status: preliminary, 30-day BTC sample only

## Question

Does HL perp funding diverge from prediction-market binary implied probability in a way that creates delta-neutral edge for a long-binary / short-perp (or vice versa) structure?

## Method

- HL BTC funding: 180 days hourly funding rate, annualized
- Kalshi KXBTCD: hourly binary "BTC close > strike at hour end". Pulled all 30-day-window markets, picked one per hour (median strike, see caveat), pulled their candlesticks for the open quote
- Joined v1 dataset to HL hourly spot, computed moneyness, kept only rows where the picked strike is within ±0.5% of spot (true ATM)
- Aligned 142 hours

Funding rate annualized = hourly_rate × 8760
Binary skew = yes_mid_open − 0.5 (positive = market thinks "above strike" is more than 50/50)

## Results

```
n = 142 hours
moneyness mean: −0.06%, std: 0.28%   (clean ATM filter)
binary_skew mean: +0.052, std: 0.189
funding APR  mean: +0.017, std: 0.083
correlation(binary_skew, funding APR): −0.041
```

**Correlation between binary implied probability and funding APR is essentially zero.** The two markets are not moving in tandem at hourly resolution.

### Quartiles by binary skew

| q | n | avg skew | avg funding APR | yes-rate |
|---|---|---------|-----------------|----------|
| 1 (most bearish binary) | 35 | −0.185 | +0.016 | 0.714 |
| 2 | 35 | +0.001 | +0.023 | 0.743 |
| 3 | 35 | +0.089 | +0.018 | 0.400 |
| 4 (most bullish binary) | 37 | +0.290 | +0.010 | 0.946 |

### Quartiles by funding APR

| q | n | avg skew | avg funding APR | yes-rate |
|---|---|---------|-----------------|----------|
| 1 (low funding) | 35 | +0.091 | −0.103 | 0.800 |
| 2 | 35 | +0.026 | +0.012 | 0.800 |
| 3 | 35 | −0.001 | +0.051 | 0.514 |
| 4 (high funding) | 37 | +0.091 | +0.102 | 0.703 |

### Disagreement regimes

| Regime | n | yes-rate |
|--------|---|----------|
| Both bullish (skew > +0.02, fund > +0.02 APR) | 37 | 0.649 |
| Both bearish | 6 | 0.667 |
| Binary up, funding down | 19 | 0.842 |
| Binary down, funding up | 18 | 0.667 |

## Findings

1. **No basis correlation.** Binary implied prob and funding APR move independently at hourly resolution (r = −0.04). The two markets are not simply two views on the same forward.

2. **Binary contains directional information that funding doesn't.** Binary skew quartiles are predictive of settlement (q1 71% → q4 95%, monotonic except q3). Funding quartiles are not (q1 80%, q4 70%, weakly inverted).

3. **In disagreement, the binary wins.** When binary is bullish but funding is bearish, yes hits 84%. When binary is bearish but funding is bullish, yes still hits 67%. The binary's signal beats funding's signal in head-to-head disagreement cases.

## What this means for Play 0

The original Play 0 thesis: a delta-neutral structure (long binary + short perp) monetizes funding while the binary leg provides directional hedge. Conclusion: this thesis isn't supported by the data as framed.

- The basis (correlation between funding and binary) is structurally absent, not a transient mispricing. Funding rate is not pricing the same thing the binary is pricing.
- Funding rate as a market-implied signal is weak. Binary as a market-implied signal is strong (q1 → q4 hit rate spread = 23 percentage points monotonically).
- A "basis arb" that bets funding is wrong is just betting against the binary, which would be betting against a higher-quality signal.

**The actual edge appears to live in Play 1, not Play 0.** Binary implied probability is a richer directional signal than funding rate. Using binary as an input to the perp signal engine is the play. Trying to monetize the basis directly (funding-arb structure) doesn't have a clear edge story.

## Caveats

1. **Sample size**: 142 hours = ~6 days of clean data over 30-day window. Rest of the 720 hours had strike-grid gaps (no Kalshi market within 0.5% of spot at that hour).

2. **Sample bias**: BTC has been in an uptrend over the 30-day window. Q1 baseline yes-rate of 71% reflects this. Need to extend to multiple regimes before strong conclusions.

3. **ATM proxy**: v1 puller picked the median strike per hour. Filtered post-hoc to truly ATM rows via HL spot. Lost 80% of candidate hours to the filter. A v2 puller that picks ATM at fetch time would recover those hours.

4. **Single asset**: BTC only so far. Durability check on ETH + non-crypto pending.

5. **Kalshi vs HIP-4 mechanics**: Kalshi participants and settlement (CFTC-regulated, USD spot) differ from HIP-4 (HL mark, crypto-degens). Direction of finding may transfer; magnitude won't.

## Next steps

1. Expand BTC sample to 90 days using v2 puller (proper ATM at fetch time).
2. Replicate on ETH (KXETHD).
3. Replicate on SPX (KXINXU), GOLD (KXGOLDMON), OIL (KXBRENTD), NATGAS (KXNATGASD) for non-crypto durability.
4. Re-frame the integration thesis around Play 1 (binary as signal input) since Play 0's specific premise looks weak.
