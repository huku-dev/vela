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
