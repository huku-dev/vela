# Incident Report: Silent Testnet Wallet Provisioning in Production

**Date:** 2026-03-06
**Severity:** Critical
**Impact:** All production user wallets provisioned as testnet. Deposits not detected. Trade execution querying wrong wallets.
**Duration:** From first user signup to fix (~4 days)
**Affected users:** All users who signed up, including Damola (first external user)

---

## What Happened

`WALLET_ENVIRONMENT` was not set in Supabase production secrets. Every backend function that needed it — `provision-wallet`, `process-withdrawal`, `trade-executor`, `deposit-monitor` — silently defaulted to `"testnet"` via `?? "testnet"` fallback patterns.

This caused:
1. **All user wallets provisioned with `environment: 'testnet'`** in the DB
2. **Deposit monitor polling testnet Hyperliquid API** — real mainnet deposits invisible
3. **Trade executor looking up testnet wallets** — would fail to find wallets for trade execution
4. **Withdrawals querying testnet wallets** — would fail with "no wallet found"
5. **Frontend defaulting to testnet** — wallet queries and onboarding pointed at testnet

Damola deposited real USDC via Arbitrum. The `deposit-monitor` cron polled the Hyperliquid testnet API (which knows nothing about his mainnet deposit), saw zero balance, and reported nothing. His deposit was invisible to the system.

---

## Root Cause

**"Safe default for dev" pattern applied to production-critical config.**

The original code used `Deno.env.get("WALLET_ENVIRONMENT") ?? "testnet"` — a sensible default for local development that becomes a silent, catastrophic bug in production when the env var isn't set.

Contributing factors:
1. `WALLET_ENVIRONMENT` was **not in `.env.example`** or `DEPLOY.md` secrets list — it was invisible during deployment setup
2. `deploy.sh` deployed to whatever Supabase project was `link`ed, with no indication of which environment it was targeting
3. The env var name was inconsistent: `WALLET_ENVIRONMENT` in some files, `VELA_WALLET_ENVIRONMENT` in others
4. No startup health check to verify critical env vars exist

---

## Fix Applied

### Code changes (fail-loud guards):

| File | Before | After |
|------|--------|-------|
| `provision-wallet/index.ts` | `?? "testnet"` | Returns 500 if not set |
| `process-withdrawal/index.ts` (×2) | `?? "testnet"` | Returns 500 if not set |
| `wallet-provisioner.ts` (×2) | Default parameter `= "testnet"` | Required parameter (no default) |
| `trade-executor.ts` | `getUserWallet()` called WITHOUT environment | Reads env var, throws if not set |
| `Onboarding.tsx` | `?? 'testnet'` | Reads env var, logs error if missing |
| `useTrading.ts` | `?? 'testnet'` | `\|\| 'mainnet'` (frontend production-safe default) |

### Infrastructure:
- `WALLET_ENVIRONMENT=mainnet` added to `.env.example`
- `WALLET_ENVIRONMENT` added to `DEPLOY.md` secrets list (was missing)
- `VITE_WALLET_ENVIRONMENT` added to Vercel env vars in `DEPLOY.md`
- Env var name unified to `WALLET_ENVIRONMENT` everywhere (was `VELA_WALLET_ENVIRONMENT` in process-withdrawal)

### Data fix:
- All production `user_wallets` rows updated: `SET environment = 'mainnet'`

### Deployment:
- `deploy.sh` rewritten to **require** `--staging` or `--prod` flag
- Production deploys require interactive `yes` confirmation
- Script always re-links to staging after completion
- Deployed all 5 affected functions to both staging and production

---

## Rules Established (NEVER violate)

### 1. No silent defaults for environment-critical config
Every env var that controls which network, API, or environment the code targets MUST fail loud (500 error / thrown exception) if not set. NEVER use `?? "testnet"` or `?? "mainnet"` as a fallback. The only acceptable behavior when a critical env var is missing is a clear, immediate failure.

### 2. Every env var must be documented
If code reads an env var, it MUST exist in:
- `.env.example` (backend)
- `DEPLOY.md` secrets list (backend)
- Vercel env vars table in `DEPLOY.md` (frontend)

If it's not in all three places, it will be silently missing in production.

### 3. Deploy script must require explicit environment target
`deploy.sh` requires `--staging` or `--prod`. No default. Production deploys require interactive confirmation. Script always re-links to staging after completion.

### 4. Verify env vars after every deployment
After deploying to production, run `supabase secrets list` and cross-reference against `DEPLOY.md`. Any missing secret is a potential silent failure.

### 5. New env vars get a PR checklist item
When adding a new env var to code, the PR/commit must also update `.env.example`, `DEPLOY.md`, and set the value in both staging and production Supabase secrets (or Vercel env vars for frontend).
