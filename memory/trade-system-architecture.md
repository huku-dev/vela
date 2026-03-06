# Vela — Trade System Architecture

> **Last Updated:** 2026-03-06
> **Triggered by:** Testnet wallet incident — no architecture doc existed, critical env vars were invisible during deployment

---

## System Overview

```
                              ┌─────────────────────┐
                              │    Signal Engine     │
                              │   (run-signals)      │
                              │   Cron: 4H + on-demand│
                              └─────────┬───────────┘
                                        │ writes signals + briefs
                                        ▼
┌──────────────────┐    ┌─────────────────────────────┐    ┌──────────────────┐
│  Volatility      │───▶│   Proposal Generator        │───▶│  Notifications   │
│  Check           │    │  (proposal-generator.ts)     │    │  (notify.ts)     │
│  Cron: 30min     │    │  Checks eligibility, tier,   │    │  Email + Telegram│
│  (early trigger) │    │  creates trade_proposals     │    │  + X (Twitter)   │
└──────────────────┘    └─────────────┬───────────────┘    └──────────────────┘
                                      │
                        ┌─────────────▼───────────────┐
                        │     User Approval            │
                        │  Telegram callback           │
                        │  Email action link            │
                        │  Frontend accept button       │
                        │  (trade-webhook)              │
                        └─────────────┬───────────────┘
                                      │ accepted / auto-approved
                        ┌─────────────▼───────────────┐
                        │     Trade Executor           │
                        │  (trade-executor.ts)          │
                        │  ⚠ WALLET_ENVIRONMENT req'd   │
                        │  Privy TEE → Hyperliquid     │
                        └─────────────┬───────────────┘
                                      │
                        ┌─────────────▼───────────────┐
                        │   Position Monitor           │
                        │  (position-monitor)           │
                        │  Cron: 2min                   │
                        │  P&L · stop-loss · trailing   │
                        │  stop · circuit breakers      │
                        └──────────────────────────────┘
```

### Two-Loop Design

| Loop | Interval | Purpose | Functions |
|------|----------|---------|-----------|
| **Fast** | 2 min | Position monitoring, stop-loss, circuit breakers | position-monitor, deposit-monitor |
| **Slow** | 4H | Signal computation, proposal generation, trade execution | run-signals, proposal-generator |
| **Reactive** | 30 min | Volatility spike detection → early signal run | volatility-check |

---

## Wallet & Funding Flow

```
  User Signup                       User Deposits USDC
      │                                   │
      ▼                                   ▼
┌──────────────┐               ┌───────────────────┐
│ provision-   │               │ On-chain transfer  │
│ wallet       │               │ to master_address  │
│ (Privy TEE)  │               │ (Arbitrum / HL)    │
│              │               └────────┬──────────┘
│ ⚠ WALLET_ENV │                        │
│ required!    │          ┌─────────────▼──────────────┐
└──────┬───────┘          │  deposit-monitor (2min)     │
       │                  │  refresh-balance (on-demand) │
       ▼                  │  Polls Hyperliquid balance    │
  user_wallets            │  Idempotent: 5min dedup       │
  (environment:           └─────────────┬─────────────────┘
   testnet|mainnet)                     │
                                        ▼
                                 funding_events
                           (deposit → completed)

  User Withdraws
      │
      ▼
┌───────────────────────────────────────────────┐
│  process-withdrawal (two-step)                │
│                                               │
│  Step 1: request_otp                          │
│    → Rate limit (5/hr)                        │
│    → Validate amount + address                │
│    → Check tier limits (daily max, min)       │
│    → Check balance vs amount + fee            │
│    → Generate 6-digit OTP (10min expiry)      │
│    → Send OTP email (Resend)                  │
│                                               │
│  Step 2: confirm                              │
│    → Rate limit (10/hr)                       │
│    → Verify OTP (match user, code, amount)    │
│    → Create funding_event (processing)        │
│    → Execute withdraw3 on Hyperliquid         │
│    → Update status → completed                │
│    → Sync balance, notify, audit log          │
│                                               │
│  ⚠ WALLET_ENVIRONMENT required at both steps  │
└───────────────────────────────────────────────┘
```

---

## Edge Functions

| Function | Purpose | Auth | Schedule |
|----------|---------|------|----------|
| **run-signals** | Signal engine orchestrator | Service role (cron) | 4H + on-demand |
| **position-monitor** | P&L, stop-loss, circuit breakers | Service role (cron) | 2min |
| **deposit-monitor** | Poll wallets for new deposits | Service role (cron) | 2min |
| **refresh-balance** | On-demand balance sync | JWT (user) | User-triggered |
| **provision-wallet** | Create Privy wallets (master+agent) | JWT (user) | User-triggered |
| **process-withdrawal** | OTP → confirm → withdraw | JWT (user) | User-triggered |
| **volatility-check** | Early signal trigger on >5% move | Service role (cron) | 30min |
| **trade-webhook** | Accept/decline proposals | JWT / Telegram / HMAC | User-triggered |
| **signal-performance-tracker** | Measure signal accuracy at 1h/4h/24h/7d | Service role (cron) | Hourly |
| **signal-review** | Weekly pattern analysis + admin report | Service role (cron) | Monday 9AM |
| **post-to-x** | Post to X (Twitter) | Service role | Internal |
| **publish-scheduled** | Post queued content to X | Service role (cron) | 15min |
| **auth-exchange** | Privy JWT → Supabase JWT | Privy signature | User-triggered |
| **create-checkout-session** | Stripe checkout for tier upgrade | JWT (user) | User-triggered |
| **create-portal-session** | Stripe customer portal | JWT (user) | User-triggered |
| **payment-webhook** | Stripe → update subscriptions | Stripe signature | Stripe push |

---

## Env Var Dependency Map

Every env var read by backend code. All must fail loud (500 error) if missing — no silent defaults.

| Env Var | Used By | Fail Mode |
|---------|---------|-----------|
| `SUPABASE_URL` | All functions | 500 — crashes on createClient |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | 500 — crashes on createClient |
| `WALLET_ENVIRONMENT` | provision-wallet, trade-executor, process-withdrawal (×2), deposit-monitor | **500 — fail-loud guard** (incident fix) |
| `PRIVY_APP_ID` | provision-wallet, deposit-monitor, position-monitor, auth-exchange | 500 — Privy client fails |
| `PRIVY_APP_SECRET` | provision-wallet, deposit-monitor, position-monitor | 500 — Privy client fails |
| `PRIVY_VERIFICATION_KEY` | auth-exchange | 500 — JWT verification fails |
| `JWT_SECRET` | auth-exchange | 500 — can't sign Supabase JWTs |
| `APP_BASE_URL` | auth-exchange, process-withdrawal, refresh-balance, create-checkout/portal | Email links point to wrong URL |
| `ANTHROPIC_API_KEY` | run-signals (brief-generator.ts) | Briefs fail — fallback text if ENVIRONMENT=staging |
| `COINGECKO_API_KEY` | run-signals, volatility-check, signal-performance-tracker | 500 — no price data |
| `STRIPE_SECRET_KEY` | create-checkout-session, create-portal-session, payment-webhook | 500 — Stripe API fails |
| `STRIPE_WEBHOOK_SECRET` | payment-webhook | 500 — signature verification fails |
| `STRIPE_PRICE_STANDARD_MONTHLY` | create-checkout-session | 500 — no price ID for checkout |
| `STRIPE_PRICE_STANDARD_ANNUAL` | create-checkout-session | 500 |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | create-checkout-session | 500 |
| `STRIPE_PRICE_PREMIUM_ANNUAL` | create-checkout-session | 500 |
| `TELEGRAM_BOT_TOKEN` | notify.ts | Telegram notifications silently fail |
| `TELEGRAM_CHAT_ID` | notify.ts | Default chat for admin messages |
| `TELEGRAM_WEBHOOK_SECRET` | trade-webhook | Telegram callbacks rejected |
| `TELEGRAM_ADMIN_BOT_TOKEN` | notify.ts (admin alerts) | Admin Telegram silently fails |
| `TELEGRAM_ADMIN_CHAT_ID` | notify.ts (admin alerts) | Admin Telegram silently fails |
| `WEBHOOK_HMAC_SECRET` | trade-webhook (email links) | Email action links rejected |
| `RESEND_API_KEY` | notify.ts (sendEmailTo) | All emails silently fail |
| `EMAIL_FROM_ADDRESS` | notify.ts (sendEmailTo) | Emails sent from wrong address |
| `NOTIFICATION_EMAIL` | notify.ts (sendEmail) | Admin emails go nowhere |
| `VELA_BUILDER_ADDRESS` | trade-executor | Builder fee goes to wrong address |
| `VELA_BUILDER_FEE_BPS` | trade-executor | Fee calculation wrong |
| `VELA_REFERRAL_CODE` | trade-executor | Referral tracking broken |
| `ENABLE_BRIEF_WEB_SEARCH` | brief-generator.ts | Web search disabled (opt-in) |
| `ENVIRONMENT` | brief-generator.ts | Staging skips Claude API calls |
| `POST_TO_X_SECRET` | post-to-x, publish-scheduled | X posting auth fails |
| `X_API_KEY` | post-to-x | X API calls fail |
| `X_API_KEY_SECRET` | post-to-x | X API calls fail |
| `X_ACCESS_TOKEN` | post-to-x | X API calls fail |
| `X_ACCESS_TOKEN_SECRET` | post-to-x | X API calls fail |
| `SUPABASE_DB_URL` | Migrations only (not edge functions) | DB push fails |

**Total: 37 secrets** — cross-reference with DEPLOY.md step 4f.

**Frontend env vars (Vercel):**

| Env Var | Purpose |
|---------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_PRIVY_APP_ID` | Privy auth configuration |
| `VITE_WALLET_ENVIRONMENT` | testnet vs mainnet wallet queries |
| `VITE_SENTRY_DSN` | Error tracking |
| `VITE_SENTRY_ENVIRONMENT` | staging vs production |
| `SENTRY_AUTH_TOKEN` | Source map uploads |
| `VITE_DEV_BYPASS_AUTH` | Dev-only: mock auth state |

---

## Cron Schedule

| Schedule | Function | Purpose |
|----------|----------|---------|
| `0 */4 * * *` | run-signals | Signal computation + proposals |
| `0 8 * * *` | run-signals?digest=true | Daily digest at 8AM UTC |
| `*/2 * * * *` | position-monitor | P&L updates, stop-loss, circuit breakers |
| `*/2 * * * *` | deposit-monitor | Poll wallets for deposits |
| `*/30 * * * *` | volatility-check | Early signal trigger on >5% price move |
| `15 * * * *` | signal-performance-tracker | Hourly signal accuracy tracking |
| `0 9 * * 1` | signal-review | Weekly pattern analysis (Monday 9AM) |
| `*/15 * * * *` | publish-scheduled | Post queued X content |
| `*/15 * * * *` | SQL: expire stale proposals | `UPDATE trade_proposals SET status='expired'` |
| `*/10 * * * *` | SQL: cleanup rate limits | `DELETE FROM rate_limits WHERE ...` |

All HTTP cron jobs include `Authorization: Bearer <service_role_key>` via vault secret.

---

## Trade Execution Data Flow

```
Signal Change
    │
    ▼
signals table ──────────────────────────────────────────┐
    │                                                    │
    ▼                                                    │
briefs table (AI-generated)                              │
    │                                                    │
    ▼                                                    │
proposal-generator                                       │
    │  Eligibility checks:                               │
    │  · wallet registered?                              │
    │  · circuit breaker active?                         │
    │  · pending proposal exists?                        │
    │  · free tier trial used?                           │
    │  · at max positions? (→ capacity nudge)            │
    │  · sufficient balance?                             │
    │  · EMA cooldown active? (V7)                       │
    │                                                    │
    ▼                                                    │
trade_proposals ────────────────────┐                    │
    │                               │                    │
    │  (semi_auto)                  │  (full_auto)       │
    │  User approves via            │  Auto-approved     │
    │  Telegram / email / app       │  immediately       │
    │                               │                    │
    ▼                               ▼                    │
trade-executor                                           │
    │  1. Atomic claim (status → executing)              │
    │  2. Fetch wallet (WALLET_ENVIRONMENT!)             │
    │  3. Set leverage on Hyperliquid                    │
    │  4. Place order (IOC market)                       │
    │  5. Record fill details                            │
    │                                                    │
    ▼                                                    │
trade_executions ───► positions ───► position-monitor ───┘
                         │              │  (2min loop)
                         │              │  · Update P&L
                         │              │  · Check stop-loss → auto-close
                         │              │  · Check trailing stop → auto-close
                         │              │  · Check profit ladder → auto-trim
                         │              │  · Check circuit breakers
                         │              │
                         │              ▼
                         │         postmortems (on close)
                         │
                         └──► notifications (Telegram + email)
```

---

## Security Layers

| Layer | Mechanism | Where |
|-------|-----------|-------|
| **Auth** | Supabase JWT, Privy JWT, Stripe signature, Telegram secret, HMAC | Each edge function |
| **Database** | RLS scoped to user_id, UNIQUE partial indexes | All user tables |
| **Execution** | Atomic claim (status → executing), idempotency guards | trade-executor |
| **Rate limiting** | Per-user limits (withdrawal OTP: 5/hr, confirm: 10/hr, refresh: 10/min) | process-withdrawal, refresh-balance |
| **Wallet** | Privy TEE (hardware isolation), no private keys in code | provision-wallet |
| **Circuit breakers** | Daily loss, consecutive losses, rapid price drop, margin | position-monitor |
| **Tier enforcement** | DB trigger (mode validation), proposal-generator, frontend clamping | 3-layer defense |

---

## Incident Reference

**2026-03-06: Silent Testnet Wallet Provisioning**
- `WALLET_ENVIRONMENT` missing from production secrets
- All wallets provisioned as testnet, deposits invisible, trades fail
- Root cause: `?? "testnet"` fallback pattern + undocumented env var
- Fix: fail-loud 500 errors, deploy.sh rewritten with `--staging`/`--prod` flags
- Full report: `memory/incident-2026-03-06-testnet-wallets.md`

**Rules established:**
1. No silent defaults for environment-critical config — fail loud
2. Every env var must be in `.env.example` + `DEPLOY.md` + Vercel env vars
3. `deploy.sh` requires `--staging` or `--prod` flag
4. Verify secrets after every deployment
5. New env vars get a PR checklist item
