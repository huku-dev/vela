# HIP-4 Outcome Markets: Integration Brief for Vela

**Date:** 2026-09-17
**Author:** Claude (Opus 4.7), on Henry's ask during the routine HL API monitor
**Status:** Research / scoping. No decisions yet. **Empirical section below is verified against testnet — three probe runs against staging-deployed `hip4-probe` edge function using the real HL testnet key.**
**Scope:** What HIP-4 outcome markets are, what integrating them into Vela would touch, and the two shapes an integration can take (native-only trading vs Vela-as-builder-deployer).

---

## TL;DR

HIP-4 has been live on mainnet since **2026-05-02**, with daily-expiring binary outcomes on BTC/ETH/HYPE/SOL, at least one multi-outcome BTC price-range market, and permissionless builder-deployed markets open since **2026-08-29** (500K HYPE stake required).

Integrating HIP-4 as a **trading client** is a moderate lift, roughly on the order of adding a new asset class to our adapter. It reuses the L1 action signing path we already have. Empirical check (2026-09-17): mainnet already has ~221 live outcomes across four deployer venues — `out` (100, "Outcome"), `txyz` (80), `skew` (33), and 8 native-HL-deployed (no `venue` field). USDC is confirmed as the quote token on both mainnet and testnet — the "USDH is required" story from Chainstack's guide is stale.

The differences from perps are:

1. A new asset addressing scheme (`#N` / `+N` / `100_000_000 + N` — three forms of the same ID, easy to mix up). The `+N`-in-coin-field footgun silently returns `null` from `l2Book` — verified live.
2. HL treats outcome markets as **spot** internally. Same fee card (spot: 7bps cross / 4bps add), no reduce-only, no trigger orders (HL error: "not enabled yet"). Vela's adapter extends the spot path, not a new asset kind.
3. Fully collateralized in **USDC** (verified — USDH story was stale). No leverage, no liquidation. Price bounded `[0.001, 0.999]`, integer sizes, **$1 USDC min notional** (not $10 as Chainstack claimed). Fee on open verified $0.
4. A different signal shape — probabilities of dated events, not continuous price movement. This affects Vela's signal engine more than the plumbing.

Integrating HIP-4 as a **builder-deployer** (Vela-branded prediction markets) is a much larger commitment: 500K HYPE stake (~$5–15M depending on price), ongoing settlement responsibility, a 183-day minimum before deactivation, template governance, and an oracle-correctness / regulatory surface. Not recommended without a concrete product hypothesis.

**Confidence: high on plumbing (verified live on testnet, section below). Confidence: high on collateral (USDC everywhere, verified). Confidence: moderate on exact fees at scale (open fee = $0 confirmed; close/settle fee schedule confirmed at spot-rate 4–7bps but currently 0 on outcomes).**

---

## Empirical findings — testnet, 2026-09-17

Deployed a probe edge function (`hip4-probe`) to staging that signed and submitted real L1 actions against Hyperliquid testnet using our production adapter's wire-format helpers. Three runs. Wallet `0xac13f186…5637`.

### Confirmed by trade

| Question | Empirical answer |
|---|---|
| Wire pipeline (msgpack → phantom agent → EIP-712) for outcomes | **Same as perps/spot.** Standard `order` action with `a = 100_000_000 + 10*outcome + side` accepted. No custom pipeline. |
| Asset addressing | **Three-form scheme confirmed.** Placed order via `#102480`; server addressed it as `assetId 100102480`; balance appeared as `+102480` — exactly the `10*outcome + side` encoding. |
| Balance shape | **`+N` form, confirmed.** After buying 3 units of outcome 10400 side 1, `spotClearinghouseState.balances` showed `{coin: "+104001", total: "3.0", hold: "0.0", entryNtl: "1.5"}`. Both YES and NO sides get pre-populated once you touch the outcome — the untouched side appears with `total: "0.0"`. |
| Order response shape | **Standard spot shape.** Resting: `{resting: {oid}}`. Filled: `{filled: {totalSz, avgPx, oid}}`. Error: `{error: string}`. Same as spot orders. |
| Open-order shape | `{coin: "#102480", side: "B", limitPx: "0.05", sz: "22.0", oid, timestamp, origSz}` — the `coin` field carries the `#N` form. |
| Cancel action | `{type: "cancel", cancels: [{a: assetId, o: oid}]}` — returns `{data: {statuses: ["success"]}}`. |
| Fee on open (marketable buy) | **$0.** Fill line: `{fee: "0.0", feeToken: "USDC", crossed: true, closedPnl: "0.0"}`. Confirms Chainstack: opening is free ("mint"). |
| Minimum order value | **$1 USDC** (NOT $10 as Chainstack claimed). Error: `"Order must have minimum value of 1 USDC. asset=100102480"`. |
| Quote token | **USDC** on both testnet and mainnet. `feeToken: "USDC"` on every fill. |

### Deltas from the brief

1. **HL treats outcome markets as *spot* internally.** Not a separate instrument class. Two errors verified: `"Reduce-only is invalid for spot trading"` and `"Placing trigger orders is not enabled on spot trading yet"`. This is a big deal — Vela's adapter can extend its spot path rather than build a third asset kind.
2. **Trigger orders (SL/TP) do NOT work on outcomes today.** HL's error language says "not enabled … yet", so plausibly coming. For now, any Vela signal exit logic on HIP-4 has to be software-driven (poll and hit market), not native triggers.
3. **`reduce-only` is rejected on outcomes.** Vela's adapter uses `r: true` on all trigger orders and some close orders on perps. For outcomes, use `r: false` on close orders.
4. **The `+N` in coin field footgun is real.** `l2Book` with `coin: "+102480"` returned `null` — silent fail, no error. `l2Book` with `coin: "#102480"` returned data. Chainstack was right. Vela's asset resolver needs to reject `+N` in order/book paths early with a clear error, not just fail silently downstream.
5. **`entryNtl` on outcome balance is populated.** `entryNtl: "1.5"` on 3 units filled at $0.5 = avg cost × size. That's a useful field for PnL calc without walking `userFills`.
6. **Testnet is very illiquid.** In 32 surveyed outcomes, essentially every candidate had either empty books or synthetic 0.0001/0.9999 placeholder liquidity from the HL house market maker. Only outcome 10400 had a tight 0.5/0.5 book we could hit. **Any Vela integration testing on testnet needs to accept this** — real fill behavior is only observable on mainnet.
7. **Fee schedule (verified from `userFees.feeSchedule`):**
   - Spot (outcomes fall here): cross **7 bps**, add **4 bps**. VIP tiers scale down to cross 2.5 bps / add 0 bps at $7B lifetime volume.
   - Perp: cross 4.5 bps, add 1.5 bps. VIPs down to 2.6 bps / 0 bps.
   - MM rebates for high maker fraction: −1 to −3 bps.
   - Referral discount 4%. Staking discount up to 40%.
   - **But actual observed fee on open: $0.** So outcomes are on spot's rate card in principle but currently zero on opens.

### Residual from probe testing

We hold 3 units of `+104001` (outcome 10400 NO side, $1.50 entry) — the close IOC failed because the mid-book bid dried up. This is testnet dust, not consequential. Options: wait for settlement, or place a resting sell above best-bid and let it match. Not blocking.

### Builder fees on outcome orders — verified

Attached `builder: {b: "0x...dead", f: 1}` to an outcome order. HL response: **`"Builder fee has not been approved"`** — the standard HL error path, identical to spot/perp when the builder hasn't been pre-approved. Means:
- The `builder` field is **accepted on outcome orders** at the wire level.
- Enabling builder fees on outcome orders uses the **same `approveBuilderFee` action** we already use for perps.
- Vela's existing builder-fee auto-recovery in `placeOrder()` should work unchanged for outcome orders — verify at rollout.

### What we didn't test

- **Full close-fee capture on testnet** — impossible. Every candidate outcome had one-sided books (asks only, no bids). Our position from E6 is stuck at 3 units on a market for which the referenced FIFA match resolution date has already passed but which hasn't settled on testnet. Cite `userFees.feeSchedule` (spot cross 7bps / add 4bps) as the authoritative source and verify the actual fee on the first mainnet close.
- **Settlement crediting.** Requires waiting for expiry; not something a single probe can observe.
- **Multi-outcome split/negate/merge** — no wire-format work done; templates exist but probing them is a phase 2 exercise.
- **WebSocket `outcomeMetaUpdates`** — didn't open a socket; no push observed.

---

## What HIP-4 is

HIP-4 introduces a third instrument type on Hyperliquid, alongside perps and spot. Each contract:

- Represents a dated, real-world event with a clear settlement rule (a price threshold, an economic release, a yes/no question).
- Trades as **two coins per outcome** — a YES side and a NO side. The two order books are merged for shared liquidity; resting-sell YES orders sit at the same price level as resting-buy NO orders.
- Is **fully collateralized** — max loss is your position size. No leverage. No liquidation.
- Settles at expiry to a fraction between 0 and 1. Binary markets settle to exactly 0 or 1. Multi-outcome markets settle to any fraction in `[0, 1]`.
- Auto-settles into the user's account. There is no `claim` / `redeem` call.

The launch market was a **recurring daily binary BTC outcome** — settles at 06:00 UTC to the HyperCore BTC mark price interpolated between two flanking updates. As of August 2026, similar daily binaries exist for ETH, HYPE, and SOL, plus at least one multi-outcome market (BTC price-range with buckets like <$90k / $90–110k / >$110k).

Multi-outcome markets add three primitives: **split** (one unit of collateral → one of each outcome), **negate** (short an outcome without touching the others), **merge** (recombine a full set back to collateral).

---

## What changes for Vela as a **trading client**

This is the smaller integration path. Vela already places orders on Hyperliquid via `hyperliquid-adapter.ts`. HIP-4 orders go through the same L1 action signing → EIP-712 → HL exchange endpoint pipeline. The changes are asset resolution, invariants, and info-endpoint plumbing.

### Asset addressing — three forms of one ID

Given an outcome `outcome` (integer) and a side (0 = YES, 1 = NO), the encoding is:

```
encoding = 10 * outcome + side
```

That single number appears in three different string prefixes depending on where you use it:

| Where used | Form | Example for outcome 220, YES |
|---|---|---|
| Order placement, L2 book | `#<encoding>` | `#2200` |
| Balance in `spotClearinghouseState` | `+<encoding>` | `+2200` |
| Protocol asset ID (wire format) | `100_000_000 + encoding` | `100_002_200` |

**This is the single biggest footgun in the API.** Chainstack's guide warns: "Mixing them up will silently fail to find your position — `l2Book` with `+10` returns nothing, balance lookup with `#10` returns nothing." Our adapter needs one canonical resolver that produces all three forms from `(outcome_id, side)` and never accepts the raw prefix strings from outside.

The community TS SDK's `SymbolConverter` also accepts a semantic name form like `btc-above-61720-yes-jun-08-0600` which resolves to asset ID `100_002_200`. Useful for logs and admin, not for wire.

### Wire format — same order action as spot

Orders use the standard `order` action with `a = 100_000_000 + encoding`. Everything else — signing scheme, msgpack ordering, phantom agent, EIP-712, builder fee — is unchanged. Our `computeActionHash` and `placeOrder` path should work as-is once the asset resolver knows about outcome coins.

Order invariants specific to HIP-4:

- Price in `[0.001, 0.999]` (probability). Tick `0.0001` on BTC daily.
- Size is **integer only** (`szDecimals = 0`).
- Minimum notional `$10` (of quote asset, currently USDH).
- Order types: `Gtc` limit and market/IOC confirmed. Trigger/stop orders not documented.

### Info-endpoint surface

New Info methods Vela would call:

| Method | Purpose |
|---|---|
| `outcomeMeta` | Full inventory of live outcomes + questions (returns `outcome`, `name`, `description`, `sideSpecs`, `quoteToken`, `deployer` for builder-deployed) |
| `settledOutcome` | Post-settlement lookup: `settleFraction`, details, spec |
| `outcomeDeployerLimits` | Per-venue caps (daily new outcomes + active count remaining) — only relevant if we become a deployer |
| `spotClearinghouseState` | Already used for spot balances. Now also returns `+<encoding>` balances for outcomes held. Its `coin` type widened in the wire format to include `` `o${number}` `` for **settled** outcomes (post-settlement balance representation). |

New WebSocket subscription:

- `outcomeMetaUpdates` — push notifications when outcomes are added, settled, or removed. Cheap way to keep our asset universe fresh without polling.

### Fees

The picture is a little muddy across sources — flagging so we verify against live behavior before shipping any user-facing fee copy.

- HIP-4 spec: "Fees are currently zero for outcome markets for initial testing."
- Chainstack guide: opening is free (a "mint"); closing charges the user's normal tier rate on `close_price * size`; opposite-side unwind ("burn") charges both sides on `1 * size`. Settlement charges `tier_rate * settlement_fraction`.
- Hyperliquid guide: "approximately half ordinary spot trading fees (~0.035% average vs. 0.070% base spot)."
- No maker rebates — makers who would normally rebate instead pay zero.

Assume: open is free, close and settle charge something small, exact schedule we should confirm from `userFees` at runtime and never hardcode.

### Collateral — USDH now, USDC via AQAv2 later

**Actual state (verified 2026-09-17):** every live outcome on mainnet and testnet reports `quoteToken: "USDC"` in `outcomeMeta`. Chainstack's "USDH is required" guide is either stale or was always testnet-specific for a brief window. QuickNode's "USDC is the collateral" guide is correct. **No swap primitive needed** — our existing USDC deposit pipeline is compatible.

**Still worth reading per outcome anyway:** `quoteToken` is per-outcome in the meta response, so if a builder venue ever deploys a market with a different quote we'd read it there rather than assume USDC.

### Position tracking and settlement

- Positions live in `spotClearinghouseState.balances` as `+<encoding>` entries. Not in a separate positions collection.
- No margin, no funding, no liquidation logic — much simpler than perps.
- Settlement is passive. At expiry the winning side's balance is credited quote-token; losing side goes to zero. The outcome disappears from the next `outcomeMeta`. Vela should treat a disappearing outcome as "settled" and reconcile against `settledOutcome`.
- Settlement price is the **mark-price sample interpolated at the exact expiry timestamp**, not a candle close, not a TWAP, not an oracle. Any Vela prediction of settlement outcome using OHLC or oracle data can diverge from the real settlement in fast markets.

### What our adapter would grow

Roughly, the additions to `hyperliquid-adapter.ts` and neighbors. **Because HL treats outcomes as spot internally, we extend the spot codepath rather than adding a third asset kind:**

1. **Spot asset resolver extended to know about outcome coins.** When resolving `#N`, produce an `AssetMeta` with `index = 100_000_000 + N`, `szDecimals = 0`, and a marker `isOutcome = true`. Same shape as spot AssetMeta.
2. **`placeOrder` accepts outcome asset.** No change to signing, only addressing. Verified with real fills against testnet.
3. **`outcomeMeta` info hook,** cached like `spot_meta` today, refreshed on `outcomeMetaUpdates` WS event.
4. **`spotClearinghouseState` reader extended to recognize `+N` and `oN` balances.** Both YES and NO sides appear once the outcome is touched, one with total 0 — reader should handle. Post-settlement, coins appear as `oN`.
5. **Outcome-specific order-path guards:** never send `r: true` (rejected with `"Reduce-only is invalid for spot trading"`); never send a `trigger` order type (rejected with `"Placing trigger orders is not enabled on spot trading yet"`); enforce `[0.001, 0.999]` price range and integer size client-side; enforce **$1 USDC min notional**.
6. **Asset-resolver hardening: reject `+N` in order/book paths.** Chainstack's silent-fail footgun is real — `l2Book` with `coin: "+N"` returns `null` with no error. Our resolver should fail loudly if given `+N` where `#N` is expected.
7. **Position monitor extended.** No liquidation logic. Watch for settlement (outcome disappearance from `outcomeMeta`, or `settledOutcome` record). Software-side exits only (no native SL/TP).
8. **Fee accounting extended.** Open is $0. Close/settle uses spot fee schedule (7bps cross / 4bps add today, tiered down for VIPs).

### What our signal engine needs to reckon with

This is where the real design lives. Perps signals are BUY/SELL/WAIT calls on continuous price. HIP-4 signals are **probability-of-event** calls on a dated binary or multi-outcome contract. They:

- Have a fixed expiry, so signal freshness matters differently — a signal 8 hours before a 06:00 UTC settlement is worth much more than the same signal 8 hours after.
- Compose differently with our sizing model — max loss is known upfront, no leverage-adjusted stop math.
- Compose differently with our regime gate and cooldown logic — daily-expiring markets create at most one signal per market per day, not a stream.
- Have different notification framing — "60% BTC above $X by 06:00 UTC" is a different sentence from "GO LONG BTC at $Y". This bumps into our brand-and-voice rule (knowledgeable friend, no gambling framing).

**None of the above blocks integration, but a HIP-4 signal type is a genuinely new product surface, not a variant of perp signals.**

### Architecture implications: no native triggers, no reduce-only

Two properties of the HIP-4 wire (both verified live: `"Placing trigger orders is not enabled on spot trading yet"`, `"Reduce-only is invalid for spot trading"`) force real architectural choices in the position-monitor and adapter layers. Neither is a blocker, but both are the sort of thing where a session that implements HIP-4 without knowing them will build the wrong shape and rip it out.

**No native trigger orders → software-side exits.** On perps today, when we open a position we place a resting SL and TP trigger with HL. If price crosses `triggerPx`, HL fires the exit itself, in the same block as the crossing tick. Cost: bounded (HL's matching latency). Reliability: high (as long as HL is up).

On outcomes we can't push exits to HL. Every SL/TP must be evaluated in **`position-monitor`** (or a new dedicated `outcome-monitor` if we want tighter cadence). Concretely:

- Position-monitor polls `spotClearinghouseState` for outcome balances (`+N` coins), joins to a `outcome_positions` DB table that stores our intended `triggerPx` / `takeProfitPx` / `stopLossPx`, fetches current book mids for those `#N` coins, and when a trigger fires it submits a marketable IOC on the opposite side.
- **Time-to-exit is bounded by the monitor's cron cadence.** Current position-monitor runs every ~1 min. On daily-expiring binaries that's fine — a 1-min lag on a 24-hour position is nothing. On a fast-moving market that just crossed our stop it's meaningful. If HIP-4 later grows intraday markets we may need a tighter cadence.
- **We already have this pattern.** T14/T15 in the E2E suite exercise Vela's spot software-SL fallback on Hyperliquid testnet where triggers aren't supported either. That's the exact template. The `outcome_positions` table and monitor extension mirror what T16 does for PURR spot.
- **Two failure modes to design for.** (a) Monitor stalls → position sits past trigger. Mitigate: heartbeat + admin alert on `position-monitor` staleness > 5 min for accounts holding outcomes. (b) The book is empty / no bid to hit at trigger time → the close IOC fails silently. Mitigate: retry with a wider price envelope on failure, then admin-alert if still stuck. Our T16 spot-close verifier pattern (`verifyFlat` in `e2e-testnet-test`) handles the "close attempt didn't actually flatten" case; extend to outcomes.
- **When HL enables native triggers (they say "yet"), we upgrade in place.** Design the outcome-monitor path with a strategy interface so we can swap in native trigger orders later without touching signal logic.

**No reduce-only → close-size clamp + reconciliation.** On perps today, a close order with `r: true` guarantees it can only shrink or flatten a position, never open the opposite side. On outcomes that guarantee is gone.

- Every close order must first read the current outcome balance and clamp `size ≤ current balance`. Do this in `_buildOutcomeCloseOrder` (new helper), not in the signal layer, so every closepath gets it.
- **Race condition:** balance is read at time T, order is sent at T+ε, fill happens at T+δ. In that window, if any concurrent action (an admin-triggered sell, a partial-fill from an earlier order, a settlement) changes the balance, our close could theoretically overshoot and open a small opposite position.
- **Mitigations, all cheap:**
  - **Serialize per-outcome close orders** with a Postgres advisory lock keyed on `(user_id, outcome_id)`. Already the pattern for `execute-proposal`; extend to outcome closes.
  - **Post-close reconciliation:** after a close, re-read balances. If we're not flat and the residual is on the OPPOSITE side of what we intended, flag it as an `outcome_overshoot` incident and page the operator. Never silent.
  - **Never use size = infinity.** Some perp "close all" paths use `s: "0"` semantics; on outcomes always use an explicit size.
- **Test surface:** add a T18 to `e2e-testnet-test` that opens 3 units, closes 5 (overshoot attempt), verifies HL either rejects the excess or the reconciler catches it.

**Combined implication for signal engine.** A HIP-4 signal's lifecycle looks like: open (trigger price crossed) → position tracked in `outcome_positions` → monitor evaluates exits every tick → software-side close on trigger/expiry → reconcile. That's a real workflow, not a variant of the perp workflow. Reuse the perp signal shape for direction (yes/no) and conviction; build a new lifecycle for entry/exit orchestration.

---

## What further changes if Vela becomes a **builder-deployer**

Second path — Vela deploys its own outcome markets (e.g. "Will Vela's average subscriber PnL beat SPX this week?", or narrower per-asset event markets tied to our signals). Much larger commitment.

### Stake and account setup

- **500,000 HYPE** stake required, maintained continuously. At today's price bracket that's on the order of $5–15M locked capital. Deactivation requires zero active outcomes and a **183-day minimum period** — once you activate you're operationally committed for 6+ months.
- Requires "Standard account abstraction" — a specific HL account mode.
- Deployer identifies with a `venueName` of 2–4 lowercase ASCII letters (namespace collision risk).

### New signing paths (deployer actions)

All are L1 actions with a top-level `venue` field. Our adapter would need:

- `activateOutcomeDeployer` — activate/deactivate
- `registerStandaloneOutcomeFromTemplate` — deploy one binary market from a validator-approved template
- `registerQuestionFromTemplate` — deploy a multi-outcome question with N outcomes + a fallback
- `registerAndAssociateNamedOutcomeFromTemplate` — add another outcome to a live question (max 100 per question)
- `settleOutcome` — settle a standalone outcome to any `settleFraction ∈ [0,1]`; for question outcomes only 0 or 1
- `settleQuestion2` — settle all remaining question outcomes at once (exactly one → 1, others → 0, fallback auto-zero). Replaces the discontinued `settleQuestion`.
- `setSubDeployers` — grant/revoke specific action permissions to sub-accounts. Useful if we want a settlement operator distinct from a deployment operator.

### Testnet limits (worth watching if HL raises them on mainnet)

- Max **10 active outcomes** per deployer.
- Max **50 outcomes deployed per day**.

### Governance and risk surface

- **Templates** are validator-approved. We don't design a market from scratch; we pick a template and fill in `keywordToValue`. Constrains what we can offer.
- **Settlement is our responsibility.** Wrong settlement = user harm + reputational damage. Needs an oracle path or clear human-in-the-loop process with the same rigor as trade execution. This is a new failure mode Vela doesn't have today.
- **Deployer fees** flow to us (`deployerFeeScale` field). Revenue upside.
- **Regulatory exposure** — running a prediction-market venue in Vela's brand is a different regulatory posture from being a trading client. Not a technical question, flagging.

### Effort estimate

- Trading-client integration (native HL markets only): ~1–2 weeks eng, plus signal-engine design work that scales with ambition (another 2–4 weeks if we want a new signal type).
- Builder-deployer integration: 4–8 weeks eng plus stake, plus ongoing settlement ops, plus legal review. Not a scoped sprint.

---

## Open questions

**Resolved by testnet probing:**
- ~~USDH vs USDC collateral~~ → USDC everywhere. No swap primitive needed.
- ~~Trigger orders on outcomes~~ → not supported today ("not enabled yet"). Software-side exits only.
- ~~Fee schedule~~ → open $0, close/settle uses spot rates (7bps cross / 4bps add). Verified from `userFees.feeSchedule`.
- ~~Min notional~~ → $1 USDC. Chainstack said $10, wrong.
- ~~`+N` footgun~~ → real, silent-null from `l2Book`. Adapter must reject early.
- ~~Balance shape~~ → `+N` form confirmed; `entryNtl` populated.

**Still open:**
1. **Multi-outcome mechanics for signals.** Vela signals today are binary BUY/SELL/WAIT. Multi-outcome markets don't map cleanly. If we support only binary outcomes at first, we cover the daily BTC/ETH/HYPE/SOL markets (the largest current volume) and defer multi-outcome to phase 2.
2. **What HIP-4 use cases actually fit Vela's ICP?** Our users are longer-horizon signal takers, not high-frequency prediction traders. A daily-expiring BTC market may or may not be a natural fit — worth checking with a few Vela users before building.
3. **Settlement crediting mechanics** — can't test in a single probe. Would need to hold through expiry. Non-blocking; docs are clear enough.
4. **WebSocket `outcomeMetaUpdates` push shape** — not observed. Cheap to test when we build.
5. **Actual close fee at first mainnet trade.** Testnet has no bid liquidity. Cite fee schedule (7bps spot cross); verify against a mainnet close during admin-only rollout (step 4 of the implementation guide's rollout plan).

---

## Recommended path (three options, ranked)

**Path 1 — Read-only display (fast).** Show HIP-4 markets on the asset detail pages we already have, using `outcomeMeta` + `l2Book`. No trading. Signals stay perp-only. Effort: ~3 days. Learns whether users care before we invest in trading.

**Path 2 — Full trading client, binary outcomes only (recommended if there's user demand).** Extend Vela's spot codepath in `hyperliquid-adapter.ts` (outcome markets are spot at the HL type-level, verified). Guard rails for the outcome-specific rules ($1 min notional, integer size, no `r: true`, no trigger orders, `+N` footgun rejection). Position monitor extension, one new signal type for daily-binary event markets. Software-side exits (no native SL/TP). Defer multi-outcome. Effort: ~2–3 weeks eng including QA — smaller than the pre-probe estimate because we don't need a USDC↔USDH swap primitive. **Implementation-ready details:** [`hip-4-implementation-guide-2026-09-17.md`](./hip-4-implementation-guide-2026-09-17.md).

**Path 3 — Vela-as-deployer.** Skip unless we have a concrete product hypothesis that justifies 500K HYPE stake, 183-day operational commitment, and settlement risk. Revisit after Path 2 is proven.

I'd suggest starting with Path 1 to learn interest, then Path 2 if users engage. Path 3 is a separate strategic decision, not a natural next step.

---

## Sources

- HL docs: [HIP-4 outcome markets spec](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets), [HIP-4 deployer actions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions), [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint), [Info endpoint (spot)](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot), [Signing](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing).
- Practical guides: [Chainstack — Trading HIP-4 outcome markets](https://docs.chainstack.com/docs/hyperliquid-hip4-outcome-markets-trading) (best developer detail), [QuickNode — Trade HIP-4 prediction markets](https://www.quicknode.com/guides/hyperliquid/trade-hip-4-prediction-markets-on-hyperliquid) (contradicts on USDH/USDC — flagged), [Hyperliquidguide — HIP-4 outcome trading](https://hyperliquidguide.com/ecosystem/hip-4-outcome-trading).
- Ecosystem context: [Bitcoin News — HL launches HIP-4](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/), [Crypto Adventure — HIP-4 review, USDH settlement](https://cryptoadventure.com/hyperliquid-hip-4-review-outcome-markets-usdh-settlement-and-prediction-trading/), [Privy — HIP-4 and HL's next phase](https://privy.io/blog/from-perps-to-prediction-markets-understanding-hip-4-and-hyperliquid-next-phase).
- Reference implementation: [nktkas TS SDK `outcomeMeta` type](https://github.com/nktkas/hyperliquid/blob/main/src/api/info/_methods/outcomeMeta.ts), [SymbolConverter](https://github.com/nktkas/hyperliquid/blob/main/src/utils/_symbolConverter.ts).
