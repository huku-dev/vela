# Vela — Trade System Architecture

> **Last Updated:** 2026-03-14
> **Purpose:** Definitive reference for debugging trade execution issues. Start here before investigating any trade failure.

---

## System Overview

```
                    ┌─────────────────────────────────┐
                    │         Signal Engine            │
                    │        (run-signals)             │
                    │   Cron: every 4H + on-demand     │
                    │   Computes indicators, signals,  │
                    │   briefs, proposals              │
                    └────────────┬────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                      │
           ▼                     ▼                      ▼
  ┌─────────────────┐  ┌─────────────────┐   ┌─────────────────┐
  │  Scanner 30m    │  │  Volatility     │   │  Daily Digest   │
  │  Cron: :02/:32  │  │  Check          │   │  Cron: 8AM UTC  │
  │  BB2 + exits    │  │  Cron: 30min    │   │  (standalone)   │
  │  Direct to HL   │  │  >5% → re-eval  │   └─────────────────┘
  └────────┬────────┘  └─────────────────┘
           │
           ▼
  ┌─────────────────────────────────────────────────────┐
  │             Proposal Generator                      │
  │           (proposal-generator.ts)                   │
  │                                                     │
  │  Eligibility: wallet? circuit breaker? tier? balance?│
  │  Size: clampToTierLimits() → floor $10 HL minimum  │
  │  Routing: use_spot = (leverage=1 && long && !close) │
  │  Status: full_auto → auto_approved, else → pending  │
  └─────────────────────┬───────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │                            │
    ┌─────▼──────┐              ┌──────▼──────┐
    │  Pending   │              │Auto-Approved│
    │  (manual)  │              │ (full_auto) │
    └─────┬──────┘              └──────┬──────┘
          │                            │
          ▼                            │ Immediate execution
  ┌────────────────┐                   │ by calling cron
  │ trade-webhook  │                   │
  │ 3 approval     │                   │
  │ channels:      │                   │
  │ · Frontend     │                   │
  │ · Telegram     │                   │
  │ · Email HMAC   │                   │
  └────────┬───────┘                   │
           │ approved                  │
           └───────────┬───────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────┐
  │              Trade Executor                         │
  │           (trade-executor.ts)                       │
  │                                                     │
  │  1. Atomic claim (status → executing)               │
  │  2. Expiry + circuit breaker checks                 │
  │  3. Wallet fetch (WALLET_ENVIRONMENT fail-loud)     │
  │  4. Pre-flight: wallet exists on HL?                │
  │  5. $10 minimum check → notifyLowBalanceFailure()   │
  │  6. Price staleness guard (>5% deviation blocks)    │
  │  7. Spot/perp routing (see diagram below)           │
  │  8. Position create/update + SL trigger order       │
  │  9. Fee calculation + sweep on close                │
  └─────────────────────┬───────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
  ┌────────────────┐         ┌─────────────────┐
  │ Position       │         │  Notifications   │
  │ Monitor        │         │  (notify.ts)     │
  │ Cron: 2min     │         │  Telegram + Email│
  │ P&L, SL, trail │         │  IS_STAGING gate │
  │ profit ladder  │         └─────────────────┘
  │ circuit breaker│
  └────────────────┘
```

---

## Trade Execution: 3 Invocation Paths

```
Path 1: USER APPROVAL (trade-webhook)
  Frontend/Telegram/Email → trade-webhook → processProposalAction()
  → status: pending → approved → executing
  → executeTradeProposal()
  Auth: JWT (frontend), Telegram secret, HMAC (email)

Path 2: 4-HOUR SIGNAL (run-signals)
  pg_cron → run-signals → generate*Proposals()
  → status: auto_approved → executing
  → executeTradeProposal() called inline
  Auth: service_role (cron)

Path 3: 30-MINUTE SCANNER (scanner-30m)
  pg_cron → scanner-30m → generateBB2Proposals() / generateTrimProposals()
  → status: auto_approved → executing
  → executeTradeProposal() called inline
  Auth: service_role (cron)
```

**Key difference:** To retry a failed proposal without a user JWT, set status to `auto_approved` (not `approved`) so scanner-30m or run-signals picks it up.

---

## Spot vs Perp Routing

```
                    ┌─────────────────────────┐
                    │   Is this a close/trim?  │
                    └─────────┬───────────────┘
                              │
                   ┌──────────┴──────────┐
                   │ YES                 │ NO (new entry)
                   ▼                     ▼
          ┌────────────────┐    ┌────────────────────┐
          │ Is position    │    │ leverage=1 AND      │
          │ is_spot=true?  │    │ side=long AND       │
          │                │    │ isSpotAvailable()?   │
          └──┬──────────┬──┘    └───┬─────────────┬──┘
             │ YES      │ NO       │ YES          │ NO
             ▼          ▼          ▼              ▼
     ┌──────────┐  ┌────────┐ ┌──────────────┐ ┌────────┐
     │SPOT CLOSE│  │  PERP  │ │  SPOT OPEN   │ │  PERP  │
     │sell spot │  │reduceOnly│ │              │ │        │
     │transfer  │  │placeOrder│ │1.transferUSDC│ │placeOrder
     │USDC back │  └────────┘ │  (perp→spot) │ └────────┘
     └──────────┘             │2.placeSpotOrder│
                              │              │
                              │  ON FAILURE: │
                              │  ┌──────────┐│
                              │  │Fallback:  ││
                              │  │1x perp    ││
                              │  └──────────┘│
                              └──────────────┘
```

**Which assets go to spot?**
- **HYPE**: Yes (native HIP-1 token, HYPE/USDC pair)
- **PURR**: Yes (native HIP-1 token, PURR/USDC pair)
- **BTC/ETH/SOL**: No. "Spot" on HL frontend is UBTC/UETH/USOL (wrapped Unit tokens). Vela uses 1x perps for equivalent exposure.

---

## Hyperliquid Adapter Internals

### Order Flow

```
placeOrder(request)                    placeSpotOrder(request)
       │                                       │
       ▼                                       ▼
 _placeOrderInner()                    _placeSpotOrderInner()
       │                                       │
       │  1. resolveAsset(symbol)              │  1. getSpotMeta() → spotToken
       │     → perpIndex from meta             │     → spotPairIndex + 10000
       │                                       │
       │  2. getMarkPrice(symbol)              │  2. getSpotMarkPrice(symbol)
       │     → perp metaAndAssetCtxs           │     → spot midPx (or perp fallback)
       │                                       │
       │  3. price = mark * (1±3%)             │  3. price = mark * (1±3%)
       │                                       │
       │  4. priceToWire(price, sz, false)     │  4. priceToWire(price, sz, true)
       │     → 5 sig figs + 6-decimal round    │     → 5 sig figs + 8-decimal round
       │                                       │
       │  5. _buildOrderWire()                 │  5. _buildOrderWire(isSpot:true)
       │     a: perpIndex                      │     a: spotPairIndex + 10000
       │     p: priceToWire result             │     p: priceToWire result
       │     t: {limit: {tif: "Ioc"}}         │     t: {limit: {tif: "Ioc"}}
       │                                       │
       │  6. Attach builder fee                │  6. Builder fee: SELL side only
       │     action.builder = {b, f}           │
       │                                       │
       └───────────────┬───────────────────────┘
                       │
                       ▼
              submitL1Action()
                       │
                       ▼
              signL1Action(action, nonce)
                       │
              msgpack → keccak256 → phantom Agent
              → EIP-712 sign via Privy (agent wallet)
                       │
                       ▼
              POST /exchange  {action, nonce, signature}
                       │
                       ▼
              _parseOrderResponse()
              → fill price, size, fees, oid
```

### Spot Asset Index Resolution (CRITICAL)

```
              spotMeta API
                  │
                  ▼
    universe: [{name:"PURR/USDC", index:0, tokens:[1,0]},
               ...
               {name:"@107",      index:107, tokens:[150,0]},  ← HYPE
               ...]
                  │
                  ▼
    For each pair:
      baseToken = tokens[pair.tokens[0]]  → {name:"HYPE", index:150}
      quoteToken = tokens[pair.tokens[1]] → {name:"USDC", index:0}
      skip if quoteToken != "USDC"
                  │
                  ▼
    Wire asset index = pair.index + 10000
                  │
    HYPE: pair.index=107  → wire asset = 10107  ✅
    PURR: pair.index=0    → wire asset = 10000  ✅

    ⚠ NOT perpIndex + 10000!  (HYPE perpIndex=159 → 10159 = WRONG MARKET)
```

### Builder Fee Auto-Recovery

```
placeOrder() / placeSpotOrder()
       │
       ▼
  _place*OrderInner()
       │
       ├─ SUCCESS → return result
       │
       ├─ ERROR: "Builder fee has not been approved"
       │         │
       │         ▼
       │    approveBuilderFee(address, "0.1%")
       │    (EIP-712 user-signed action, master wallet)
       │    (address MUST be lowercase!)
       │    (field order: hyperliquidChain FIRST)
       │         │
       │         ├─ SUCCESS → retry _place*OrderInner() ONCE
       │         │             (prevents infinite loop)
       │         │
       │         └─ FAILURE → return combined error
       │              "Builder fee not approved. Auto-recovery failed: ..."
       │
       │              ⚠ "Builder has insufficient balance to be approved"
       │              = builder/treasury wallet needs USDC on HL
       │
       └─ OTHER ERROR → return error directly
```

---

## Key Database Tables

```
signals              → Signal state per asset (color, RSI, EMA, etc.)
briefs               → AI-generated market briefs
trade_proposals      → Proposed trades (pending/approved/auto_approved/executing/executed/failed/expired/declined)
trade_executions     → Fill details (price, size, fees, raw HL response)
positions            → Open/closed positions (size, entry, SL, P&L, is_spot, trim_history)
user_wallets         → Privy wallet addresses (master+agent, environment, builder_fee_approved)
funding_events       → Deposits/withdrawals
scanner_state        → 30m scanner dedup (last_candle_ts)
scanner_events       → Scanner audit log
```

---

## Common Failure Modes & Where to Look

| Error | Root cause | File:Function | Fix |
|-------|-----------|---------------|-----|
| "95% away from reference price" | Wrong spot asset index | adapter:`getSpotMeta()` | Must use `pair.index + 10000` not `perpIndex + 10000` |
| "Price must be divisible by tick size" | Wrong decimal rounding | adapter:`priceToWire()` | Spot: 8 decimals, Perp: 6 decimals |
| "Builder fee has not been approved" | First trade for user | adapter:`placeOrder()` | Auto-recovery handles it (approve + retry) |
| "Builder has insufficient balance" | Treasury wallet empty on HL | Operational | Deposit USDC to builder address |
| "Order must have minimum value of $10" | Order too small | executor:$10 guard | `clampToTierLimits()` floors at $10 |
| "Insufficient spot balance" | USDC transfer failed | executor:spot flow | Falls back to 1x perp |
| Balance too low for user | <$10 USDC | executor:$10 guard | `notifyLowBalanceFailure()` (Telegram + email) |
| Price staleness >5% | Market moved since proposal | executor:staleness guard | Proposal rejected, new one generated next cycle |
| "User or API Wallet does not exist" | Mixed-case builder address | adapter:`approveBuilderFee()` | Address MUST be `.toLowerCase()` |
| Wire format rejection | Trailing zeros in amount | adapter:`floatToWire()` | Strips trailing zeros ("100.0" → "100") |

---

## Two-Loop + Scanner Design

| Loop | Interval | Purpose | Functions |
|------|----------|---------|-----------|
| **Fast** | 2 min | Position monitoring, deposits, stop-loss, circuit breakers | position-monitor, deposit-monitor |
| **Slow** | 4H | Signal computation, proposals, trade execution | run-signals, proposal-generator |
| **Scanner** | 30 min | BB2 entries/exits, early trims, momentum detection | scanner-30m |
| **Reactive** | 30 min | Volatility spike → early signal re-eval | volatility-check |

---

## Env Var Dependency Map

Every env var read by backend code. All must fail loud (500 error) if missing.

| Env Var | Used By | Fail Mode |
|---------|---------|-----------|
| `SUPABASE_URL` | All functions | 500 — crashes on createClient |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | 500 — crashes on createClient |
| `WALLET_ENVIRONMENT` | provision-wallet, trade-executor, process-withdrawal, deposit-monitor | **500 — fail-loud** |
| `PRIVY_APP_ID` | provision-wallet, deposit-monitor, position-monitor, auth-exchange | 500 |
| `PRIVY_APP_SECRET` | provision-wallet, deposit-monitor, position-monitor | 500 |
| `PRIVY_VERIFICATION_KEY` | auth-exchange | 500 |
| `JWT_SECRET` | auth-exchange | 500 |
| `APP_BASE_URL` | auth-exchange, process-withdrawal, refresh-balance, checkout | Wrong URLs |
| `ANTHROPIC_API_KEY` | run-signals (brief-generator) | Briefs fail |
| `COINGECKO_API_KEY` | run-signals, volatility-check, signal-performance-tracker | 500 |
| `STRIPE_SECRET_KEY` | checkout, portal, payment-webhook | 500 |
| `STRIPE_WEBHOOK_SECRET` | payment-webhook | 500 |
| `TELEGRAM_BOT_TOKEN` | notify.ts | Telegram silently fails |
| `TELEGRAM_CHAT_ID` | notify.ts | Admin messages lost |
| `TELEGRAM_WEBHOOK_SECRET` | trade-webhook | Telegram callbacks rejected |
| `RESEND_API_KEY` | notify.ts | All emails silently fail |
| `VELA_BUILDER_ADDRESS` | trade-executor (builder fee) | Orders fail (fail-closed) |
| `VELA_BUILDER_FEE_BPS` | trade-executor | Fee calculation wrong |
| `VELA_TREASURY_HL_ADDRESS` | notify.ts (fee sweep) | Fee sweep fails |
| `ENVIRONMENT` | notify.ts (staging gate) | Staging leaks to prod notifications |

---

## Incident Reference

| Date | Incident | Root Cause | Fix |
|------|----------|------------|-----|
| 2026-03-06 | Silent testnet wallets | `WALLET_ENVIRONMENT` missing, `?? "testnet"` fallback | Fail-loud guards, deploy.sh rewrite |
| 2026-03-08 | Vault key migration | Supabase rotated API keys, vault not updated | Manual vault secret update |
| 2026-03-12 | HYPE tick size errors | `priceToWire` wrong decimals for spot | Spot: 8 decimals (Python SDK match) |
| 2026-03-13 | EIP-712 field order | `APPROVE_BUILDER_FEE_TYPES` wrong order | `hyperliquidChain` first (Python SDK match) |
| 2026-03-13 | $10 minimum rejections | HL rejects orders <$10 | Floor in `clampToTierLimits()` + defense-in-depth |
| 2026-03-14 | HYPE 95% price error | Spot wire used `perpIndex+10000` not `pairIndex+10000` | Use `pair.index` from spotMeta universe |
| 2026-03-14 | Builder fee insufficient | Treasury wallet empty on HL | Deposit USDC to builder address |

---

## BB2 Upgrade Close Pattern (2026-05-04)

When an EMA signal fires in the same direction as an open BB2 (half-size mean-reversion) position, instead of skipping with "already aligned", the system:

1. Emits an `upgrade_close` proposal (new `proposal_type` added via migration `20260501000001`)
2. trade-executor closes the BB2, then `await`s `fireUpgradeEmaOpen()` post-fill
3. `fireUpgradeEmaOpen()` fetches a fresh balance snapshot and inserts a full-size EMA open proposal

**Why post-fill (not two proposals upfront):** Two simultaneous proposals create a race for full_auto users and the first proposal's balance snapshot is stale by the time the second executes.

**Abort condition:** If EMA cooldown fires and strips the follow-on open, the entire upgrade is cancelled. The user keeps their BB2. Logic: `upgradeActions.length > 0 && !actions.some((a) => !a.isClose)` — if we generated upgrade-close actions but the EMA open was stripped, abort.

**Double-close guards:**
- `generateBB2ExitProposals()` checks for pending `upgrade_close` before emitting a regular BB2 exit
- `position-monitor` hold-days expiry path checks for in-flight `upgrade_close` before firing a reduce-only close

**`$10` minimum:** `upgrade_close` must be excluded from the $10 guard. BB2 positions are half-size and can legally fall below $10.

**Notification copy:** "Closing your short-term position to open a full-size trade. Signals point to a stronger move." ("short-term position" not "mean-reversion trade" — jargon violation).

**`close_reason`:** Set to `"bb2_upgrade"` (not `"signal_red"`) so P&L accounting and analytics can distinguish upgrade closes from regular signal closes.

---

## Deno Isolate Lifetime — Awaited Side Effects (CRITICAL)

**Problem:** In Deno Deploy, unawaited `.then()` chains after `Response` is returned are silently dropped. The isolate can be recycled before the chained work runs.

**Applies to:** Any post-fill side effect in trade-executor that happens after `executeTradeProposal()` returns. Specifically: `fireUpgradeEmaOpen()` for the BB2 upgrade flow.

**Fix:** Always `await` the side-effect chain inside a `try/catch` block before returning the response. Never use fire-and-forget `.then()` for trade-critical paths.

```typescript
// WRONG — silently dropped on Deno Deploy
fireUpgradeEmaOpen(supabase, { ... }).then(async (upgradeResult) => {
  if (upgradeResult.autoApproved) await executeTradeProposal(...);
});

// CORRECT — awaited in try/catch
try {
  const upgradeResult = await fireUpgradeEmaOpen(supabase, { ... });
  if (upgradeResult.proposalId && upgradeResult.autoApproved) {
    await executeTradeProposal(supabase, upgradeResult.proposalId);
  }
} catch (upgradeErr) {
  console.error("[trade-executor] upgrade EMA open failed:", upgradeErr);
}
```

Fire-and-forget is acceptable ONLY for notifications (`.catch(() => {})`). Never for trade execution.

---

## `signals` Table Schema (CRITICAL)

The `signals` table does NOT have `headline` or `asset_symbol` columns. Querying for them returns an error.

**Correct pattern:** Query `assets` and `briefs` separately in parallel:

```typescript
const [assetRes, briefRes] = await Promise.all([
  supabase.from("assets").select("symbol").eq("id", proposal.asset_id).maybeSingle(),
  supabase.from("briefs").select("headline")
    .eq("signal_id", proposal.signal_id)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle(),
]);
const assetSymbol = assetRes.data?.symbol ?? "Unknown";
const headline = briefRes.data?.headline ?? "";
```

**Why this bites:** PostgREST on a non-existent column does not error with 400 — it silently returns no rows. This can cause the wrong user-facing context (empty symbol/headline) without any log noise.

## Failure Notification Routing (2026-05-07)

`notifyTradeResult` failure path is admin-only by design. Comment in `notify.ts:170-174`: "Trade failures are operational errors, admin-only, not user-facing. Users see the failure reflected in proposal status on the app."

That assumption only holds for operational failures (RPC errors, leverage glitches, network timeouts). When a failure is **user-actionable**, route to a user-facing notify instead so the user gets Telegram + email + admin (not just admin).

Current user-facing failure notifies:

| Function | Trigger | CTA |
|---|---|---|
| `notifyLowBalanceFailure` | Auto-approve fails the $10 HL minimum | Deposit at least $10 USDC |
| `notifyMarginShortfall` | Preflight bail OR HL bounces with insufficient-margin error | Top up to catch the next one |

Both rate-limit via `audit_log`:
- `notifyLowBalanceFailure`: per-event log only, no rate limit (low recurrence)
- `notifyMarginShortfall`: 1 per user per 24h via action `margin_shortfall_notified`

**Brand-coherence rule for failure CTAs:** Vela manages position closes on the user's behalf. Never tell users to manually close or trim a position to free up balance. The right action is always deposit or top up. Future user-facing failure copy should default to that framing.

**Decision rule for new failure modes:** before adding a new error path, ask "can the user act on this?". If yes, write a user-facing notify or extend an existing one. If no, the existing admin-only path through `notifyTradeResult` is correct.
