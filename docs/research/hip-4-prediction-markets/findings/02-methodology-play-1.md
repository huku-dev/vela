# Methodology: Play 1 — Prediction-market binary skew as Vela signal-engine input

**Status:** pre-registered. Locked before any data is pulled. Deviations from this document during execution must be flagged in the writeup.

**Date:** 2026-05-05

---

## 1. Hypothesis

Adding Kalshi BTC and ETH binary skew as a confirming filter on Vela's V7/BB2 signal entries produces positive expectancy lift under PROD_ACTUAL exit rules over 12 months of historical price data, on out-of-sample walk-forward windows.

Falsifies if: expectancy lift is non-positive, or fails to clear the BH-corrected significance threshold, or fails the walk-forward stability test, or the null-feature negative control also produces apparent lift.

---

## 2. Specific scope

| Dimension | v1 |
|-----------|-----|
| Assets | BTC, ETH only |
| Cadence | Vela's existing 4H signal cadence |
| Horizon | 24h forward window (single horizon) |
| Data window | 12 months (2025-05-05 to 2026-05-05). Falls back to oldest-available date per asset if a data source has shorter history. |
| Venue | Kalshi only. Polymarket deferred to v2. |
| Binary cadence | Hourly KXBTCD for BTC, KXETHD for ETH. We sample at the Kalshi market open immediately preceding each Vela signal time. |
| User-facing surface | None. UI surface is a separate v2 spec. |

---

## 3. Datasets

### 3.1 Vela historical signals (regenerated)

Live signal history is ~7 weeks. Insufficient for 80% power on a 3pp expectancy lift. We regenerate would-have-been signals using existing backtest infrastructure (`crypto-agent/scripts/backtest/*`) against 12 months of HL price data.

**Fields needed per signal:**
- timestamp (4H boundary in UTC)
- asset (`btc`, `eth`)
- direction (`buy`, `sell`)
- entry price
- the realized outcome under PROD_ACTUAL exit rules: TP-1, TP-2, TP-3, equity stop, trailing stop, EMA cooldown exit, 24h forced exit
- realized PnL in basis points
- which gate fired (V7, BB2, or both)

**Acknowledged overfit limitation:** PROD_ACTUAL config (8% equity stop, ladder TP at 15/25/35%, 5%/2.5% trailing, 24h EMA cooldown) was tuned partially on this 12-month period. The test does not produce a universal claim about binary skew. It produces a ship-decision specifically for our config. Writeup explicitly disclaims generalization.

### 3.2 Kalshi binary data

KXBTCD and KXETHD series, 12-month window, server-side filtered via `min_close_ts`/`max_close_ts`. For each Vela signal timestamp:
- Find the active Kalshi binary whose open_time is ≤ signal_time and close_time > signal_time
- Pull all strikes available on that binary
- Pull yes_bid_open, yes_ask_open at signal_time using 1-minute candlesticks

### 3.3 HL spot

HL hourly candles for BTC, ETH at 1h resolution over the 12-month window. Used for:
- Anchoring the binary's "ATM strike" (closest strike to spot at signal time)
- Computing realized return at signal_time + 24h for outcome attribution

---

## 4. Feature construction (locked)

For each Vela signal at timestamp t:

1. Look up HL spot price S_t at the 4H boundary
2. Find the active Kalshi binary covering t (open_time ≤ t < close_time)
3. Extract all available strikes K_i and their yes_mid_open prices p_i
4. Linearly interpolate the implied probability surface to extract p(S_t) = the implied probability of close > S_t at the binary's expiry
5. Compute time-to-expiry τ = close_time − t in hours
6. Define **binary skew** as:

   ```
   skew_t = (p(S_t) − 0.5) / sqrt(τ / 1h)
   ```

   This normalizes for time-to-expiry under a sqrt-of-time vol assumption, so the skew is comparable across different binary horizons.

7. Define **binary skew sign** as:

   ```
   skew_sign_t = +1 if skew_t > +threshold
                 −1 if skew_t < −threshold
                  0 otherwise
   ```

   Threshold is pre-registered at the 33rd/67th percentile of |skew_t| across the in-sample window. This produces three balanced buckets: clear-bullish, clear-bearish, neutral.

**Why this construction:** linear interpolation of the strike grid is the simplest defensible approach. Black-Scholes-style fits add parameters and assumptions. Kernel smoothing adds bandwidth tuning. We pre-commit to linear interpolation; alternatives only get tried if v1 kills cleanly and we want a v1.5 retry.

**Edge cases:**
- If <3 strikes are available, skew_t is null
- If the closest strike is >1% from spot, skew_t is null (interpolation unreliable)
- If yes_bid_open or yes_ask_open is null/zero, skew_t is null
- Null skew → signal proceeds unchanged (binary filter has no opinion)

---

## 5. Gate-stack placement (locked)

Binary skew acts as a **confirming filter on V7 and BB2 entries**, not as an independent signal source. Specifically:

- A V7 BUY entry fires only if `skew_sign_t ∈ {+1, 0}` (binary not bearish)
- A V7 SELL entry fires only if `skew_sign_t ∈ {−1, 0}` (binary not bullish)
- Same logic for BB2 entries
- When `skew_sign_t == 0` (neutral) or null, the entry fires per current logic
- When `skew_sign_t` opposes the entry direction, the entry is **vetoed** (no trade)

This is the most conservative integration: binary skew can only suppress trades, never add new ones. It tests whether the binary filter improves expectancy by avoiding bad trades. If the answer is yes, that's the cleanest possible win. If the answer is no, we've ruled out the simplest version with high confidence.

Alternative placements (size modifier, exit informant, signal generator) are explicitly out of scope for v1.

---

## 6. Statistical tests (locked)

### Primary metric

**Expectancy per signal under PROD_ACTUAL exit rules**, in basis points.

Compared between:
- **Baseline:** V7/BB2 signals from regenerated backtest, no binary filter
- **Treatment:** same signals filtered by binary skew sign

### Tests

1. **Diebold-Mariano test** on PnL-weighted forecast loss between baseline and treatment. Loss = realized PnL × signal direction. Higher is better.
2. **Block-bootstrap** with 7-day blocks on the difference series. Block size chosen to capture intra-week autocorrelation while breaking regime cycles. 10,000 resamples. Compute 95% CI on expectancy lift.
3. **Newey-West standard errors** with lag = 6 (4H × 6 = 24h overlap window) on the expectancy difference.
4. **Walk-forward expanding window:** train window starts at month 1, tests month 2; expands monthly through month 12. Eleven walk-forward folds.
5. **Multiple-comparisons correction:** Benjamini-Hochberg at q=0.10 across the 2 (asset) × 1 (horizon) = 2 tests in v1. Correction burden is light because scope is tight.

### Negative control

**Null feature:** random Bernoulli(p) where p matches the marginal probability of `skew_sign == ±1` in the data. Re-run the entire test substituting null feature for binary skew. If the null feature also lifts expectancy at p<0.10, the harness has a leak and v1 results are invalid until the leak is found.

### Decision rule

**Ship if all of the following hold:**
- Expectancy lift > 0 on at least one of (BTC, ETH)
- DM test p < 0.10 after BH correction
- Block-bootstrap 95% CI on expectancy lift excludes zero
- Walk-forward stability: lift sign is positive in ≥75% of the 11 folds for the qualifying asset
- Null feature does **not** also pass at p<0.10

**Kill if any of the following:**
- All decision-rule conditions fail
- Null feature passes (harness leak)
- Lift is positive in-sample but inverts in OOS folds (overfit)

---

## 7. Power analysis (run before pull)

Before pulling data, estimate power. Inputs:
- Pilot effect size: q4 vs q1 hit-rate spread = 24pp on binary skew. Conservative translation to expectancy: assume ~5pp lift translates to ~0.5σ standard effect.
- Signal cadence: BTC and ETH at 4H = ~6 signals per day, ~2200 signals per asset in 12 months.
- After binary-coverage filtering: assume ~70% retention = ~1500 signals per asset.

Approximate power calculation: at α=0.05, n=1500, σ=1, detectable effect at 80% power ≈ 0.07σ. The pilot's implied effect is ~7x the minimum detectable. Power is not a binding constraint at 12 months for BTC and ETH.

**If the actual binary-coverage retention is <40% (i.e., <900 signals per asset), trigger a scope review before continuing.**

---

## 8. Validation checks (during execution)

Before declaring any result, verify:

1. The implied-probability surface produces sensible values (p(S_t) ∈ [0,1], monotonic in K)
2. The Kalshi binary expiry chosen for each signal is the closest one (no expired binaries used)
3. The PnL attribution under PROD_ACTUAL matches the actual exit rules in `signal-persistence.ts`
4. The walk-forward folds are non-overlapping in time
5. The null-feature distribution matches the marginal of `skew_sign`
6. No future-information leak: feature construction uses only data ≤ signal_time

If any check fails, document and either fix or kill the run.

---

## 9. Out of scope explicitly

- Multi-asset (SPX, GOLD, OIL, NATGAS): defer to v2
- Multi-horizon (72h, 168h): defer to v2
- Polymarket as parallel data source: defer to v2 (acknowledged as different participant pool with confirmation value if v1 lands)
- "Markets agree" UI surface: separate spec
- Alternative feature constructions (Black-Scholes fit, kernel smoothing): considered only if v1 kills cleanly
- Alternative gate placements (size modifier, exit informant): defer
- Live integration: scope only the backtest decision in v1; engineering the live ingest is a separate scope downstream of the ship-decision

---

## 10. Outputs

On completion:
- `findings/02-methodology-play-1.md` (this document)
- `findings/03-play-1-decision.md` — go/no-go writeup with full statistics, walk-forward results, null-feature control, validation checks, and engineering scope estimate (if go)
- Aligned data: `data/play1_aligned_BTC_12mo.csv`, `data/play1_aligned_ETH_12mo.csv`
- Backtest harness: `scripts/backtest_play1.py`

If the test passes, the engineering scope for live integration ships in a follow-up methodology doc with its own pre-registration of operational decisions (cron cadence, fail-open vs fail-closed when Kalshi is down, monitoring, etc.).
