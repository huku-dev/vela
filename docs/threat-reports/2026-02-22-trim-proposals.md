# Threat Report: Trim Proposals (Partial Position Close)

> **Date:** 2026-02-22
> **Feature:** Yellow event detection triggers partial position closes (trims) to lock in profits while keeping remaining exposure.
> **Test file:** `crypto-agent/supabase/functions/_shared/trade-executor.test.ts`
> **Tests added:** 10 adversarial (`TRIM-ADV:`) + 11 source-verification (`TRIM:`)

---

## Summary

Trim proposals introduce a new `proposal_type = 'trim'` that reduces an open position by a percentage (25% or 50%) rather than closing it entirely. This creates a novel attack surface because trims intentionally bypass two guards that protect regular trades: circuit breakers (since trims *reduce* risk) and price staleness checks (since the goal is de-risking, not entry timing). Any bug in the trim path could be weaponized to drain a position to zero, execute against someone else's position, or double-execute for amplified effect.

---

## Threat Matrix

### THREAT-1: Over-trimming to Negative Balance

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Category** | Fund extraction |
| **Attack scenario** | An attacker crafts a trim proposal where `proposed_size_usd >= position.size_usd`. The executor computes `newSizeUsd = size_usd - trimmedSizeUsd`, producing zero or negative. On Hyperliquid, this could close the entire position (or error), but the DB would record a nonsensical state: a position with negative size. |
| **Defense mechanism** | Two layers. (1) **Generator**: `MIN_REMAINING_PCT = 25` ensures no trim leaves less than 25% of the original position. If the requested trim would breach this, the generator either reduces `effectiveTrimPct` or skips entirely (floor of 5%). (2) **Generator**: `maxTrimPct < 5` early exit prevents dust-level trims that aren't worth the exchange fee. |
| **Test name** | `TRIM-ADV: Trim cannot produce negative position size_usd` |
| **Residual risk** | None. Originally the executor lacked an independent check — a manually inserted DB row could have bypassed the generator's guard. **Fixed:** Added executor-level guard `if (newSizeUsd <= 0) fail("Trim would zero out position")` for defense-in-depth. Now three layers protect this: generator MIN_REMAINING_PCT, executor zero-check, and Hyperliquid's reduceOnly. |

### THREAT-2: Phantom Trim Against Closed Position

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Category** | Phantom operation |
| **Attack scenario** | A trim proposal is created while a position is open. Before the user approves, the position is closed by a RED signal. The user then approves the stale trim. Without validation, the executor would attempt a `reduceOnly` order on Hyperliquid for a position that doesn't exist — which would either error (best case) or, if a new position was opened in the interim, trim the *wrong* position. |
| **Defense mechanism** | Two layers. (1) **Generator**: `checkTrimEligibility()` checks `has_open_position` before creating trim proposals. (2) **Executor**: Explicit check `if (!existingPosition) → fail("Position no longer open")`. The executor fetches the current position by `user_id + asset_id + status='open'` — if it's been closed, null is returned and the trim fails cleanly. |
| **Test name** | `TRIM-ADV: Trim proposal requires open position — no phantom trims` |
| **Residual risk** | None. Both layers independently prevent this. |

### THREAT-3: Cross-User Position Targeting

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Category** | Authorization bypass |
| **Attack scenario** | An attacker manipulates `parent_position_id` on a trim proposal to point to another user's position, hoping the executor will reduce that user's position and credit the attacker. |
| **Defense mechanism** | Three layers. (1) **Executor**: The position lookup query filters by `user_id` (from the authenticated proposal) and `status='open'` — it can only find the requesting user's own position, regardless of what `parent_position_id` says. (2) **Executor**: Even if somehow a wrong position were returned, the `parent_position_id` mismatch check catches it: `existingPosition.id !== typedProposal.parent_position_id → fail("Position mismatch")`. (3) **Generator**: `parent_position_id` is set from `user.open_position_id`, which comes from the user's own position query. |
| **Test name** | `TRIM-ADV: Trim proposal cannot target another user's position` |
| **Residual risk** | None. The user_id scoping in the position query is the primary defense and cannot be bypassed via proposal fields. |

### THREAT-4: Rapid-Fire Drain via Repeated Trims

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Guard bypass |
| **Attack scenario** | Yellow events fire every signal cycle (e.g., every 4 hours during a sustained RSI > 78 period). Without a cooldown, each cycle generates a new 25% trim: $1000 → $750 → $562 → $421 → $316 → $237. After 5 trims, the position is at 23.7% — below the 25% floor, but only the 6th would be caught. The attacker (or just an unfortunate market condition) drains the position far more than intended. |
| **Defense mechanism** | `TRIM_COOLDOWN_MS = 8 * 3600_000` (8 hours). The generator queries for any trim proposal for this user+asset created within the last 8 hours. If found, the trim is skipped with a log. Combined with the 4-hour signal cycle, this means at most one trim per two signal cycles. |
| **Test name** | `TRIM-ADV: Trim cooldown prevents rapid-fire draining` |
| **Residual risk** | The cooldown queries `trade_proposals` (not `trade_executions`). A trim that was *proposed* but never *approved* would still trigger the cooldown, which is actually conservative (safer). However, if the signal cycle were changed to < 8 hours, multiple trims per day become possible. The 25% minimum remaining guard is the hard backstop. |

### THREAT-5: Orphaned Trim Executes Against Wrong Position

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Phantom operation |
| **Attack scenario** | User has a long BTC position. A trim proposal is created. Before approval, a RED signal fires, closing the position. User opens a new long BTC position. The stale trim proposal is then approved. Without cleanup, it would execute against the *new* position — trimming a position the user didn't intend. |
| **Defense mechanism** | Two layers. (1) **Generator**: When creating a close proposal, any pending trim proposals for the same user+asset are expired first: `.update({ status: "expired" }).eq("proposal_type", "trim").eq("status", "pending")`. This is the "close supersedes trim" rule. (2) **Executor**: `parent_position_id` mismatch check — the old trim points to the closed position's ID, but the new position has a different ID, so the executor fails with "Position mismatch". |
| **Test name** | `TRIM-ADV: Close supersedes trim — no orphaned trim after close` |
| **Residual risk** | Edge case: if the close proposal is created and the trim is approved in the same moment (race), the expiry might not have run yet. The executor's `parent_position_id` check is the backstop for this race. |

### THREAT-6: Trim Opens Opposing Position Instead of Reducing

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Category** | Accidental amplification |
| **Attack scenario** | If `reduceOnly` is not set on the Hyperliquid order, a trim for a long position (which places a sell order) could *open a new short position* instead of reducing the long — doubling exposure in the opposite direction. |
| **Defense mechanism** | The executor sets `reduceOnly: isClose || isTrim`. This tells Hyperliquid to only allow the order if it reduces an existing position. If the position is already closed or smaller than the order, Hyperliquid rejects it. |
| **Test name** | `TRIM-ADV: Trim uses reduceOnly — cannot accidentally open new position` |
| **Residual risk** | None. `reduceOnly` is enforced at the exchange level — even a bug in our code can't override it. |

### THREAT-7: Double-Execution of Trim Proposal

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Category** | Race condition |
| **Attack scenario** | Two concurrent executor invocations (e.g., auto-approved trim + manual retry) both attempt to claim and execute the same trim proposal. Without atomic claiming, both could execute, doubling the trim. |
| **Defense mechanism** | Trims use the same atomic claiming mechanism as all proposals: `UPDATE trade_proposals SET status='executing' WHERE id=$1 AND status IN ('approved', 'auto_approved') RETURNING *`. Only one concurrent caller can succeed. The `isTrim` detection happens *after* claiming, from the claimed proposal data, so the atomic guard is fully inherited. Additionally, `trade_executions` has a UNIQUE constraint on `trade_proposal_id`, providing a DB-level second line of defense. |
| **Test name** | `TRIM-ADV: Trim cannot bypass atomic proposal claiming` |
| **Residual risk** | None. Two independent mechanisms (atomic UPDATE + UNIQUE constraint) prevent this. |

### THREAT-8: Full Position Close Disguised as Trim

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Accidental amplification |
| **Attack scenario** | If the executor uses `existingPosition.size_usd` (full size) for the order instead of `typedProposal.proposed_size_usd` (trim amount), the "trim" would close the entire position — misleading the user who expected a partial close. |
| **Defense mechanism** | The executor explicitly uses `typedProposal.proposed_size_usd` for the order size. The generator computes this as `currentSize * (effectiveTrimPct / 100)`, which is always a fraction of the position. |
| **Test name** | `TRIM-ADV: Trim order uses proposed_size_usd, not full position size` |
| **Residual risk** | None. The trim amount is derived from the proposal, not the current position state. |

### THREAT-9: Cross-User Trim Expiry

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Scope leakage |
| **Attack scenario** | When expiring conflicting pending trims (either from close-supersedes-trim or new-trim-replaces-old), if the query doesn't scope to `user_id`, one user's trim expiry could accidentally expire another user's pending trim for the same asset. |
| **Defense mechanism** | All trim expiry queries include `.eq("user_id", user.privy_did)` and `.eq("asset_id", assetId)`, ensuring they are scoped to the specific user and asset. |
| **Test name** | `TRIM-ADV: Expired pending trims are scoped to same user+asset` |
| **Residual risk** | None. Query scoping is explicit. |

### THREAT-10: Semi-Auto User Gets Trims Auto-Executed

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Auto-approval abuse |
| **Attack scenario** | A user in `semi_auto` mode expects to approve every action. If the trim auto-approval logic is looser than regular trade auto-approval, trims could execute without the user's knowledge, violating the "You Stay in Control" pillar. |
| **Defense mechanism** | Trim auto-approval uses the same two-condition check as regular trades: `user.mode === "full_auto" && user.tier_config?.features?.auto_mode === true`. Both must be true. Semi-auto users always get trim proposals sent to Telegram/email for manual approval. |
| **Test name** | `TRIM-ADV: Trim auto-approval still requires full_auto + tier feature` |
| **Residual risk** | None. Same guard as regular trades. |

---

## Architecture Notes

### Defense-in-Depth Assessment

The trim pipeline has strong layered defenses:

- **Generator → Executor → Exchange** — Each layer independently validates. The generator prevents bad proposals from being created, the executor validates at execution time (in case the world changed), and Hyperliquid's `reduceOnly` flag provides an exchange-level backstop.

- **Atomic claiming** is fully inherited from the existing trade pipeline. No trim-specific bypass path exists.

- **Intentional guard bypasses** (circuit breaker, price staleness) are well-scoped and documented. The reasoning is sound: trims reduce risk, so blocking them during volatile periods is counterproductive.

### Single Points of Failure

1. ~~**MIN_REMAINING_PCT is only enforced in the generator, not the executor.**~~ **Fixed.** Executor now has `if (newSizeUsd <= 0) fail("Trim would zero out position")`. Three-layer defense: generator, executor, exchange.

2. **Cooldown is time-based, not execution-based.** The cooldown checks proposal creation time, not execution time. A proposal created 7h59m ago that takes 1 minute to approve would respect the cooldown, but the next cycle at 8h01m could trim again. This is acceptable given the 4-hour signal cycle.

### Comparison to Regular Trade Pipeline

| Guard | Regular trades | Trims | Justification |
|---|---|---|---|
| Circuit breaker | Yes | **Bypassed** | Trims reduce exposure |
| Price staleness | Yes | **Bypassed** | Trims are de-risking, not entering |
| Atomic claiming | Yes | Yes | Same mechanism |
| reduceOnly | Closes only | Yes | Prevents opening opposing position |
| Tier enforcement | Yes | Yes | Same auto_mode check |
| Cooldown | None | **8 hours** | Trim-specific; prevents rapid draining |
| Min remaining | None | **25%** | Trim-specific; prevents dust positions |
