# Monthly Security Audit — 2026-09-01

**Scope:** Both repos — `crypto-agent-frontend` (React/Vite/Supabase/Vercel) and `crypto-agent` (58 Supabase Edge Functions, Deno, PostgreSQL)
**Baseline:** 2026-05-06 audit (this directory). The 2026-06, 2026-07 and 2026-08 runs left no durable record (July's report was written but never committed and is lost) — May is the only prior baseline. Verified: no June/July/August report exists in git history, untracked files, or either repo.
**Method:** Live infrastructure queries (Supabase MCP, prod `dikybxkubbaabnshnreh` + staging `memyqgdqcwrrybjpszuw`), auth-gate sweep across all edge functions, targeted file review, npm audit.

---

## 1. Trust Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                  │
│                                                                  │
│  Browser ──HTTPS──► Vercel CDN ──► React SPA (anon key only)     │
│                └──► /api/og (satori+sharp serverless)            │
│  Telegram ──────────────────────────────────────────────────┐    │
│  Stripe / Swapped ──────────────────────────────────────────┤    │
│  Email action links (HMAC, user-bound) ─────────────────────┤    │
└─────────────────────────────────────┬───────────────────────┘    │
                                      │ HTTPS                      │
┌─────────────────────────────────────▼────────────────────────┐   │
│ SUPABASE EDGE LAYER (58 functions, --no-verify-jwt)          │   │
│                                                              │   │
│  Auth boundary: Privy ES256 → HS256 JWT 1h (auth-exchange)   │   │
│  Financial boundary: OTP(hashed) + JWT (process-withdrawal)  │   │
│  Webhook boundary: Stripe sig / Swapped HMAC / TG secret     │   │
│  Cron boundary: verifyCronAuth (X-Cron-Secret, timing-safe)  │   │
│    or service-role bearer compare                            │   │
│                                                              │   │
│  ⚠ UNGATED (10 cron fns): attribution-compute,               │   │
│    bb2-shadow-resolve, classifier-drift-check,               │   │
│    content-generator, earnings-calendar-sync, macro-enrich,  │   │
│    news-l2-batch, sec-edgar-poll, sec-filing-enrich,         │   │
│    user-activation  (see M1)                                 │   │
└─────────────────────────────────────┬────────────────────────┘
                                      │ service_role
┌─────────────────────────────────────▼────────────────────────┐
│ SUPABASE POSTGRES (RLS on all public tables, no ERROR lints) │
│  ⚠ /rest/v1/rpc/admin_llm_cost_* anon-executable (see M2)    │
│  + pg_cron: all jobs use vault lookups, zero literal secrets │
│  + Privy HSM (private keys never extracted)                  │
│  + Hyperliquid API (agent wallets, withdraw3-scoped)         │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Live Infrastructure Queries (Part 3 — both projects)

| Check | Prod | Staging |
|---|---|---|
| pg_cron literal `Bearer` secrets (2026-05-07 incident regression) | **0 rows** — all 45 jobs `has_literal_secret=false`; every HTTP-calling job uses `decrypted_secrets` vault lookup | **0 rows** — identical |
| Supabase security advisors: ERROR | 0 | 0 |
| Supabase security advisors: WARN | 41 (triaged below) | 5 |
| RLS on public tables | Enabled everywhere (no `rls_disabled_in_public` lints) | Same |
| `USING (true)` policies scoped correctly | ✅ All `ALL:true` policies are `TO service_role` only; anon/authenticated `true` policies exist only on intentional public product data (`assets`, `briefs`, `signals`, `indicator_snapshots`, `tier_config`, `paper_trades`, `release_notes`, `news_cache`, `signal_reviews`, `trade_postmortems`, `signal_performance`) | Same pattern |
| User-data table policies | ✅ `positions`, `trade_proposals`, `user_wallets`, `user_subscriptions`, `profiles`, `user_preferences`, `audit_log`, `circuit_breaker_events`, `funding_events`, `cctp_transfers` all ownership-scoped via `auth.jwt()->>'sub'` | Same |

**Advisor WARN triage (prod):**

- `anon_security_definer_function_executable` / `authenticated_...` on `admin_llm_cost_agg`, `admin_llm_cost_by_provider` → **real finding, M2 below.** No internal auth check in the function bodies; anon EXECUTE granted.
- `authenticated_security_definer_function_executable` on `claim_trial()` → **benign.** Inspected the function body: identity comes from `auth.jwt()->>'sub'`, takes no user_id argument, race-safe single-claim UPDATE. Correct by design.
- `pg_graphql_anon_table_exposed` / `..._authenticated_table_exposed` (34 items) → **benign.** These mirror the Supabase-default `GRANT ALL` to anon/authenticated; RLS is the actual gate and every listed table either has intentional public-read policies (product data) or deny-all (RLS enabled, zero policies: `wallet_migration_log`, `dashboard_curated`, etc.). Discoverability-only.
- `function_search_path_mutable` on `retry_daily_digest` → **L4 below** (hygiene).
- INFO `rls_enabled_no_policy` on 23 backend-only tables → **benign** (deny-all is the intent; service role bypasses RLS).

---

## 3. Findings — Ranked by Severity

### CRITICAL

None.

### HIGH

None. (May's C1/H1-H3 are all confirmed fixed — see §6.)

### MEDIUM

#### M1: 10 cron edge functions still have no auth gate
- **Files:** `attribution-compute`, `bb2-shadow-resolve`, `classifier-drift-check`, `content-generator`, `earnings-calendar-sync`, `macro-enrich`, `news-l2-batch`, `sec-edgar-poll`, `sec-filing-enrich`, `user-activation` (each `index.ts`, handler entry).
- **Problem:** Every function deploys `--no-verify-jwt`, so these are internet-invocable by anyone. Most are `Deno.serve(async (_req)` — the request is never inspected. The `verifyCronAuth` helper (timing-safe `X-Cron-Secret` check, `_shared/cron-auth.ts:31`) exists and is applied to ~15 sibling functions; these were left out.
- **Impact by function:**
  - `content-generator` — triggers Anthropic content generation and queues social posts on prod (LLM spend + content-queue pollution). Highest blast radius of the ten.
  - `macro-enrich`, `news-l2-batch`, `sec-filing-enrich`, `classifier-drift-check` — LLM calls on pending batches; dedup columns (`enriched_at`/`processed_at`) bound the damage per invocation, but hammering between cron ticks drains quota.
  - `user-activation` — sends activation emails to users (flows A/B); send-tracking limits repeats but an attacker controls timing.
  - `earnings-calendar-sync`, `sec-edgar-poll`, `twitter-cache`-adjacent, `attribution-compute`, `bb2-shadow-resolve` — external API quota + DB write load only.
- **Fix:** Add `const authErr = verifyCronAuth(req, "<fn>"); if (authErr) return authErr;` at each handler entry, and change `(_req)` to `(req)`. Cron jobs already send the vault-resolved authorization, so no cron migration needed (the service-role bearer path in `verifyCronAuth` accepts them).

#### M2: `admin_llm_cost_agg` / `admin_llm_cost_by_provider` executable by `anon`
- **Where:** Prod + staging, `/rest/v1/rpc/admin_llm_cost_agg` and `.../admin_llm_cost_by_provider`.
- **Problem:** Both are `SECURITY DEFINER` (bypassing `llm_call_log`'s service-role-only RLS), contain **no internal auth check**, and have EXECUTE granted to `anon` and `authenticated`. The anon key ships in the frontend bundle, so any internet user can read total LLM spend, call counts, token volumes, and per-provider cost breakdowns.
- **Impact:** Information disclosure of internal cost/ops data (no PII, no user data). Aids competitor/attacker reconnaissance of LLM usage patterns.
- **Fix (migration):**
  ```sql
  REVOKE EXECUTE ON FUNCTION public.admin_llm_cost_agg(timestamptz, timestamptz) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.admin_llm_cost_by_provider(timestamptz, timestamptz) FROM anon, authenticated;
  ```
  The admin dashboard reads these via the `admin-dashboard-data` edge function (service role + `verifyAuthToken` admin gate), which is unaffected by the revoke.

#### M3: `APP_BASE_URL ?? "http://localhost:5173"` residual fallback (May M3, partially fixed)
- **File:** `crypto-agent/supabase/functions/trade-webhook/index.ts:632, 690` (email-action and batch-email-action handlers).
- **Problem:** The May finding was fixed in the CORS helpers but two redirect-target sites remain. If `APP_BASE_URL` were unset, users clicking email accept/decline links would be redirected to `localhost:5173` — silent misconfiguration, violates the repo's fail-loud rule. Not attacker-controllable (env-var only).
- **Fix:** Fail loud (500 + Sentry) when `APP_BASE_URL` is missing, matching `formatProposalEmail()`.

### LOW

#### L1: `twitter-fetcher` auth gate fails open if service key env var is absent
- **File:** `twitter-fetcher/index.ts:352-357` — `if (serviceKey && token !== serviceKey)`. When `SUPABASE_SERVICE_ROLE_KEY` is unset (platform always sets it, so theoretical), the gate passes everyone. Invert to fail closed: `if (!serviceKey || token !== serviceKey)`.

#### L2: Non-timing-safe secret comparisons in webhook/gate paths
- `swapped-webhook/index.ts:75` — `receivedSig !== expectedSig` plain string compare on the HMAC hex.
- `post-to-x/index.ts:713` and `_shared/cron-auth.ts` legacy path — `authHeader.includes(serviceKey)` (substring match, also not timing-safe).
- Practical exploitability of remote timing on these is negligible; flagged for consistency with `notify.ts`/`cron-auth.ts` which already use `timingSafeEqual`.

#### L3: npm audit — 75 findings (3 critical, 26 high), runtime exposure limited
- **Critical (all dev-time):** `vitest`/`@vitest/coverage-v8` (UI server file read — dev only), `tar` (build tooling).
- **High, production-relevant:**
  - `react-router-dom` → `react-router` (turbo-stream deserialization RCE affects SSR/RSC data routers; Vela is a client-side SPA — exposure low; XSS via `javascript:` RSC redirect not applicable).
  - `sharp` (libvips CVEs) — runs in `api/og` Vercel functions, but only processes satori-generated SVG, never user uploads. Low practical risk.
  - `protobufjs` DoS (posthog-js → opentelemetry chain) — carried over from May.
  - Remainder (`axios`, `hono`, `undici`, `ws`, `js-yaml`, `minimatch`, etc.) are transitive via dev tooling (`@vercel/node`, eslint, vite).
- **Fix:** schedule an upgrade pass (`npm audit fix`, then test Privy + build + OG rendering). Count rose from 24 (May) to 75, mostly new advisories in unchanged pins — the dependency set is aging.

#### L4: `retry_daily_digest` has role-mutable `search_path` (advisor WARN)
- Add `SET search_path = public, pg_temp` to the function definition, matching `claim_trial`/`admin_llm_cost_*`.

#### L5: CSP allows `'unsafe-inline'` + `'unsafe-eval'` in `script-src`
- Required by the Privy SDK today; documented as an accepted risk. Re-test on each major Privy upgrade whether `'unsafe-eval'` can be dropped.

---

## 4. STRIDE Summary Table

| Category | Threat | Attack path | Severity | Mitigated? |
|---|---|---|---|---|
| Spoofing | Fake Telegram webhook | POST to trade-webhook | LOW | ✅ TELEGRAM_WEBHOOK_SECRET, fail-closed (`trade-webhook:387-390`) |
| Spoofing | Forged email action link | Guess HMAC | LOW | ✅ userId-bound HMAC-SHA256, timing-safe, 4h expiry window |
| Spoofing | Forged Stripe/Swapped webhook | POST fake event | LOW | ✅ signature verified on raw body before parse (both) |
| Spoofing | JWT forgery | Craft HS256 token | LOW | ✅ Privy ES256 verified upstream; HS256 secret server-side only |
| Tampering | Out-of-schedule signal run | POST run-signals | LOW | ✅ FIXED (May C1) — service-role gate at handler entry |
| Tampering | Cross-user proposal accept | Race ownership check | LOW | ✅ FIXED (May M1) — ownership pushed into atomic UPDATE WHERE |
| Tampering | Tier bypass via webhook replay | Replay Stripe event | LOW | ✅ idempotency (`processed_webhook_events`) |
| Repudiation | No trail on trade actions | — | LOW | ✅ `logAudit()` on all paths; `audit_log` user-scoped RLS |
| Info Disclosure | LLM cost data to anon | `/rest/v1/rpc/admin_llm_cost_*` | **MEDIUM** | **NO — M2** |
| Info Disclosure | OTP theft from DB | Read `withdrawal_otps` | LOW | ✅ FIXED (May M4) — peppered HMAC-SHA256 hashes |
| Info Disclosure | System state via health-check | GET health-check | LOW | ✅ FIXED (May M5) — service-role gate |
| Info Disclosure | Stack traces / source maps | — | LOW | ✅ `sanitizeError()`; `sourcemap: 'hidden'` |
| DoS | LLM quota drain via ungated crons | Hammer content-generator etc. | **MEDIUM** | **NO — M1** |
| DoS | Email spam via ungated user-activation | Repeated invocation | LOW-MED | **Partial — M1** (send-dedup bounds it) |
| DoS | Rate-limit fail-open on DB error | — | LOW | Accepted by design (Sentry-alerted) |
| EoP | Service role key in frontend | Bundle inspection | LOW | ✅ anon key only (verified) |
| EoP | RLS bypass via SECURITY DEFINER | RPC surface | MEDIUM | **Partial — M2** (`claim_trial` correct; admin_llm_* exposed) |
| EoP | `claim_trial` double-claim / other-user claim | RPC race | LOW | ✅ JWT-derived identity, race-safe UPDATE |

---

## 5. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | PASS | RLS ownership-scoped on all user tables (live-verified). trade-webhook ownership atomic in UPDATE (May M1 fixed). Email HMAC userId-bound. Engagement callbacks admin-gated (`trade-webhook:434-442`, May L4 fixed). M2 is the one gap (anon RPC). |
| **A02 Cryptographic Failures** | PASS | Privy ES256 verify (`jose.importSPKI` + `jwtVerify`), HS256 JWT 1h TTL, OTPs now stored as peppered HMAC-SHA256 (May M4 fixed), HMAC timing-safe in notify/cron-auth. L2 nits on swapped-webhook/post-to-x compares. |
| **A03 Injection** | PASS | Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` in frontend src. All DB access via PostgREST parameterized queries. No raw SQL concatenation found. |
| **A04 Insecure Design** | PASS | `max_active_positions` enforced at proposal generation (`proposal-generator.ts:371`) AND execution-time re-check (`trade-executor.ts:636-685`, MF-2a). Withdrawal: OTP + rate limit + daily limit + concurrency guard. |
| **A05 Security Misconfiguration** | PARTIAL | No hardcoded secrets in either repo's tracked files. `.env`/`.env.local` contain publishable values only (verified by shape, untracked). HSTS + Permissions-Policy now present (May L1/L2 fixed). CSP solid apart from L5. M3 residual localhost fallback. |
| **A06 Vulnerable Components** | FAIL | 75 npm findings (3 crit / 26 high), up from 24 in May; runtime exposure limited (L3) but an upgrade pass is due. |
| **A07 Auth Failures** | PARTIAL | auth-exchange rate-limited + ES256; DEV_BYPASS now gated on `import.meta.env.DEV` (May L3 fixed). 10 cron functions ungated (M1). |
| **A08 Data Integrity** | PASS | Stripe raw-body signature verify; Swapped HMAC verify; Telegram secret fail-closed; webhook idempotency table; OTP single-use. |
| **A09 Logging & Monitoring** | PASS | Sentry on financial paths; rate-limit breach → admin Telegram with DB-backed 10-min cooldown; `logAudit()` coverage; `sanitizeError()` prevents leakage; cron heartbeats. |
| **A10 SSRF** | PASS | Swept all `fetch(url)` sites: every variable URL is built from hardcoded API bases (Hyperliquid, Finnhub, FRED, SEC, Twitter/RapidAPI, Telegram, Resend) or `SUPABASE_URL` env. No user-controlled URLs reach server-side fetch. |

---

## 6. Regression Check vs. 2026-05-06 Audit

| May finding | Status today |
|---|---|
| **C1** run-signals no auth | ✅ FIXED — service-role gate at handler entry |
| **H1** asset-intel-generate no auth | ✅ FIXED — gated |
| **H2** proposal-reminder no auth | ✅ FIXED — gated (invoked with service-role bearer from publish-scheduled) |
| **H3** weekly-recap no auth | ✅ FIXED — gated |
| **H4** npm audit 24 findings | ⚠️ WORSE — now 75 (aging pins, see L3) |
| **M1** ownership check after UPDATE | ✅ FIXED — `user_id` in atomic UPDATE WHERE (code comment cites this audit) |
| **M2** daily-digest / subscription-reminders / position-holder-brief no auth | ✅ FIXED — all gated |
| **M3** CORS localhost fallback | ⚠️ PARTIAL — CORS helpers fixed; 2 redirect sites remain in trade-webhook (new M3) |
| **M4** plaintext OTPs | ✅ FIXED — peppered HMAC-SHA256, fail-loud on missing pepper |
| **M5** health-check no auth | ✅ FIXED — gated |
| **L1** missing HSTS | ✅ FIXED |
| **L2** missing Permissions-Policy | ✅ FIXED |
| **L3** DEV_BYPASS not DEV-gated | ✅ FIXED — `import.meta.env.DEV &&` guard |
| **L4** engagement callbacks not admin-gated | ✅ FIXED — `TELEGRAM_ADMIN_CHAT_ID` check |
| **L5** rate limiter fail-open | Accepted as designed (unchanged) |
| WALLET_ENVIRONMENT soft-skip in auth-exchange | ✅ FIXED — Sentry `captureMessage` error on missing var (deliberately non-fatal for the token exchange itself, documented in code) |

**Historic incident regressions checked:**
- Email HMAC IDOR (userId binding): ✅ still fixed (`notify.ts:82-129`).
- pg_cron secret leak (2026-05-07 incident): ✅ zero literal secrets in `cron.job.command` on prod and staging; all 45 jobs use vault lookups. Queried with the redacting predicate form — command text never selected.
- `WALLET_ENVIRONMENT` fail-loud in process-withdrawal: ✅ still fixed.
- Staging env leaks: content-generator/breaking-news/notify all IS_STAGING-gated.

---

## 7. Recommended Actions (Priority Order)

| # | Action | Effort | Where |
|---|---|---|---|
| 1 | Revoke anon/authenticated EXECUTE on `admin_llm_cost_agg` + `admin_llm_cost_by_provider` (migration, both projects) | 10 min | New migration (see M2 SQL) |
| 2 | Apply `verifyCronAuth` to the 10 ungated cron functions (start with `content-generator`, `user-activation`) | 30 min | Each `index.ts` handler entry |
| 3 | Fail loud on missing `APP_BASE_URL` in trade-webhook email-action redirects | 10 min | `trade-webhook/index.ts:632,690` |
| 4 | npm dependency upgrade pass (test Privy auth + build + OG rendering after) | 2h | `package.json` |
| 5 | Fail-closed gate in twitter-fetcher (`!serviceKey \|\|`) | 2 min | `twitter-fetcher/index.ts:353` |
| 6 | Timing-safe compares in swapped-webhook + post-to-x; replace `includes()` with equality on the bearer token | 15 min | `swapped-webhook/index.ts:75`, `post-to-x/index.ts:713`, `_shared/cron-auth.ts` |
| 7 | Pin `search_path` on `retry_daily_digest` | 5 min | Migration |
| 8 | Re-test dropping `'unsafe-eval'` from CSP on next Privy major | — | `vercel.json` |

---

## 8. Positive Observations

- **13 of 15 actionable May findings are fixed**, including everything CRITICAL/HIGH. The auth-gate remediation was applied broadly (run-signals, health-check, digests, recaps, reminders) with code comments citing the audit.
- **pg_cron hygiene is exemplary:** every one of 45 HTTP-calling jobs resolves its secret from Vault at execution time; zero literal secrets, on both projects.
- **RLS posture is clean end-to-end:** live-verified that every `USING (true)` policy is service-role-scoped, all user tables are ownership-scoped, and deny-all backend tables are actually deny-all.
- **`claim_trial` is a model SECURITY DEFINER function:** JWT-derived identity, no user_id parameter, race-safe claim, pinned search_path.
- **OTP storage upgraded beyond the May recommendation** — peppered HMAC rather than plain SHA-256, with fail-loud on a missing pepper.
- **process-withdrawal remains the strongest surface:** JWT + hashed OTP + rate limits + daily limit + concurrency guard + WALLET_ENVIRONMENT fail-loud.
- Zero XSS sinks, no secrets in tracked files, anon-key-only frontend, hidden source maps — all re-verified.

---

*Run as scheduled monthly audit, 2026-09-01. Next run should verify: M1/M2 remediation, npm audit count trend, and that this report's lessons on report durability held (this file is committed in the same run that produced it).*
