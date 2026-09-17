# HIP-4 Implementation Guide

**Companion to:** `hip-4-integration-brief-2026-09-17.md` (context, product framing, empirical findings)
**For:** a session picking up HIP-4 integration into Vela
**Date:** 2026-09-17
**Reviewed against:** live testnet probes (2026-09-17) via `hip4-probe` edge function on staging

This guide assumes the brief has been read. It covers the concrete code and DB changes to implement Path 2 (full trading client, binary outcomes only). It does NOT cover Path 3 (Vela-as-deployer). It does NOT cover the signal engine — signal design is its own workstream, not blocked by this guide.

---

## Ground rules verified by testnet trades

Do not re-derive these — they were checked live against `api.hyperliquid-testnet.xyz` on 2026-09-17.

- Outcome markets are **spot** at the HL type level. Errors reference "spot trading". Extend Vela's spot codepath, not a new asset kind.
- Wire signing is identical to perps/spot: msgpack → phantom-agent → EIP-712. No new signature scheme.
- Asset addressing has three forms and **mixing them is a silent-null footgun**:
  | Use | Form | Example (outcome 10248, YES) |
  |---|---|---|
  | Order `a` field, book/mid coin string | `#N` where N = `10*outcome + side` (0=YES, 1=NO) | `#102480` |
  | `spotClearinghouseState.balances[i].coin` | `+N` | `+102480` |
  | Wire asset id inside the action | `100_000_000 + N` | `100102480` |
  | Settled coin (post-expiry) | `oN` — schema-widened, not yet observed live | — |
- Order invariants:
  - Price in `[0.001, 0.999]`. Reject client-side.
  - Size is integer (`szDecimals = 0`). Reject fractional client-side.
  - **Minimum order value: $1 USDC.** Reject smaller notionals client-side with a clear error.
  - `r: true` (reduce-only) → HL rejects with "Reduce-only is invalid for spot trading". Never send it.
  - `t.trigger` order type → HL rejects with "Placing trigger orders is not enabled on spot trading yet". Never send it (yet).
- Fees:
  - **Open (marketable buy): $0.** Verified via `fee: "0.0"` on the fill line.
  - Close/settle: spot fee card (cross 7bps, add 4bps), tiered down for VIPs. Fetch from `userFees.feeSchedule` at runtime; never hardcode.
- Balance shape when holding an outcome: `spotClearinghouseState.balances` returns entries for **both sides** (`+N` YES and `+(N+1)` NO), one with `total: "0.0"` and the other with your position. `entryNtl` is populated on the held side — use it for cost-basis without walking `userFills`.

---

## Concrete adapter changes

All paths in `crypto-agent/supabase/functions/_shared/hyperliquid-adapter.ts`.

### 1. Add outcome-market awareness to asset resolution

Add a fourth branch to `AssetMeta` resolution alongside perp / spot / builder-dex:

```ts
interface AssetMeta {
  name: string;      // "#102480"
  szDecimals: number;
  maxLeverage: number; // 1 for outcomes (no leverage)
  index: number;       // 100_000_000 + 10*outcome + side
  isOutcome?: true;    // marker for outcome-specific guards
  outcome?: number;    // parsed outcome id
  side?: 0 | 1;        // 0 = YES, 1 = NO
}
```

Add `getOutcomeMeta()` alongside `getAssetMeta()`:

```ts
private async getOutcomeMeta(): Promise<Map<string, AssetMeta>> {
  // Cache on outcomeCacheLoadedAt, TTL ASSET_CACHE_TTL_MS.
  const res = await this.hlFetch(`${this.baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "outcomeMeta" }),
  });
  const data = await res.json() as {outcomes: Array<{outcome: number; name: string; sideSpecs: Array<{name: string}>}>};
  const cache = new Map<string, AssetMeta>();
  for (const o of data.outcomes) {
    for (const side of [0, 1] as const) {
      const n = 10 * o.outcome + side;
      const coin = `#${n}`;
      cache.set(coin, { name: coin, szDecimals: 0, maxLeverage: 1, index: 100_000_000 + n, isOutcome: true, outcome: o.outcome, side });
    }
  }
  return cache;
}
```

Wire it into `resolveAsset`. When asset name starts with `#` (or when we're building an outcome order via a new `placeOutcomeOrder` public method), route through `getOutcomeMeta()`.

### 2. Reject the `+N` footgun early

`resolveAsset` should throw a clear error if given `+N` where `#N` was expected. The error message must reference the actual footgun so the caller sees it:

```ts
if (name.startsWith("+")) {
  throw new Error(
    `[HL] '+N' is the BALANCE form of outcome ${name}, not an order/book form. ` +
    `Use '#${name.slice(1)}' instead. (Silent null from l2Book on '+N' is a documented HL footgun.)`
  );
}
```

Add a unit test that this fires. This is exactly the sort of guard that saves an hour of debugging a null-book response six months from now.

### 3. New `placeOutcomeOrder` public method

Because outcome orders have distinct guards, don't just extend `placeOrder`. Add a sibling method:

```ts
async placeOutcomeOrder(request: {
  coin: string;      // "#102480"
  isBuy: boolean;
  size: number;      // integer
  price: number;     // 0.001..0.999
  orderType: "market" | "limit";  // 'market' → Ioc, 'limit' → Gtc
  builder?: { address: string; feeBps: number };  // optional builder fee
}): Promise<ExecutionResult> {
  const meta = await this.getOutcomeMeta();
  const asset = meta.get(request.coin);
  if (!asset) throw new Error(`[HL] Unknown outcome coin: ${request.coin}`);

  // Guards (all must throw clear errors — do NOT silently coerce)
  if (!Number.isInteger(request.size)) throw new Error(`[HL] Outcome size must be integer, got ${request.size}`);
  if (request.size < 1) throw new Error(`[HL] Outcome size must be >= 1, got ${request.size}`);
  if (request.price < 0.001 || request.price > 0.999) throw new Error(`[HL] Outcome price out of range [0.001, 0.999], got ${request.price}`);
  const notional = request.price * request.size;
  if (notional < 1.00) throw new Error(`[HL] Outcome notional must be >= $1 USDC, got $${notional.toFixed(2)}`);

  const order: Record<string, unknown> = {
    a: asset.index,
    b: request.isBuy,
    p: pxToWireOutcome(request.price), // no szDecimals rounding, just trailing-zero strip
    s: String(request.size),
    r: false, // ALWAYS false — HL rejects r:true on outcomes
    t: { limit: { tif: request.orderType === "market" ? "Ioc" : "Gtc" } },
    // No `trigger` type — HL rejects it on outcomes
  };

  const action: Record<string, unknown> = { type: "order", orders: [order], grouping: "na" };
  if (request.builder) {
    action.builder = { b: request.builder.address.toLowerCase(), f: request.builder.feeBps };
  }

  const result = await this.submitL1Action(action);
  return this._parseOrderResponse(result, request.coin, request.price, `outcome:${request.coin}`);
}
```

Notes:
- `pxToWireOutcome` is a new helper: outcomes don't have `szDecimals` in the perp/spot sense. Strip trailing zeros only.
- Never call this method with a `+N` coin — the resolver will throw, but also throw at the entry to `placeOutcomeOrder` for a clearer stack.
- `r: false` is a hard constant, never a parameter. Callers that need to close a position use `placeOutcomeClose` (below).

### 4. New `placeOutcomeClose` — clamp-size + reconciliation

Because there's no `reduce-only` guarantee, encapsulate close logic in one place:

```ts
async placeOutcomeClose(coin: string, address: string, opts?: { maxSize?: number; builder?: { address: string; feeBps: number } }): Promise<ExecutionResult> {
  // 1. Read current balance
  const state = await this._info<{balances?: Array<{coin: string; total: string; entryNtl?: string}>}>({ type: "spotClearinghouseState", user: address });
  const balanceCoin = "+" + coin.slice(1);  // #N -> +N
  const bal = (state.balances ?? []).find(b => b.coin === balanceCoin);
  if (!bal || parseFloat(bal.total) === 0) {
    return { success: true, error: `No position on ${coin} to close`, fill_size: 0 };
  }
  const holdingSz = parseFloat(bal.total);
  const closeSz = Math.min(Math.floor(holdingSz), opts?.maxSize ?? Infinity);
  if (closeSz < 1) return { success: false, error: `Holding ${holdingSz} < 1 unit — cannot close` };

  // 2. Read book, use best bid for size — the outcome side we hold sells INTO bids
  const book = await this._info<{levels?: Array<Array<{px: string; sz: string}>>}>({ type: "l2Book", coin });
  const bids = book?.levels?.[0] ?? [];
  if (bids.length === 0) return { success: false, error: `No bids on ${coin} — cannot close via IOC` };

  // 3. Aggressive close price — sell at 0.001 (min) IOC hits any bid at any price
  //    HL's matching engine picks the best available bid, not our price.
  const closePx = 0.001;

  const result = await this.placeOutcomeOrder({
    coin, isBuy: false, size: closeSz, price: closePx, orderType: "market", builder: opts?.builder,
  });

  // 4. Reconcile: re-read balance, alarm if not flat
  await new Promise(r => setTimeout(r, 1500));
  const finalState = await this._info<{balances?: Array<{coin: string; total: string}>}>({ type: "spotClearinghouseState", user: address });
  const finalBal = (finalState.balances ?? []).find(b => b.coin === balanceCoin);
  const residual = finalBal ? parseFloat(finalBal.total) : 0;
  if (residual > 0.5) {
    // opts.maxSize may explain some residual; > 0.5 from our intended full close is real
    console.warn(`[HL] Outcome close residual: ${coin} still holds ${residual} after close attempt of ${closeSz}`);
  }

  return result;
}
```

Notes:
- Advisory-lock the caller (`execute-proposal`-style), not this method, so we can reuse this from `position-monitor` and from `execute-proposal` without nested-lock pain.
- If HL enables native triggers on outcomes later, wire a `placeOutcomeTrigger` sibling that returns to native behavior.

### 5. Balance / position reader changes

`getSpotBalance` returns `{coin, total, hold, entryNtl}` entries. Today it filters by `coin === expectedCoin`. Extend it to recognize outcome coins:

```ts
interface OutcomePosition {
  outcome: number; side: 0 | 1; coin: string;  // "+N"
  size: number; entryPx: number;  // entryNtl / size
  settled: boolean;                // true when coin starts with "o"
}
async getOutcomePositions(address: string): Promise<OutcomePosition[]> {
  const state = await this._info<{balances?: Array<{coin: string; total: string; entryNtl?: string}>}>({ type: "spotClearinghouseState", user: address });
  const positions: OutcomePosition[] = [];
  for (const b of (state.balances ?? [])) {
    if (b.coin.startsWith("+")) {
      const sz = parseFloat(b.total);
      if (sz <= 0) continue;  // untouched side gets a total: "0.0" row — skip it
      const n = parseInt(b.coin.slice(1), 10);
      const entryNtl = parseFloat(b.entryNtl ?? "0");
      positions.push({
        outcome: Math.floor(n / 10), side: (n % 10) as 0 | 1, coin: b.coin,
        size: sz, entryPx: sz > 0 ? entryNtl / sz : 0, settled: false,
      });
    } else if (b.coin.startsWith("o")) {
      const sz = parseFloat(b.total);
      if (sz <= 0) continue;
      const n = parseInt(b.coin.slice(1), 10);
      positions.push({
        outcome: Math.floor(n / 10), side: (n % 10) as 0 | 1, coin: b.coin,
        size: sz, entryPx: 0, settled: true,  // settlement credited USDC directly, entryPx moot
      });
    }
  }
  return positions;
}
```

### 6. Fee accounting hook

Extend `_enrichFillFromUserFills` to recognize outcome fills. `matchCoin` for outcomes is the `#N` form, which is what HL already returns in `userFills.coin`. No wire change needed — just make sure the caller sends `#N`, not `+N`, as `matchCoin`.

For `closedPnl` on outcome closes: HL returns the correct value in the fill line. Do not re-derive.

---

## DB schema additions

Two small tables. Both scoped by `user_id` and indexed for the position-monitor scan.

### `outcome_positions`

Tracks intent + monitored state for each outcome position. One row per (user, outcome, side).

```sql
create table outcome_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  outcome_id integer not null,           -- HL outcome integer
  side smallint not null check (side in (0, 1)),  -- 0 YES, 1 NO
  coin_hash text generated always as ('#' || (10 * outcome_id + side)::text) stored,  -- #N form for orders/books
  coin_balance text generated always as ('+' || (10 * outcome_id + side)::text) stored, -- +N form for state
  entry_px numeric not null,
  size numeric not null,
  intended_close_px numeric,             -- our target close (SL or TP)
  status text not null check (status in ('open', 'closing', 'closed', 'settled', 'stuck')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  settled_at timestamptz,
  settle_fraction numeric,                -- populated at settlement
  last_monitored_at timestamptz,
  notes text,
  unique (user_id, outcome_id, side)
);
create index outcome_positions_open_idx on outcome_positions (status, last_monitored_at) where status in ('open', 'closing');
```

### `outcome_fills` — optional, mirror of relevant `userFillsByTime` rows for outcome fills

Only if we want persistent audit outside HL's history. Not required for MVP.

---

## Monitor changes

### `position-monitor` extension (or `outcome-monitor` sibling)

Every tick, for each user with `outcome_positions.status IN ('open', 'closing')`:

1. Fetch `spotClearinghouseState` (single call for the user, gets all balances)
2. For each intended-open position:
   a. Read current book for `coin_hash`
   b. Compute current mid, best bid, best ask
   c. If SL/TP triggered per stored `intended_close_px`, submit `placeOutcomeClose(user, coin, {...})`
   d. Update `last_monitored_at`
3. For each position marked `closing`:
   a. Re-check balance for residual → mark `closed` if flat, `stuck` if not
4. For each position with `outcome_id` no longer in `outcomeMeta`:
   a. Query `settledOutcome` for the settle fraction
   b. Update `status = 'settled'`, populate `settle_fraction`, `settled_at`

Failure modes to instrument:

- **Monitor stale > 5 min while user has open outcome positions** → admin alert. Same pattern as our existing signal-freshness alert.
- **Close IOC returned "no bid" error** → retry with wider search, then admin alert (position stuck).
- **Post-close residual > 0.5** → warn log + `status = 'stuck'`, admin alert.

### `execute-proposal` extension

If we accept HIP-4 signals for automated execution, extend `execute-proposal` to route to `placeOutcomeOrder` when the proposal's `asset` field is `#N` (or a new `outcome_id` column). Same busy-guard, same async pattern — but no perp asset resolution branch. Advisory-lock key becomes `(user_id, outcome_id)`.

---

## Testing

Add T18–T20 to `e2e-testnet-test/index.ts`, mirroring the T13–T16 spot-side patterns:

- **T18: outcome resting-order lifecycle** — place Gtc at 0.05 on any live outcome, verify openOrders, cancel, verify gone. Cleanup guaranteed.
- **T19: outcome asset resolver footgun** — attempt `placeOutcomeOrder("+102480", ...)` and assert we throw with the "'+N' is the BALANCE form" message. No wire call.
- **T20: outcome close-size clamp** — open 3 units, call `placeOutcomeClose` with `maxSize: 5` and verify only 3 sell. (This test exercises the reconciliation path; it's fine if the sell doesn't fill on testnet — we're testing our clamp, not HL's match.)

For unit tests, mock `_info` and `submitL1Action` to return specific shapes (order response, spotClearinghouseState with `+N` and `oN` balances, `outcomeMeta`, `settledOutcome`). Cover:

- `placeOutcomeOrder` reject paths (fractional size, out-of-range price, sub-$1 notional, trigger type attempt via wrong caller)
- `placeOutcomeClose` with empty book, with residual, with settled position
- `getOutcomePositions` with mixed `+N` / `oN` / non-outcome balances

---

## Environment

No new env vars required for Path 2. Reuse `HL_TESTNET_PRIVATE_KEY` for E2E and Vela's production Privy signing for user wallets.

Reuse `VELA_BUILDER_ADDRESS` / `VELA_BUILDER_FEE_BPS` for builder fees on outcome orders. **Verified 2026-09-17:** the `builder` field on the order action is accepted on outcome orders at the wire level (HL responded with the standard `"Builder fee has not been approved"` error when the builder hadn't been pre-approved for the wallet — same failure path as spot/perp). This means:
- The same `approveBuilderFee` user-signed action enables builder fees for outcome orders.
- Vela's existing `builder_fee_approved` auto-recovery in `placeOrder()` (see adapter's `_placeOrderInner` retry path) should route unchanged for outcomes.
- Verify at rollout: after the admin-only first mainnet trade, check the fill line for a populated `builderFee` alongside `fee`.

---

## Rollout plan

1. **Feature flag** — new `assets.hip4_enabled` boolean, default false. Gate every code path behind it.
2. **Testnet staging** — enable in `e2e-testnet-test`, run the T18–T20 suite in the deploy pipeline. Fix regressions.
3. **Backend deploy** — via `deploy.sh --staging` (never bare per CLAUDE.md rule 14).
4. **Admin-only mainnet** — enable feature flag for a single admin account. Manual test one open + close per market type (daily binary, multi-outcome question). **Capture the actual close fee from `userFillsByTime` on the first close and record it in the brief.** Testnet can't tell us this — bid side is empty; spot fee schedule (7bps cross / 4bps add) is the a-priori expectation but has not been verified on a real fill.
5. **Gradual user rollout** — small user cohort with position size caps, then wider release.

---

## Non-goals for this pass

- **Multi-outcome markets (split/negate/merge).** Binary only for Path 2. Multi-outcome primitives require distinct wire actions and a materially different sizing model — separate scope.
- **Vela-as-deployer.** See brief's Path 3.
- **Signal design.** This guide implements the execution plumbing. Signal generation for HIP-4 is a separate workstream (see brief's "signal engine reckon" section).
- **Native trigger orders on outcomes.** Design the `placeOutcomeClose` interface so it can be extended when HL enables triggers ("not enabled yet" per HL's error), but don't build the native-trigger path yet.

---

## References

- Brief: `docs/product-briefs/hip-4-integration-brief-2026-09-17.md`
- Empirical probes (staging): the `hip4-probe` edge function was deployed to project `memyqgdqcwrrybjpszuw`. Deleted after this document; if we need to re-run, re-deploy from `/private/tmp/.../scratchpad/hip4-probe-v*.ts` (last state saved in Henry's session scratchpad).
- Prior HIP-4 research (killed, useful context): `docs/research/hip-4-prediction-markets/findings/03-play-1-kill.md`, `docs/research/hip-4-prediction-markets/findings/05-testnet-trial-1.md`
- Adapter to extend: `crypto-agent/supabase/functions/_shared/hyperliquid-adapter.ts`
- Signer available for testnet flows: `crypto-agent/supabase/functions/_shared/testnet-signer.ts`
- E2E testnet suite to extend: `crypto-agent/supabase/functions/e2e-testnet-test/index.ts`
