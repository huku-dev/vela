# Monthly Security Audit — 2026-08-02

**Scope:** Both repos — `crypto-agent-frontend` (React 18 / Vite / Supabase / Vercel) and `crypto-agent` (Supabase Edge Functions, Deno, PostgreSQL)
**Prior audit:** [2026-05-06](2026-05-06-monthly-audit.md). Interim June/July security work reviewed from incident memories and migrations (see §6).
**Method:** Direct file review, grep sweeps across all 53 edge functions and frontend source, live Supabase advisor + catalog queries against **production** (`dikybxkubbaabnshnreh`) and **staging** (`memyqgdqcwrrybjpszuw`), `npm audit`.
**Backend branch at audit time:** `feat/admin-dashboard` (commit `c8917b8`). Frontend `main` (`6990d71`) with uncommitted `/admin` work in tree.

> **Handling note:** §2 C1 concerns a live credential that is currently exposed. Its value is deliberately **not** reproduced in this document. Retrieve it yourself from the catalog query given in the remediation steps.

---

## 1. Trust Boundary Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                       │
│                                                                       │
│  Browser ──HTTPS──► Vercel CDN ──► React SPA   (anon key ONLY ✓)      │
│                                     CSP + HSTS + Permissions-Policy ✓ │
│                                                                       │
│  Telegram ────────────────────────────────────────────────────────┐   │
│  Stripe ──────────────────────────────────────────────────────────┤   │
│  Email action links (HMAC) ───────────────────────────────────────┤   │
│  *** ANY UNAUTHENTICATED CALLER *** ──────────────────────────────┤   │
└──────────────────────────────────────────────┬────────────────────┘   │
                                               │ HTTPS                   │
┌──────────────────────────────────────────────▼────────────────────┐   │
│ SUPABASE EDGE LAYER — 53 functions, ALL deployed --no-verify-jwt   │◄──┘
│                                                                    │
│  Auth boundary  : Privy ES256 → HS256 JWT      (auth-exchange)     │
│  Financial      : JWT + hashed OTP             (process-withdrawal)│
│  Webhook        : Stripe sig / TG secret / HMAC                    │
│  Cron           : X-Cron-Secret (vault) OR service-role bearer     │
│  Admin          : JWT + privy_did allowlist    (admin-dashboard)   │
│                                                                    │
│  ⚠ 12 FUNCTIONS WITH NO AUTH GATE AT ALL — see C2, H1              │
│    incl. scanner-30m, which executes real trades                   │
└──────────────────────────────────────────────┬────────────────────┘
                                               │ service_role
┌──────────────────────────────────────────────▼────────────────────┐
│ SUPABASE POSTGRES                                                  │
│   RLS enabled on all user-data tables ✓                            │
│   Backend-only tables: RLS deny-all + grants revoked ✓             │
│   ⚠ pg_cron catalog leaks service_role key literal — C1            │
├────────────────────────────────────────────────────────────────────┤
│ Privy HSM — private keys never leave, no export path in code ✓     │
│ Hyperliquid API — agent wallets, withdraw3-scoped ✓                │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Findings — Ranked by Severity

### CRITICAL

#### C1: Production service_role key stored in plaintext in the pg_cron catalog — **regression of the 2026-05-07 incident**

- **Where:** `cron.job.command` for jobs `run-signals-4h` and `run-signals-4h-b2`, on **both production and staging**.
- **Source:** `supabase/migrations/20260521000001_run_signals_batch_split.sql:51-62` and `:77-88`.
- **The pattern:**
  ```sql
  SELECT decrypted_secret INTO STRICT _svc_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ...
  PERFORM cron.schedule('run-signals-4h', '...', format(
    $$... 'Authorization', 'Bearer %s' ...$$, _base_url, _svc_key));
  ```
  `format()` resolves `_svc_key` at **migration time**, so the literal `sb_secret_…` value is what lands in `cron.job.command` — a plaintext catalog column readable by any role with `SELECT` on `cron.job`, and captured in WAL and backups.
- **Verification (run this to confirm and to retrieve the exposed value):**
  ```sql
  SELECT jobname, command FROM cron.job
  WHERE command LIKE '%Bearer ey%' OR command LIKE '%Bearer sb_%';
  ```
  Returned 2 rows on prod, 2 rows on staging, both with `has_literal_secret = true`, `uses_vault_lookup = false`.
- **Why this is a regression:** this is the *exact* banned pattern from the 2026-05-07 cron-secret-leak incident, reintroduced 14 days after that incident closed. The incident memo's own periodic-audit query (`memory/incident_2026_05_07_cron_secret_leak.md:19`) is the query above — it has been returning non-zero since 2026-05-21 and was never re-run.
- **Compounding:** the leaked value appears to be the same key the 2026-05-07 memo flagged as **"Rotation is required"**. That residual-risk item was never closed, so the key has now been continuously exposed since the original incident (~12 weeks), not 10 weeks.
- **Impact:** anyone with `SELECT` on `cron.job` — including the `postgres` role on managed Supabase, and anyone reading a DB backup — obtains the service_role key. That key bypasses all RLS: full read/write on every user's positions, proposals, wallets, PII, and the ability to invoke every service-role-gated edge function.
- **Why the prevention hook did not stop it:** `.claude/hooks/check-write-secrets.sh:65` and `.claude/hooks/check-migration-security.sh:112-113` both now catch `format('Bearer %s', _svc_key)` correctly. But `check-migration-security.sh` was authored 2026-07-01 (per the trade_attribution incident) and the consolidated secret rule postdates 2026-05-21. The migration predates coverage. **The hooks are correct going forward; nothing swept the already-live catalog state.** Note also that `check-no-cron-secrets.sh`, named in the 2026-05-07 memo, does not exist under that filename — the rule lives in the two files above.
- **Fix — reschedule first, then rotate:**
  1. **Reschedule both jobs** with runtime vault resolution, matching the established remediation pattern in `20260507000002_lock_down_cron_secrets.sql`:
     ```sql
     'Authorization', 'Bearer ' || (
       SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name = 'service_role_key' LIMIT 1
     )
     ```
     This must be string concatenation *inside the command text*, not `format()` substitution — that is the entire distinction between the safe and unsafe forms.
  2. Re-run the audit query on both projects; expect zero rows.
  3. **Then rotate** the service_role key: Supabase Dashboard → Settings → API, on prod and staging. Update the `service_role_key` Vault entry on both, then `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new>` on both, then redeploy via `./scripts/deploy.sh`.
  4. Add the audit query to `health-check` or a scheduled monitor so drift is detected continuously rather than at the next manual audit.

  **Ordering rationale:** the replacement command embeds nothing — it stores the vault *query*, so it is safe to apply regardless of key state. Rescheduling first clears the literal from the catalog immediately with zero cron downtime. Rotating first would instead leave both `run-signals` jobs carrying a now-dead literal key until the migration lands, breaking the 4-hourly signal run in the interim.

#### C2: `scanner-30m` is unauthenticated and executes real trades

- **File:** `supabase/functions/scanner-30m/index.ts:70` — `Deno.serve(async (_req) => {`. The request object is unused; there is no auth check anywhere in the file.
- **Deployed** with `--no-verify-jwt` (`scripts/deploy.sh:195` applies it to every function), so the endpoint is reachable by anyone at `<SUPABASE_URL>/functions/v1/scanner-30m`.
- **Reaches money:** imports `executeTradeProposal` (`:35`) and calls it at `:470`, `:495`, `:561`. Per `CLAUDE.md`, scanner-30m is one of the three trade-execution paths.
- **Attack:** repeatedly POST the endpoint to force out-of-schedule scan cycles — generating and auto-executing momentum/BB2 entries and exit-scanner stop/trim actions for every eligible user, at attacker-chosen timing. Each cycle costs real Hyperliquid fees and moves real positions. Also drains LLM quota and Micro-plan IO budget.
- **Fix:** add `verifyCronAuth` at handler entry, matching `position-monitor` / `market-context-refresh`:
  ```typescript
  Deno.serve(async (req) => {
    const authResult = await verifyCronAuth(req);
    if (!authResult.ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  ```
  Note this requires changing the `_req` parameter to `req`.

---

### HIGH

#### H1: 11 further edge functions accept unauthenticated requests

Same root cause as C2 — `--no-verify-jwt` on every function, no in-function gate. Full sweep result:

| Function | Blast radius if triggered at will |
|---|---|
| `e2e-testnet-test` | Executes a 17-test testnet trade suite. Burns testnet funds + IO budget; long-running (150s) so it is an effective DoS lever on the Micro plan worker pool. |
| `breaking-news` | Calls `broadcastNewsBrief` (`:1563`) — per-user Telegram broadcast to the entire user base. Mass-notification spam; brand damage. |
| `attribution-compute` | Service-role DB writes. Accepts a `?backfill_since=` query param from the caller (`:74`), widening the processing window arbitrarily — unbounded work amplification per request. |
| `news-l2-batch` | LLM judge batch. Direct spend amplification. |
| `news-enrich` | LLM enrichment. Direct spend amplification. |
| `macro-enrich` | LLM enrichment. Direct spend amplification. |
| `sec-filing-enrich` | LLM enrichment. Direct spend amplification. |
| `classifier-drift-check` | Privileged drift RPCs + admin alerting. Alert spam. |
| `bb2-shadow-resolve` | Service-role writes to shadow-tracking `detail` (`:305`). Corrupts forward-test data. |
| `earnings-calendar-sync` | External API sync; wrapped in `withSentry`, which performs **no** auth (`_shared/sentry.ts:132-146`). Third-party quota drain. |
| `sec-edgar-poll` | SEC EDGAR polling. Third-party quota drain; EDGAR rate-limit / IP-ban risk. |

- **Severity rationale:** HIGH not CRITICAL because none of these move user funds directly. `attribution-compute` and `bb2-shadow-resolve` write to the DB, and `breaking-news` reaches all users, so they sit at the top of this band.
- **Fix:** add `verifyCronAuth` (cron-driven: `attribution-compute`, `bb2-shadow-resolve`, `breaking-news`, `classifier-drift-check`, `earnings-calendar-sync`, `macro-enrich`, `news-enrich`, `news-l2-batch`, `sec-edgar-poll`, `sec-filing-enrich`) or a service-role bearer check (`e2e-testnet-test`). Each is a ~5-line change at handler entry. Several use `async (_req)` and will need the parameter renamed.
- **Systemic fix worth considering:** the failure mode recurs because auth is opt-in per function while exposure is automatic via `--no-verify-jwt`. A shared `withCronAuth(name, handler)` wrapper — or a deploy.sh preflight that greps each target for a known auth token and refuses to deploy without one — inverts that default.

#### H2: `npm audit` — 71 vulnerabilities (3 critical, 24 high), materially worse than May

- **May 2026:** 24 total (1 critical, 2 high, 21 moderate). **Now:** 71 total (3 critical, 24 high, 43 moderate, 1 low).
- Dominant new chain is the WalletConnect/Reown stack pulled in through `@privy-io/react-auth` → `@wagmi/connectors` → `@reown/appkit-*` → `@walletconnect/universal-provider`, plus the carried-over `protobufjs` (via `posthog-js` → OpenTelemetry) and `lodash` chains.
- All are transitive; none is directly imported by Vela code, which limits practical exploitability. The trajectory is the concern, not any single advisory.
- **Fix:** `npm audit fix` first and re-test the Privy login path end-to-end. For what remains, bump `@privy-io/react-auth` to the current release — most of the delta since May sits under that one dependency. Re-run and record the residual count here next month.

---

### MEDIUM

#### M1: `APP_BASE_URL` silently falls back to `http://localhost:5173` in 10 places — **unfixed from May (was M3)**

- **Files:** `create-checkout-session/index.ts:33,212`, `create-portal-session/index.ts:27,99`, `trade-webhook/index.ts:632,690`, `news-detail-generate/index.ts:45`, `swapped-signature/index.ts:20`, `telegram-link/index.ts:26`, `provision-wallet/index.ts:22`.
- Violates the project's absolute "no silent defaults" rule. If `APP_BASE_URL` were unset in a deployed environment, Stripe checkout `success_url` / `cancel_url` and portal return URLs would point at localhost, and email/Telegram deep links would be dead — with no error raised anywhere.
- `formatProposalEmail()` in `_shared/notify.ts` already does this correctly with a fail-loud guard. The inconsistency is the bug.
- **Fix:** extract a shared `getAppBaseUrl()` in `_shared/` that throws when unset, and replace all 10 call sites.

#### M2: `public.retry_daily_digest` has a mutable `search_path`

- **Advisor:** `function_search_path_mutable` (WARN), production.
- **Source:** `supabase/migrations/20260411000002_retry_daily_digest_rpc.sql`. The same file also builds an `Authorization` header via `'Bearer ' || _service_key` (`:36`) — that concatenation form is the safe runtime pattern *only if* it is inside the command text rather than resolved at definition time; worth confirming while fixing the search_path.
- A mutable search_path on a privileged function is the classic schema-shadowing escalation vector.
- **Fix:** `ALTER FUNCTION public.retry_daily_digest() SET search_path = public, pg_temp;` — works in place on the existing function, idempotent.

#### M3: `auth-exchange` still soft-skips wallet provisioning when `WALLET_ENVIRONMENT` is unset — improved but not closed

- **File:** `supabase/functions/auth-exchange/index.ts:188-201`.
- Since May this gained `captureMessage(...)` with `level: "error"`, so the condition now surfaces in Sentry rather than vanishing. That is a real improvement over the May finding.
- It remains a soft skip: token exchange succeeds and the user is fully logged in with no wallet and therefore no deposit address. The user-visible failure is silent even though the operator-visible one is not.
- **Fix:** keep the non-fatal auth path, but mark the profile so the UI can surface "wallet provisioning pending" and a retry runs on next login, rather than leaving the account in a quietly broken state.

---

### LOW

#### L1: Broad GraphQL/REST schema discoverability for `authenticated`

- **Advisors:** `pg_graphql_anon_table_exposed` (7 objects), `pg_graphql_authenticated_table_exposed` (16 objects), both WARN.
- Notable: `audit_log`, `positions`, `profiles`, `trade_proposals`, `user_wallets`, `user_subscriptions`, `funding_events`, `circuit_breaker_events` are all discoverable in the schema by any signed-in user.
- **Row exposure is correctly prevented** — every one of these has RLS enabled with policies (verified by direct catalog query: `audit_log` 1 policy, `positions` 1, `profiles` 2, `user_wallets` 1, `trade_proposals` 1, `user_subscriptions` 1, `funding_events` 2, `user_preferences` 3, `withdrawal_otps` 1). This is schema-shape disclosure, not data disclosure.
- The anon-exposed set (`assets`, `briefs`, `latest_*` views, `paper_trades`, `release_notes`) is intentional — those back the logged-out marketing and dashboard surfaces.
- **Fix:** optional hardening only. Revoke `SELECT` from `authenticated` on tables the frontend never queries directly through PostgREST. Low priority given RLS is doing the real work.

#### L2: `claim_trial()` is executable by `authenticated` — advisor WARN, assessed as a false positive

- **Advisor:** `authenticated_security_definer_function_executable` (WARN).
- Reviewed `supabase/migrations/20260421000001_trial_system_schema.sql:172-197`. The function is correctly built: `SET search_path = public, pg_temp`, derives the caller from `auth.jwt() ->> 'sub'` and explicitly refuses a `user_id` argument (the comment at `:182-183` calls out the escalation footgun), raises `insufficient_privilege` on a null caller, and claims the trial via a race-safe conditional `UPDATE ... WHERE has_used_trial = false`.
- **No action.** Being callable by `authenticated` is the entire point of this RPC. Recorded here so the WARN is not re-triaged next month.

#### L3: Rate limiter fails open on DB errors — accepted, unchanged

- **File:** `_shared/rate-limiter.ts:89,123`. Intentional: DB unavailability must not halt all trading. Admin alerting is DB-backed with a per-identifier cooldown (`:106-117`) and remains in place. **No action.**

---

## 3. STRIDE Summary

| Category | Threat | Attack path | Severity | Status |
|---|---|---|---|---|
| **Spoofing** | Forged Telegram webhook | POST webhook endpoint without secret | LOW | ✅ `TELEGRAM_WEBHOOK_SECRET`, fail-closed |
| **Spoofing** | Forged email action link | Craft HMAC for another user's proposal | LOW | ✅ userId-bound HMAC + timing-safe compare (`notify.ts:82-141`) |
| **Spoofing** | JWT `sub` tampering | Forge Supabase JWT | LOW | ✅ Privy ES256 verified → HS256 signed; `verify-auth.ts` |
| **Spoofing** | Impersonate cron caller | POST cron-driven functions directly | **HIGH** | ❌ **12 functions ungated — C2, H1** |
| **Tampering** | Force out-of-schedule trade execution | POST `scanner-30m` | **CRITICAL** | ❌ **C2** |
| **Tampering** | Corrupt attribution / shadow-test data | POST `attribution-compute`, `bb2-shadow-resolve` | HIGH | ❌ **H1** |
| **Tampering** | Proposal double-accept race | Concurrent accept requests | LOW | ✅ Atomic `WHERE status='pending'` + ownership pushed into UPDATE |
| **Tampering** | Subscription tier bypass via webhook replay | Replay Stripe event | LOW | ✅ Idempotency via `last_webhook_event_id`; `constructEventAsync` on raw body |
| **Repudiation** | No audit trail on trade actions | — | LOW | ✅ `logAudit()` on all three paths; `notification_log` rows |
| **Info Disclosure** | **service_role key readable from DB catalog** | `SELECT command FROM cron.job` | **CRITICAL** | ❌ **C1 — prod + staging** |
| **Info Disclosure** | Cross-user data read | PostgREST as another user | LOW | ✅ RLS + policies verified on all user tables |
| **Info Disclosure** | Backend-only tables readable | PostgREST/GraphQL as anon | LOW | ✅ Grants revoked — zero `anon`/`authenticated` grants on all 16 checked |
| **Info Disclosure** | OTP readable if DB compromised | Read `withdrawal_otps` | LOW | ✅ **Fixed** — HMAC-SHA256 hashed with server pepper |
| **Info Disclosure** | Schema shape visible to any user | GraphQL introspection | LOW | ⚠️ L1 — rows protected, shape visible |
| **Info Disclosure** | Stack traces in responses | Trigger handler error | LOW | ✅ `sanitizeError()`; admin-dashboard-data returns opaque 500 |
| **Info Disclosure** | Source maps public | Fetch `.map` from CDN | LOW | ✅ `sourcemap: 'hidden'` + deleted post-Sentry-upload |
| **DoS** | Flood trade-executing scanner | POST `scanner-30m` | **CRITICAL** | ❌ **C2** |
| **DoS** | Drain LLM quota | POST the 5 ungated enrich/judge functions | HIGH | ❌ **H1** |
| **DoS** | Mass Telegram broadcast | POST `breaking-news` | HIGH | ❌ **H1** |
| **DoS** | Exhaust Micro-plan worker pool | POST `e2e-testnet-test` (150s each) | HIGH | ❌ **H1** |
| **DoS** | Unbounded backfill window | `attribution-compute?backfill_since=2020-01-01` | MEDIUM | ❌ **H1** |
| **DoS** | Rate limit bypass on DB error | Induce DB error | LOW | ✅ Accepted fail-open by design; alerted |
| **EoP** | service_role key in frontend bundle | Read JS bundle | LOW | ✅ Zero matches for `service_role` in `src/` |
| **EoP** | **service_role key from catalog → full RLS bypass** | Chain from C1 | **CRITICAL** | ❌ **C1** |
| **EoP** | Cross-user proposal action | Accept another user's proposal | LOW | ✅ Ownership in the UPDATE `WHERE` (May M1 fixed) |
| **EoP** | Non-admin reaches admin dashboard | Call `admin-dashboard-data` | LOW | ✅ JWT + `privy_did` allowlist, fail-closed, opaque 404 |
| **EoP** | Non-admin Telegram engagement actions | Click inline buttons | LOW | ✅ **Fixed** — admin chat ID checked (May L4) |
| **EoP** | Schema shadowing via mutable search_path | Exploit `retry_daily_digest` | MEDIUM | ⚠️ M2 |
| **EoP** | Trial re-claim | Call `claim_trial()` repeatedly | LOW | ✅ JWT-derived caller, race-safe conditional UPDATE |

---

## 4. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | **FAIL** | 12 edge functions with no auth gate (C2, H1). Ownership checks and RLS themselves are sound: May's M1 ordering bug fixed, RLS + policies verified on all user tables, backend-only grants fully revoked, email HMAC still userId-bound. |
| **A02 Cryptographic Failures** | **FAIL** | Primitives are correct — Privy ES256 → HS256, HMAC-SHA256 with timing-safe compare, `crypto.getRandomValues()` OTPs now hashed with a server pepper (May M4 fixed), 1h JWT TTL with 5-min client buffer. Fails on key *handling*: C1 leaks the service_role key to a plaintext catalog on both environments, and the key flagged for rotation on 2026-05-07 was never rotated. |
| **A03 Injection** | **PASS** | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval()` / `new Function()` in frontend `src/`. All DB access via PostgREST or parameterized RPC. No string-concatenated SQL in edge functions. |
| **A04 Insecure Design** | **FAIL** | Exposure is the default (`--no-verify-jwt` applied to all 53 functions in `deploy.sh:195`) while auth is opt-in per function. That inversion is what produced C2/H1 and will keep producing them. `attribution-compute` also accepts an unbounded caller-supplied `backfill_since` window. Tier limits and `max_active_positions` enforcement remain correct. |
| **A05 Security Misconfiguration** | **PARTIAL** | Frontend is in good shape: `.env` and `.env.local` both gitignored and confirmed untracked, no real secrets in either (the one `SUPABASE_SERVICE_ROLE_KEY` grep hit in `.env` is a commented-out placeholder), `sourcemap: 'hidden'`, and `vercel.json` now carries CSP, HSTS, Permissions-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` — May's L1/L2 both closed. Backend fails on M1 (10 silent localhost fallbacks) and M2. |
| **A06 Vulnerable Components** | **FAIL** | 71 npm vulnerabilities, 3 critical / 24 high — up from 24 total in May. All transitive, dominated by the Privy → WalletConnect/Reown chain. |
| **A07 Auth Failures** | **PARTIAL** | `DEV_BYPASS` now gated on `import.meta.env.DEV` (May L3 fixed, `useAuth.ts:18`). Token exchange rate-limited with inflight dedup. Cron auth has a proper vault-backed `X-Cron-Secret` helper with constant-time compare. Undermined by the 12 ungated functions. |
| **A08 Data Integrity** | **PASS** | Stripe `constructEventAsync` against the raw `req.text()` body before any parsing (`payment-webhook:49` → `stripe-adapter.ts:190`). Telegram secret fail-closed. Email HMAC user-bound with a previous-window grace check. OTP single-use enforced. Webhook idempotency via `processed_webhook_events`. |
| **A09 Logging & Monitoring** | **PARTIAL** | Sentry on all financial paths, `logAudit()` on trade/auth/payment, DB-backed rate-limit admin alerts with cooldown, `notification_log` audit rows, cron heartbeats. **Gap:** the 2026-05-07 periodic cron-secret audit query was documented but never automated — it has been failing silently for ~10 weeks, which is precisely why C1 survived. Detection, not prevention, is the weak link. |
| **A10 SSRF** | **PASS** | Every server-side `fetch()` target reviewed: all resolve from env vars (`SUPABASE_URL`, `config.rpcUrl`, `deployHookUrl`) or hardcoded adapter base URLs. No user-controlled host reaches `fetch()`. |

---

## 5. Recommended Actions (Priority Order)

| # | Action | Effort | Location |
|---|---|---|---|
| 1 | **Reschedule both `run-signals-4h*` crons with runtime vault lookup, then rotate the service_role key on prod + staging.** Reschedule first — see C1 ordering rationale. | 1–2h | New migration + Supabase Dashboard |
| 2 | **Add `verifyCronAuth` to `scanner-30m`** — it executes trades | 10 min | `scanner-30m/index.ts:70` |
| 3 | **Add auth to the remaining 11 ungated functions** | 1h | Each `index.ts` handler entry |
| 4 | **Automate the cron-secret audit query** as a `health-check` assertion or scheduled advisor monitor | 30 min | `health-check/index.ts` |
| 5 | **`npm audit fix`, then bump `@privy-io/react-auth`**; re-test login end-to-end | 1–2h | `package.json` |
| 6 | **Add a `deploy.sh` preflight** that refuses to deploy a function containing no recognized auth token | 45 min | `scripts/deploy.sh` |
| 7 | **Extract a fail-loud `getAppBaseUrl()`** and replace all 10 silent-fallback call sites | 30 min | `_shared/` + 7 functions |
| 8 | **`ALTER FUNCTION public.retry_daily_digest() SET search_path = public, pg_temp`** | 5 min | New migration |
| 9 | **Bound `attribution-compute`'s `backfill_since`** to a maximum window | 15 min | `attribution-compute/index.ts:74` |
| 10 | **Surface pending wallet provisioning to the user** when `WALLET_ENVIRONMENT` is unset | 30 min | `auth-exchange/index.ts:188` |
| 11 | Optional: revoke `authenticated` `SELECT` on tables never queried via PostgREST | 30 min | New migration |

Items 1–4 should land before anything else ships. Item 1 is the only one that touches a live credential and needs the ordering respected exactly.

**Rotation assessment (added post-review):** the realistic access set for prod `cron.job` is narrow — the operator, Supabase's own infrastructure (which holds full DB access regardless), and Supabase-managed backups. No CI pipeline touches the database; the backend repo has no `.github/workflows`. There is no positive evidence of third-party access. Two factors still argue for rotating: (a) Postgres does not log `SELECT`s on `cron.job`, so non-exposure is **unverifiable** — absence of evidence carries no information here; and (b) the key value was rendered in full inside at least two Claude Code session transcripts (2026-05-07 and this audit), a surface outside the database entirely. Rotation is ~30 minutes and reversible; this same key was already flagged for rotation on 2026-05-07 and skipped. Recommendation: rotate at the next convenient window, not as an emergency. The reschedule in step 1 removes the ongoing catalog exposure independently of the rotation decision.

---

## 6. Regression Check vs. Prior Audits

### Against 2026-05-06 (previous monthly audit)

| May finding | Status now |
|---|---|
| C1 `run-signals` no auth | ✅ **FIXED** — service-role bearer check at `:79-92` |
| H1 `asset-intel-generate` no auth | ✅ **FIXED** — `:124-135` |
| H2 `proposal-reminder` no auth | ✅ **FIXED** — `:26-36` |
| H3 `weekly-recap` no auth | ✅ **FIXED** — `:45-55` |
| H4 npm audit (24 findings) | ❌ **WORSE** — now 71 (H2) |
| M1 ownership check after DB update | ✅ **FIXED** — `.eq("user_id", …)` pushed into the UPDATE, with an explicit code comment citing the May audit |
| M2 `daily-digest` / `subscription-reminders` / `position-holder-brief` no auth | ✅ **FIXED** — all three gated |
| M3 CORS localhost fallback | ❌ **UNFIXED** — now M1, 10 call sites |
| M4 plaintext OTP storage | ✅ **FIXED** — HMAC-SHA256 with `WEBHOOK_HMAC_SECRET` pepper; verify path hashes the submitted code |
| M5 `health-check` unauthenticated | ✅ **FIXED** — `:155-167` |
| L1 missing HSTS | ✅ **FIXED** — `vercel.json` |
| L2 missing Permissions-Policy | ✅ **FIXED** — `vercel.json` |
| L3 `DEV_BYPASS` not gated on `DEV` | ✅ **FIXED** — `useAuth.ts:18`, with a comment naming the Vercel-misconfiguration scenario |
| L4 engagement callbacks not admin-gated | ✅ **FIXED** — admin chat ID checked before processing |
| L5 rate limiter fail-open | ✅ Accepted as-designed, unchanged |
| `WALLET_ENVIRONMENT` soft-skip in `auth-exchange` | ⚠️ **PARTIAL** — now Sentry-captured, still a soft skip (M3) |

**13 of 16 closed.** Strong remediation record on everything that was explicitly listed.

### Against interim June/July security work

| Item | Status |
|---|---|
| `trade_attribution` RLS incident (2026-07-01) — RLS enabled, lock RPCs revoked, `search_path` set | ✅ **HOLDING** — advisor shows RLS-enabled-no-policy (the intended deny-all); zero `anon`/`authenticated` grants |
| Second-gate commit hook `check-migration-security.sh` (2026-07-01) | ✅ Present, covers RLS / `search_path` / `SECURITY DEFINER` / Bearer-literal / REVOKE rules |
| Grant lockdown follow-up (2026-07-13) — `trade_attribution`, `classifier_calibration` | ✅ **HOLDING** — verified zero grants on all 16 backend-only tables checked |
| `cron_heartbeats` RLS (open item from the 2026-07-01 retro) | ✅ **CLOSED** — `20260506000001_cron_heartbeats_enable_rls.sql` enables RLS; advisor confirms |
| Privy stuck-wallet export route (2026-07-15) — one-off `/support/export` page | ✅ **REMOVED CLEANLY** — commit `ab7a952` deleted `SupportExport.tsx` and its route; no residual private-key handling in `src/` (only Privacy/Terms prose matches) |
| `trade_postmortems.asset_class` silent default (2026-07-28) | ✅ Fixed with required field + runtime guard + Sentry. Not a security finding, but the same "silent substitution" class as M1/M3 here. Its own memo flags `strategy_config` as unaudited with identical shape — still open. |
| **2026-05-07 cron secret leak** | ❌ **REGRESSED** — see C1. Both the pattern (reintroduced 2026-05-21) and the unclosed rotation residual. |

---

## 7. Positive Observations

- **May remediation was thorough.** 13 of 16 findings closed, several with code comments explicitly citing the audit that raised them — that traceability made this month's verification fast and unambiguous.
- **Privy HSM model intact.** `wallet-provisioner.ts` exposes no private-key handling of any kind, and the one-off support export route was removed rather than left dormant.
- **`admin-dashboard-data` is a well-built new surface.** JWT verification, then a `privy_did` allowlist, fail-closed 500 when the allowlist is unset, and a deliberately opaque 404 for non-admins so `/admin` is not discoverable. The frontend allowlist is correctly documented in-file as UX only, with the server named as the real boundary.
- **Grant lockdown is comprehensive and holding.** Every backend-only table checked has zero `anon`/`authenticated` grants — deny-all RLS *plus* revoked grants, which is stronger than either alone.
- **Frontend security posture is now clean.** Zero XSS sinks, no secrets in tracked or untracked env files, hidden source maps, and a complete security header set including a genuinely restrictive CSP with `frame-ancestors 'none'`.
- **Stripe and Telegram webhook handling remains textbook** — raw body read before signature verification, fail-closed secrets, idempotency tables.
- **`claim_trial()` is a model SECURITY DEFINER function**: JWT-derived identity, refuses a caller-supplied user id with a comment explaining why, pinned search_path, race-safe conditional update.
- **`process-withdrawal` retains defense in depth** and gained OTP hashing this cycle: JWT + hashed OTP + rate limit + daily limit + execute-time balance check + concurrency guard + `WALLET_ENVIRONMENT` fail-loud.

---

## 8. Meta-observation

The three worst findings this month (C1, C2, H1) share one shape: **a security control that exists and is correct, but is not applied by default.**

Cron secrets have a correct vault pattern, a documented ban on the unsafe form, and now two hooks enforcing it — and a migration written 14 days after the incident still shipped the banned form, because nothing swept the live catalog afterwards. Edge functions have three good auth helpers — and 12 functions have none, because `--no-verify-jwt` exposes them automatically while auth must be remembered per function.

Prevention hooks catch the *next* offender. They do not clean up state that is already live, and they do not fire on the function you forgot to write. The two structural items in §5 — automating the cron-secret audit query (#4) and adding a deploy-time auth preflight (#6) — are worth more than any individual fix in this report, because they convert both classes from "remembered" to "enforced."

---

*Audit performed 2026-08-02. Live catalog and advisor queries run against production `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw`.*
