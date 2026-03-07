---
name: vela-debug
description: Debug & investigate production/staging data using Supabase MCP — signal freshness, brief staleness, trade status, position health, cron jobs, and error investigation. Read-only queries only.
---

# Vela Debug & Investigate

Uses Supabase MCP to query production and staging data for debugging and investigation. **All queries are read-only** — this skill NEVER performs INSERT, UPDATE, or DELETE operations.

## Triggers
"check signals", "debug", "investigate", "why is X broken", "check if signals are stale", "check user data", "what's the system status", "are briefs generating", "any stuck proposals", "are crons running"

---

## Environment Selection

**Always confirm which environment before running queries.**

| Environment | Project Ref | When to use |
|-------------|------------|-------------|
| Staging | `memyqgdqcwrrybjpszuw` | Default for investigation. Test queries here first. |
| Production | `dikybxkubbaabnshnreh` | Only when debugging a live user issue or verifying prod data. |

If the user doesn't specify, **default to staging** and confirm: "Querying staging — want production instead?"

---

## Common Investigation Queries

### Signal Freshness — "Are signals stale?"
```sql
SELECT asset, status, reason, created_at,
  NOW() - created_at AS age
FROM signals
ORDER BY created_at DESC
LIMIT 10;
```
**Alert if:** Latest signals are >4 hours old. Check if `run-signals` cron is executing (see Cron Health below).

### Brief Staleness — "Are briefs generating?"
```sql
SELECT asset, brief_type, created_at,
  NOW() - created_at AS age
FROM briefs
ORDER BY created_at DESC
LIMIT 10;
```
**Check for:**
- `daily_digest` briefs — should have one per day (generated ~08:00 UTC)
- `notable_update` briefs — generated on signal changes or every 8H if stale
- If no briefs in >12H, brief generation may be broken

### Trade Proposal Status — "Any stuck proposals?"
```sql
SELECT id, asset, direction, proposal_type, status,
  created_at, expires_at
FROM trade_proposals
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 10;
```
**Alert if:** Proposals are pending past their `expires_at` — the proposal expiry cron may not be running.

### Open Positions — "What positions are open?"
```sql
SELECT asset, direction, entry_price, size_usd,
  status, created_at
FROM positions
WHERE status = 'open'
ORDER BY created_at DESC;
```
Provides a quick portfolio view. Cross-reference with signal status to verify alignment.

### Cron Job Health — "Are crons running?"
```sql
SELECT jobname, schedule, active,
  (SELECT MAX(start_time) FROM cron.job_run_details jrd WHERE jrd.jobid = j.jobid) AS last_run
FROM cron.job j
ORDER BY jobname;
```
**Expected crons:** run-signals (hourly), health-check (30min), deposit-monitor (2min), volatility-check (30min), publish-scheduled (hourly), signal-review (daily).

### Social Post Errors — "Why aren't posts publishing?"
```sql
SELECT id, asset, post_type, platform,
  error_message, created_at
FROM social_posts
WHERE error_message IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```
**Look for:** `[image]` prefix in error_message indicates SVG→PNG rendering failure (resvg-wasm). Text-only errors indicate API/auth issues.

### Edge Function Invocations — "Is function X running?"
```sql
SELECT function_name, status, created_at,
  response_status, execution_time_ms
FROM supabase_functions.hooks
WHERE function_name = '<function-name>'
ORDER BY created_at DESC
LIMIT 10;
```

### User Investigation — "What tier is user X?"
```sql
SELECT
  u.email,
  us.tier,
  us.status AS sub_status,
  up.mode,
  up.notification_preference
FROM auth.users u
LEFT JOIN user_subscriptions us ON us.user_id = u.id
LEFT JOIN user_preferences up ON up.user_id = u.id
WHERE u.email ILIKE '%<search>%'
LIMIT 5;
```
**Privacy rule:** Only select fields needed for debugging. Never dump full user records.

### Trade Execution Check — "Did this trade execute?"
```sql
SELECT te.id, te.proposal_id, te.side,
  te.size_usd, te.fill_price, te.status,
  te.created_at, te.error_message
FROM trade_executions te
ORDER BY te.created_at DESC
LIMIT 10;
```

### Health Check Summary — "System status?"
Run Signal Freshness + Brief Staleness + Cron Job Health + Open Positions in sequence. Present as a dashboard:

```
## System Health Report

### Signals: [HEALTHY / STALE]
- Latest: BTC BUY (2h ago), ETH WAIT (2h ago)

### Briefs: [HEALTHY / STALE]
- Latest daily_digest: today 08:12 UTC
- Latest notable_update: 3h ago

### Crons: [ALL RUNNING / X INACTIVE]
- run-signals: last run 1h ago
- health-check: last run 28min ago
- deposit-monitor: last run 1min ago

### Positions: X open
- BTC LONG @ $45,200
- ETH SHORT @ $3,100

### Errors: [NONE / X recent errors]
```

---

## Safety Rules

1. **Read-only queries ONLY** — NEVER suggest or execute INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE via Supabase MCP
2. **Always specify environment** — Queries must target the correct project (staging vs production)
3. **No PII exposure** — Avoid selecting full user records. Only select the fields needed for debugging.
4. **Log what was checked** — Include a summary of queries run in the session retrospective
5. **Don't modify data to "fix" issues** — If a fix requires data changes, document the fix and have the user execute it through proper channels (migration, edge function, or direct Supabase dashboard)

## Interaction with Existing Tools

| Tool | Purpose | Relationship |
|------|---------|-------------|
| `verify-deployment.sh` | Checks infra health (migrations, functions, secrets) | This skill checks DATA health |
| `health-check` edge function | Automated monitoring (cron-based) | This skill provides ad-hoc investigation |
| `signal-review` edge function | Automated signal quality analysis | This skill queries raw data for manual investigation |

## Key References
- Signal engine architecture: MEMORY.md
- Cron schedule: `memory/cron-schedule.md`
- Backend project refs: Staging `memyqgdqcwrrybjpszuw`, Production `dikybxkubbaabnshnreh`
- Security rules: `/Users/henry/crypto-agent/SECURITY.md`
