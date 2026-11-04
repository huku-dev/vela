# Monthly Security Audit: 2026-11-02

**Scope:** Both repos. `crypto-agent-frontend` at `origin/main` `a011dfc` (React / Vite / Supabase / Vercel) and `crypto-agent` at `c5d4b64` (= `origin/main`; 61 Supabase Edge Functions in the repo, Deno, PostgreSQL).
**Prior audit:** [2026-10-01](2026-10-01-monthly-audit.md) (baseline). Also on file: [2026-09-01](2026-09-01-monthly-audit.md), [2026-08-02](2026-08-02-monthly-audit.md), [2026-07-02](2026-07-02-monthly-audit.md), [2026-05-06](2026-05-06-monthly-audit.md).
**Baseline completeness:** 2026-04 and 2026-06 have no report on `origin/main`. Recovery re-attempted this run (`git log --all` on both paths, 20 stash entries inspected, `fsck --lost-found`): nothing found, consistent with the README. Comparisons in this report are against 2026-10-01, which is the correct immediate baseline, so the gap does not affect this month's regression table.
**Method:** Isolated worktree off `origin/main` (Part 0). Live catalog, advisor, grant, policy, view, vault-metadata, cron-run and heartbeat queries against prod `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw` via Supabase MCP. Handler-scoped auth sweep of every `Deno.serve` body plus a **deployed-vs-repo function diff on both projects** (the check the October run could not complete). Targeted review of every file touched since 2026-10-01 in the money-flow and auth paths (90 backend commits, 10 frontend files). `npm audit`. All queries and source review ran 2026-11-02.

---

## 0. Report durability

Third consecutive month the worktree + branch + PR mechanism delivered the prior report on `main` with no recovery step. This report follows the same path.

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
│ SUPABASE EDGE LAYER                                        │◄────┘
│  Repo: 61 fns, 60/61 gated in-handler ✓ (uptime-probe is   │
│    the only allowlisted public fn; Oct M2 closed)          │
│  deploy.sh auth preflight ✓ (repo functions only)    L1    │
│  ⚠ DEPLOYED BUT NOT IN REPO (invisible to preflight):      │
│    prod:    test-emails (NO AUTH, sends branded email to   │
│             any address) H1 · nim-probe · register-webhook │
│    staging: send-test-email (NO AUTH) · model-comparison-  │
│             test (NO AUTH, 3 paid LLM calls/req) ·         │
│             admin-bulk-cancel (mainnet HL reach) ·         │
│             register-webhook-temp                    M1    │
│  Auth boundary : Privy ES256 → HS256 JWT 1h (auth-exchange)│
│  Financial     : JWT + peppered OTP + daily cap re-checked │
│                  at confirm ✓ (Oct H1/M1 closed)           │
│  Webhook       : Stripe sig / Swapped HMAC / TG secret ✓   │
│  Cron          : X-Cron-Secret, timing-safe, fail-closed ✓ │
│    ⚠ one shared secret now gates 33 fns incl. 4 trade /    │
│      SL-modifying paths                              M2    │
└───────────────────────────────────────────────┬────────────┘
                                               │ service_role
┌───────────────────────────────────────────────▼────────────┐
│ SUPABASE POSTGRES: RLS on every public base table ✓        │
│  pg_cron: 0 literal secrets, 34/34 HTTP jobs vault ✓       │
│  ALTER DEFAULT PRIVILEGES locked for postgres role ✓       │
│  Backend-only tables: 0 anon/auth grants ✓ (Oct M3 closed) │
│  ⚠ legacy ALL grants on 19 frontend tables/views; RLS is   │
│    SELECT-only on all of them (live), so inert today  M3   │
│  Privy HSM (keys never extracted) ✓ · HL withdraw3-scoped ✓│
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Live Infrastructure Queries (both projects)

| Check | Prod | Staging |
|---|---|---|
| pg_cron literal `Bearer` secrets (2026-05-07 incident class) | **0 rows**. 45 jobs; all 34 HTTP jobs `uses_vault_lookup=true`, `has_literal_secret=false` | **0 rows**. Same shape, most HTTP jobs inactive by design |
| Supabase advisors: ERROR | 0 | 0 |
| Supabase advisors: WARN | 31 (10 anon GraphQL, 20 authenticated GraphQL, 1 `claim_trial` known-benign). Down from 36: the four backend tables revoked in Oct M3 left the schema | 1 (`claim_trial`) |
| Supabase advisors: INFO `rls_enabled_no_policy` | 23 (all intended deny-all backend tables) | 23 |
| RLS enabled | Every base table in `public` | Every base table |
| Backend-only table grants to anon/authenticated | **None.** `admin_alert_history`, `dashboard_curated`, `wallet_migration_log` revoked; `cctp_transfers` anon revoked (migration `20261004000001`, live-verified) | Same |
| Default privileges (`pg_default_acl`) for the migration role `postgres` | Tables / sequences / functions: `postgres` + `service_role` only. anon/authenticated removed ✓ (`supabase_admin`'s own defaults still name anon/authenticated; Supabase-managed role, informational L8) | Same |
| `USING (true)` policies to non-service roles | SELECT only, on intentional public product data (`assets`, `briefs`, `indicator_snapshots`, `news_cache`, `paper_trades`, `release_notes`, `signals`, `tier_config`, `signal_performance`, `signal_reviews`, `trade_postmortems`) | Same. **Staging `paper_trades` public UPDATE policy is gone** (Oct M5 fixed) |
| Write policies for authenticated on user tables | Only `user_preferences` (INSERT/UPDATE own) and `profiles` (UPDATE own, column-scoped). `positions`, `trade_proposals`, `user_wallets`, `funding_events`, `audit_log`, `cctp_transfers`, `circuit_breaker_events`, `user_subscriptions` are SELECT-own-rows only | Same, plus `brief_ratings` |
| Views exposed to anon (`latest_briefs`, `latest_digest`, `latest_signals`, `paper_trade_stats`) | All `security_invoker=on`, `is_updatable=NO` ✓ | Same, plus `open_paper_trades` (updatable, `security_invoker=true`; writes transit to `paper_trades` under anon, blocked by its SELECT-only RLS) |
| anon-executable RPCs | 12, all `SECURITY INVOKER` (pre-date the default-privilege lock; unchanged set) | Same |
| Deployed edge functions vs repo (61 in repo) | **64 deployed: 3 orphans** (`test-emails`, `nim-probe`, `register-webhook-temp`) | **65 deployed: 4 orphans** (`send-test-email`, `admin-bulk-cancel`, `model-comparison-test`, `register-webhook-temp`) |
| Legacy `Authorization`-only crons actually succeeding (Oct L3) | **Yes.** All 202 `net._http_response` rows in the last 24h are status 200; the 8 active legacy jobs (`asset-intel-generate`, `daily-digest`, `health-check`, `position-holder-brief`, `run-signals-4h`, `-batch2`, `subscription-reminders`, `weekly-recap`) all ran within the last 24h with `succeeded` | n/a (inactive) |
| Vault `service_role_key` last updated | 2026-05-07 14:07 UTC (prod). No rotation since the Aug / Sept / Oct recommendations | 2026-03-08 (never rotated) |
| Vault `cron_shared_secret` last updated | 2026-05-07 (64 chars). Never rotated | 2026-05-07 |

---

## 3. Findings Ranked by Severity

### CRITICAL

None.

### HIGH

#### H1: Orphan production function `test-emails` is unauthenticated and sends ten branded transactional emails to any caller-supplied address (new; invisible to every prior audit)
- **Where:** deployed on prod only, slug `test-emails`, `verify_jwt=false`, created 2026-03-12, version 52, never updated. **Not in the repo** (`git log --all` has no `supabase/functions/test-emails`), so the September deploy preflight, the October handler sweep and `verify-deployment.sh` (which only checks repo → deployed, `scripts/verify-deployment.sh:145-154`) all had no way to see it.
- **Handler (retrieved via `get_edge_function`):** the header comment says `-H "Authorization: Bearer <service_role_key>"` but the code never reads the header. `Deno.serve` → `POST` check → `const { email } = await req.json()` → calls `sendSubscriptionConfirmationEmail`, `sendSubscriptionRenewedEmail`, `sendRenewalReminderEmail`, `sendPlanExpiredEmail`, `sendPlanUpgradedEmail`, `sendPaymentFailedEmail`, `sendWelcomeEmail`, `sendTradeExecutedEmail`, `sendPositionTrimmedEmail`, `sendPositionClosedEmail` with that address, through a bundled 8-month-old snapshot of `_shared/notify.ts` and the production `RESEND_API_KEY`.
- **Attack path:** `curl -X POST https://dikybxkubbaabnshnreh.supabase.co/functions/v1/test-emails -d '{"email":"victim@example.com"}'`. No key, no rate limit. Each call sends ten emails from `alerts@getvela.xyz` ("Your trade was executed", "Payment failed", "Your plan has expired", ...) to any inbox. Looped, it is an open relay for brand-impersonating mail.
- **Impact:** Resend quota drain and, more importantly, **sender-domain reputation**: spam complaints against `getvela.xyz` degrade or suspend delivery of the real OTP, trade and subscription emails. Confusing financial-sounding emails to third parties is also a trust and abuse-report problem. No funds or user data are reachable, which is why this is HIGH rather than CRITICAL.
- **Fix (5 min):** `supabase functions delete test-emails --project-ref dikybxkubbaabnshnreh`. Then the structural fix in M1.
- Confidence: high (source read directly; no auth statement exists in the handler).

#### H2: `npm audit` 106 vulnerabilities (4 critical, 51 high), sixth consecutive increase
- May 24 → Aug 71 → Sept 75 → Oct 79 → **now 106** (4 crit / 51 high / 50 mod / 1 low). Direct dependencies with advisories: `@privy-io/react-auth`, `@vercel/node`, `react-router-dom`, `sharp`, `vite`, `vitest`, `@vitest/coverage-v8`, `@typescript-eslint/*`, `posthog-js`, `satori`, `@sentry/vite-plugin`, `eslint*`. Criticals (`vitest`, `@vitest/coverage-v8`, `tinypool`, `tar`) remain dev/build-time. New production-relevant highs since October: `dompurify`, `zod`, `viem`, `js-cookie`, `nanoid`, `query-string` (all transitive under Privy / WalletConnect / Reown).
- **What changed for the better:** `.github/dependabot.yml` landed in October (weekly, grouped minor/patch, vitest majors deliberately ignored with a written reason). **What did not:** 8 Dependabot PRs are open and 0 have merged (`huku-dev/vela` #31-#45, 2026-10); the two vitest-major PRs were closed unmerged. The tooling is now in place; the backlog is the finding.
- **Fix:** merge the grouped runtime PR (#43) and dev PR (#36) after CI, then the `npm_and_yarn` security group (#45); schedule the vitest 1 → 5 migration the dependabot comment already describes. Re-test login, build, OG rendering. Record the residual next month.

### MEDIUM

#### M1: Six further orphan deployed functions, two of them unauthenticated on staging; no deployed-vs-repo check exists (new)
Retrieved and read via `get_edge_function`:

| Function | Project | Created | Auth | Reach |
|---|---|---|---|---|
| `send-test-email` | staging | 2026-03-06 | **none** (`serve(async () =>`) | Sends a fixed email to the operator's inbox via `RESEND_API_KEY` on every call. Inbox spam + Resend quota; same sending domain as prod |
| `model-comparison-test` | staging | 2026-06-10 | **none** | Fires one Groq, one NVIDIA and one **Anthropic** (`claude-haiku-4-5`) call per request, in parallel. Unauthenticated paid-LLM amplification; keys are the shared account keys |
| `admin-bulk-cancel` | staging | 2026-06-08 | `x-admin-secret` must equal `SUPABASE_SERVICE_ROLE_KEY` (fail-closed, non-timing-safe) | Reads `user_wallets` **`environment='mainnet'`**, instantiates the HL adapter via Privy and cancels every open trigger order on a builder dex for a caller-chosen `user_id`. Gated, but it is a mainnet-reaching, one-off tool left live for five months with the header comment "Delete this function after use" |
| `nim-probe` | prod | 2026-05-15 | service-role bearer, fail-closed | Arbitrary-prompt NVIDIA NIM call; spend only. Header: "One-shot diagnostic" |
| `register-webhook-temp` | prod + staging | 2026-03-13 | `verify_jwt=true` (gateway JWT check: **the public anon key satisfies it**) | Re-registers the Telegram bot webhook to `${SUPABASE_URL}/functions/v1/trade-webhook` with the real secret, but without the `?source=telegram` suffix DEPLOY.md documents and with `allowed_updates` reset. Idempotent today because `trade-webhook:938` accepts both forms; still a bot-token-wielding endpoint anyone with the anon key can fire |

- **Why MEDIUM:** nothing here reaches funds or user data unauthenticated; two are pure spend/spam amplifiers on staging and the rest are gated one-offs. The systemic point is the same shape as last year's ungated-function class: **every control (auth preflight, handler sweep, `verify-deployment.sh`) is derived from the repo, so anything deployed outside the repo is invisible to all of them.** Three of these pre-date every audit in the series.
- **Fix:**
  1. Delete all seven now (`supabase functions delete <slug> --project-ref <ref>`; `register-webhook-temp` on both projects). None is referenced by any script, migration or doc except a stale pointer in `docs/llm-routing-patterns.md:403`.
  2. Add the inverse diff to `verify-deployment.sh:145`: every slug in `supabase functions list` must have `supabase/functions/<slug>/index.ts`; fail with the orphan list otherwise. ~10 lines; the data is already fetched.
  3. Add "one-off functions get a deletion date in the header and a `verify-deployment` exception entry" to DEPLOY.md.

#### M2: `CRON_SHARED_SECRET` has become a trade-execution credential shared by 33 functions, never rotated (new framing)
- `verifyCronAuth` (`_shared/cron-auth.ts:34`) is now the gate on 33 handlers (October: ~20). Since the last audit that set gained **`execute-proposal`** (new 4th trade-execution path: `execute-proposal/index.ts:53`, takes a caller-chosen `user_id` and runs `executeTradeProposal` on that user's oldest auto-approved proposal), **`preopen-equity-sl-tighten`** (`:131`, modifies live stop-loss orders through `modifySLSafely` with the user's Privy agent wallet), `admin-resend-close` (`:82`), `hip4-book-logger` (`:85`), plus `scanner-30m` and the three staging E2E harnesses from October. The secret also travels: `execute-proposal-trigger.ts:35-47` reads it from env and sends it on every trade-webhook → execute-proposal hop, and `deploy.sh` resolves the staging value into its own process from the staging vault.
- Vault `cron_shared_secret` on both projects: created 2026-05-07, `updated_at` identical, never rotated. One leak (a log line, a Sentry breadcrumb, a transcript) is now out-of-schedule trade execution and SL manipulation for every user, not just a spurious news broadcast.
- **Why MEDIUM:** no exposure path was found; this is blast-radius growth of a single secret. Confidence moderate on severity.
- **Fix:** (a) split: a second secret (`TRADE_EXEC_SECRET`, env + vault) for the four money-moving handlers, sent only by their crons and by `execute-proposal-trigger`; (b) a rotation procedure for both in DEPLOY.md (`vault.update_secret` + `supabase secrets set` + redeploy, staging first), run once now; (c) never log the header value (grep confirmed no current logging of it).

#### M3: Legacy `ALL` grants remain on 19 frontend-facing tables and views, contradicting the SELECT-only intent documented in `20261020000001` (new)
- Live on both projects: `anon` holds `DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE` (plus SELECT) on `assets`, `briefs`, `paper_trades`, `release_notes`, `latest_briefs`, `latest_digest`, `latest_signals`, `paper_trade_stats`; `authenticated` holds the same on those plus `positions`, `trade_proposals`, `user_wallets`, `funding_events`, `audit_log`, `cctp_transfers`, `circuit_breaker_events`, `user_subscriptions`, `news_cache`, `signals`. These are Supabase's pre-October auto-grants; `20261020000001_grant_frontend_tables_explicit.sql` added explicit `GRANT SELECT` and its header states "authenticated SELECT only (RLS gates rows; no frontend write path)", but it never `REVOKE`d the surplus.
- **Live-verified inert today:** every one of those tables has SELECT-only policies for non-service roles (§2), so PostgREST writes are denied. `profiles` is correctly column-scoped (no table-level UPDATE; column UPDATE on `avatar_url`, `display_name`, `email`, `onboarding_completed`, `privy_wallet_address`, `updated_at`).
- **Why it matters:** this is exactly the defense-in-depth gap the 2026-07-13 standard was written for. A single future `CREATE POLICY ... FOR UPDATE USING (user_id = jwt.sub)` on `positions` (plausible for a "user edits their own stop" feature) would, with the table-level UPDATE grant already present, let users rewrite `entry_price`, `size`, `status` or `exchange_sl_order_id` directly, bypassing position-monitor. With grants revoked, the same policy mistake is a no-op. `TRUNCATE`, `TRIGGER` and `REFERENCES` are not governed by RLS at all (PostgREST does not expose them, so no API path today).
- **Fix (migration, both projects, with a verify block):**
  ```sql
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.assets, public.briefs, public.paper_trades, public.release_notes,
       public.latest_briefs, public.latest_digest, public.latest_signals, public.paper_trade_stats,
       public.news_cache, public.signals
    FROM anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.positions, public.trade_proposals, public.user_wallets, public.funding_events,
       public.audit_log, public.cctp_transfers, public.circuit_breaker_events, public.user_subscriptions
    FROM authenticated;
  -- keep: user_preferences (S/I/U/D), brief_ratings (staging), profiles column grants
  ```
  Staging additionally: `open_paper_trades` (anon ALL on an updatable view).

#### M4: `e2e-prod-test` remains a single-secret path to mainnet trades plus arbitrary-`sub` JWT minting (Oct M6, unchanged, now documented)
- `e2e-prod-test/index.ts:35-49` `mintJwt(userId)` signs with `JWT_SECRET` for whatever `body.user_id` the caller supplies (`:120`), used at `:136, :303, :406, :500`. Gate `requireE2ESecret` (`_shared/e2e-auth.ts:30-50`) is timing-safe and fails loud below 16 chars. DEPLOY.md:141 now documents the secret's handling (prod-only, typed into the operator shell, never through an agent): good. The `user_id` allowlist suggested in October is not implemented.
- Accept-or-fix decision still open. If accepted, record it in DEPLOY.md and this item drops to LOW next month.

#### M5: `auth-exchange` soft-skips wallet provisioning when `WALLET_ENVIRONMENT` is unset (Oct M7, unchanged; fifth audit)
- `auth-exchange/index.ts:207-219`: Sentry `captureMessage`, then login proceeds with no wallet and no user-visible state. Same recommendation: mark the profile "provisioning pending", surface it in the UI, retry on next login.

#### M6: `service_role` key rotation flagged 2026-05-07 / Aug / Sept / Oct is still not done (carried, now evidenced)
- Vault `service_role_key.updated_at` is 2026-05-07 14:07 on prod and 2026-03-08 on staging. The October run could not verify this; this run can. The key is `sb_secret_*` shaped (41 chars). The catalog exposure was removed in August; the residual is the transcript exposure the August report described, which cannot be ruled out. Rotate at the next window or record an explicit acceptance so the item stops recurring.

### LOW

- **L1: `deploy.sh` auth preflight is still a whole-file grep** (`scripts/deploy.sh:155-179`; Oct L1). It currently passes correctly on all 60 gated functions, but a comment containing `X-Cron-Secret` satisfies it. Anchor to the handler body.
- **L2: Non-timing-safe secret compares, unchanged:** nine raw `req.headers.get("Authorization") !== \`Bearer ${serviceKey}\`` handlers (`asset-intel-generate:133`, `daily-digest:79`, `daily-digest-preview:46`, `health-check:171`, `position-holder-brief:115`, `proposal-reminder:33`, `run-signals:100`, `subscription-reminders:22`, `weekly-recap:66`), `admin-webhook:465` (Telegram secret), `cron-auth.ts:42` legacy substring `.includes(legacyKey)` (the file says "Follow-up PR will remove the dead legacy branch"; it has not). **Oct L3 is resolved**: the eight active legacy-gated crons demonstrably return 200 (§2), so the `cron-auth.ts:1-19` claim that the gateway rewrites `Authorization` for `sb_secret_*` keys does not match current behaviour for these jobs. Either migrate the nine to `verifyCronAuth` (adding `X-Cron-Secret` to their cron commands via the `20261004000002` injection pattern) or correct the comment; today the comment would mislead the next person who debugs a 401.
- **L3: `profiles.email` and `profiles.privy_wallet_address` are user-writable** (column UPDATE grant + "Users can update own profile" policy). No backend code reads `profiles.privy_wallet_address` (grep: only `src/types.ts:156`), and notification routing uses `profiles.email` by design, so a user can only redirect their own notifications. Keep it that way: never let a future funds path trust either column. Consider revoking column UPDATE on `privy_wallet_address` since nothing writes it from the frontend.
- **L4: GraphQL schema discoverability**: 30 objects (10 anon, 20 authenticated), down from 35. Rows protected by RLS (live-verified). Remaining set is intentional public data plus user tables the SPA queries directly.
- **L5: CSP `'unsafe-inline'` + `'unsafe-eval'` in `script-src`** (`vercel.json`), Privy requirement, unchanged. Re-test on the H2 Privy bump.
- **L6: Rate limiter fails open on DB error** (`_shared/rate-limiter.ts:94-102, 128-136`), accepted by design, Sentry-alerted, unchanged.
- **L7: Frontend `.env.example` still absent** (Jul L2; CLAUDE.md Critical Rule #4 requires it). `.env` / `.env.local` hold only the nine `VITE_*` publishable values and are untracked.
- **L8: `supabase_admin` default ACL still grants anon/authenticated** on tables, sequences and functions. Migrations run as `postgres`, whose defaults are locked (`20261004000001`), so this only matters for objects Supabase itself creates. Informational.
- **L9: Staging-only objects persist**: `open_paper_trades` (updatable view, anon ALL grant) and `brief_ratings` do not exist on prod; `20261020000001` references both. The October policy drift (M5) is fixed; the object drift is not, and `verify-deployment.sh` still has no policy/object parity check.
- **L10: `attribution-compute` `backfill_since` now bounded** (`:28-29, :157-167`: ISO parse, 400-day floor, rejects future). Oct L5 closed; recorded here only so the regression table is complete.
- **L11: `funding_events` `processing` row still inserted before the `WALLET_ENVIRONMENT` check at confirm** (`process-withdrawal/index.ts:588-589` vs `:613-619`; Oct L6). Availability only (a misconfigured env leaves a row that the one-active-withdrawal index then enforces). Move the env read above the insert.
- **L12: Feed-sourced URL fetches without scheme/private-host guard** (`macro-enrich`, `sec-filing-enrich`, `_shared/article-fetcher.ts:87`; Oct L12), unchanged. Not caller-controlled.
- **L13: Stripe idempotency is last-event-id only** (`payment-webhook:132-150`; Oct L13), theoretical, unchanged.
- **L14: `register-webhook-temp` registers the Telegram webhook without `?source=telegram`** (covered in M1; harmless because `trade-webhook:938` accepts both).

---

## 4. STRIDE Summary

| Category | Threat | Attack path | Severity | Status |
|---|---|---|---|---|
| Spoofing / DoS | Send branded Vela emails to any address from the prod sender domain | POST orphan `test-emails` with `{email}` | **HIGH** | ❌ **H1** |
| DoS | Paid LLM spend (Anthropic/Groq/NVIDIA) per anonymous request | POST staging `model-comparison-test` | MEDIUM | ❌ **M1** |
| DoS | Spam operator inbox / Resend quota | POST staging `send-test-email` | MEDIUM | ❌ **M1** |
| Tampering | Cancel a mainnet user's open HL trigger orders | `admin-bulk-cancel` + service-role key | MEDIUM (gated) | ⚠️ **M1** (delete) |
| Tampering | Re-register Telegram webhook config | `register-webhook-temp` + anon key | LOW | ⚠️ **M1** (delete) |
| EoP / Tampering | Out-of-schedule trade execution or SL change for any user | Leak of one `CRON_SHARED_SECRET` | MEDIUM | ⚠️ **M2** (no leak found) |
| EoP | Future permissive policy becomes user-editable `positions` | One bad migration | MEDIUM | ⚠️ **M3** (inert today) |
| Spoofing / EoP | Forge JWT `sub`, execute mainnet trade | Hold `E2E_PROD_SECRET` | MEDIUM (accepted?) | ⚠️ **M4** gated + documented |
| Info Disclosure | service_role key from prior transcript exposure | Reuse key | MEDIUM | ⚠️ **M6** not rotated |
| Tampering / EoP | Exceed withdrawal daily cap via pre-minted OTPs | N OTPs, confirm sequentially | n/a | ✅ **FIXED** (Oct H1): cap re-checked at confirm incl. pending/processing (`limits.ts`, `process-withdrawal:531-573`) |
| Tampering | Double-spend one OTP | Concurrent confirm | n/a | ✅ **FIXED** (Oct M1): conditional burn + zero-row abort (`:489-502`) |
| Tampering / DoS | Drive staging testnet trades anonymously | POST e2e harnesses | n/a | ✅ **FIXED** (Oct M2): `verifyCronAuth` on all three; allowlist = `uptime-probe` |
| Info Disclosure / EoP | Backend tables with default grants | GraphQL / future policy | n/a | ✅ **FIXED** (Oct M3): revoked + `ALTER DEFAULT PRIVILEGES` |
| Spoofing | Post to X via engagement callback with env unset | Forged callback | n/a | ✅ **FIXED** (Oct M4): fail-closed (`trade-webhook:462-473`); `twitter-fetcher` on `verifyCronAuth` (`:353`) |
| Tampering | Rewrite staging paper-trade record | PostgREST UPDATE | n/a | ✅ **FIXED** (Oct M5): policy dropped, live-verified |
| EoP | Unattributed Telegram callback acts on a proposal | Callback without `from.id` | n/a | ✅ **FIXED** (Oct L4): rejected (`trade-webhook:577-581`) |
| Info Disclosure | service_role key from pg_cron catalog | `SELECT command FROM cron.job` | n/a | ✅ Holding: 0 literal secrets, both envs, third consecutive month |
| Tampering | Force out-of-schedule trade execution | POST `scanner-30m` / `execute-proposal` | n/a | ✅ `verifyCronAuth` first statement on both |
| Spoofing | Forged Telegram / Stripe / Swapped webhook | POST fake event | LOW | ✅ secret fail-closed / raw-body signature |
| Spoofing | Forged email action link | Guess HMAC | LOW | ✅ userId-bound, timing-safe (`notify.ts:82-161`) |
| Tampering | Cross-user proposal action | Direct call | LOW | ✅ ownership inside UPDATE WHERE |
| Info Disclosure | Cross-user data read | RLS bypass | LOW | ✅ RLS on all base tables; user tables SELECT-own only (live) |
| Info Disclosure | OTP theft from DB | Read `withdrawal_otps` | LOW | ✅ peppered HMAC-SHA256 |
| EoP | service_role key in frontend bundle | Inspect bundle | LOW | ✅ zero matches in `src/`, `api/` |
| EoP | Non-admin reaches admin dashboard | Call `admin-dashboard-data` | LOW | ✅ JWT + `privy_did` allowlist |
| Repudiation | No audit trail on trade actions | n/a | LOW | ✅ `logAudit()` + `notification_log` |

---

## 5. OWASP Top 10 Sweep

| Category | Status | Notes |
|---|---|---|
| **A01 Broken Access Control** | **PARTIAL** | Repo functions: 60/61 gated in-handler, all five October A01 items closed. Fails on the out-of-repo surface: H1 (unauthenticated prod email relay) and M1 (two unauthenticated staging functions). M3 is a defense-in-depth gap, inert today. RLS, ownership checks and HMAC binding sound and live-verified. |
| **A02 Cryptographic Failures** | PASS | Primitives unchanged and correct. M2 is key-scope management, M6 is rotation hygiene; neither is a primitive failure. L2 compares remain consistency items. |
| **A03 Injection** | PASS | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in frontend `src/` and `api/`; zero raw SQL or template-literal `.rpc` in Deno. The two `.or()` interpolations (`earnings-actuals-repoll:415`, `admin-dashboard-data/queries.ts:626`) use server-computed ISO strings. |
| **A04 Insecure Design** | PARTIAL (improved) | The October design gap (limit enforced at intent, not commit) is closed and the fix is unit-tested (`withdrawal-limits.test.ts`). Remaining design items: a single cron secret now spans non-money and money paths (M2); one-off functions have no lifecycle (M1). Tier / `max_active_positions` enforcement unchanged. |
| **A05 Security Misconfiguration** | PARTIAL | Frontend clean: no tracked env files, `sourcemap: 'hidden'` (`vite.config.ts:43`), full header set unchanged, `DEV_BYPASS` gated on `DEV` (`useAuth.ts:18`). Backend: seven orphan deployments (H1, M1), legacy grants (M3), staging object drift (L9), `.env.example` missing (L7). October's backend misconfigurations (default grants, staging policy, fail-open gates) are all fixed. |
| **A06 Vulnerable Components** | **FAIL** | 106 findings, 4 crit / 51 high, sixth consecutive increase (H2). Dependabot wired; nothing merged. |
| **A07 Auth Failures** | PASS (repo) / FAIL (orphans) | Every repo function authenticates; `verify-auth.ts` pins iss/aud/role; `cron-auth.ts` and `e2e-auth.ts` fail closed. `test-emails`, `send-test-email`, `model-comparison-test` have no authentication at all. |
| **A08 Data Integrity** | PASS | Stripe raw body before verify; Swapped HMAC; Telegram secret fail-closed; OTP burn now atomic (Oct M1 closed); L13 theoretical. |
| **A09 Logging & Monitoring** | PASS | Sentry on financial paths; rate-limit admin alerts; `cron_heartbeats` now carries 17 keys including the new `hip4-*` and `uptime-probe`; `health-check` alerts on `disabled` heartbeats. Gap closed this month: the deployed-function inventory is now part of the audit (and should be part of `verify-deployment.sh`, M1). |
| **A10 SSRF** | PASS | No request-derived host reaches `fetch()`. New functions: `hip4-book-logger` → fixed `api.hyperliquid.xyz/info`; `earnings-actuals-repoll:162` → fixed Finnhub base + DB-sourced ticker; `nim-probe` → fixed NVIDIA URL (body controls model/prompt only). L12 feed-sourced URLs unchanged. |

---

## 6. Regression Check vs. 2026-10-01

| October finding | Status now |
|---|---|
| **H1** withdrawal daily cap not re-checked at `confirm` | ✅ **FIXED**: `process-withdrawal/limits.ts` (`DAILY_LIMIT_COUNTED_STATUSES = completed, pending, processing`, cents arithmetic), applied at `:284-290` and `:567-573`; `withdrawal-limits.test.ts` |
| **H2** npm audit 79 | ❌ **WORSE**: 106 (**H2**); Dependabot added, 0 merged |
| **M1** OTP burn non-conditional | ✅ **FIXED**: `.eq("used", false).select("id")` + zero-row 401 (`:489-502`) |
| **M2** staging E2E harnesses anonymous | ✅ **FIXED**: `verifyCronAuth` on `e2e-trade-test:28`, `e2e-testnet-test:48`, `test-r2-tp-trim-during-trail:68`; `ALLOW_UNAUTHENTICATED` = `uptime-probe` only (`deploy.sh:162-168`) |
| **M3** default grants on four backend tables; no `ALTER DEFAULT PRIVILEGES` | ✅ **FIXED**: `20261004000001` (revokes + default-privilege lock + verify block), live-verified on both projects |
| **M4** two fail-open gates | ✅ **FIXED**: `twitter-fetcher:353` → `verifyCronAuth` (+ cron header injection `20261004000002`); engagement gate fail-closed (`trade-webhook:462-473`) |
| **M5** staging `paper_trades` public UPDATE | ✅ **FIXED**: dropped by `20261004000001`, live-verified. Object drift remains (**L9**) |
| **M6** `e2e-prod-test` single-secret mainnet + JWT mint | ⚠️ Unchanged, now documented in DEPLOY.md:141 (**M4**) |
| **M7** `auth-exchange` wallet soft-skip | ⚠️ Unchanged (**M5**) |
| **L1** preflight whole-file grep | ⚠️ Unchanged (**L1**) |
| **L2** non-timing-safe compares | ⚠️ Unchanged (**L2**) |
| **L3** legacy `Bearer` crons possibly 401ing | ✅ **RESOLVED (verified working)**: 202/202 HTTP responses 200 in 24h, all eight active jobs succeeded today. Comment in `cron-auth.ts` now inaccurate (**L2**) |
| **L4** Telegram callback without `from.id` | ✅ **FIXED**: `trade-webhook:577-581` |
| **L5** `backfill_since` unbounded | ✅ **FIXED**: `attribution-compute:28-29, :157-167` (**L10**) |
| **L6** `processing` row before env check | ⚠️ Unchanged (**L11**) |
| **L7** GraphQL discoverability 35 objects | ✅ Improved to 30 (**L4**) |
| **L8** CSP `unsafe-eval` | ⚠️ Unchanged (**L5**) |
| **L9** rate limiter fail-open | ✅ Accepted (**L6**) |
| **L10** anon-executable RPCs by default | ✅ **FIXED for the future** (`ALTER DEFAULT PRIVILEGES ... FUNCTIONS`); 12 pre-existing `SECURITY INVOKER` RPCs unchanged |
| **L11** `APP_BASE_URL` prod fallback | ✅ Recorded; no change needed |
| **L12** feed-sourced URL fetch | ⚠️ Unchanged (**L12**) |
| **L13** Stripe idempotency | ⚠️ Unchanged (**L13**) |
| Oct #12 service_role rotation | ❌ **NOT DONE**, now evidenced by vault `updated_at` (**M6**) |
| Oct coverage note: deployed-function cross-check not completed | ✅ **COMPLETED this run**: found 7 orphans (**H1**, **M1**) |

**Net:** 12 of October's 20 tracked items closed, including the HIGH money-flow item and every MEDIUM that had a code fix (M1-M5). The structural fix (`ALTER DEFAULT PRIVILEGES`) landed with a verify block. New this month: H1 and M1 come entirely from the one surface no prior audit could see (functions deployed outside the repo), M2 from the growth of the cron secret's reach, M3 from reading grants against the migration that documented them. npm audit has now worsened at every audit since May.

### Regression check vs. older fixed controls

| Control | Holds? | Evidence |
|---|---|---|
| Email HMAC userId-bound, timing-safe (2026-03) | ✅ | `notify.ts:82-161`; `trade-webhook:687, 746` verify before DB read |
| `WALLET_ENVIRONMENT` fail-loud in `process-withdrawal` | ✅ | `:294-300`, `:613-619`; also `preopen-equity-sl-tighten:170` |
| OTP hashed with pepper, throws if unset | ✅ | `process-withdrawal:89-105` |
| Rate-limit admin alerting with cooldown | ✅ | `rate-limiter.ts:98-124` |
| Telegram webhook fail-closed | ✅ | `trade-webhook:407-416`; `admin-webhook:456-467` |
| Ownership inside UPDATE WHERE (May M1) | ✅ | `trade-webhook:129-145` |
| Engagement callbacks admin-gated (May L4) | ✅ now fail-closed | `trade-webhook:462-473` |
| `DEV_BYPASS` gated on `DEV` (May L3) | ✅ | `useAuth.ts:18` |
| HSTS / Permissions-Policy / CSP / `frame-ancestors` (May L1/L2) | ✅ | `vercel.json` unchanged |
| Source maps hidden | ✅ | `vite.config.ts:43` |
| `trade_attribution` / `classifier_calibration` deny-all + zero grants (2026-07) | ✅ | Live: RLS on, 0 policies, no grants |
| pg_cron vault lookup (2026-05-07 / Aug C1) | ✅ | Live: 0 literal secrets, 34/34, both envs |
| Hooks `check-migration-security.sh`, `check-write-secrets.sh` | ✅ | Present in `.claude/hooks/` |
| Privy HSM: no key material / export path | ✅ | `wallet-provisioner.ts` unchanged in shape |
| `scanner-30m` / `e2e-prod-test` gates (Sept C1/C2) | ✅ | `scanner-30m:84`, `e2e-prod-test:105-124` |
| 13 cron/broadcast functions gated (Sept H1) | ✅ | All carry `verifyCronAuth`; sweep table in §2 of the audit worktree log |

---

## 7. Recommended Actions (Priority Order)

| # | Action | Effort | Location |
|---|---|---|---|
| 1 | **Delete `test-emails` on prod** (H1) | 2 min | `supabase functions delete test-emails --project-ref dikybxkubbaabnshnreh` |
| 2 | **Delete the six other orphans** (`nim-probe`, `register-webhook-temp` ×2, `send-test-email`, `model-comparison-test`, `admin-bulk-cancel`) (M1) | 10 min | `supabase functions delete <slug> --project-ref <ref>` |
| 3 | **Add the deployed → repo inverse diff to `verify-deployment.sh`**, failing on orphans; note one-off lifecycle rule in DEPLOY.md (M1 structural) | 20 min | `scripts/verify-deployment.sh:145`, `DEPLOY.md` |
| 4 | **Merge the open Dependabot PRs** (#43, #36, then #45), schedule vitest 1 → 5; re-test login / build / OG; retry dropping CSP `unsafe-eval` (H2, L5) | 2h | `huku-dev/vela` PRs, `vercel.json` |
| 5 | **Split the cron secret**: `TRADE_EXEC_SECRET` for `scanner-30m`, `execute-proposal`, `preopen-equity-sl-tighten`, `admin-resend-close` + their crons + `execute-proposal-trigger`; rotate both secrets; document rotation (M2) | 1.5h | `_shared/cron-auth.ts`, four handlers, two cron migrations, DEPLOY.md |
| 6 | **Revoke surplus table grants** on the 19 frontend objects with a verify block, both projects (M3) | 30 min | new migration |
| 7 | **Rotate `service_role` key** on prod + staging, or record explicit acceptance (M6) | 30 min | Supabase Dashboard, vault, `supabase secrets set`, redeploy |
| 8 | Decide `e2e-prod-test` residual (allowlist `user_id` or accept in DEPLOY.md) (M4) | 30 min | `e2e-prod-test/index.ts:120`, DEPLOY.md |
| 9 | Migrate the nine raw-`Bearer` handlers to `verifyCronAuth` (inject `X-Cron-Secret` into their crons first, `20261004000002` pattern) and remove the `cron-auth.ts` legacy branch + stale comment (L2) | 1h | nine handlers, `_shared/cron-auth.ts`, one migration |
| 10 | Anchor the deploy preflight to the handler body (L1) | 30 min | `deploy.sh:155` |
| 11 | Surface pending wallet provisioning (M5); move the `WALLET_ENVIRONMENT` read above the `funding_events` insert (L11); add `.env.example` (L7) | 1h | `auth-exchange:207`, `process-withdrawal:588`, frontend root |
| 12 | Drop staging-only `open_paper_trades` / `brief_ratings` or add them to prod; add object + policy parity to `verify-deployment.sh` (L9) | 30 min | staging SQL, `scripts/verify-deployment.sh` |

Items 1 and 2 are deletions with no code dependency and should happen today. Item 3 is what stops this class recurring; items 5 and 6 are the structural follow-ups for the two new MEDIUMs.

---

## 8. Positive Observations

- **October's money-flow findings were fixed properly, not patched.** The daily-cap check moved to where the money moves, counts in-flight rows, does cents arithmetic, and lives in a pure module with its own unit tests. The OTP burn is atomic with a row-count check. Both carry comments naming the audit item.
- **The database layer is now locked by default.** `20261004000001` revoked the stragglers, set `ALTER DEFAULT PRIVILEGES` at both scopes, and asserts its own post-conditions (including that `service_role` keeps a default grant). `20261020000001` then pinned explicit grants ahead of Supabase's 2026-10-30 auto-grant removal, with effective-access checks for two live bugs it found. This is the pattern every audit follow-up should take.
- **Edge-layer auth is complete for everything in the repo**: 60 of 61 functions gate in-handler, the single exception is an explicit allowlist with a written reason, the staging harnesses are gated with a secret that is deliberately not the prod one, and the five functions added since October all start with `verifyCronAuth`.
- **pg_cron hygiene held for the third consecutive audit** on both projects, and the `X-Cron-Secret` injection migrations include literal-secret abort checks.
- **Dependabot is configured thoughtfully** (grouped, major-pinned with a written reason, GitHub Actions included). The PRs just need merging.
- **Frontend posture unchanged and clean**: zero XSS sinks, no secrets, hidden source maps, full header set; only admin-dashboard files changed since October.
- **`cron_heartbeats` coverage grew** to the new HIP-4 pipeline and the uptime probe, and `health-check` treats a disabled kill-switch as an alert rather than silence.

---

## 9. Meta-observation

Every audit in this series has derived its edge-function inventory from the repo, and every control built in response (the auth preflight, the handler sweep, `verify-deployment.sh`) does the same. The repo is the source of truth for what *should* be deployed; it says nothing about what *is*. Seven functions, one of them an unauthenticated prod email relay, sat outside that view for five to eight months, and the only reason they surfaced now is that the October run flagged its own incomplete cross-check and this run finished it. The fix is small (one inverse diff), but the lesson is the same one the series keeps relearning in new clothes: a control that enumerates from the wrong side of the boundary cannot see the thing it is meant to catch. The other new MEDIUM, the cron secret's reach, is the inverse failure: a control that was correct for its original scope (cron-only functions) silently kept its scope label while its actual scope grew to include trade execution. Both are inventory problems, and inventory is the cheapest thing to automate.

---

*Audit performed 2026-11-02 from worktree `security-audit/2026-11-02` off `origin/main`. Live catalog, advisor, grant, policy, view, vault-metadata, cron-run, heartbeat and deployed-function queries run against prod `dikybxkubbaabnshnreh` and staging `memyqgdqcwrrybjpszuw` on 2026-11-02.*
