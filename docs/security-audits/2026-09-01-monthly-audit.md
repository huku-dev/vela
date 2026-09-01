# Monthly Security Audit — 2026-09-01

**Scope:** Both repos — `crypto-agent-frontend` (React/Vite/Supabase/Vercel) and `crypto-agent` (58 Supabase Edge Functions, Deno, PostgreSQL)
**Prior audit:** [2026-08-02](2026-08-02-monthly-audit.md) (the correct baseline). Also on file: [2026-07-02](2026-07-02-monthly-audit.md), [2026-05-06](2026-05-06-monthly-audit.md). The July and August reports were recovered from a git stash during this run and committed — see §0.
**Method:** Live infrastructure queries (Supabase MCP, prod `dikybxkubbaabnshnreh` + staging `memyqgdqcwrrybjpszuw`), handler-scoped auth-gate sweep across all edge functions, targeted file review, npm audit.

> **Correction note:** the first draft of this report (before the August baseline was located) wrongly concluded "no CRITICAL/HIGH findings." That draft used a whole-file grep for auth tokens, which gave false negatives — a function can *contain* the string `verifyHmac`/`Authorization` in an outgoing call or comment while its handler has no gate. This version re-swept scoped to each `Deno.serve` handler and hand-verified every trade/broadcast-reaching function. Two CRITICALs and a HIGH band were missed by the first pass. Both are unremediated carry-overs from the August audit.

---

## 0. Report durability (the recurring failure)

The August README's gap table recorded that 2026-04, 2026-06 and 2026-07 produced no committed record, and that the July report "was written but never committed." This run found **July and August reports both alive only inside git stashes** (`stash@{9}` and `stash@{7}`, as untracked files), never committed to any branch — the same failure repeating. Both are now committed in this run alongside this report. The August audit's own findings (2 CRITICAL) were therefore effectively invisible for a month: the fixes were partly not applied (see §6), and nobody could diff against them.

---

## 1. Trust Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                  │
│  Browser ──HTTPS──► Vercel CDN ──► React SPA (anon key only) ✓   │
│    CSP + HSTS + Permissions-Policy ✓                            │
│  Telegram / Stripe / Swapped / Email-HMAC ─────────────────┐     │
│  *** ANY UNAUTHENTICATED CALLER *** ───────────────────────┤     │
└───────────────────────────────────────────────┬────────────┘     │
                                               │ HTTPS             │
┌───────────────────────────────────────────────▼────────────┐     │
│ SUPABASE EDGE LAYER — 58 functions, ALL --no-verify-jwt     │◄────┘
│  Auth boundary : Privy ES256 → HS256 JWT 1h (auth-exchange) │
│  Financial     : JWT + hashed OTP (process-withdrawal)      │
│  Webhook       : Stripe sig / Swapped HMAC / TG secret      │
│  Cron          : Authorization==Bearer<svc> OR verifyCronAuth│
│                                                             │
│  ⚠ 2 CRITICAL ungated: scanner-30m (trades), e2e-prod-test │
│    (mainnet trades + arbitrary-sub JWT forge) — C1, C2      │
│  ⚠ ~13 further ungated cron/broadcast fns — H1             │
└───────────────────────────────────────────────┬────────────┘
                                               │ service_role
┌───────────────────────────────────────────────▼────────────┐
│ SUPABASE POSTGRES — RLS on all user tables ✓                │
│  pg_cron: 0 literal secrets, all vault lookups ✓ (C1 Aug    │
│    FIXED — migration 20260802000001, live-verified)         │
│  ⚠ /rpc/admin_llm_cost_* anon-executable — M1               │
│  Privy HSM (keys never extracted) ✓ · HL withdraw3-scoped ✓ │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Live Infrastructure Queries (both projects)

| Check | Prod | Staging |
|---|---|---|
| pg_cron literal `Bearer` secrets (2026-05-07 incident / Aug C1) | **0 rows** — all 45 jobs vault-lookup, `has_literal_secret=false` | **0 rows** |
| Supabase advisors: ERROR | 0 | 0 |
| Supabase advisors: WARN | 41 (triaged §5) | 5 |
| RLS on user-data tables | ✅ ownership-scoped via `auth.jwt()->>'sub'` on all (positions, trade_proposals, user_wallets, user_subscriptions, profiles, audit_log, funding_events, cctp_transfers, circuit_breaker_events, user_preferences) | Same |
| `USING (true)` policies | ✅ every one is `TO service_role`; anon/authenticated `true` only on intentional public product data | Same |
| Backend-only table grants to anon/authenticated | ✅ none on the sensitive set | Same |

**C1 (Aug) confirmed fixed:** migration `20260802000001_fix_run_signals_cron_secret_leak.sql` rescheduled both `run-signals-4h*` jobs with runtime vault concatenation (`'Bearer ' || (SELECT decrypted_secret …)`) and embeds a self-auditing `RAISE WARNING`. Live query returns zero literal secrets on prod and staging. This is the one August critical that was actually remediated.

---

## 3. Findings — Ranked by Severity

### CRITICAL

#### C1: `scanner-30m` is unauthenticated and executes real trades — **August C2, STILL OPEN**
- **File:** `crypto-agent/supabase/functions/scanner-30m/index.ts:80` — `Deno.serve(async (_req) => {`. The only `Authorization` in the file (`:319`) is an *outgoing* header on a call it makes; the handler never inspects the incoming request.
- **Deployed** with `--no-verify-jwt`, reachable at `<SUPABASE_URL>/functions/v1/scanner-30m`.
- **Reaches money:** imports `executeTradeProposal`; scanner-30m is one of the three trade-execution paths (per CLAUDE.md). Repeated POSTs force out-of-schedule momentum/BB2 entries and exit-scanner stop/trim actions for every eligible user, at attacker-chosen timing — real HL fees, real position moves, plus LLM/IO drain.
- **Status:** August rated this C2 CRITICAL and recommended `verifyCronAuth` at the handler. Not applied. `run-signals` (the sibling 4H path) *does* gate correctly (`run-signals/index.ts:100`, `req.headers.get("Authorization") !== Bearer <key>` → 401) — scanner-30m was simply never given the same guard.
- **Fix:** add the same incoming-Authorization check (or `verifyCronAuth(req, "scanner-30m")`) at the top of the handler; rename `_req`→`req`. The cron already sends the vault-resolved bearer, so no cron change needed.

#### C2: `e2e-prod-test` is unauthenticated on mainnet, forges JWTs, and executes trades
- **File:** `crypto-agent/supabase/functions/e2e-prod-test/index.ts:91` — `Deno.serve(async (req)` with no auth gate anywhere in the file (only a `POST`-only method check).
- **Deployed to prod:** listed in `scripts/deploy.sh` function set; deploy.sh invokes it with no auth header (relies on `--no-verify-jwt`). No `ENVIRONMENT !== "staging"` guard (unlike `e2e-testnet-test`, which is staging-gated at `:51`).
- **Two exploit paths:**
  1. **Default (no body):** runs a real open+close position cycle for `DEFAULT_USER` on mainnet — every unauthenticated call burns real Hyperliquid fees. Trivial DoS / fund-drain.
  2. **`{action:"execute-proposal", user_id, proposal_id}`:** `mintJwt(userId)` (`:34`) signs a Supabase JWT with `JWT_SECRET` and an **attacker-supplied `sub`**, then calls the trade webhook as that user to accept/execute the proposal. This is an identity-forgery primitive (arbitrary `sub`) exposed to the internet, chained straight into mainnet trade execution. Targeted use needs a victim's `privy_did` + a pending `proposal_id` (both UUID-ish, not enumerable), which bounds practical targeting — but the primitive itself is a service-role-adjacent auth bypass and should not be internet-reachable.
- **Severity:** CRITICAL (mainnet fund movement + JWT-`sub` forgery, unauthenticated). Not flagged in the August report — either missed or introduced since.
- **Fix:** gate with a dedicated `E2E_PROD_SECRET` bearer compare at handler entry (deploy.sh sends it), and/or refuse to run unless a signed operator token is present. Never leave a `mintJwt(arbitrary sub)` path internet-reachable.

### HIGH

#### H1: ~13 further edge functions accept unauthenticated requests — **August H1, largely unremediated**
Handler-scoped sweep (all `--no-verify-jwt`, no in-function gate). Excludes `auth-exchange` (Privy ES256 verify *is* its auth) and `daily-digest-feedback` (per-link HMAC signature verify), which are gated by design.

| Function | Blast radius |
|---|---|
| `breaking-news` | `broadcastNewsBrief` — per-user Telegram broadcast to the whole base (prod; staging early-returns). Mass spam / brand damage. |
| `attribution-compute` | Service-role DB writes; `?backfill_since=` still unbounded (`:81`) → arbitrary work amplification per request. |
| `publish-scheduled` | Publishes queued social content on prod and fires `proposal-reminder`. |
| `user-activation` | Sends activation emails (flows A/B) to users. |
| `bb2-shadow-resolve` | Service-role writes to shadow-tracking data — corrupts forward-test integrity. |
| `classifier-drift-check` | Privileged drift RPCs + admin alerting → alert spam. |
| `news-enrich`, `news-l2-batch`, `macro-enrich`, `sec-filing-enrich` | LLM calls on pending batches → direct spend amplification (dedup columns bound per-invocation damage; timing is attacker-controlled). |
| `content-generator` | Anthropic content generation + social queue writes (prod only). |
| `earnings-calendar-sync`, `sec-edgar-poll` | External API sync/poll → third-party quota drain, EDGAR IP-ban risk. |
- **Status:** August recommended `verifyCronAuth`/bearer checks on this whole set (its actions #2/#3). Not applied. The set is essentially unchanged from August.
- **Systemic fix (August #6, still open):** exposure is automatic (`--no-verify-jwt` on all 58 functions) while auth is opt-in per function. Add a `deploy.sh` preflight that refuses to deploy any function whose source lacks a recognised auth token, and/or a shared `withCronAuth(name, handler)` wrapper. This converts the class from "remembered" to "enforced" and is worth more than any single gate.

#### H2: `npm audit` — 75 vulnerabilities (3 critical, 26 high), worsening trend
- May 24 → August 71 → **now 75** (3 crit / 26 high / 45 mod / 1 low).
- Production-relevant: `react-router-dom`→`react-router` (turbo-stream deserialization RCE — affects SSR/RSC data routers; Vela is a client-side SPA, exposure low), `sharp`/libvips CVEs (runs in `api/og`, processes only satori-generated SVG, never user uploads), `protobufjs` DoS (posthog→otel chain). Criticals (`vitest`, `tar`) are dev/build-time only. All transitive.
- **Fix:** `npm audit fix`, then bump `@privy-io/react-auth` (most of the delta sits under it); re-test the login path + build + OG rendering. Record residual count next month.

### MEDIUM

#### M1: `admin_llm_cost_agg` / `admin_llm_cost_by_provider` executable by `anon` — **new since August**
- **Where:** prod + staging, `/rest/v1/rpc/admin_llm_cost_agg` and `…_by_provider` (created by `20260814000001_admin_llm_cost_rpcs.sql`, after the August audit).
- Both are `SECURITY DEFINER` (bypassing `llm_call_log`'s service-role-only RLS), have **no internal auth check**, and grant EXECUTE to `anon` + `authenticated`. The anon key ships in the frontend, so any internet user can read total LLM spend, call counts, token volumes, and per-provider cost. Information disclosure of internal ops data (no PII/user data).
- **Fix:**
  ```sql
  REVOKE EXECUTE ON FUNCTION public.admin_llm_cost_agg(timestamptz, timestamptz) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.admin_llm_cost_by_provider(timestamptz, timestamptz) FROM anon, authenticated;
  ```
  The admin dashboard reads these via `admin-dashboard-data` (service role + admin gate), unaffected by the revoke.

#### M2: `APP_BASE_URL` silently falls back to `http://localhost:5173` in 11 places — **August M1, unfixed (was 10, now 11)**
- **Files:** `create-checkout-session:33,212`, `create-portal-session:27,99`, `trade-webhook:632,690`, `news-detail-generate:45`, `swapped-signature:20`, `telegram-link:26`, `provision-wallet:22`, **`refresh-balance:26` (new since August)**.
- Violates the absolute no-silent-defaults rule. If `APP_BASE_URL` were unset, Stripe `success_url`/`cancel_url`, portal return URLs, and email/Telegram deep links would point at localhost with no error. `formatProposalEmail()` already fails loud — the inconsistency is the bug.
- **Fix:** extract a shared `getAppBaseUrl()` in `_shared/` that throws when unset; replace all 11 call sites.

#### M3: `retry_daily_digest` has a role-mutable `search_path` — **August M2, unfixed**
- Advisor `function_search_path_mutable` (WARN), prod. Classic schema-shadowing escalation vector on a privileged function.
- **Fix:** `ALTER FUNCTION public.retry_daily_digest() SET search_path = public, pg_temp;`

#### M4: `auth-exchange` soft-skips wallet provisioning when `WALLET_ENVIRONMENT` unset — **August M3, unchanged**
- `auth-exchange/index.ts:188` — Sentry-captured (good, since May), but still a soft skip: token exchange succeeds and the user logs in with no wallet / no deposit address, with no user-visible signal.
- **Fix:** mark the profile "wallet provisioning pending" so the UI surfaces it and a retry runs on next login.

### LOW

- **L1:** `twitter-fetcher` gate fails open if `SUPABASE_SERVICE_ROLE_KEY` env is absent (`:353`, `if (serviceKey && token !== serviceKey)`) — invert to `if (!serviceKey || token !== serviceKey)`.
- **L2:** Non-timing-safe secret compares: `swapped-webhook:75` (HMAC hex `!==`), `post-to-x:713` and cron-auth legacy path (`authHeader.includes(serviceKey)` substring). Negligible remote-timing exploitability; flagged for consistency with `notify.ts`/`cron-auth.ts` which use `timingSafeEqual`.
- **L3:** Broad GraphQL/REST schema discoverability for `authenticated` (advisor WARN, 34 objects) — schema-shape only; RLS prevents row exposure (live-verified). Optional hardening.
- **L4:** CSP allows `'unsafe-inline'` + `'unsafe-eval'` in `script-src` (Privy requirement) — re-test dropping `'unsafe-eval'` on next Privy major.
- **L5:** Rate limiter fails open on DB error (`rate-limiter.ts`) — accepted by design, Sentry-alerted, unchanged.

---

## 4. STRIDE Summary

| Category | Threat | Attack path | Severity | Status |
|---|---|---|---|---|
| Tampering | Force out-of-schedule trade execution | POST `scanner-30m` | **CRITICAL** | ❌ **C1** |
| Spoofing / EoP | Forge JWT `sub`, execute mainnet trade | POST `e2e-prod-test` `{action:execute-proposal}` | **CRITICAL** | ❌ **C2** |
| Spoofing | Impersonate cron caller | POST any ungated cron fn | HIGH | ❌ **H1** |
| DoS | Mass Telegram broadcast | POST `breaking-news` | HIGH | ❌ **H1** |
| DoS | Drain LLM quota | POST enrich/judge fns | HIGH | ❌ **H1** |
| DoS | Unbounded backfill window | `attribution-compute?backfill_since=2000-01-01` | HIGH | ❌ **H1** |
| Info Disclosure | service_role key from pg_cron catalog | `SELECT command FROM cron.job` | — | ✅ **FIXED (Aug C1)** — vault lookup, 0 literal secrets both envs |
| Info Disclosure | LLM cost data to anon | `/rpc/admin_llm_cost_*` | MEDIUM | ❌ **M1** |
| Spoofing | Forged Telegram webhook | POST trade-webhook | LOW | ✅ TG secret, fail-closed |
| Spoofing | Forged email action link | Guess HMAC | LOW | ✅ userId-bound HMAC, timing-safe |
| Spoofing | Forged Stripe/Swapped webhook | POST fake event | LOW | ✅ signature verified on raw body |
| Tampering | Proposal double-accept race | Concurrent accept | LOW | ✅ atomic UPDATE + ownership in WHERE |
| Info Disclosure | Cross-user data read | RLS bypass | LOW | ✅ RLS + policies verified |
| Info Disclosure | OTP theft from DB | Read `withdrawal_otps` | LOW | ✅ peppered HMAC-SHA256 |
| EoP | service_role key in frontend | Bundle inspection | LOW | ✅ anon key only |
| EoP | Non-admin reaches admin dashboard | Call admin-dashboard-data | LOW | ✅ JWT + privy_did allowlist |
| EoP | Trial re-claim | Call `claim_trial()` | LOW | ✅ JWT-derived identity, race-safe |

---

## 5. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | **FAIL** | 2 CRITICAL + ~13 HIGH ungated functions (C1, C2, H1). RLS/ownership themselves sound: user tables ownership-scoped (live-verified), atomic ownership in trade-webhook UPDATE, email HMAC userId-bound, engagement callbacks admin-gated. M1 anon RPC is the DB-layer gap. |
| **A02 Cryptographic Failures** | PARTIAL | Primitives correct (Privy ES256→HS256, HMAC timing-safe, peppered OTP hashing, 1h JWT). But C2 exposes a `mintJwt(arbitrary sub)` forge primitive to the internet. Aug C1 key-handling leak is fixed. |
| **A03 Injection** | PASS | Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` in frontend src; all DB access parameterized. |
| **A04 Insecure Design** | **FAIL** | Exposure-by-default (`--no-verify-jwt` on all 58 fns) with opt-in auth is the root cause of C1/C2/H1 and keeps reproducing it. `attribution-compute` unbounded `backfill_since`. Tier/`max_active_positions` enforcement is sound (proposal-gen + execution-time re-check). |
| **A05 Security Misconfiguration** | PARTIAL | Frontend clean: no secrets in tracked/untracked env files, `sourcemap:'hidden'`, full header set (CSP/HSTS/Permissions-Policy/frame-ancestors). Backend: M2 (11 localhost fallbacks), M3. |
| **A06 Vulnerable Components** | FAIL | 75 npm findings (3 crit/26 high), worsening (H2). |
| **A07 Auth Failures** | **FAIL** | auth-exchange + DEV_BYPASS gating solid, but 15 functions ungated including two that move mainnet funds. |
| **A08 Data Integrity** | PASS | Stripe raw-body sig verify, Swapped HMAC, TG secret fail-closed, webhook idempotency, single-use OTP. |
| **A09 Logging & Monitoring** | PASS | Sentry on financial paths; rate-limit breach → admin Telegram w/ cooldown; audit log; cron heartbeats. C1's self-auditing migration closes the Aug "detection not automated" gap for cron secrets. |
| **A10 SSRF** | PASS | All server-side `fetch()` targets resolve from env or hardcoded adapter bases; no user-controlled host reaches fetch. |

---

## 6. Regression Check vs. 2026-08-02

| August finding | Status now |
|---|---|
| **C1** service_role key in pg_cron catalog | ✅ **FIXED** — migration `20260802000001`, runtime vault lookup; live-verified 0 literal secrets prod+staging |
| **C2** `scanner-30m` unauthenticated, executes trades | ❌ **STILL OPEN** — now **C1 this report** |
| **H1** 11 further ungated functions | ❌ **STILL OPEN** — now **H1 this report** (~13, essentially unchanged) |
| **H2** npm audit 71 findings | ❌ **WORSE** — now 75 (H2) |
| **M1** `APP_BASE_URL` 10 localhost fallbacks | ❌ **UNFIXED / WORSE** — now 11 (M2) |
| **M2** `retry_daily_digest` mutable search_path | ❌ **UNFIXED** (M3) |
| **M3** `auth-exchange` wallet soft-skip | ⚠️ Unchanged (M4) |
| **L1** schema discoverability | ⚠️ Unchanged (L3) |
| **L2** `claim_trial` WARN (false positive) | ✅ Re-confirmed correct by design |
| **L3** rate limiter fail-open | ✅ Accepted, unchanged (L5) |
| service_role key rotation (flagged 2026-05-07, re-flagged Aug) | ⚠️ **Open** — reschedule removed the ongoing catalog exposure; rotation still recommended at next window (key was rendered in prior transcripts) |
| Rotate assessment / e2e-prod-test | **New CRITICAL this report (C2)** — was not surfaced in August |

**Net:** of August's two CRITICALs, one fixed (C1) and one still open (C2/scanner-30m). The entire H1 auth-gap band and both cross-cutting structural fixes (deploy preflight, shared getAppBaseUrl) went unimplemented. Only the cron-secret migration landed. New this month: M1 anon RPCs, and the e2e-prod-test CRITICAL surfaced by handler-scoped review.

---

## 7. Recommended Actions (Priority Order)

| # | Action | Effort | Location |
|---|---|---|---|
| 1 | **Gate `e2e-prod-test`** with a dedicated secret bearer; never leave `mintJwt(arbitrary sub)` internet-reachable | 15 min | `e2e-prod-test/index.ts:91` + deploy.sh |
| 2 | **Gate `scanner-30m`** (incoming-Authorization compare or `verifyCronAuth`) — it executes trades | 10 min | `scanner-30m/index.ts:80` |
| 3 | **Gate the remaining ~13 ungated functions** (H1) | 1h | each `index.ts` handler entry |
| 4 | **Add a `deploy.sh` preflight** refusing to deploy a function with no recognised auth token | 45 min | `scripts/deploy.sh` |
| 5 | **Revoke anon/authenticated EXECUTE on `admin_llm_cost_*`** (migration, both projects) | 10 min | new migration |
| 6 | **`npm audit fix` + bump `@privy-io/react-auth`**; re-test login/build/OG | 1–2h | `package.json` |
| 7 | **Extract fail-loud `getAppBaseUrl()`**, replace all 11 call sites | 30 min | `_shared/` + 8 functions |
| 8 | **Bound `attribution-compute` `backfill_since`** to a max window | 15 min | `attribution-compute/index.ts:81` |
| 9 | **`ALTER FUNCTION retry_daily_digest SET search_path`** | 5 min | new migration |
| 10 | **Rotate service_role key** at next convenient window (reschedule already removed catalog exposure) | 30 min | Supabase Dashboard, both projects |
| 11 | Surface pending wallet provisioning to the user (M4) | 30 min | `auth-exchange/index.ts:188` |

Items 1–3 move mainnet funds or reach the whole user base; they should land before anything else ships.

---

## 8. Positive Observations

- **August C1 (the cron-secret leak) is properly fixed** — runtime vault concat, and the fix migration embeds its own `RAISE WARNING` self-audit, which closes the "detection never automated" gap that let the original regression survive 12 weeks.
- **pg_cron hygiene now exemplary on both projects:** 45/45 HTTP jobs resolve secrets from Vault at execution time; zero literal secrets.
- **RLS posture clean end-to-end** (live-verified): every `USING (true)` policy is service-role-scoped; all user tables ownership-scoped; backend-only tables deny-all.
- **`run-signals` gates correctly** (`:100`) — proof the right pattern is in the codebase and just needs applying to scanner-30m/e2e-prod-test.
- **`claim_trial` is a model SECURITY DEFINER function** (JWT identity, no user_id arg, race-safe, pinned search_path).
- **process-withdrawal defense-in-depth intact:** JWT + peppered-hashed OTP + rate limit + daily limit + concurrency guard + WALLET_ENVIRONMENT fail-loud.
- **Frontend clean:** zero XSS sinks, no secrets in env files, hidden source maps, restrictive CSP.

---

## 9. Meta-observation

Every top finding this month is the same shape August named: **a correct control that is not applied by default.** `run-signals` has the exact gate scanner-30m and e2e-prod-test lack. `formatProposalEmail` has the exact fail-loud `getAppBaseUrl` the other 11 sites lack. The vault-lookup pattern was correct and still got regressed once. Prevention that lives in a per-function habit keeps failing; the two structural items — a deploy-time auth preflight (#4) and a shared fail-loud base-URL helper (#7) — are worth more than any individual gate because they make the safe path the default. And the report-durability failure (§0) is the meta-instance: the audit process itself relied on "remember to commit" and lost two months of critical findings to it.

---

*Audit performed 2026-09-01. Live catalog + advisor queries run against prod `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw`.*
