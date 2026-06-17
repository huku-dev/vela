# Play A v3 deferred — reframe spot-vs-outcome bot before building

**Date:** 2026-05-13
**Status:** v3 build deferred. v1 (mechanical arb) and v1.5 (mid-life position monitoring) remain shipped.

---

## Summary

The original v3 plan was to build a "spot-vs-outcome dislocation detector" using Black-Scholes binary call pricing as fair value, then trade directionally when observed binary mid diverged from BS fair value. Adversarial review identified that the framing was wrong and several core mechanics were internally inconsistent. The build is deferred pending an honest backtest and an architecture pivot.

---

## What v3 was supposed to be

- Compute fair YES price using `fair_yes = N(d2)` with `σ` from realized vol
- When `|observed_yes_mid - fair_yes| > threshold`, buy YES (if undervalued) or NO (if overvalued)
- Hold until convergence to fair, expiry, or stop on adverse fair-value move
- Sizing scales with mispricing magnitude

---

## What the review surfaced

### The trade was misframed as "lag arb"

The proposed bot computes a fair-value estimate, buys when observed < fair, and presumes convergence. The reviewer (correctly) reframed this as:

> The edge comes from your σ being right and the market's σ being wrong. Full stop. Lag is one mechanism by which the market's σ is temporarily wrong, not the edge itself.

Mathematically this is a **probability bet** (your conditional probability estimate vs the market's), not a lag arb. Two hard consequences:

1. **Hold-to-expiry should be the default**, not a failure mode. If σ is your edge, you collect it at settlement, not at convergence.
2. **The "stop loss on fair-value drift" logic is internally inconsistent.** If S moves so fair value drops to match observed, expected value has gone to zero — cutting at that moment locks the loss exactly when no edge remains. Correct action: do nothing (the position still has terminal EV given the original probability estimate) or re-evaluate σ.

### Selection bias risk on manual profits

The manual trading evidence that motivated v3 was Henry's experience profiting from dislocations during a mostly-bullish stretch. Reviewer's null hypothesis: profits were partly directional luck (buying YES during BTC up-moves looks like alpha when it's just delta). Distinguishable only with a regime-balanced backtest.

### Real practitioners do something different

SIG and Jane Street on Kalshi are running:
1. **Market-making** with model midpoint + inventory skew, earning the spread instead of paying it
2. **Cross-venue arb** (same event on multiple venues, different prices)
3. **Replication portfolios**: pricing binaries against synthetic constructions from spot + perp + nearby-strike binaries (vertical spreads). They detect violations of static no-arb relationships, not violations of a BS model.

The "compare binary to BS fair value" approach is what retail quants do. It loses to market-making because the MM has better σ, lower latency, and gets paid the spread we'd be paying.

### Adverse selection in thin books

HIP-4 day-one volume was ~$6M total. In a market that thin, "attractive" mispricings we see from a polling bot are likely either:
- Priced correctly given information we don't have (a participant saw a perp print before our poll cycle)
- Already taken by lower-latency HFT before our order lands

So our fill rate on "good-looking" mispricings will be systematically worse than fill rate on normal trades. Classic adverse selection.

### Capital efficiency was understated

Each binary contract locks $0.30 (or whatever fill price) for up to 24h. ROC per trade looks attractive (33% gross on a successful 0.5% edge), but with a thin book supporting maybe 2-3 fills/day, annualized capital efficiency is meaningfully worse than the perp basis trades Henry is used to.

### Specific technical issues with the proposed model

- Funding-rate as IV proxy is wrong (funding is a positioning signal, not dispersion)
- Static realized vol systematically under-estimates σ during regime transitions
- BS Gaussian assumption is most correct at ATM (low edge) and least correct in the tails (where mispricings could exist but books are thinnest)
- Path-dependent settlement (pin behavior near strike) breaks the Brownian motion assumption

---

## Revised architecture if/when v3 gets built

The reviewer's strongest recommendation: don't build the BS-fair-value-vs-observed bot. Build one of these instead.

### Option A: Paired perp + binary vol-selling structure (preferred)

Long BTC perp + long NO at strike-above-spot, sized for delta-neutrality at S=K. This is a vol-selling trade: you collect if realized vol < implied vol in the binary's pricing. Clean edge story (we sell realized vol back to binary holders), relative-value rather than directional, doesn't require σ to be "right" in an absolute sense.

### Option B: Market maker, not taker

Quote both sides of the binary book using a model midpoint plus inventory skew. Earn spread instead of paying it. Requires lower latency (significant engineering increase) but the spread is consistent income, not an occasional dislocation.

### Option C: Vertical spread no-arb monitor (waiting on multi-strike)

When HIP-4 has multiple strikes per question, `YES(K1) − YES(K2) for K1 < K2` must be in [0, 1]. Violations are real static arbitrage. Today's single-strike HIP-4 doesn't support this; revisit when multi-strike depth exists.

---

## What we built instead

### v1: Mechanical arb (taker, paired)

Detects `yes_ask + no_ask + fees < $1` dislocations on HIP-4 binaries. Submits matched IOC orders via `bulk_orders` (atomic, single signed action). Hard safeguards: $1000/opportunity, $10k/day, 0.5% min edge, $500 min depth, 0.3% quote-drift abort, partial-fill halt, settlement-divergence halt.

### v1.5: Mid-life position monitoring

After v3 deferral, the mid-life monitor's role shifted from "find better early exits" to **observability + manipulation alerts**. Specifically:

- One-sided book detection (alert if T-30min and one leg has no bid or ask)
- Wide spread alerts (>5% on either leg within an hour of expiry)
- Mark-vs-expected-settle divergence tracking (logged at >5%)
- Pre-settle alert at T-30min: current book state, likely winning side, signs of pin/manipulation

This addresses the settlement-manipulation risk identified in both the original adversarial review and the v3 review.

---

## Conditions to revisit v3

Revisit if any of the following:

1. **~30 days of HIP-4 tick history accumulated.** Enables an honest backtest with realistic fill model (mid − half spread − 1 tick − fees), across multiple BTC regimes.
2. **Multi-strike HIP-4 markets list.** Unlocks Option C (vertical spread no-arb).
3. **HL options list with matching expiries.** Unlocks credible IV input for σ (instead of realized-vol proxies).
4. **v1 mechanical arb hits the 4-week criteria.** Validates that we can capture HIP-4 opportunities operationally before committing to a more complex strategy.

If/when revisited, the backtest is the first deliverable, not the bot:
- 60 days of tick data
- Realistic fill model
- Regime balance (up / down / chop)
- Null benchmark (random-direction strategy with same sizing)
- Kill threshold: Sharpe < 1.0 net = don't build

---

## Process notes

- Spinning up adversarial reviewers before committing engineering time has paid off twice (Play 1 kill, v3 reframe). Should be standard for any non-trivial trading bot proposal going forward.
- The "lag arb" framing was the kind of plausible-sounding story that didn't survive math scrutiny. Reviewer caught it immediately. The pattern: when a hypothesis is built on observation + a clean mechanism (lag → convergence), check whether the mechanism is actually load-bearing or just decorative.
- Real practitioners do market-making + cross-venue + replication. Retail quants do BS-fair-value-vs-observed. The gap between "what looks intuitive" and "what actually pays" is consistent across the literature. Defaulting to the retail-quant pattern is a known failure mode.
