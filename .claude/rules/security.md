---
paths:
  - ".env*"
  - "src/lib/supabase*"
  - "src/lib/auth*"
  - "src/hooks/useAuth*"
  - "vercel.json"
---

# Security Rules

**Full reference:** `docs/claude-reference/security-checklist.md`

## API Keys & Secrets
- All keys in env vars (`.env.local`, never committed). NEVER hardcode.
- Pre-commit hook checks for `ntn_`, `sk-` patterns in src/

## Env Var Safety (MANDATORY — from 2026-03-06 incident)
- **Fail-loud rule:** Critical env vars MUST throw/500 if missing. NEVER `?? "testnet"` or any silent default.
- **Same-commit rule:** New env vars must update `.env.example` + `DEPLOY.md` + set staging/prod values in the same commit.

## Supabase PostgREST Danger
- `.eq()` on non-existent columns doesn't throw — returns ALL rows unfiltered
- `.single()` returns whichever row Postgres picks first
- Always verify queries against actual migration schema

## Migration Column Verification
- When writing SQL views, verify column names against migrations — not from memory
- Past incidents: `p.tier`, `pm.closed_at`, `sr.exit_time`, `tp.position_id`, `te.fees_usd`

## RLS Reads + Dev Bypass

The dev bypass in `useAuth.ts` returns the bare anon supabase client. RLS-protected tables that gate on `TO authenticated` will return zero rows under dev bypass without raising an error — Postgres RLS denies are silent at the query layer.

Symptoms in dev preview:
- A page that fetches via `useAuthContext().supabaseClient` renders an empty state ("no rows", "not found", or a fallback) when production with real Privy auth would render data
- Looks identical to "the data genuinely doesn't exist" — easy to misdiagnose

When you see empty results in dev for a query that should have data:
1. Confirm the query target has RLS — `pg_policy` row count via supabase mcp
2. Confirm the policy is `TO authenticated` (not `TO public`)
3. Verify auth path: in dev bypass, `getToken()` returns `null` and `supabaseClient` is the anon client
4. Don't widen RLS just for verification — use a render harness with hardcoded mock state, or test in a Vercel preview build with real auth

When you see this for the first time in a session, log it once: `console.warn('[<page>] supabaseClient is null or anon — RLS will deny')` so the silent-empty failure mode surfaces.
