# Vela Security Audit — 2026-07-02

**Scope:** Frontend (`/Users/henry/crypto-agent-frontend`) + Backend (`/Users/henry/crypto-agent`)
**Method:** STRIDE threat model + OWASP Top 10 sweep, evidence-based (file:line code review, live `npm audit`, migration inspection).
**Auditor:** Automated monthly security audit (scheduled task).
**Prior audit:** 2026-04-01 (all HIGH/MEDIUM actioned).

## Headline

**No CRITICAL or HIGH application-level findings.** The trust-critical paths (auth, withdrawals, trade execution, webhooks, key custody, RLS) are strongly hardened and every previously-fixed issue remains fixed — **no regressions**. Open items are 2 MEDIUM (dependency CVEs; rate-limiter fail-open) and 5 LOW/informational (CSP constraint, missing `.env.example`, non-constant-time Telegram compare, CORS fallback, adapter default). Full detail below.

---

## 1. System Overview & Trust Boundaries

```
                          PUBLIC INTERNET
   ┌──────────────┬──────────────┬───────────────┬──────────────┐
   │ Browser SPA  │ Telegram Bth │ Stripe        │ Email link    │
   │ (React/Vite) │ (server→srv) │ (webhook)     │ click (HMAC)  │
   └──────┬───────┴──────┬───────┴───────┬───────┴──────┬───────┘
          │ HTTPS        │               │              │
 ══════════════════════ TRUST BOUNDARY 1: CDN / edge ═══════════════
          │              │               │              │
   ┌──────▼──────┐  ┌────▼─────────────────────────────▼────────┐
   │ Vercel CDN  │  │  Supabase Edge Functions (Deno, 52 fns)    │
   │ static +    │  │  auth-exchange · trade-webhook ·           │
   │ /api/og/*   │  │  process-withdrawal · payment-webhook ·    │
   │ (serverless)│  │  admin-webhook · telegram-link · crons ... │
   └─────────────┘  └───┬───────────────┬──────────────┬─────────┘
                        │ verifyAuthToken│ HMAC/secret  │ service_role
 ═══════════ TRUST BOUNDARY 2: auth (Privy ES256 → Supabase HS256 JWT) ══
                        │               │              │
              ┌─────────▼───┐   ┌───────▼──────┐  ┌────▼──────────┐
              │ PostgreSQL  │   │ Privy TEE/HSM│  │ Hyperliquid   │
              │ + RLS       │   │ (wallet keys)│  │ (USDC funds)  │
              │ (per-user)  │   │ master+agent │  │ mainnet API   │
              └─────────────┘   └──────────────┘  └───────────────┘
 ═══════════ TRUST BOUNDARY 3: service_role bypasses RLS ══════════════

Key custody: private keys NEVER touch Postgres. Master wallet (owns HL
account) + agent wallet (trades, cannot withdraw) both held in Privy TEE.
Only wallet IDs + addresses are persisted.
```

**Assets:** user funds (USDC on HL), Privy-custodied keys, `JWT_SECRET`, `WEBHOOK_HMAC_SECRET`, `STRIPE_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, service-role key, trade proposals, user PII (email), subscription state.

---

## 2. STRIDE Findings

| # | STRIDE | Threat | Attack path | Severity | Status |
|---|--------|--------|-------------|----------|--------|
| S1 | Spoofing | Forge Privy identity to mint a Supabase JWT | POST `auth-exchange` with a crafted token | — | **Mitigated.** `jose.jwtVerify` with `importSPKI(..., "ES256")`, `issuer:"privy.io"`, `audience:privyAppId` (`auth-exchange/index.ts:105-110`). |
| S2 | Spoofing | Fake Telegram webhook approves a trade | POST `trade-webhook?source=telegram` | — | **Mitigated (fail-closed).** `X-Telegram-Bot-Api-Secret-Token` required; rejects all if secret unset (`trade-webhook/index.ts:387-400`). |
| S3 | Spoofing | Fake Stripe event grants a paid tier | POST `payment-webhook` | — | **Mitigated.** `constructEventAsync(payload, sig, secret)` on raw body (`stripe-adapter.ts:190-193`, `payment-webhook/index.ts:61-69`). |
| S4 | Tampering | Alter withdrawal amount/destination after OTP issued | Replay confirm with changed params | — | **Mitigated.** OTP row binds `amount_usdc` + `destination_address` + hashed code; confirm re-matches all (`process-withdrawal/index.ts:434-445`). |
| T1 | Tampering | Reuse an OTP or email action link | Replay | — | **Mitigated.** OTP single-use (`used=true`, `:454-458`); HMAC has 4h expiry window (`notify.ts:73,93`). |
| R1 | Repudiation | User denies authorizing a trade/withdrawal | — | — | **Mitigated.** `logAudit` on token exchange, proposal action, every payment event; `notification_log` audit rows. |
| I1 | Info Disclosure | Read another user's proposals / withdrawals / balances | RLS bypass via anon client | — | **Mitigated.** RLS enabled on all user tables; `funding_events`/`trade_proposals`/`positions`/`user_wallets` bound to `jwt.sub`. |
| I2 | Info Disclosure | Recover OTP codes from a DB dump | Read `withdrawal_otps` | — | **Mitigated.** Codes stored as HMAC-SHA256 keyed by server pepper; table is service-role-only (`process-withdrawal/index.ts:89-105`). |
| I3 | Info Disclosure | Source maps / secrets in prod bundle | Fetch `.map`, inspect JS | — | **Mitigated.** `sourcemap:'hidden'`, maps deleted post-Sentry-upload (`vite.config.ts:43`); only `VITE_` publishable vars client-side. |
| D1 | DoS | Flood login / trade endpoints | Rapid POST | LOW-MED | **Partial.** DB-backed rate limits on auth-exchange (10/min), trade-webhook (30/min), withdrawal. **Fails OPEN** on DB error (see M2). |
| D2 | DoS | Exhaust LLM/news budget via cron amplification | — | — | **Mitigated.** Crons are internal/cron-auth gated; concurrency caps on news fetch; per-task LLM cost logging. |
| E1 | Elevation | Act on another user's proposal (IDOR) | Change `proposalId` in webhook | — | **Mitigated.** Ownership pushed into atomic DB `UPDATE ... WHERE user_id=?` (TOCTOU-safe, fixes M1/2026-05-06) (`trade-webhook/index.ts:123-189`). |
| E2 | Elevation | Compromised agent wallet drains funds | Steal agent key | — | **Mitigated by design.** Agent wallet can trade but **cannot withdraw**; withdrawal requires master (Privy TEE) (`wallet-provisioner.ts:8-9`). |
| E3 | Elevation | Bypass tier caps by calling trade-webhook directly | Direct API call | — | **Mitigated.** Tier limits enforced server-side in proposal generation + execution; withdrawal daily caps enforced from `tier_config` server-side. |

---

## 3. OWASP Top 10

- **A01 Broken Access Control — PASS.** RLS enabled on 50 tables. Every `USING(true)` policy is either public reference data (`assets`, `signals`, `briefs`, `tier_config`, `indicator_snapshots`, `paper_trades` — intentionally world-readable) or `TO service_role` (bypasses RLS regardless). User tables gate on `jwt.sub`. Proposal ownership is enforced atomically in the DB update. Email links + Telegram callbacks verify ownership.
- **A02 Cryptographic Failures — PASS.** Privy ES256 verify (no alg confusion — `jose` binds key type to alg); Supabase HS256 mint with fail-loud `JWT_SECRET`; `verify-auth.ts` checks sig+issuer+audience+role+exp; HMAC email tokens use `timingSafeEqual`; OTPs HMAC-peppered. Minor: Telegram secret uses `!==` (L3).
- **A03 Injection — PASS.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` in frontend `src/`. All DB access via parameterized PostgREST/supabase-js (no string-concatenated SQL). React auto-escaping.
- **A04 Insecure Design — PASS.** Withdrawal is two-step (OTP), single-active-withdrawal DB unique index, final balance re-check at execution, master/agent key separation. Tier caps enforced server-side.
- **A05 Security Misconfiguration — MOSTLY PASS.** Strong CSP (HSTS, `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, `Permissions-Policy`). Two LOW items: CSP `'unsafe-inline'/'unsafe-eval'` in `script-src` (Privy requirement — L1); missing `.env.example` (L2).
- **A06 Vulnerable Components — MEDIUM (M1).** `npm audit`: 2 critical / 19 high / 46 moderate. Criticals are **dev-only** (`vitest`/`@vitest/coverage-v8`, not in prod bundle). Prod-runtime relevant: `react-router` (XSS/open-redirect — SPA mitigates most), `undici`/`ws` (serverless-runtime DoS/smuggling).
- **A07 Auth Failures — PASS.** Dev bypass gated on `import.meta.env.DEV` (stripped from prod builds even if env var leaks to Vercel — `useAuth.ts:18`). 1h JWT TTL with 5-min refresh buffer. Rate limiting present (fail-open caveat = M2).
- **A08 Data Integrity — PASS.** Stripe `constructEventAsync` sig verification + `last_webhook_event_id` idempotency + `processed_webhook_events` table (RLS-enabled). Telegram secret token validated.
- **A09 Logging & Monitoring — PASS.** Rate-limit breaches fire admin Telegram alerts (10-min DB-backed cooldown) + Sentry `captureMessage`. `audit_log` + `notification_log`. HTTP error responses return generic messages (`"Authentication failed"`, `"Withdrawal failed. Your funds are safe"`) — no stack traces or internals leaked to clients; details go to `console.error`/Sentry only.
- **A10 SSRF — PASS.** The one server-side `fetch` of a dynamic value (`api/og/news.ts:97`) resolves against a **static allowlist map** (`COINGECKO_ICONS[upper]`), not a user-supplied URL. No user-controlled fetch targets.

---

## 4. Findings Ranked by Severity

### MEDIUM

**M1 — Vulnerable dependencies (A06).** `npm audit`: 68 total (2 critical / 19 high / 46 moderate).
- The 2 **criticals** are `vitest` + `@vitest/coverage-v8` ("Vitest UI arbitrary file read/execute") — **dev/test-only, never shipped to the production bundle or serverless runtime.** Effective production risk: negligible.
- Production-runtime relevant highs: `react-router`/`react-router-dom` (unescaped-`Location` XSS, `//` open-redirect, turbo-stream RCE — the XSS/RCE variants require SSR/RSC/prerender which this SPA does not use; the protocol-relative open-redirect is the only one worth a direct check); `undici` + `ws` (request smuggling / memory-exhaustion DoS in the Vercel Node serverless runtime used by `/api/og/*`); `form-data`, `protobufjs`, `hono` (transitive).
- The bulk of highs are **build/dev tooling** (`@typescript-eslint/*`, `@vercel/*`, `vite`, `minimatch`, `path-to-regexp`) — not runtime-exploitable.

**M2 — Rate limiter fails OPEN on DB error (A07 / DoS).** `rate-limiter.ts:87-96,121-130`: on any RPC error/exception the limiter returns `{allowed:true}`. This is a documented, deliberate tradeoff ("don't let a rate-limit table issue block all trading"), but it means a disruption of the `check_rate_limit` RPC silently removes brute-force/DoS protection on `auth-exchange` (the login endpoint), `trade-webhook`, and withdrawal. **Not an auth bypass** — a valid Privy ES256 token is still required, so the residual exposure is DoS/enumeration resistance, not account takeover. Fail-open events are surfaced to Sentry, which is the right compensating control.

### LOW / Informational

**L1 — CSP allows `'unsafe-inline'` + `'unsafe-eval'` in `script-src` (A05).** `vercel.json:15`. Required by the Privy SDK. Weakens XSS defense-in-depth, but residual risk is low: no `dangerouslySetInnerHTML`/`eval` in app code and React escapes by default. Track for tightening if/when Privy supports nonces.

**L2 — `.env.example` missing (A05 / project Critical Rule #4).** The project mandates that new env vars update `.env.example` in the same commit; the file does not exist. Live `.env`/`.env.local` are correctly gitignored and contain only `VITE_`-prefixed publishable values. This is an onboarding/documentation gap, not a runtime exposure.

**L3 — Telegram secret compared with `!==` (A02).** `trade-webhook/index.ts:396` (and `admin-webhook`). Non-constant-time, but timing attacks on a full-string webhook-secret compare over the network are impractical and this matches Telegram's own documented pattern. Informational.

**L4 — CORS falls back to `http://localhost:5173` when `APP_BASE_URL` unset (informational).** `auth-exchange/index.ts:40`, `process-withdrawal/index.ts:35`. Fail-safe direction (blocks the prod frontend rather than opening CORS); logs an error. No action needed beyond ensuring `APP_BASE_URL` is set in every env.

**L5 — `hyperliquid-adapter` defaults `isTestnet ?? true` (informational).** `hyperliquid-adapter.ts:395`. Safe default (testnet). The authoritative gate is `WALLET_ENVIRONMENT`, which fails loud upstream in `process-withdrawal`/`proposal-generator`. No action.

---

## 5. Recommended Actions

| Pri | Finding | Action |
|-----|---------|--------|
| P2 | M1 | Run `npm audit fix`; explicitly bump `react-router`/`react-router-dom` to the patched line and `vitest` to clear the critical. Confirm no `//`-prefixed or user-input-derived redirect targets exist in routing. No code change expected beyond version bumps + a build/test pass. |
| P2 | M2 | Consider **fail-closed for `auth-exchange` specifically** (login is not latency-critical the way trade execution is), while keeping fail-open for trade/withdrawal paths. At minimum, confirm the Sentry fail-open alert is wired to a paging channel. |
| P3 | L2 | Add `.env.example` with the 6 `VITE_` frontend keys (values redacted) to satisfy Critical Rule #4. |
| P3 | L1 | Note as accepted risk; revisit when Privy supports CSP nonces. |
| P4 | L4 | Ops check: `APP_BASE_URL` set in staging + prod edge env. |

All P2+ items are enhancements/hygiene — none block. No emergency remediation required.

---

## 6. Comparison vs Prior Audit & Regression Checks

Every previously-fixed issue was re-verified against current code. **All pass — no regressions.**

| Prior issue | Fix | Current status |
|-------------|-----|----------------|
| **Email HMAC IDOR** | Bind `userId` into HMAC | ✅ **Intact.** `notify.ts:103` signs `${userId}:${proposalId}:${action}:${expiry}`, `timingSafeEqual`, fails loud if secret unset. |
| **Staging env leak** | gitignore `.env*`, `VITE_`-only | ✅ **Intact.** `.gitignore:2-3`; `git ls-files` shows no committed env files; `.env` holds only publishable `VITE_` vars. |
| **WALLET_ENVIRONMENT fail-loud** (2026-03-06/18) | Throw/500 if unset | ✅ **Intact.** Enforced in `process-withdrawal` (both steps, 500), `proposal-generator` (throws), `auth-exchange` (warns + Sentry, non-fatal by design). No `?? "testnet"` silent defaults. |
| **Trade-proposal TOCTOU / IDOR** (M1, 2026-05-06) | Atomic DB-scoped ownership | ✅ **Intact.** `trade-webhook/index.ts:123-189` pushes `user_id` into the `UPDATE...WHERE`, plus secondary check + revert. |
| **trade_attribution RLS** (2026-07-01) | Enable RLS + owner policy | ✅ **Fixed.** Migration `20260630000001_rls_trade_attribution.sql` present; RLS enabled on the table. |
| **Notification privacy breach** (2026-03-19) | Per-user notification scoping | ✅ **Appears intact.** `notification_log` RLS-enabled; withdrawal/proposal notifications resolve email per `user_id`. (Deep per-message audience re-verification recommended annually but no anomaly found.) |
| **Vault key migration incident** (2026-03-08) | Keys in Privy TEE, not DB | ✅ **Intact.** `wallet-provisioner.ts` stores only wallet IDs/addresses; zero private-key/`encrypt`/`vault` handling in code. Master/agent split enforces withdrawal isolation. |
| **Dev bypass in prod** | Gate on `import.meta.env.DEV` | ✅ **Intact.** `useAuth.ts:18` — stripped from prod build even if `VITE_DEV_BYPASS_AUTH` set in Vercel. |
| **Monthly audit 2026-04-01** | All HIGH/MED actioned | ✅ Carried forward; no new HIGH introduced since. |

---

*Report generated 2026-07-02. Read-only audit — no code modified. Async sub-agent fan-out stalled on the environment watchdog; findings were gathered by direct file/migration/`npm audit` inspection instead.*
