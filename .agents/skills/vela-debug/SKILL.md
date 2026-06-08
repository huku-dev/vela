---
name: vela-debug
description: Debug & investigate production/staging issues using Supabase MCP — signal freshness, proposal generation failures, trade status, position health, cron jobs, and error investigation. Read-only queries only. Use when asked to investigate why signals, trades, or proposals are not working as expected.
context: fork
---

# Vela Debug & Investigate

Uses Supabase MCP to query production and staging data for debugging and investigation. **All queries are read-only** — NEVER performs INSERT, UPDATE, or DELETE.

## CRITICAL: Schema-first rule

**Before writing any query against a table you haven't already verified in this session, run:**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = '<table_name>'
ORDER BY ordinal_position;
```

Never assume column names. Past bugs: fabricated `external_key` on `macro_events`, used `asset` instead of `asset_id`, used `direction` instead of `side`. Always verify first.

---

## Environment Selection

| Environment | Project Ref | When to use |
|-------------|------------|-------------|
| Staging | `memyqgdqcwrrybjpszuw` | Default for investigation. |
| Production | `dikybxkubbaabnshnreh` | Live user issues or verifying prod data. |

If the user doesn't specify, **default to production for live issues** (the user is usually reporting something they see right now).

---

## Investigation Protocol

When given an open-ended bug report ("why are no trades firing", "signals seem stale", "something is wrong with X"), follow this structure:

### Step 1: Establish ground truth
Run schema checks on the relevant tables. Do NOT skip this.

### Step 2: Query the raw data
Look at the actual state: recent signals, proposals, positions, any errors. Form a hypothesis from what you see.

### Step 3: Trace the code path
If the data shows a signal existed but no proposals were generated, trace the gating conditions:
- Was there a macro blackout? (`macro_events` table — check `scheduled_at ± blackout_hours_before/after`, `blocked_direction`, `asset_ids`)
- Did the signal actually change color? (signals table only writes rows on `signalChanged=true`)
- Were there eligible users? (Check `user_wallets.agent_registered=true`, `user_preferences.mode IN ('semi_auto','full_auto')`, tier limits)
- Were users at max positions? (`tier_config.max_active_positions` vs COUNT of open positions)
- Was there an EMA cooldown? (`ema_cooldowns` table)

### Step 4: State findings clearly
For each anomaly: what you found, whether it's a bug or expected behavior, and what (if anything) needs fixing.

**Do NOT look at local files, git diffs, or the filesystem unless explicitly asked. Focus on DB queries.**

---

## Correct Column Names (verified 2026-05-04)

### `assets`
`id, symbol, name, coingecko_id, enabled, created_at, asset_class, scanner_enabled, hl_symbol, icon_url`

### `signals`
`id, asset_id, timestamp, signal_color, reason_code, price_at_signal, ema_9, ema_21, rsi_14, sma_50_daily, adx_4h, created_at, near_confirmation, funding_rate, crosscheck_verdict, crosscheck_reason`

Note: signals table only inserts rows on color CHANGES (`signalChanged=true`). A "stale" last row doesn't mean the engine isn't running — it means the color hasn't changed.

### `trade_proposals`
`id, user_id, asset_id, signal_id, side, proposed_size_usd, proposed_leverage, entry_price_at_proposal, status, approval_source, approved_at, expires_at, created_at, updated_at, proposal_type, trim_pct, parent_position_id, position_type, use_spot, error_message, reminded_at`

### `positions`
`id, user_id, asset_id, trade_execution_id, side, entry_price, current_price, size, size_usd, leverage, unrealized_pnl, unrealized_pnl_pct, stop_loss_price, status, closed_at, total_pnl, closed_pnl_pct, close_reason, created_at, updated_at, trim_history, original_size_usd, position_type, opened_at, is_spot`

### `user_preferences`
`id, user_id, mode, default_position_size_usd, max_leverage, max_daily_loss_pct, max_position_pct, stop_loss_pct, allowed_assets, notifications_telegram, notifications_email, created_at, updated_at, telegram_chat_id, max_consecutive_losses`

### `user_wallets`
`user_id, environment, agent_registered, balance_usdc, available_balance, trial_trade_used`

### `user_subscriptions`
`user_id, tier`

### `tier_config`
`tier, max_active_positions, max_leverage, max_position_size_usd, features`

### `macro_events`
`id, event_type, title, scheduled_at, blackout_hours_before, blackout_hours_after, blocked_direction, asset_ids`

### `ema_cooldowns`
`id, user_id, asset_id, direction, created_at, expires_at`

---

## Common Investigation Queries

### Signal freshness per asset
```sql
SELECT a.symbol, a.asset_class, s.signal_color, s.reason_code, s.timestamp, s.rsi_14, s.adx_4h
FROM assets a
LEFT JOIN signals s ON s.asset_id = a.id
  AND s.timestamp = (SELECT MAX(s2.timestamp) FROM signals s2 WHERE s2.asset_id = a.id)
WHERE a.enabled = true
ORDER BY a.asset_class, a.symbol;
```

### Recent proposals (last 10 days)
```sql
SELECT a.symbol, tp.proposal_type, tp.side, tp.status, tp.position_type, tp.created_at, tp.error_message
FROM trade_proposals tp
JOIN assets a ON a.id = tp.asset_id
WHERE tp.created_at > NOW() - INTERVAL '10 days'
ORDER BY tp.created_at DESC
LIMIT 60;
```

### Open positions
```sql
SELECT a.symbol, p.side, p.size_usd, p.position_type, p.entry_price, p.status, p.opened_at
FROM positions p
JOIN assets a ON a.id = p.asset_id
WHERE p.status = 'open'
ORDER BY p.opened_at;
```

### Active macro blackouts right now
```sql
SELECT title, scheduled_at, blackout_hours_before, blackout_hours_after, blocked_direction, asset_ids
FROM macro_events
WHERE NOW() BETWEEN
  scheduled_at - (blackout_hours_before || ' hours')::interval
  AND scheduled_at + (blackout_hours_after || ' hours')::interval
ORDER BY scheduled_at;
```

### Trading-eligible users (agent_registered + non-view-only)
```sql
SELECT up.user_id, up.mode, us.tier, uw.agent_registered, uw.balance_usdc, uw.available_balance
FROM user_preferences up
JOIN user_subscriptions us ON us.user_id = up.user_id
LEFT JOIN user_wallets uw ON uw.user_id = up.user_id AND uw.environment = 'mainnet'
WHERE up.mode IN ('semi_auto', 'full_auto')
ORDER BY up.mode;
```

### Cron job health
```sql
SELECT jobname, schedule, active,
  (SELECT MAX(start_time) FROM cron.job_run_details jrd WHERE jrd.jobid = j.jobid) AS last_run
FROM cron.job j
ORDER BY jobname;
```

### EMA cooldowns blocking proposals
```sql
SELECT a.symbol, ec.user_id, ec.direction, ec.created_at, ec.expires_at
FROM ema_cooldowns ec
JOIN assets a ON a.id = ec.asset_id
WHERE ec.expires_at > NOW()
ORDER BY ec.expires_at;
```

---

## Key Gating Conditions for Proposal Generation

When investigating "why didn't a proposal fire", check in order:

1. **Signal color** — grey signals never generate proposals (by design)
2. **signalChanged** — proposals only fire on color transitions, not steady-state
3. **Macro blackout** — check `macro_events` for windows covering the signal timestamp
4. **User eligibility**:
   - `user_wallets.agent_registered = true` AND `environment = 'mainnet'`
   - `user_preferences.mode IN ('semi_auto', 'full_auto')`
   - `circuit_breaker_events.resolved = false` (blocks if any active)
   - `has_pending_proposal` (status='pending' for this asset)
   - `total_open_positions >= tier_config.max_active_positions` (BB2 positions count toward total)
   - `allowed_assets` (empty = all allowed; non-empty = must include asset_id)
5. **EMA cooldown** — `ema_cooldowns` table; blocks same-direction re-entry after stop-out

---

## Safety Rules

1. **Read-only queries ONLY** — NEVER suggest or execute INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE
2. **Schema-first** — Verify column names before any query you haven't already run in this session
3. **No PII exposure** — Only select fields needed for debugging; never dump full user records
4. **Production by default for live issues** — Don't default to staging when the user is reporting something live
5. **Don't modify data to "fix" issues** — Document the fix; let the user execute it

## Key References
- Signal engine architecture: MEMORY.md
- Cron schedule: `memory/cron-schedule.md`
- Backend project refs: Staging `memyqgdqcwrrybjpszuw`, Production `dikybxkubbaabnshnreh`
