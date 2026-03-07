# Security Checklist

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## API Keys & Secrets

- All API keys in environment variables (`.env.local`, never committed)
- Notion token in `~/.notion-config.json` (outside repo)
- Supabase keys in Vercel environment variables
- **NEVER** hardcode API keys in source code
- **NEVER** commit `.env.local` to git

### Pre-commit Security Check
```bash
# Automated in git hooks
grep -r "ntn_" src/  # Check for Notion tokens
grep -r "sk-" src/   # Check for API keys
```

---

## Environment Variable Safety (MANDATORY)

> Learned from 2026-03-06 production incident: A missing `WALLET_ENVIRONMENT` env var silently provisioned all production wallets on testnet, making user deposits invisible. This rule exists to prevent that class of failure from ever recurring.

### New Env Var Checklist

When adding ANY new `Deno.env.get()` or `import.meta.env.VITE_*` to code, the SAME commit/PR MUST also:

1. **Backend env var** -> add to `.env.example` (backend repo) AND `DEPLOY.md` step 4 secrets list AND step 4f checklist table
2. **Frontend env var** -> add to `DEPLOY.md` step 9b Vercel env vars table (both production AND preview sections)
3. **Set the value** in both staging and production (Supabase secrets or Vercel env vars). If you can't set it now, log it as a blocking task — never leave it for later.
4. **Update MEMORY.md** with the new total secret count

### Fail-Loud Rule for Critical Env Vars

Critical env vars (network/environment selectors) MUST fail loud:
- **Backend:** return 500 / throw if not set. NEVER use `?? "testnet"` or any silent default.
- **Frontend:** log `console.error` if not set. Use production-safe default (`mainnet`) only as last resort.

### Post-Deploy Audit

After every production deployment: run `supabase secrets list` and cross-reference against the `DEPLOY.md` step 4f table. Any missing secret is a potential silent production failure.

**Canonical secret count:** 38 backend secrets (updated 2026-03-06). Full checklist: `DEPLOY.md` step 4f.

---

## Input Validation

- All user inputs must be validated (XSS prevention)
- All API responses must be validated before rendering
- Use TypeScript interfaces to enforce data shapes

---

## Backend & Database Security

For all database, Edge Function, RLS, and API security rules, see:
**`/Users/henry/crypto-agent/SECURITY.md`** (backend repo)

Key rules enforced there:
- All tables MUST have RLS enabled + policies (in the same migration file)
- All views MUST use `security_invoker = on`
- All functions MUST set `search_path = public`
- Run Supabase Security Advisor after any migration (0 errors required)
- Run `scripts/verify-migrations.sql` after every `db push` (all rows must be `true`)
- Adversarial tests (`FEATURE-ADV:` prefix) required for any financial feature
- Threat report in `docs/threat-reports/` required for new attack surfaces

---

## Migration Column Verification (MANDATORY)

When writing SQL views, ALWAYS verify column names against the CREATE TABLE / ALTER TABLE migrations — not from memory.

Past incidents with non-existent columns that passed code review but failed on `db push`:
- `p.tier` (profiles)
- `pm.closed_at` (postmortems)
- `sr.exit_time` (simulated)
- `tp.position_id` (proposals)
- `te.fees_usd` (executions)
