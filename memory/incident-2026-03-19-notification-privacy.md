# Incident: Position Close Notification Privacy Breach

**Date:** 2026-03-19
**Severity:** CRITICAL
**Status:** Resolved

## What happened

When position-monitor closed positions (stop-loss, BB2 expiry, trailing stop, liquidation), the `notifyUserPositionClosed()` function sent email and Telegram notifications to the **wrong user**. Henry received Damola's HYPE position close notification on the user-facing Telegram bot.

## Root cause

`notifyUserPositionClosed()` (position-monitor/index.ts lines 109-113) had two bugs in a single Supabase query:

```typescript
// THE BUG
const { data: profile } = await supabase
  .from("profiles")
  .select("email, telegram_chat_id")  // telegram_chat_id doesn't exist on profiles
  .eq("user_id", userId)               // profiles has no user_id column (uses privy_did)
  .single();
```

**Bug 1**: `.eq("user_id", userId)` — The `profiles` table has no `user_id` column. The primary key is `id` (UUID) and the user identifier is `privy_did`. Supabase PostgREST silently ignores unknown columns in `.eq()` filters, meaning the query returned an unfiltered `.single()` — whichever profile row Postgres returned first.

**Bug 2**: `.select("email, telegram_chat_id")` — `telegram_chat_id` doesn't exist on `profiles`. It was added to `user_preferences` in migration `20260313000002`. Supabase returns null for non-existent columns in select, or errors depending on PostgREST version.

## How was this introduced?

The `notifyUserPositionClosed()` function was written **before** the Telegram individual sending infrastructure was built (March 13). It was a placeholder that never got updated when `getUserTelegramChatId()` was added to notify.ts. The correct patterns existed in notify.ts (all 4+ call sites use `privy_did` for profiles and `getUserTelegramChatId()` for Telegram), but position-monitor had its own inline implementation that was never aligned.

## Why wasn't it caught?

1. **No integration test** — Existing source-verification tests checked that the function existed and called downstream functions, but regex patterns matched the wrong column names
2. **Silent failure mode** — Supabase PostgREST doesn't throw on `.eq()` with non-existent columns (returns all rows), and `.single()` returns the first row
3. **Low volume** — Position closes are infrequent. The first visible manifestation was during the March 19 session when stuck HYPE positions were force-closed

## Impact

- All position close notifications since the function was written were potentially misrouted
- Email and Telegram notifications for one user's position close could reach a different user
- Position data (asset, side, entry price, exit price, P&L, hold duration) leaked across users
- 6 call sites affected: stop-loss, liquidation, recent close fill, trailing stop (spot), BB2 expiry, trailing stop (perps)

## Fix (commit 8707399)

```typescript
// Email from profiles using correct column
const { data: profile } = await supabase
  .from("profiles")
  .select("email")
  .eq("privy_did", userId)
  .single();

// Telegram from user_preferences via shared helper
const chatId = await getUserTelegramChatId(supabase, userId);
```

## Regression guards

Two new tests in `position-monitor.test.ts`:
1. `CLOSE-NOTIFY-ADV: NEVER queries profiles by user_id (must use privy_did)` — extracts function body, asserts no `.from("profiles")` + `.eq("user_id"` pattern
2. `CLOSE-NOTIFY-ADV: NEVER selects telegram_chat_id from profiles` — asserts profiles query never includes `telegram_chat_id`

## Lessons

1. **Every notification function must use shared helpers** — `getUserTelegramChatId()` for Telegram, profile queries by `privy_did`. No inline Supabase queries for user routing.
2. **Source-verification tests must assert correct column names**, not just function existence.
3. **Supabase PostgREST silent failures are dangerous** — `.eq()` on non-existent columns doesn't throw. Any new Supabase query should be verified against the actual migration schema.
4. **New notification pathways need cross-reference review** — When a new file sends notifications, verify it follows the same patterns as the canonical implementation in notify.ts.
