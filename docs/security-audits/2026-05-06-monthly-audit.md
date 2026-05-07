# Monthly Security Audit — 2026-05-06

**Scope:** Both repos — `crypto-agent-frontend` (React/Vite/Supabase) and `crypto-agent` (Supabase Edge Functions, Deno, PostgreSQL)
**Reference:** Prior audit 2026-03-18 in `memory/security-hardening.md`
**Method:** Direct file review + grep sweeps across all 47 edge functions, frontend source, migrations

---

## 1. Trust Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                 │
│                                                                 │
│  Browser ──HTTPS──► Vercel CDN ──► React SPA (anon key only)  │
│                                                                 │
│  Telegram ──────────────────────────────────────────────────┐  │
│  Stripe ────────────────────────────────────────────────────┤  │
│  Email links ───────────────────────────────────────────────┤  │
└─────────────────────────────────────┬───────────────────────┘  │
                                      │ HTTPS                     │
┌─────────────────────────────────────▼───────────────────────┐  │
│ SUPABASE EDGE LAYER (47 functions, --no-verify-jwt)         │  │
│                                                             │  │
│  Auth boundary: Privy ES256 → HS256 JWT (auth-exchange)     │  │
│  Financial boundary: OTP + JWT (process-withdrawal)         │  │
│  Webhook boundary: Stripe sig / Telegram secret / HMAC      │  │
│                                                             │  │
│  ⚠ EXPOSED: run-signals, asset-intel-generate, weekly-recap │  │
│             proposal-reminder (NO auth — see C1, H1-H3)     │  │
└─────────────────────────────────────┬───────────────────────┘
                                      │ service_role (encrypted)
┌─────────────────────────────────────▼───────────────────────┐
│ SUPABASE POSTGRES (RLS-enforced for authenticated users)    │
│  + Privy HSM (private keys — never extracted)               │
│  + Hyperliquid API (agent wallets — withdraw3 scoped)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Findings — All Severities Ranked

### CRITICAL

#### C1: `run-signals` has no authentication
- **File:** `supabase/functions/run-signals/index.ts:59`
- **Problem:** `Deno.serve` handler starts immediately with no auth check. Anyone on the internet can POST to `<SUPABASE_URL>/functions/v1/run-signals` and trigger the full signal engine.
- **Attack:** Calling this endpoint at any time causes the system to:
  - Evaluate all enabled assets and generate trade proposals
  - Auto-execute trades for every user with `mode = full_auto`
  - Send Telegram and email notifications to all users
  - With `?asset=btc` query param, can target specific assets repeatedly
- **Impact:** Out-of-schedule trade execution for paying users, notification spam, Anthropic API quota drain
- **Fix:** Add service role key check at handler entry (same pattern as `market-context-refresh:58-65`):
  ```typescript
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || key.length < 20) return respond(500, { error: "Server misconfigured" });
  if (req.headers.get("Authorization") !== `Bearer ${key}`) return respond(401, { error: "Unauthorized" });
  ```

---

### HIGH

#### H1: `asset-intel-generate` has no authentication
- **File:** `supabase/functions/asset-intel-generate/index.ts:118`
- **Problem:** No auth check. Handler accepts `mode=manual` from any caller. The code explicitly flags this: *"an unvalidated reason='manual' from a misbehaving caller could circumvent dedup"* (line 138) — but there's nothing stopping that caller.
- **Attack:** Flood with `mode=manual` calls to exhaust NVIDIA/Groq LLM quota; the 60-minute dedup window is bypassed by `manual` mode.
- **Fix:** Service role key check (same pattern as above).

#### H2: `proposal-reminder` has no authentication
- **File:** `supabase/functions/proposal-reminder/index.ts`
- **Problem:** No auth check found. Sending reminders to all users with pending proposals.
- **Attack:** Trigger at will to spam every semi-auto user with reminder emails. With multiple calls, could exhaust Resend API quota.
- **Fix:** Service role key check.

#### H3: `weekly-recap` has no authentication
- **File:** `supabase/functions/weekly-recap/index.ts`
- **Problem:** No auth check. Sends weekly recap emails to the entire user base.
- **Attack:** Any caller can trigger a mass email blast to all users.
- **Fix:** Service role key check.

#### H4: `npm audit` — 1 critical + 2 high transitive vulnerabilities
- **Summary:** 24 total (21 moderate, 2 high, 1 critical)
- **Critical:** `protobufjs@7.5.4` — arbitrary code execution. Chain: `posthog-js` → `@opentelemetry/otlp-transformer` → `protobufjs`. Risk is low in practice (not processing user-controlled proto data), but the advisory is critical.
- **High:** `lodash@4.17.23` — code injection via `_.template`. Chain: `@privy-io/react-auth` → `@metamask/utils` → `lodash`.
- **High:** `defu@6.1.4` — prototype pollution. Chain: `@privy-io/react-auth` → `@walletconnect` → `unstorage` → `h3` → `defu`.
- **Fix:** `npm audit fix` (test for breaking changes in Privy/WalletConnect first). All are transitive — can't be fixed without upstream updates.

---

### MEDIUM

#### M1: Ownership check runs AFTER DB update in `processProposalAction`
- **File:** `supabase/functions/trade-webhook/index.ts:119–166`
- **Problem:** The proposal status is atomically updated (`pending → approved/declined`) at line 119 BEFORE the `authenticatedUserId` ownership check at line 159. The revert at line 162 is fire-and-forget (error not checked). If the revert fails silently (DB timeout, network error), the proposal is permanently stuck in the wrong state with no alert.
- **Attack:** In practice, all three auth paths (JWT, HMAC, Telegram) prevent a wrong `authenticatedUserId` from being supplied. But if revert fails for any reason (transient DB issue), the proposal state is corrupted silently.
- **Fix:** Add `.eq("user_id", authenticatedUserId)` to the initial UPDATE query when `authenticatedUserId` is set, so the DB does ownership enforcement atomically:
  ```typescript
  if (authenticatedUserId) {
    query = query.eq("user_id", authenticatedUserId);
  }
  ```

#### M2: `daily-digest`, `subscription-reminders`, `position-holder-brief` — no auth on email/notification functions
- **Files:** Respective `index.ts` files for each
- **Problem:** Same pattern as H2/H3 but lower blast radius — affects smaller user subsets.
- **Fix:** Service role key check on all three.

#### M3: CORS origin falls back to `localhost:5173` silently
- **Files:** `trade-webhook:65`, `process-withdrawal:31`, `auth-exchange:36`
- **Pattern:** `Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173"`
- **Problem:** If `APP_BASE_URL` is missing in a deployed environment, the CORS `Access-Control-Allow-Origin` header returns `localhost:5173` rather than failing loud. Requests from the real frontend would be CORS-blocked but the misconfiguration produces no error.
- **Note:** `formatProposalEmail()` already has a proper fail-loud guard for `APP_BASE_URL` — this is inconsistent.
- **Fix:** Apply the same guard in the CORS helper functions, or at minimum add `APP_BASE_URL` to the startup env validation.

#### M4: `withdrawal_otps.code` stored as plaintext
- **File:** Migration `20260302000001_funding_events.sql:65` + `process-withdrawal/index.ts:298`
- **Problem:** OTP codes are inserted as plaintext strings. If an attacker gains read access to the `withdrawal_otps` table (via service role leak or future SQL injection), they could read valid codes and execute withdrawals against users' wallets.
- **Context:** Table has RLS enabled with service_role-only policy, so direct PostgREST access is blocked. Risk is conditional on a separate service role compromise.
- **Fix:** Hash OTPs before storage (`crypto.subtle.digest('SHA-256', code)` or bcrypt). Compare hash at verify time.

#### M5: `health-check` exposes system state without auth
- **File:** `supabase/functions/health-check/index.ts`
- **Problem:** Returns system health data (function availability, DB connectivity) without any auth. Aids attackers in mapping live services and detecting downtime windows.
- **Fix:** Restrict to internal callers only (service role check) or Supabase admin dashboard only.

---

### LOW

#### L1: Missing `Strict-Transport-Security` (HSTS) header
- **File:** `crypto-agent-frontend/vercel.json`
- **Problem:** No HSTS header. Vercel enforces HTTPS at CDN level, but without HSTS, browsers don't cache the HTTPS-only requirement. Leaves a window for SSL-stripping on first visit.
- **Fix:** Add `{ "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }` to `vercel.json` headers.

#### L2: Missing `Permissions-Policy` header
- **File:** `crypto-agent-frontend/vercel.json`
- **Problem:** No Permissions-Policy to restrict access to browser APIs (camera, geolocation, etc.).
- **Fix:** Add `{ "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }`.

#### L3: `DEV_BYPASS` not gated on `import.meta.env.DEV`
- **File:** `crypto-agent-frontend/src/hooks/useAuth.ts:16`
- **Pattern:** `const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'`
- **Problem:** No `import.meta.env.DEV` guard. If `VITE_DEV_BYPASS_AUTH=true` were accidentally set in Vercel's production environment config, the bypass would activate. Impact is limited (bypass uses anon client only, RLS still applies, trading doesn't work), but auth would appear satisfied to all UI components.
- **Fix:** `const DEV_BYPASS = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'`

#### L4: `engagement_opportunities` callbacks not admin-gated in `trade-webhook`
- **File:** `supabase/functions/trade-webhook/index.ts:413`
- **Problem:** Any Telegram user who receives a message with the engagement inline buttons (approve/skip) can click them. In practice only the admin chat receives these messages.
- **Fix:** Cross-check `callbackQuery.from.id` against `TELEGRAM_ADMIN_CHAT_ID` before processing.

#### L5: Rate limiter fail-open on DB errors (accepted risk)
- **File:** `supabase/functions/_shared/rate-limiter.ts:95,129`
- **Note:** Intentional design — DB unavailability should not block all trading. Sentry alerts on fail-open events. Accepted as-designed.

---

## 3. STRIDE Summary Table

| Category | Threat | Severity | Mitigated? |
|---|---|---|---|
| **Spoofing** | Fake Telegram webhook | LOW | Yes — TELEGRAM_WEBHOOK_SECRET (fail-closed) |
| **Spoofing** | Forged email action HMAC | LOW | Yes — userId-bound HMAC, timing-safe |
| **Spoofing** | JWT sub claim tampering | LOW | Yes — Privy ES256 + HS256, proper claims validation |
| **Tampering** | Trigger run-signals arbitrarily | **CRITICAL** | **NO — C1** |
| **Tampering** | Proposal double-accept race | LOW | Yes — atomic DB transition on `status='pending'` |
| **Tampering** | Subscription tier bypass via webhook replay | LOW | Yes — idempotency via `last_webhook_event_id` |
| **Repudiation** | No audit trail on trade actions | LOW | Yes — `logAudit()` on all 3 paths |
| **Info Disclosure** | User proposals readable by other users | LOW | Yes — ownership check on all 3 paths |
| **Info Disclosure** | OTP readable if DB compromised | MEDIUM | **Partial — M4** |
| **Info Disclosure** | System state via health-check | MEDIUM | **NO — M5** |
| **Info Disclosure** | Stack traces in HTTP responses | LOW | Yes — `sanitizeError()` in trade-webhook |
| **Info Disclosure** | Source maps public | LOW | Yes — `sourcemap: 'hidden'`, deleted post-Sentry |
| **Denial of Service** | Flood run-signals | **CRITICAL** | **NO — C1** |
| **Denial of Service** | Flood asset-intel LLM calls | HIGH | **NO — H1** |
| **Denial of Service** | Mass email spam via recap/reminder | HIGH | **NO — H2, H3** |
| **DoS** | Rate limit bypass on DB error | LOW | Accepted (fail-open design) |
| **EoP** | Service role key in frontend | LOW | Yes — only anon key client-side |
| **EoP** | Cross-user proposal action | MEDIUM | Yes — ownership verified on all paths (see M1 for edge case) |
| **EoP** | RLS bypass via SECURITY DEFINER views | LOW | Yes — fixed in 2026-03-04 migration |

---

## 4. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | PARTIAL | Ownership checks in place for proposals/withdrawals. C1: run-signals fully open. M1: ownership check ordering. |
| **A02 Cryptographic Failures** | PASS | Privy ES256 verified. HMAC uses SHA-256 + timing-safe comparison. JWT TTL 1h. OTP uses `crypto.getRandomValues()`. Plaintext OTP storage is M4. |
| **A03 Injection** | PASS | Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval()` in frontend. All DB queries via PostgREST (parameterized). |
| **A04 Insecure Design** | PARTIAL | `max_active_positions` enforced. C1 is an insecure design flaw. M1 ownership-after-update is a design issue. |
| **A05 Security Misconfiguration** | PARTIAL | No hardcoded secrets found in `src/`. CSP headers present. Source maps hidden. CORS silent fallback is M3. HSTS missing is L1. |
| **A06 Vulnerable Components** | FAIL | 24 npm audit findings, 1 critical (`protobufjs`), 2 high (`lodash`, `defu`). All transitive. |
| **A07 Auth Failures** | PARTIAL | Auth exchange solid (rate-limited, ES256). Dev bypass risk is L3. 12 edge functions lack any auth (C1, H1-H3, M2). |
| **A08 Data Integrity** | PASS | Stripe signature verified before processing. Telegram secret enforced fail-closed. Email HMAC user-bound. OTP single-use enforced. |
| **A09 Logging & Monitoring** | PASS | Sentry on all financial paths. Rate limit abuse alerts to admin Telegram. Audit log on all trade/auth/payment events. |
| **A10 SSRF** | PASS | No user-controlled URLs passed to server-side `fetch()`. All external endpoints are hardcoded. |

---

## 5. Regression Check vs. Prior Audit (2026-03-18)

| Prior Fix | Status |
|---|---|
| Email HMAC IDOR (`userId`-bound HMAC, `verifyHmac` requires userId) | ✅ CONFIRMED — `notify.ts:70-101` |
| `APP_BASE_URL` fail-loud in `formatProposalEmail()` | ✅ CONFIRMED — `notify.ts:1387-1393` |
| Rate limit admin alerting (DB-backed, 10-min cooldown) | ✅ CONFIRMED — `rate-limiter.ts:104-117` |
| `WALLET_ENVIRONMENT` fail-loud in `process-withdrawal` | ✅ CONFIRMED — both handlers, lines 217-225 + 480-488 |
| `bb2_cooldowns` RLS, `SECURITY DEFINER` views, `funding_events` RLS | ✅ CONFIRMED — `20260304000001_security_advisor_remediation.sql` |
| Zero XSS sinks in frontend | ✅ CONFIRMED — no `dangerouslySetInnerHTML`/`innerHTML`/`eval` |
| Telegram webhook fail-closed | ✅ CONFIRMED — `trade-webhook:363-375` |
| **`WALLET_ENVIRONMENT` in `auth-exchange`** | ⚠️ SOFT REGRESSION — `auth-exchange:184-203` uses `if (walletEnv)` soft skip. Doesn't default to testnet (prior bug), but silently skips wallet provisioning if env var missing. New users on misconfigured environment get no wallet. |

---

## 6. Recommended Actions (Priority Order)

| # | Action | Effort | File |
|---|---|---|---|
| 1 | **Add service role auth to `run-signals`** | 5 min | `run-signals/index.ts:59` |
| 2 | **Add service role auth to `asset-intel-generate`** | 5 min | `asset-intel-generate/index.ts:118` |
| 3 | **Add service role auth to `proposal-reminder`, `weekly-recap`, `subscription-reminders`, `daily-digest`, `position-holder-brief`** | 10 min | Each `index.ts` handler entry |
| 4 | **`npm audit fix`** (after testing Privy/WalletConnect compat) | 1h | `package.json` |
| 5 | **Add user ownership to initial UPDATE in `processProposalAction`** | 15 min | `trade-webhook/index.ts:119` |
| 6 | **Gate `DEV_BYPASS` on `import.meta.env.DEV`** | 2 min | `useAuth.ts:16` |
| 7 | **Add HSTS + Permissions-Policy headers** | 5 min | `vercel.json` |
| 8 | **Hash OTPs before DB storage** | 30 min | `process-withdrawal/index.ts:298` + migration |
| 9 | **Add auth to `health-check`** | 5 min | `health-check/index.ts` |
| 10 | **Add admin check to engagement callbacks** | 10 min | `trade-webhook/index.ts:413` |
| 11 | **Add fail-loud for `WALLET_ENVIRONMENT` in `auth-exchange`** | 5 min | `auth-exchange/index.ts:184` |

---

## 7. Positive Observations

- **Email HMAC IDOR** (the highest-risk prior issue) confirmed still fixed and correctly implemented.
- **Zero XSS sinks** in all frontend source code.
- **process-withdrawal** has excellent security depth: OTP + rate limiting + daily limit + balance check at execute time + concurrency guard + WALLET_ENVIRONMENT fail-loud.
- **payment-webhook** correctly reads raw body before signature verification, proper idempotency.
- **RLS** confirmed on all financial tables. No `USING (true)` bypass policies found.
- **SECURITY DEFINER views** all converted to SECURITY INVOKER in prior migration.
- **Source maps** correctly set to `hidden` + deleted post-Sentry-upload.
- **Telegram bot admin webhook** correctly validates both the webhook secret AND the chat ID — double-layered.
- **trade-webhook** has full sanitizeError() preventing stack trace leakage.
- **Privy HSM** model confirmed — no private keys in Supabase, agent wallets cannot sign withdrawal-class transactions beyond `withdraw3`.
