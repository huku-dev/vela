# Monthly Security Audit: 2026-10-01

**Scope:** Both repos. `crypto-agent-frontend` at `origin/main` `b604ede` (React / Vite / Supabase / Vercel) and `crypto-agent` at `5417a1a` (one docs-only ADR commit ahead of `origin/main` `1d0d764`; 59 Supabase Edge Functions, Deno, PostgreSQL).
**Prior audit:** [2026-09-01](2026-09-01-monthly-audit.md) (baseline). Also on file: [2026-08-02](2026-08-02-monthly-audit.md), [2026-07-02](2026-07-02-monthly-audit.md), [2026-05-06](2026-05-06-monthly-audit.md). 2026-04 and 2026-06 produced no report (recorded in the README; nothing to recover).
**Method:** Isolated worktree off `origin/main` (Part 0). Live catalog, advisor, grant and policy queries against prod `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw` via Supabase MCP. Handler-scoped auth sweep of every `Deno.serve` body (not whole-file grep). Targeted review of the money-flow and auth files. `npm audit`. Live queries ran 2026-10-01; source review completed 2026-10-04 (the run spanned several days of wall-clock).

> **Coverage note:** the Supabase MCP connection was invalidated partway through Part 3. All four mandated live checks (pg_cron secrets, advisors, grants, RLS/policies) completed on both projects before that. Not completed: the deployed-function list cross-check (orphan functions still reachable but deleted from the repo) and a direct `proconfig` read of `retry_daily_digest`. The latter is inferred fixed because its `function_search_path_mutable` WARN is gone from the advisor output and migration `20260902000001` pins it.

---

## 0. Report durability

The September mechanism (worktree off `origin/main`, branch, push, PR) worked: the 2026-09-01 report is on `main` and was the baseline for this run with no recovery step. This report follows the same path.

---

## 1. Trust Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                  │
│  Browser ──HTTPS──► Vercel CDN ──► React SPA (anon key only) ✓   │
│    CSP + HSTS + Permissions-Policy + frame-ancestors 'none' ✓    │
│  Telegram / Stripe / Swapped / Email-HMAC / Privy ─────────┐     │
│  *** ANY UNAUTHENTICATED CALLER *** ───────────────────────┤     │
└───────────────────────────────────────────────┬────────────┘     │
                                               │ HTTPS             │
┌───────────────────────────────────────────────▼────────────┐     │
│ SUPABASE EDGE LAYER: 59 functions, ALL --no-verify-jwt      │◄────┘
│  Gate coverage : 55/59 gated in-handler ✓ (Sept: ~44/58)    │
│    4 allowlisted ungated: uptime-probe (public by design),  │
│    e2e-testnet-test / e2e-trade-test / test-r2-tp-trim      │
│    (403 off staging; on staging: anonymous trade driving    │
│     + service-role writes, hard-coded-sub JWT mint)   M2    │
│  deploy.sh auth preflight ✓ (whole-file grep)         L1    │
│  Auth boundary : Privy ES256 → HS256 JWT 1h (auth-exchange) │
│  Financial     : JWT + peppered OTP (process-withdrawal)    │
│    ⚠ daily limit checked at request_otp only, not confirm   │
│      → N pre-minted OTPs each under cap             H1      │
│  Webhook       : Stripe sig / Swapped HMAC / TG secret ✓    │
│  Cron          : X-Cron-Secret (vault, timing-safe) ✓       │
└───────────────────────────────────────────────┬────────────┘
                                               │ service_role
┌───────────────────────────────────────────────▼────────────┐
│ SUPABASE POSTGRES: RLS on 62/62 public tables ✓             │
│  pg_cron: 0 literal secrets, 36/36 HTTP jobs vault ✓        │
│  admin_llm_cost_* anon EXECUTE revoked ✓ (Sept M1 fixed)    │
│  ⚠ default ALL grants to anon/authenticated on 4 backend    │
│    tables (RLS still blocks rows)                     M3    │
│  ⚠ staging-only: paper_trades public UPDATE USING(true) M5  │
│  Privy HSM (keys never extracted) ✓ · HL withdraw3-scoped ✓ │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Live Infrastructure Queries (both projects)

| Check | Prod | Staging |
|---|---|---|
| pg_cron literal `Bearer` secrets (2026-05-07 incident class) | **0 rows**. 44 jobs; all 36 HTTP jobs `uses_vault_lookup=true`, `has_literal_secret=false` | **0 rows**. Same shape (most HTTP jobs inactive on staging by design) |
| Supabase advisors: ERROR | 0 | 0 |
| Supabase advisors: WARN | 36 (12 anon GraphQL, 23 authenticated GraphQL, 1 `claim_trial` known-benign) | 1 (`claim_trial`, known-benign) |
| `function_search_path_mutable` WARN (Sept M3, `retry_daily_digest`) | **gone** | gone |
| RLS enabled | 62/62 public tables | 63/63 (staging has an extra `brief_ratings`) |
| `USING (true)` policies to non-service roles | Only on intentional public product data: `assets`, `briefs`, `signals`, `indicator_snapshots`, `tier_config`, `release_notes`, `news_cache`, `paper_trades`, `signal_performance`, `signal_reviews`, `trade_postmortems` (all SELECT) | Same, **plus `paper_trades` `Allow update on paper_trades [public:UPDATE]`** (M5) |
| anon/authenticated table grants | 18 tables carry grants. User-data tables (`positions`, `trade_proposals`, `user_wallets`, `profiles`, `audit_log`, `funding_events`, `cctp_transfers`, `circuit_breaker_events`, `user_preferences`, `user_subscriptions`) are ownership-scoped by RLS as before. **New vs the 2026-07-13 lockdown standard:** `admin_alert_history`, `dashboard_curated`, `wallet_migration_log` (created Aug 3 / 20 / 25, no `REVOKE`) hold default `ALL` grants for anon + authenticated (M3) | Same, plus `open_paper_trades` view (anon ALL) and `brief_ratings` |
| `admin_llm_cost_agg` / `_by_provider` executable by anon/authenticated (Sept M1) | **No** (revoked by `20260902000001`) | No |
| anon-executable RPCs | 11, all `SECURITY INVOKER` (RLS applies). `check_rate_limit`, `get_*blackout*`, `get_upcoming_macro_events`, `recent_material_sec_event`, `rpc_brief_events_quality`, time helpers. No `ALTER DEFAULT PRIVILEGES` in any migration (L10) | Same |

**Sept C1 (cron secret) stays fixed.** Two further migrations (`20260901000001`, `20260901000002`) added `X-Cron-Secret` headers to high-risk crons with runtime vault lookup and an explicit literal-secret abort check. Nothing regressed.

---

## 3. Findings Ranked by Severity

### CRITICAL

None. Both September CRITICALs are fixed and live-verified in source (see §6).

### HIGH

#### H1: Withdrawal daily limit is enforced at `request_otp` but never re-checked at `confirm` (new)
- **File:** `crypto-agent/supabase/functions/process-withdrawal/index.ts:217-241` computes `withdrawnToday` from `funding_events` with `status='completed'` and rejects if `withdrawnToday + amount > maxDaily`. The `confirm` handler (`:431-458`) validates the OTP (user + hashed code + amount + destination + unused + unexpired) and proceeds straight to execution. No `maxDaily` reference exists in the confirm path.
- **Attack path:** a user (or an attacker holding the session and the email inbox) with a $1,000 daily cap requests OTP A for $900 and OTP B for $900. Both pass because nothing has completed yet. Confirm A, wait for `completed`, confirm B. The one-active-withdrawal index does not block B because A is no longer `pending/processing`. Net $1,800 against a $1,000 cap. Rate limit is 5 OTPs/hour, so the ceiling is 5× cap per hour, bounded by balance.
- **Why HIGH:** the daily limit is the control that bounds damage from a compromised session. It is defeated by design, not by a race. Money-flow code.
- **Fix:** repeat the 24h-sum check inside `confirm` immediately before the `funding_events` insert, counting `completed` plus `pending/processing` rows. ~15 lines, mirrors `:217-241`.
- Confidence: high on the logic (read directly); moderate on real-world magnitude (depends on `tier_config` caps and balances).

#### H2: `npm audit` 79 vulnerabilities (3 critical, 28 high), worsening for the fifth consecutive audit
- May 24 → Aug 71 → Sept 75 → **now 79** (3 crit / 28 high / 47 mod / 1 low). `package-lock.json` on the primary checkout is identical to `origin/main`.
- Direct dependencies with advisories: `@privy-io/react-auth`, `@vercel/node`, `posthog-js`, `react-router-dom`, `sharp`, `vite`, `vitest`, `@vitest/coverage-v8`, `@typescript-eslint/*`. Criticals (`vitest`, `@vitest/coverage-v8`, `tar`) are dev/build-time only. Production-relevant highs: `react-router` (SSR data-router issues; Vela is a client SPA, low exposure), `sharp` (runs in `api/og`, processes only satori-generated SVG), `axios`, `undici`, `ws`, `form-data` (transitive, mostly Privy/WalletConnect chain).
- **Fix:** `npm audit fix`, then bump `@privy-io/react-auth` and `vite`/`vitest` majors in a dedicated PR; re-test login, build, OG rendering. Record residual next month. Four months of "recommended, not done" is itself the finding.

### MEDIUM

#### M1: OTP burn is a non-conditional UPDATE (new)
- `process-withdrawal/index.ts:455-458`: `.update({ used: true }).eq("id", otp.id)` with no `.eq("used", false)` and no row-count check. Two concurrent `confirm` calls with the same code both pass the SELECT at `:431-440` before either UPDATE lands. Today the `idx_one_active_withdrawal` unique index catches the second `funding_events` insert while the first is `processing`, so the window is narrow. One-line fix: `.eq("used", false).select("id")` and abort on zero rows.

#### M2: Staging is driveable by anonymous callers through the three allowlisted test functions (new framing of a known shape)
- `e2e-trade-test/index.ts:31-37` returns 403 unless `ENVIRONMENT === "staging"`. On staging it has no caller auth, mints HS256 JWTs (`:63-77`; **correction 2026-10-07:** the `sub` values are hard-coded test users and the function never reads the request body, so this is not an arbitrary-`sub` forge; that primitive exists only in `e2e-prod-test`, already gated) and calls `executeTradeProposal` (`:176, :277, :356, :430`) and `trade-webhook` as those users, inserting and deleting `trade_proposals` / `positions`. `e2e-testnet-test` (`:50-56`) and `test-r2-tp-trim-during-trail` (`:66-72`) have the same staging-only guard and place HL testnet orders for caller-chosen assets. All three are in `deploy.sh`'s `ALLOW_UNAUTHENTICATED` list (`:157-166`).
- Prod is not affected. Staging holds testnet funds and shadow/forward-test data whose integrity matters (BB2 shadow tracking, regime-gate forward test). An anonymous caller can corrupt that at will and burn the Micro-plan worker pool (150s runs).
- **Fix:** gate all three with `evaluateE2EAuth` / `X-E2E-Secret`, exactly as `e2e-prod-test` now does; `deploy.sh` already sends that header for prod. Then shrink `ALLOW_UNAUTHENTICATED` to `uptime-probe`.

#### M3: Default `ALL` grants to anon/authenticated on four backend-only tables (regression of the 2026-07-13 grant-lockdown standard)
- Live on prod + staging: `admin_alert_history`, `dashboard_curated`, `wallet_migration_log` carry `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` for both `anon` and `authenticated`. Their creating migrations (`20260803120000`, `20260820170000`, `20260825220000`) enable RLS but contain no `REVOKE`. `cctp_transfers` also carries anon `ALL` (it is a user table with ownership RLS, but anon has no business holding grants on it).
- RLS is doing the real work: `dashboard_curated` and `wallet_migration_log` have zero policies (deny-all); `admin_alert_history` has a service-role-only policy. Live-verified: no rows reach anon. Side effect: all four appear in the anon GraphQL schema (advisor WARN), so table names and columns are enumerable without sign-in.
- **Why it matters:** the July incident response set "deny-all RLS **plus** revoked grants" as the standard, so that a single future `CREATE POLICY ... USING (true)` mistake does not become a data leak. Three tables created since then did not follow it, and the `check-migration-security.sh` hook did not flag them (it checks RLS and `search_path`, not grants).
- **Fix (migration, both projects):**
  ```sql
  REVOKE ALL ON public.admin_alert_history, public.dashboard_curated,
                public.wallet_migration_log FROM anon, authenticated;
  REVOKE ALL ON public.cctp_transfers FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;
  ```
  The `ALTER DEFAULT PRIVILEGES` lines make the safe state the default for every future table and function, which is the structural fix. Then add a `REVOKE`-presence check to `check-migration-security.sh` for any `CREATE TABLE`.

#### M4: Two fail-open-shaped gates remain (Sept L1, plus one new sighting)
- `twitter-fetcher/index.ts:352-353`: `if (serviceKey && token !== serviceKey)`. If `SUPABASE_SERVICE_ROLE_KEY` were unset the gate is skipped. The only function in the fleet with this shape; Sept L1, unfixed. Its cron is currently inactive on both projects. Migrate to `verifyCronAuth`.
- `trade-webhook/index.ts:461-469`: engagement admin gate `if (adminChatId && callerChatId !== adminChatId)`. If `TELEGRAM_ADMIN_CHAT_ID` were unset, any Telegram user who can send a `callback_query` reaches `approve_engagement_<uuid>` and posts to X under the brand account. Env is documented and set, so gated today; invert to fail closed.

#### M5: Staging-only schema drift: `paper_trades` is world-writable on staging (new)
- Staging has policy `Allow update on paper_trades` for `public`, `UPDATE`, `USING (true)`, plus `open_paper_trades` (anon `ALL`) and `brief_ratings` which do not exist on prod. Anyone with the staging anon key (shipped in every staging frontend build) can rewrite the staging paper-trade record. Prod has only the anon/authenticated SELECT policies.
- Not a prod exposure, but it is unexplained drift between environments the deploy pipeline is supposed to keep in parity (`verify-deployment.sh` checks migration parity, not policy parity). Drop the policy on staging; consider adding a policy-diff to `verify-deployment.sh`.

#### M6: `e2e-prod-test` is gated, but still a single-secret path to mainnet trades plus arbitrary-`sub` JWT forgery (Sept C2, downgraded; accepted-risk candidate)
- `e2e-prod-test/index.ts:105-124` + `auth.ts:29-36`: `X-E2E-Secret` vs `E2E_PROD_SECRET`, timing-safe, 500 if the secret is shorter than 16 chars. The gate is sound and `deploy.sh:383-405` sends the header.
- `mintJwt(body.user_id)` (`:35-49`, used at `:154, :321, :424, :518`) still signs with `JWT_SECRET` for whatever `sub` the caller supplies, and there is no staging guard (by design; T1 places a real $10 mainnet order). Whoever holds `E2E_PROD_SECRET` holds identity forgery on the trade path. Treat that secret with service-role-key handling (vault, rotation schedule) and consider restricting `user_id` to an allowlist of designated E2E accounts. Document as accepted if not changed.

#### M7: `auth-exchange` soft-skips wallet provisioning when `WALLET_ENVIRONMENT` is unset (Sept M4, unchanged)
- `auth-exchange/index.ts:213-220`: Sentry `error`-level capture, then login proceeds with no wallet and no user-visible signal. Same recommendation as the last three audits: mark the profile "provisioning pending" and retry on next login.

### LOW

- **L1: `deploy.sh` auth preflight is a whole-file grep** (`scripts/deploy.sh:147-190`, `AUTH_GATE_TOKENS` at `:155`). It landed (Sept #4) and currently passes correctly because every non-allowlisted function has a real gate, but it inherits the false-negative class this task describes: a comment containing `X-Cron-Secret` or an outgoing `Authorization` header satisfies it. Anchor the match to the first N lines after `Deno.serve(`, or require the token before the first `await supabase.`/`fetch(`.
- **L2: Non-timing-safe secret compares:** `admin-webhook:463`, `trade-webhook:415` (Telegram secret), `swapped-webhook:75` (HMAC hex), `post-to-x:712-713`, `_shared/telegram-token.ts:111`, `_shared/cron-auth.ts:42` (legacy `.includes`), and the nine raw service-role `!==` compares (`asset-intel-generate:133`, `daily-digest:79`, `daily-digest-preview:46`, `health-check:167`, `position-holder-brief:115`, `proposal-reminder:33`, `run-signals:100`, `subscription-reminders:22`, `weekly-recap:66`). Remote timing against a CDN-fronted edge function is impractical; flagged for consistency with `cron-auth.ts` / `notify.ts`.
- **L3: Nine functions gate on raw `Authorization: Bearer <service_role>`** rather than `verifyCronAuth`. `cron-auth.ts:14-19` documents that the edge gateway rewrites that header for `sb_secret_*` keys. If accurate, the active prod crons for `daily-digest`, `health-check`, `position-holder-brief`, `run-signals-4h*`, `subscription-reminders`, `weekly-recap`, `asset-intel-generate` would be 401ing. Availability, not exposure. Not verified against live logs this run (connector dropped). Confidence: low. Check `cron_heartbeats` for these jobs and migrate them to `verifyCronAuth` either way.
- **L4: Telegram path skips ownership when `callback_query.from.id` is absent** (`trade-webhook:567-592`): `processProposalAction` runs with `authenticatedUserId = undefined`, so the UPDATE has no `.eq("user_id")`. Requires a request carrying the valid webhook secret, so it needs secret compromise first. Reject when `from.id` is missing.
- **L5: `attribution-compute` `backfill_since` is unvalidated** (`:155, :176`) but now behind `verifyCronAuth` (`:140`) and bounded by `.limit(1000)` / `BACKFILL_BATCH_SIZE=50`. Downgraded from the Aug/Sept HIGH band. Parse as ISO date and floor to a max window anyway.
- **L6: `funding_events` `processing` row is inserted before the `WALLET_ENVIRONMENT` check** (`process-withdrawal:487-525`); a misconfiguration leaves a permanent `processing` row that locks the user out via the concurrency guard. Availability only.
- **L7: GraphQL schema discoverability** (35 objects across anon + authenticated, advisor WARN). Rows protected by RLS (live-verified). M3's revokes remove the four backend tables from the anon set; the rest is intentional public data plus user tables the frontend queries directly.
- **L8: CSP allows `'unsafe-inline'` + `'unsafe-eval'` in `script-src`** (Privy requirement). Unchanged. Re-test dropping `'unsafe-eval'` on the next Privy major (H2 bump is the opportunity).
- **L9: Rate limiter fails open on DB error** (`_shared/rate-limiter.ts:94-103, 128-137`). Accepted by design, Sentry-alerted, unchanged. Also: identifier comes from the first `x-forwarded-for` hop (`:147`); fine behind Supabase's proxy, worth a comment.
- **L10: 11 utility RPCs executable by anon** (all `SECURITY INVOKER`, several with `search_path=public` lacking `pg_temp`). `check_rate_limit` is callable by anon but `rate_limits` RLS is service-only, so calls are inert. The root cause is Postgres' default `EXECUTE TO PUBLIC` on new functions; the M3 `ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS` line closes it for the future.
- **L11: `APP_BASE_URL` fallback is now the prod URL** via `_shared/app-base-url.ts` (deliberate, documented at `:10-13`, commit `bc2bfaf`). The 11 localhost fallbacks from Sept M2 are gone; the only localhost remaining is `corsAllowedOrigin` (`:40`), which fails safe (blocks CORS rather than opening it). Consequence: the `formatProposalEmail` fail-loud guard (`notify.ts:2702-2713`) is unreachable for the unset case. Action links use `SUPABASE_URL`, so no link breaks. Recorded so the regression table wording is accurate going forward.
- **L12: `macro-enrich:236-247`, `sec-filing-enrich:153,223-227`, `_shared/article-fetcher.ts:87`** fetch URLs stored in DB rows that originate from external feeds, with no scheme/private-IP guard. Feed-controlled, not caller-controlled; not SSRF in the OWASP sense. Add an `https:` + public-host check when convenient.
- **L13: Stripe idempotency is "last event id equals this id"** (`payment-webhook:132-150`), so a re-delivered older event after a newer one would re-apply. Stripe retries sequentially per endpoint; C2-C5 writes are idempotent. Theoretical.

---

## 4. STRIDE Summary

| Category | Threat | Attack path | Severity | Status |
|---|---|---|---|---|
| Tampering / EoP | Exceed withdrawal daily cap | Mint N OTPs each under cap, confirm sequentially | **HIGH** | ❌ **H1** |
| Tampering | Double-spend a single OTP | Concurrent `confirm` with same code | MEDIUM | ⚠️ **M1** (narrow window, index-mitigated) |
| Tampering / DoS | Drive staging testnet trades, service-role writes and the prod-gating E2E suite anonymously | POST `e2e-trade-test` / `e2e-testnet-test` / `test-r2` on staging | MEDIUM | ❌ **M2** (prod 403) |
| Info Disclosure | Enumerate backend table shapes without sign-in | GraphQL introspection with anon key | MEDIUM | ⚠️ **M3** (rows blocked by RLS) |
| EoP | Future `USING (true)` policy on a re-granted table becomes a leak | One bad migration | MEDIUM | ⚠️ **M3** (defense-in-depth gap) |
| Spoofing | Post to X as the brand via engagement callback | Unset `TELEGRAM_ADMIN_CHAT_ID` + forged callback | MEDIUM | ⚠️ **M4** (env set today) |
| Tampering | Rewrite staging paper-trade record | PostgREST UPDATE with staging anon key | MEDIUM (staging) | ❌ **M5** |
| Spoofing / EoP | Forge JWT `sub`, execute mainnet trade | Hold `E2E_PROD_SECRET` | MEDIUM (accepted) | ⚠️ **M6** gated |
| Tampering | Force out-of-schedule trade execution | POST `scanner-30m` | n/a | ✅ **FIXED** (Sept C1) `verifyCronAuth` at `:88` |
| Spoofing / EoP | Unauthenticated mainnet trade + JWT forge | POST `e2e-prod-test` | n/a | ✅ **FIXED** (Sept C2) secret gate `:105-124` |
| Spoofing | Impersonate cron caller on ~13 functions | POST any ungated cron fn | n/a | ✅ **FIXED** (Sept H1) all gated + deploy preflight |
| DoS | Mass Telegram broadcast / LLM drain | POST `breaking-news`, enrich fns | n/a | ✅ **FIXED** `verifyCronAuth` on all |
| Info Disclosure | LLM cost data to anon | `/rpc/admin_llm_cost_*` | n/a | ✅ **FIXED** (Sept M1) revoked `20260902000001` |
| EoP | Schema shadowing via mutable `search_path` | `retry_daily_digest` | n/a | ✅ **FIXED** (Sept M3) advisor WARN gone |
| Info Disclosure | service_role key from pg_cron catalog | `SELECT command FROM cron.job` | n/a | ✅ Holding: 0 literal secrets both envs |
| Spoofing | Forged Telegram webhook | POST trade-webhook | LOW | ✅ secret fail-closed (`:406-412`) |
| Spoofing | Forged email action link | Guess HMAC | LOW | ✅ userId-bound, timing-safe, bucketed TTL |
| Spoofing | Forged Stripe / Swapped webhook | POST fake event | LOW | ✅ raw-body signature verify |
| Tampering | Proposal double-accept race / cross-user accept | Concurrent accept | LOW | ✅ ownership + `status='pending'` inside UPDATE WHERE |
| Info Disclosure | Cross-user data read | RLS bypass | LOW | ✅ RLS 62/62, policies ownership-scoped (live) |
| Info Disclosure | OTP theft from DB | Read `withdrawal_otps` | LOW | ✅ peppered HMAC-SHA256 |
| EoP | service_role key in frontend | Bundle inspection | LOW | ✅ zero matches in `src/` |
| EoP | Non-admin reaches admin dashboard | Call `admin-dashboard-data` | LOW | ✅ JWT + `privy_did` allowlist, 500 if allowlist empty |
| Repudiation | No audit trail on trade actions | n/a | LOW | ✅ `logAudit()` + `notification_log` |

---

## 5. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | **PARTIAL** (was FAIL) | Edge layer: 55/59 gated in-handler, deploy preflight present, Sept C1/C2/H1 all closed. Remaining: H1 daily-cap bypass (authorization-of-amount gap), M2 staging test functions, M3 default grants, L4 Telegram `from.id` gap. RLS and ownership checks sound and live-verified. |
| **A02 Cryptographic Failures** | PASS | Primitives correct: Privy ES256 → HS256 1h; HMACs timing-safe and user-bound; OTP CSPRNG + peppered hash; Stripe SDK verify. L2 compares are consistency items. M6 `mintJwt` is now behind a timing-safe secret. |
| **A03 Injection** | PASS | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in frontend `src/` and `api/`; zero in Deno. All PostgREST `.or()` interpolations use server-computed values. |
| **A04 Insecure Design** | **PARTIAL** (was FAIL) | The exposure-by-default root cause is now compensated by the deploy preflight (L1 weakness noted). H1 is a design gap: a limit enforced at intent time, not commit time. Tier / `max_active_positions` enforcement unchanged and sound. |
| **A05 Security Misconfiguration** | PARTIAL | Frontend clean: no tracked env files, `.env`/`.env.local` hold only `VITE_*` public values, `sourcemap: 'hidden'`, full header set unchanged. Backend: M3 default grants, M4 fail-open shapes, M5 staging drift, no `ALTER DEFAULT PRIVILEGES`. Sept M2 localhost fallbacks resolved (L11). |
| **A06 Vulnerable Components** | **FAIL** | 79 npm findings, 3 crit / 28 high, fifth consecutive increase (H2). |
| **A07 Auth Failures** | PASS (was FAIL) | All trade/broadcast/LLM functions gated; `DEV_BYPASS` gated on `import.meta.env.DEV` (`useAuth.ts:18`); `verify-auth.ts` pins iss/aud/role and throws on missing `JWT_SECRET`; `cron-auth.ts` fail-closed. M2 is staging-only. |
| **A08 Data Integrity** | PASS | Stripe raw body before verify; Swapped HMAC on raw body; Telegram secret fail-closed; processed-event idempotency (L13 theoretical); OTP single-use (M1 window). |
| **A09 Logging & Monitoring** | PASS | Sentry on financial paths; rate-limit admin alerts with DB-backed cooldown; `cron_heartbeats`; self-auditing cron-secret migrations; 2026-09 migrations include verification `DO` blocks. L3 (possible silent 401s on legacy-gated crons) is the one monitoring question raised. |
| **A10 SSRF** | PASS | No request-derived host reaches `fetch()` in either repo. `api/og/*` reads `req.query` for text/ids only; icon fetch is a fixed-map lookup (`news.ts:97`). L12 feed-sourced URLs noted. |

---

## 6. Regression Check vs. 2026-09-01

| September finding | Status now |
|---|---|
| **C1** `scanner-30m` unauthenticated, executes trades | ✅ **FIXED**: `verifyCronAuth` is the first statement (`:88-89`); `executeTradeProposal` additionally behind `!IS_STAGING` |
| **C2** `e2e-prod-test` unauthenticated mainnet trades + JWT forge | ✅ **GATED**: `X-E2E-Secret` timing-safe, 500 if weak/unset (`:105-124`). `mintJwt` + no staging guard remain → **M6** (accepted-risk candidate) |
| **H1** ~13 ungated cron/broadcast functions | ✅ **FIXED**: all 13 carry `verifyCronAuth` (`breaking-news:875`, `attribution-compute:140`, `publish-scheduled:51`, `user-activation:531`, `bb2-shadow-resolve:203`, `classifier-drift-check:55`, `news-enrich:115`, `news-l2-batch:61`, `macro-enrich:47`, `sec-filing-enrich:46`, `content-generator:22`, `earnings-calendar-sync:273`, `sec-edgar-poll:63`) |
| **H1 systemic** deploy.sh auth preflight | ✅ **LANDED** (`deploy.sh:147-190`), whole-file grep → **L1** |
| **H2** npm audit 75 | ❌ **WORSE**: 79 (**H2**) |
| **M1** `admin_llm_cost_*` anon-executable | ✅ **FIXED**: `20260902000001:15-16`, live-verified not executable by anon/authenticated |
| **M2** `APP_BASE_URL` 11 localhost fallbacks | ✅ **RESOLVED (by design change)**: shared `app-base-url.ts` with prod-URL fallback; only CORS helper keeps localhost, fail-safe (**L11**) |
| **M3** `retry_daily_digest` mutable `search_path` | ✅ **FIXED**: `20260902000001:18`; advisor WARN gone on prod |
| **M4** `auth-exchange` wallet soft-skip | ⚠️ Unchanged (**M7**) |
| **L1** `twitter-fetcher` fail-open gate | ❌ Unchanged (**M4**, promoted because a second fail-open shape was found alongside it) |
| **L2** non-timing-safe compares | ⚠️ Unchanged (**L2**) |
| **L3** GraphQL discoverability | ⚠️ Unchanged, now 35 objects incl. 4 backend tables (**L7**, **M3**) |
| **L4** CSP `unsafe-eval` | ⚠️ Unchanged (**L8**) |
| **L5** rate limiter fail-open | ✅ Accepted, unchanged (**L9**) |
| Sept #8 bound `attribution-compute` `backfill_since` | ⚠️ Not bounded, but gated → **L5** |
| Sept #10 rotate service_role key | ❓ **Unknown**: cannot be verified from the repo and the connector dropped before a `vault.decrypted_secrets` `updated_at` check. Carry forward. |
| Report durability (§0) | ✅ Mechanism held: Sept report on `main`, used as baseline with no recovery |

**Net:** 7 of September's 11 ranked items closed, including both CRITICALs and the entire HIGH auth band; this is the strongest remediation month since May. The two structural items (deploy preflight, shared base-URL helper) both landed. New this month: H1 (withdrawal daily-cap bypass, found by reading the confirm path end-to-end), M3 (grant-lockdown standard not applied to three post-July tables), M5 (staging policy drift). npm audit is the only item that has worsened at every audit since May.

### Regression check vs. older fixed controls

| Control | Holds? | Evidence |
|---|---|---|
| Email HMAC userId-bound, timing-safe | ✅ | `notify.ts:103, 130, 152, 198`; verify-before-DB-read in `trade-webhook:667, 726` |
| `WALLET_ENVIRONMENT` fail-loud in `process-withdrawal` | ✅ | `:248-256`, `:517-525` |
| OTP hashed with pepper, throws if unset | ✅ | `:89-105` |
| Rate-limit admin alerting with cooldown | ✅ | `rate-limiter.ts:111-124` |
| Telegram webhook fail-closed | ✅ | `trade-webhook:406-412` |
| Ownership inside UPDATE WHERE (May M1) | ✅ | `trade-webhook:129-145` on all three user-supplying paths |
| Engagement callbacks admin-gated (May L4) | ✅ (fail-open shape, **M4**) | `trade-webhook:461-469` |
| `DEV_BYPASS` gated on `DEV` (May L3) | ✅ | `useAuth.ts:18` |
| HSTS / Permissions-Policy / CSP / `frame-ancestors` (May L1/L2) | ✅ | `vercel.json` unchanged |
| Source maps hidden | ✅ | `vite.config.ts:43` |
| `trade_attribution` / `classifier_calibration` deny-all + zero grants (2026-07) | ✅ | Live: RLS on, 0 policies, absent from grant list |
| pg_cron vault lookup (2026-05-07 / Aug C1) | ✅ | Live: 0 literal secrets, 36/36 HTTP jobs vault, both envs |
| Hooks `check-migration-security.sh`, `check-write-secrets.sh` | ✅ | Present, wired in `.claude/settings.json` |
| Privy HSM: no key material / export path | ✅ | `wallet-provisioner.ts`; no `/support/export` residue |
| `APP_BASE_URL` fail-loud in `formatProposalEmail` (2026-03) | ⚠️ Superseded | Unreachable since `bc2bfaf` prod-URL fallback (**L11**); links unaffected |

---

## 7. Recommended Actions (Priority Order)

| # | Action | Effort | Location |
|---|---|---|---|
| 1 | **Re-check the 24h withdrawal sum + `maxDaily` inside `confirm`**, counting `completed` + `pending` + `processing`, before the `funding_events` insert (H1) | 20 min + adversarial test (`FEATURE-ADV:`) | `process-withdrawal/index.ts:431-458` |
| 2 | **Make the OTP burn conditional** (`.eq("used", false).select()`; abort on 0 rows) (M1) | 5 min | `process-withdrawal/index.ts:455-458` |
| 3 | **`npm audit fix` + bump `@privy-io/react-auth`, `vite`, `vitest`**; re-test login / build / OG; retry dropping CSP `unsafe-eval` (H2, L8) | 2h | `package.json`, `vercel.json` |
| 4 | **Grant lockdown migration + `ALTER DEFAULT PRIVILEGES`** for tables and functions, both projects; add a `REVOKE`-presence rule to `check-migration-security.sh` (M3, L10) | 30 min | new migration, `.claude/hooks/` |
| 5 | **Gate the three staging test functions** with `verifyCronAuth` (X-Cron-Secret, already on both projects; a 2026-10-07 Phase 0 review rejected reusing `E2E_PROD_SECRET` because it would put the prod mainnet-trade secret on staging); shrink `ALLOW_UNAUTHENTICATED` to `uptime-probe` (M2) | 30 min | `e2e-trade-test`, `e2e-testnet-test`, `test-r2-tp-trim-during-trail`, `deploy.sh:157-166` |
| 6 | **Invert the two fail-open gates** (`twitter-fetcher` → `verifyCronAuth`; engagement gate 500 when `TELEGRAM_ADMIN_CHAT_ID` unset) (M4) | 15 min | `twitter-fetcher:352`, `trade-webhook:461` |
| 7 | **Drop the staging `paper_trades` public UPDATE policy**; add policy-diff to `verify-deployment.sh` (M5) | 15 min | staging SQL, `scripts/verify-deployment.sh` |
| 8 | **Verify the nine legacy `Bearer <service_role>` crons are actually succeeding** (`cron_heartbeats`), then migrate them to `verifyCronAuth` (L3) | 45 min | nine `index.ts` handlers |
| 9 | Anchor the deploy preflight to the handler body (L1) | 30 min | `deploy.sh:155` |
| 10 | Decide and document `e2e-prod-test` residual risk; vault + rotation schedule for `E2E_PROD_SECRET`; optional `user_id` allowlist (M6) | 30 min | `e2e-prod-test/index.ts:138`, DEPLOY.md |
| 11 | Reject Telegram callbacks with no `from.id`; timing-safe sweep; ISO-validate `backfill_since` (L2, L4, L5) | 45 min | per file:line above |
| 12 | Confirm or perform the service_role key rotation flagged 2026-05-07 / Aug / Sept | 30 min | Supabase Dashboard, both projects |
| 13 | Surface pending wallet provisioning to the user (M7) | 30 min | `auth-exchange/index.ts:213` |

Items 1 and 2 are money-flow and should ship together with adversarial tests before anything else. Item 4 is the structural fix that prevents M3 recurring.

---

## 8. Positive Observations

- **September's two CRITICALs and the full HIGH auth band are closed**, with a deploy-time preflight so the class is enforced rather than remembered. 55 of 59 functions now authenticate in-handler, and the four exceptions are an explicit allowlist.
- **pg_cron hygiene held and improved**: zero literal secrets on both projects for the second consecutive audit, and the two September migrations include their own literal-secret abort checks.
- **Database hardening migration `20260902000001`** closed Sept M1 and M3 in one file with verification `DO` blocks: the right shape for audit follow-ups.
- **`process-withdrawal` defense in depth otherwise intact**: JWT, peppered OTP, destination regex, rate limits, concurrency index, `WALLET_ENVIRONMENT` fail-loud at both stages. H1 is a gap in an otherwise well-layered handler.
- **`verify-auth.ts` and `cron-auth.ts` are correct by construction**: fail-closed on missing secrets, pinned claims, timing-safe where it matters.
- **Frontend posture unchanged and clean**: zero XSS sinks across `src/` and `api/`, no secrets in any env file, hidden source maps, full header set. Only one frontend file touched since September.
- **`20260919132607_rpc_brief_events_quality`** is the model for new RPCs: `SECURITY INVOKER`, pinned `search_path`, `REVOKE ALL FROM PUBLIC`, `GRANT` to `service_role` only.

---

## 9. Meta-observation

Last month's lesson was that a correct control not applied by default keeps failing. This month shows the fix works when it is made structural: the deploy preflight turned 13 open functions into zero in one cycle. The two new MEDIUMs are the same lesson in the database layer. The July grant-lockdown was applied as a one-time sweep, not as `ALTER DEFAULT PRIVILEGES`, so three tables created afterwards silently fell back to Postgres' permissive defaults, and the hook that guards migrations does not know about grants. H1 is a different shape worth naming: a control enforced at the moment of *intent* (OTP request) rather than at the moment of *commitment* (confirm). Any check that gates a financial action should run where the money moves, not where it is asked for.

---

*Audit performed 2026-10-01 to 2026-10-04 from worktree `security-audit/2026-10-01` off `origin/main`. Live catalog, advisor, grant and policy queries run against prod `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw` on 2026-10-01.*
