# Security Hardening

Security audit findings, fixes, and ongoing hardening for the Vela platform.

## STRIDE + OWASP Audit (2026-03-18)

Full audit covering both frontend (crypto-agent-frontend) and backend (crypto-agent) repos.

### Critical Fix: Email HMAC IDOR

**Problem:** `generateHmac(proposalId, action)` produced tokens not bound to any user. The email handler in `trade-webhook` skipped ownership checks for the email path (`authenticatedUserId` was undefined). A leaked/forwarded email link could accept or decline any user's trade proposal.

**Fix (shipped 2026-03-18):**
- `generateHmac(userId, proposalId, action)` — HMAC now signs `userId:proposalId:action:expiry`
- `verifyHmac(userId, proposalId, action, token)` — verification requires userId
- Email action links include `user_id` query param
- `handleEmailAction()` extracts userId from URL, passes to `processProposalAction()` as `authenticatedUserId`
- Ownership check now enforced for all 3 paths (frontend JWT, Telegram ID resolution, email HMAC)

**Files:** `_shared/notify.ts`, `trade-webhook/index.ts`

### Rate Limit Abuse Alerting (2026-03-18)

Added admin Telegram alerting to `rate-limiter.ts`:
- In-memory hit counter per `endpoint:identifier` key
- Alert threshold: 5+ hits triggers admin Telegram
- 10-minute cooldown between alerts for same identifier
- Fire-and-forget (doesn't block responses)
- Resets on cold start (acceptable — DB-backed counters handle actual limiting)

### APP_BASE_URL Fail-Loud Guard (2026-03-18)

`formatProposalEmail()` in `notify.ts` throws if `APP_BASE_URL` is missing or contains "localhost" in non-development environments. Prevents silently broken email action links in staging/production.

### Audit Summary — No Issues Found

- **Frontend:** Zero XSS sinks (no dangerouslySetInnerHTML/innerHTML/eval), no open redirects, proper CSP headers, source maps hidden + deleted post-Sentry-upload, all secrets properly prefixed
- **SQL injection:** All queries via Supabase PostgREST (parameterized)
- **Auth:** Privy ES256 + custom HS256 JWT + timing-safe HMAC comparison
- **RLS:** All user-scoped tables enforce `auth.jwt() ->> 'sub' = user_id`
- **Webhooks:** Stripe signature, Telegram secret, email HMAC all verified
- **Wallets:** Private keys never stored locally (Privy HSM), agent wallets can't withdraw

### Open Items (post 2026-03-18)

- `max_active_positions` values under review (current: free=1, standard=2, premium=5)
- Staging service role key removed from `.env` but key itself not rotated (low priority, never committed to git)
- Prod E2E test fixtures need real profile rows (foreign key constraint failures)
- Monthly security audit scheduled: 1st of every month at 9 AM

### Scheduled Audit

`monthly-security-audit` task runs 1st of every month. Full STRIDE + OWASP sweep with regression checks against prior findings.

---

## STRIDE + OWASP Audit (2026-05-06)

Full report: `docs/security-audits/2026-05-06-monthly-audit.md`

### Critical Finding: run-signals Has No Authentication

**Problem:** `supabase/functions/run-signals/index.ts` has no auth check at all. Any caller can POST to the endpoint and trigger the full signal engine — including trade execution for all `full_auto` users, proposal generation, and Telegram/email notifications to all users. No rate limit, no credentials required.

**Status: OPEN — must fix before next cron window.**

Fix: Add service role key check at handler entry (same pattern as `market-context-refresh:58-65`).

### High Findings: 11 additional edge functions lack authentication

Several cron-triggered functions (email senders + LLM callers) have no auth check, making them publicly callable:
- `asset-intel-generate` — triggers LLM calls, bypasses 60-min dedup on `mode=manual`
- `proposal-reminder` — spams reminder emails to all users with pending proposals
- `weekly-recap` — spams recap emails to entire user base
- `subscription-reminders`, `daily-digest`, `position-holder-brief` — similar mass-email risk

Fix: Service role key check on all of them (5 min each).

### High Finding: npm audit — 1 critical + 2 high transitive vulnerabilities

- Critical: `protobufjs@7.5.4` via `posthog-js` → OpenTelemetry (not processing user data, low practical risk)
- High: `lodash@4.17.23` via `@privy-io/react-auth` → `@metamask`
- High: `defu@6.1.4` via `@privy-io/react-auth` → `@walletconnect`
- Fix: `npm audit fix` after testing Privy/WalletConnect compat.

### Medium Finding: Ownership check runs after DB update in processProposalAction

`trade-webhook/index.ts:119-166` — status is updated BEFORE ownership check. Revert is fire-and-forget (error unchecked). If revert fails, proposal state is corrupted permanently with no alert.
Fix: Add `.eq("user_id", authenticatedUserId)` to the initial UPDATE.

### Medium Finding: withdrawal_otps stored in plaintext

`withdrawal_otps.code` column is plaintext. Fix: Hash before storage.

### Low Findings

- Missing HSTS header in `vercel.json`
- Missing Permissions-Policy header in `vercel.json`
- `DEV_BYPASS` not gated on `import.meta.env.DEV` in `useAuth.ts:16`

### Regression Check

All prior fixes confirmed still in place:
- Email HMAC IDOR: CONFIRMED FIXED
- APP_BASE_URL fail-loud (in formatProposalEmail): CONFIRMED
- Rate limit abuse alerting: CONFIRMED
- WALLET_ENVIRONMENT fail-loud in process-withdrawal: CONFIRMED
- RLS + SECURITY DEFINER view fixes: CONFIRMED

Soft regression: `auth-exchange` still does soft-skip on missing `WALLET_ENVIRONMENT` (doesn't default to testnet, but silently skips wallet provisioning). Fix: throw rather than warn.
