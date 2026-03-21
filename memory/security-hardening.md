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

### Open Items

- `max_active_positions` values under review (current: free=1, standard=2, premium=5)
- Staging service role key removed from `.env` but key itself not rotated (low priority, never committed to git)
- Prod E2E test fixtures need real profile rows (foreign key constraint failures)
- Monthly security audit scheduled: 1st of every month at 9 AM

### Scheduled Audit

`monthly-security-audit` task runs 1st of every month. Full STRIDE + OWASP sweep with regression checks against prior findings.
