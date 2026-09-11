# Vela Financial Model

> Last updated: 2026-09-11
> Purpose: Determine tier pricing, project costs/revenue, inform Stripe product creation
>
> **Source of truth for infrastructure line items:** [`src/lib/infrastructure-costs.ts`](../src/lib/infrastructure-costs.ts). Update that file first; then refresh this doc to match.

---

## Current state (2026-09-11)

**Fixed spend (contractual, monthly):**
- **Supabase: Pro ($25).** Moved back to Pro after two Free-tier outages (2026-09-08 and 2026-09-11) triggered by Supabase's WAL archiver stalling on the smaller Free-tier disk. Free is not viable at production load for Vela's WAL profile. See [backend retro](../../crypto-agent/.claude/worktrees/classifier-drift-handoff-4ebfac/docs/retros/2026-09-09-supabase-wal-outage.html).
- **Domain: $1.08 amortized** ($13/yr getvela.xyz).
- **Vercel: Hobby (Free).** Not paying for Pro.
- **Resend, Privy, CoinGecko, Telegram: Free.** All within their respective free tiers at current user count.
- **Fixed total: ~$26.08/mo.**

**Variable spend (measured, trailing-30d estimates):**
- **DeepSeek: ~$4.40/mo.** Paid LLM provider for classifier + enrichment. Measured: 3,056 calls / $1.02 over 7 days ending 2026-09-09; extrapolated ×30/7.
- **Groq / NVIDIA / Anthropic: $0.** All free-tier or below their whitelisted last-resort use. Anthropic is whitelisted for `signal_explanation` / `news_summary` / `news_vela_take` last-resort only; zero paid Anthropic calls observed in the recent 7d window (a nonzero value on this line is a signal to investigate).
- **Stripe fees: ~$1-2/mo** at current 6-subscriber mix (2.9% + $0.30 per charge).
- **Variable total: ~$6/mo** at current traffic.

**Total run-rate: ~$32/mo** ($26.08 fixed + ~$6 variable).

**Confirmed paying subscribers:** 6 (per July 2026 admin dashboard snapshot: 4 Premium + 2 Standard).

---

## 1. Platform Operating Costs (Fixed Monthly)

| Provider | Plan | Monthly | Notes |
|----------|------|---------|-------|
| **Supabase** | **Pro** | **$25** | Current tier (upgraded 2026-09-11). Free tier's disk headroom is too small for Vela's WAL profile at production load; confirmed by two RO outages in 3 days. |
| Vercel | Hobby (Free) | $0 | Free tier: unlimited deploys, 100 GB bandwidth. Officially non-commercial but fine at current scale. Not planning to upgrade. |
| Resend | Free | $0 | 3,000 emails/mo (upgrade to Pro $20/mo at ~50 users) |
| CoinGecko | Free | $0 | Only used for daily-digest macro context (market cap, BTC dominance). Signal data comes from Hyperliquid directly. 10K calls/mo free tier is more than sufficient for 1-2 digest calls/day. |
| Privy | Free | $0 | 50K sigs/mo (scales at ~500 trading users) |
| Telegram | Free | $0 | Bot API is free |
| Stripe | Per-txn | Variable | 2.9% + $0.30 per subscription charge — see variable spend below |
| Domain | Annual | ~$1.08 | $13/year amortized (getvela.xyz). |

### External LLM spend (variable, measured)

Real observed spend on paid providers. All entries are trailing-30d extrapolations from `llm_call_log`. Refresh periodically.

| Provider | Trailing 30d (est) | 7d sample (source) | Notes |
|---|---:|---|---|
| **DeepSeek** | **$4.40** | 3,056 calls / $1.02 over 7d ending 2026-09-09 | Primary paid provider. Classifier + enrichment. Scales with news volume. |
| Groq | $0 | 788 calls / $0 over same window | Free tier (gpt-oss-120b). 200K TPD daily cap. |
| NVIDIA | $0 | 139 calls / $0 over same window | Fallback provider, free tier. |
| Anthropic | $0 | 0 paid calls in same window | Whitelisted for signal_explanation / news_summary / news_vela_take last-resort only. Nonzero here = last-resort fallback fired; investigate why. |

Source of truth for these numbers: [`src/lib/infrastructure-costs.ts`](../src/lib/infrastructure-costs.ts) and the live `llm_call_log` table on prod.

> **Note on data sources:** Hyperliquid provides all data needed for signal generation —
> real-time mark/index prices, full OHLCV candle history (EMA, RSI, ADX inputs), order book
> depth, recent trades, and funding rates. CoinGecko is only needed for the daily digest's
> macro market context (total market cap, BTC/ETH dominance, circulating supply) which
> Hyperliquid doesn't surface. This eliminates CoinGecko as a scaling cost entirely.

### Fixed cost at different stages:
| Stage | Users | Monthly Fixed |
|-------|-------|--------------|
| ~~**Day zero (aspirational)**~~ | <30 | ~~**~$2**~~ (domain only — Supabase Free + Vercel Hobby). **Not viable in practice**: two RO outages on Free tier (2026-09-08, 2026-09-11) forced the move to Pro. Free tier's ~8 GB disk cannot hold Vela's WAL profile under production cron load. |
| **← Current: First paying users** | 6 confirmed paid | **$26.08** (Supabase Pro $25 + domain $1.08; Vercel/Resend/Privy still Free) |
| **Early traction** | 30-100 | **$47** (+ Resend Pro $20 for higher-volume email) |
| **Growth** | 100-500 | **$47** (CoinGecko stays free — only used for digest) |
| **Scale** | 500+ | **$350+** (Privy paid ~$300 + potentially higher Supabase compute) |

---

## 2. Variable Costs Per User Per Month

### Actual routing (2026-09-11)

Vela uses a cascade of paid + free LLM providers. All backend routing is defined in `_shared/llm/factory.ts` and `_shared/llm/registry.ts`. Per CLAUDE.md constraints: **never default to paid Anthropic for free-tier tasks**; `claude-haiku-4-5` last-resort is whitelisted ONLY for `signal_explanation`, `news_summary`, and `news_vela_take`.

Current provider mix by measured spend (7 days ending 2026-09-09, source: `llm_call_log`):

| Provider | Calls | Spend | Extrapolated monthly | Role |
|---|---:|---:|---:|---|
| **DeepSeek** | 3,056 | $1.02 | **~$4.40** | Primary paid provider. Classifier + enrichment. |
| Groq | 788 | $0 | $0 | Free tier (gpt-oss-120b primary). 200K TPD daily cap. |
| NVIDIA | 139 | $0 | $0 | Fallback, free tier. |
| Anthropic | 0 | $0 | $0 | Last-resort whitelist only. Zero fires this week. |

**Total measured LLM spend: ~$4.40/mo.**

### Per-user cost attribution

Not yet computed. The measured spend is dominated by the news pipeline (classifier + enrichment) which processes global feeds regardless of user count. It scales with news volume, not user tier.

**Naive per-user split at current traffic:** $4.40/mo ÷ 6 paid subscribers = ~$0.73/user/mo blended. This is misleading — it attributes news-pipeline cost to paying users when in fact the pipeline runs at fixed load. **Do not use this for pricing decisions until per-`task_name` cost is broken out** and each task is mapped to its consumer (free vs standard vs premium vs pipeline).

**Follow-up task:** query `llm_call_log` grouped by `task_name`, join to which pipeline / tier consumes each task, and produce a real per-tier variable cost.

### Privy Wallet Signatures

Each trade needs ~4 signatures (set leverage + place order + native SL + potential cancel).
Free tier: 50,000 sigs/month.

| Tier | Trades/mo | Sigs/mo | Marginal Cost |
|------|-----------|---------|---------------|
| **Free** | 0 | 0 | $0 |
| **Standard** | ~10 | ~40 | $0 (within free tier) |
| **Premium** | ~25 | ~100 | $0 (within free tier) |

50K free sigs supports ~500 active trading users before paid tier kicks in.

### Email / Notifications

| Tier | Emails/mo | Cost |
|------|-----------|------|
| **Free** | ~60 | $0 (within Resend free) |
| **Standard** | ~120 | $0 |
| **Premium** | ~150 | $0 |

Resend free (3K/mo) supports ~25-30 users. Pro ($20/mo, 50K) supports ~350 users.

### Total Variable Cost Per User

**Per-user AI cost: not yet computed** (see attribution note above). Sigs, Email, Privy: all zero at current scale.

| Tier | AI (blended est.) | Sigs | Email | **Total/User/Mo** |
|------|-----|------|-------|--------------------|
| All tiers | ~$0.73 (blended, dominated by news pipeline) | $0 | $0 | **~$0.73** |

> AI cost is dominated by the news pipeline (classifier + enrichment), which runs at fixed load regardless of user count. As paid users grow, blended per-user cost falls even if total AI spend stays flat. Real per-tier attribution will separate pipeline cost (COGS) from per-user cost (user-scaling).

---

## 3. Revenue Streams

### A. Subscription Revenue

**Confirmed pricing:** Standard $10/mo ($100/yr), Premium $20/mo ($200/yr).
Annual = 10× monthly (2 months free, ~17% discount).

| Tier | Monthly | Annual (per mo) | Net Monthly (after Stripe 2.9%+$0.30) | Net Annual (per mo) |
|------|---------|-----------------|---------------------------------------|---------------------|
| **Free** | $0 | $0 | $0 | $0 |
| **Standard** | $10 | $8.33 | **$9.41** | **$7.97** |
| **Premium** | $20 | $16.67 | **$19.12** | **$16.04** |

> Stripe fees are proportionally higher at low price points. The $0.30 flat fee
> takes 3% of a $10 charge vs 0.4% of a $79 charge. At these prices, trade fees
> and builder fees become a more important revenue driver relative to subscriptions.

### B. Trade Fee Revenue (tier_config.trade_fee_pct)

Collected on-chain via Hyperliquid builder fee mechanism.

**Confirmed values:** Free=0.5%, Standard=0.1%, Premium=0%.

| Tier | Trades/mo | Avg Size | Fee Rate | **Fee Revenue/mo** |
|------|-----------|----------|----------|---------------------|
| **Free** | 0 | - | 0.50% | **$0** (no trading on free) |
| **Standard** | 10 | $3,000 | 0.10% | **$30** |
| **Premium** | 25 | $5,000 | 0.00% | **$0** |

### C. Builder Fee Revenue (VELA_BUILDER_FEE_BPS)

This is a fixed on-chain fee applied to ALL trades regardless of tier.
It's the actual collection mechanism on Hyperliquid.

**Decision needed:** What BPS to set? Currently unconfigured.

Example at 10 BPS (0.1%):

| Tier | Trades/mo | Avg Volume | Builder Fee | **Revenue/mo** |
|------|-----------|------------|-------------|----------------|
| **Standard** | 10 | $30,000 total | 0.1% | **$30** |
| **Premium** | 25 | $125,000 total | 0.1% | **$125** |

> **Key question:** Is the builder fee ADDITIVE to the trade fee, or IS it the trade fee?
> If the 0.1% trade fee for Standard is implemented via the builder fee, then
> VELA_BUILDER_FEE_BPS = 10. But this means Premium users (0% trade fee)
> would also pay 10 BPS on-chain since it's a single env var.
>
> **Options:**
> 1. Builder fee = 0 BPS, trade fee collected off-chain (not implemented yet)
> 2. Builder fee = 10 BPS for all, Premium "0% fee" is marketing (builder fee is a platform cost)
> 3. Builder fee = 5 BPS universal, trade_fee_pct is display-only
>
> **Recommendation:** Option 2 or 3. The builder fee is negligible for users
> ($3-5 per $3-5K trade) and provides meaningful platform revenue at scale.

---

## 4. Unit Economics Per Tier

### Standard Tier (Monthly Billing)

| | Conservative | Moderate | Active |
|--|-------------|----------|--------|
| Subscription (net) | $9.41 | $9.41 | $9.41 |
| Trade fee (0.1%) | $15 (5 trades) | $30 (10 trades) | $60 (20 trades) |
| Variable cost | -$0.73 (blended, TBD once per-tier attribution done) | -$0.73 | -$0.73 |
| **Gross margin/user (approx)** | **$23.68** | **$38.68** | **$68.68** |

> At $10/mo subscription, trade fees are the primary revenue driver for Standard.
> A moderate user generates 3× more from trade fees ($30) than subscriptions ($9.41).

### Premium Tier (Monthly Billing)

| | Conservative | Moderate | Active |
|--|-------------|----------|--------|
| Subscription (net) | $19.12 | $19.12 | $19.12 |
| Trade fee (0%) | $0 | $0 | $0 |
| Builder fee (if 10 BPS) | $50 | $125 | $250 |
| Variable cost | -$0.73 (blended, TBD) | -$0.73 | -$0.73 |
| **Gross margin/user (approx)** | **$68.39** | **$143.39** | **$268.39** |

> Premium revenue is dominated by builder fees from trading volume.
> Subscription is the "floor" — active traders generate 13× more.

### Free Tier (Cost Center)

| | Per User |
|--|---------|
| Revenue | $0 |
| Variable cost | ~$0.73 blended (TBD from per-tier attribution) |
| **Gross margin (est)** | **~-$0.73** |

> Free-tier true cost is uncertain until per-`task_name` cost attribution is done. Current best estimate: news-pipeline-dominated blended $0.73/user. **Key open question:** how much of the ~$4.40/mo DeepSeek spend is user-scaling vs. fixed-pipeline. If it's mostly fixed pipeline, free users are near-zero marginal cost.

---

## 5. Break-Even Analysis

### Today's actual run-rate: ~$32/mo

- Fixed: **$26.08** (Supabase Pro $25 + domain $1.08)
- Variable at current traffic: **~$6** (DeepSeek $4.40 + Stripe $1-2)

### Break-even at each scale

| Scenario | Total Fixed + Variable | Paid Users Needed (subs only) | Notes |
|----------|-----------------------|-------------------------------|-------|
| **~~Day zero~~ (not viable)** | ~~$2/mo (Free tier)~~ | ~~1 Standard~~ | Free tier proven unable to hold Vela's WAL profile (2026-09-08, 2026-09-11 outages). |
| **← Current: Pro + measured variable** | ~$32/mo | **4 Standard** | 4 × $9.41 = $38 (subs alone; trade fees add ~$60-120 on top). |
| Early traction (Resend Pro added) | ~$52/mo | 6 Standard | 6 × $9.41 = $56 (or 3 Premium × $19 = $57). Add ~$5-10 for variable LLM growth. |
| Growth (≥100 users) | ~$60+/mo | 8 Standard | Variable AI cost scales with news pipeline load; expect $10-20/mo at 100 users. |

> **Today we're break-even on subscriptions alone at 4 Standard.** With 6 confirmed paid subscribers (4 Premium + 2 Standard per the July admin snapshot), net subscription revenue is roughly **6 × $9-19 = $60-100/mo**, comfortably above the $32/mo run-rate. Trade fees are pure upside on top.

---

## 6. Growth Scenarios (Monthly Revenue Projections)

> **Fixed-cost values below are updated to reflect current reality (2026-09-11).**
> Variable-cost values still use the legacy per-user assumption from §2, which is now known to be stale. Re-derive per-user variable cost from measured `llm_call_log` before treating the net numbers as decision-grade.

### Assumptions
- **Conversion rate:** 5% free→standard, 2% free→premium (industry avg for dev tools)
- **Annual billing discount:** 2 months free (~17% off)
- **Billing mix:** 60% monthly / 40% annual
- **Churn:** 5% monthly for standard, 3% for premium
- **Average trades/mo:** Standard=10, Premium=25
- **Average trade size:** Standard=$3K, Premium=$5K
- **Builder fee:** 10 BPS (option 2 from above)
- **Vercel:** Hobby (Free) throughout — no Pro upgrade planned.

### Month 6 — Early Traction

| Tier | Users | Sub Revenue | Trade Fees | Builder Fees | Total |
|------|-------|-------------|------------|-------------|-------|
| Free | 200 | $0 | $0 | $0 | $0 |
| Standard | 15 | $140* | $450 | $0** | $590 |
| Premium | 4 | $75* | $0 | $500 | $575 |
| **Total** | **219** | **$215** | **$450** | **$500** | **$1,165** |

*Blended: 60% monthly + 40% annual pricing.
**If builder fee = trade fee mechanism, Standard trade fees would be collected as builder fees instead.

| Costs | |
|-------|------|
| Fixed | -$47 (Supabase Pro + Resend Pro + domain; Vercel Free) |
| Variable (est., dominated by news pipeline; refresh from measurement) | ~-$120 |
| Stripe fees | -$12 |
| **Net (approx)** | **$986** |

### Month 12 — Growth

| Tier | Users | Sub Revenue | Trade Fees | Builder Fees | Total |
|------|-------|-------------|------------|-------------|-------|
| Free | 800 | $0 | $0 | $0 | $0 |
| Standard | 50 | $467 | $1,500 | $0 | $1,967 |
| Premium | 16 | $299 | $0 | $2,000 | $2,299 |
| **Total** | **866** | **$766** | **$1,500** | **$2,000** | **$4,266** |

| Costs | |
|-------|------|
| Fixed | -$47 (same stage) |
| Variable (est.) | ~-$470 |
| Stripe fees | -$40 |
| **Net (approx)** | **$3,709** |

### Month 24 — Scale

| Tier | Users | Sub Revenue | Trade Fees | Builder Fees | Total |
|------|-------|-------------|------------|-------------|-------|
| Free | 3,000 | $0 | $0 | $0 | $0 |
| Standard | 200 | $1,866 | $6,000 | $0 | $7,866 |
| Premium | 60 | $1,120 | $0 | $7,500 | $8,620 |
| **Total** | **3,260** | **$2,986** | **$6,000** | **$7,500** | **$16,486** |

| Costs | |
|-------|------|
| Fixed | -$350 (Privy paid ~$300 + Supabase higher compute; Vercel Free assumed to hold) |
| Variable (est.) | ~-$1,780 |
| Stripe fees | -$150 |
| **Net (approx)** | **$14,206** |

> **Key insight:** At $10/$20 subscription pricing, trade fees and builder fees
> dominate revenue (82% at Month 12, 82% at Month 24). Subscriptions are the
> "activation fee" — the real business model is volume-based.

---

## 7. Pricing Decisions — Confirmed

### A. Standard Tier: $10/mo, $100/yr ✅

Low entry point maximizes conversion. Trade fees ($30/mo from moderate user)
provide 3× the subscription revenue per user. Annual = 10× monthly (2 months free).

### B. Premium Tier: $20/mo, $200/yr ✅

2× Standard pricing with clear upgrade incentives: 0% trade fee, full auto mode,
1h signals, unlimited assets. Builder fee (10 BPS) means active Premium users
generate $125-250/mo — subscription is just the floor.

### C. Trade Fee Rate ✅

- **Free: 0.5%** — $15 on a $3K trade. Meaningful friction to encourage upgrading.
- **Standard: 0.1%** — $3 on a $3K trade. Barely noticeable.
- **Premium: 0%** — Clear upgrade incentive.

### D. Builder Fee BPS: Decision still needed

**Recommendation: 10 BPS (0.1%)**

| BPS | Fee Rate | On $3K Trade | On $5K Trade |
|-----|----------|-------------|-------------|
| 5 | 0.05% | $1.50 | $2.50 |
| 10 | 0.10% | $3.00 | $5.00 |
| 15 | 0.15% | $4.50 | $7.50 |
| 20 | 0.20% | $6.00 | $10.00 |

### E. DB Seed vs Frontend Discrepancies

| Field | Frontend (old) | DB Seed (old) | **Confirmed** |
|-------|----------|---------|-----|
| Standard monthly | $29 | $29 | **$10** |
| Standard annual | $290 | $290 | **$100** |
| Premium monthly | $79 | $99 | **$20** |
| Premium annual | $790 | $990 | **$200** |
| Standard trade fee | 0.1% | 0.25% | **0.1%** |
| Standard max position | $20,000 | $10,000 | $20,000 |
| Standard max assets | 3 | 5 | 3 |
| Standard signal freq | 2h | 4h | 2h |
| Premium max position | Unlimited | $100,000 | Unlimited |
| Premium max assets | Unlimited | 50 | Unlimited |

> **Action:** Update both frontend tier-definitions.ts and DB seed migration
> to match confirmed pricing. These are significant price changes from original values.

---

## 8. Stripe Products to Create

### Products

| Product | Stripe Product Name |
|---------|-------------------|
| Standard Plan | `Vela Standard` |
| Premium Plan | `Vela Premium` |

### Prices (4 total)

| Price | Amount | Interval | Env Var |
|-------|--------|----------|---------|
| Standard Monthly | $10.00 | month | `STRIPE_PRICE_STANDARD_MONTHLY` |
| Standard Annual | $100.00 | year | `STRIPE_PRICE_STANDARD_ANNUAL` |
| Premium Monthly | $20.00 | month | `STRIPE_PRICE_PREMIUM_MONTHLY` |
| Premium Annual | $200.00 | year | `STRIPE_PRICE_PREMIUM_ANNUAL` |

### Env Vars to Set

```bash
# After creating Stripe products:
supabase secrets set STRIPE_PRICE_STANDARD_MONTHLY=price_xxx
supabase secrets set STRIPE_PRICE_STANDARD_ANNUAL=price_xxx
supabase secrets set STRIPE_PRICE_PREMIUM_MONTHLY=price_xxx
supabase secrets set STRIPE_PRICE_PREMIUM_ANNUAL=price_xxx

# Builder fee
supabase secrets set VELA_BUILDER_FEE_BPS=10
```

---

## 9. Sensitivity Analysis

### What if Premium conversion is higher? (4% instead of 2%)

Month 12: 32 premium users instead of 16 → +$2,299/mo additional revenue.
Premium is the highest-margin tier (builder fees), so conversion rate here matters most.

### What if average trade size is $1K instead of $3K?

Trade fee + builder fee revenue drops by 67%. At $1K avg:
- Standard user generates $10/mo in trade fees instead of $30
- Premium user generates $42/mo in builder fees instead of $125
- Still profitable per user ($19/mo Standard margin), but aggregate revenue scales slower

### What if news pipeline volume grows?

DeepSeek is currently the dominant paid LLM line at ~$4.40/mo, driven mostly by classifier + enrichment on the news feed (not per-user). If ingested news volume doubles (e.g., add another source, or tighten dedup thresholds), DeepSeek spend roughly doubles to ~$8-9/mo — still trivial relative to revenue at current scale.

If we ever route classifier fall-throughs to Anthropic Haiku (currently zero paid Anthropic), cost per classification rises ~10-20x. **Monitor the Anthropic line in the config — nonzero values are a warning signal, not a normal run-rate.**

### What if subscription price is too low?

At $10/$20 pricing, subscriptions are only ~18% of total revenue at Month 12.
The business model effectively runs on trade volume. If trade volume is lower
than projected, raising subscriptions to $15/$30 or $20/$40 would be the
first lever to pull. The low starting price gives room to raise later.

---

## 10. Key Metrics to Track Post-Launch

| Metric | Target |
|--------|--------|
| Free → Standard conversion | >5% |
| Free → Premium conversion | >2% |
| Monthly churn (Standard) | <5% |
| Monthly churn (Premium) | <3% |
| Average trades/user/month | >8 (Standard), >20 (Premium) |
| Average trade size | >$2,000 |
| LTV:CAC ratio | >3:1 |
| Gross margin per paid user | >$30/mo |
| AI cost per user (blended) | <$1.50/mo (current: ~$0.73 blended) |
| Trade fee revenue as % of total | Track trend (expected: 60-80%) |
| Builder fee revenue per Premium user | >$100/mo |

---

## 11. Monthly Financial Statement (Automated)

Once Vela goes into production, an automated monthly statement will be generated
to track actual performance against this model. The statement will include:

### Statement Template

```
VELA MONTHLY FINANCIAL STATEMENT — [Month Year]
================================================

REVENUE
  Subscription Revenue
    Standard Monthly:    $___  (__ users × $10)
    Standard Annual:     $___  (__ users × $8.33/mo)
    Premium Monthly:     $___  (__ users × $20)
    Premium Annual:      $___  (__ users × $16.67/mo)
  Total Subscriptions:   $___

  Trade Fee Revenue
    Standard volume:     $___  (__ trades, $__ avg size, 0.1%)
  Total Trade Fees:      $___

  Builder Fee Revenue
    On-chain collected:  $___  (__ BPS on $__ total volume)
  Total Builder Fees:    $___

  TOTAL REVENUE:         $___

COSTS
  Fixed Costs
    Supabase:            $___
    Vercel:              $___
    Resend:              $___
    Other:               $___
  Total Fixed:           $___

  Variable Costs
    AI (Claude API):     $___  ($__/user avg)
    Privy:               $___
    Stripe fees:         $___
  Total Variable:        $___

  TOTAL COSTS:           $___

NET:                     $___

METRICS vs MODEL
  Users (free/std/prem):     __/__ /__ (model: __/__/__)
  Conversion rate:           __%/__%   (model: 5%/2%)
  Churn (std/prem):          __%/__%   (model: 5%/3%)
  Avg trades/user:           __        (model: 10/25)
  Avg trade size:            $__       (model: $3K/$5K)
  Revenue vs model:          __% of projected
```

### Data Sources for Automation
- **Subscriptions:** Stripe API (invoices, subscriptions)
- **Trade fees:** Hyperliquid builder fee receipts (on-chain)
- **AI costs:** Anthropic API usage dashboard
- **User counts:** Supabase `profiles` + `tier_configs` tables
- **Trade data:** Supabase `trade_executions` table

> This will be automated as a Supabase Edge Function or scheduled script
> that runs on the 1st of each month and delivers via email/Telegram.

---

## Summary

| | Free | Standard | Premium |
|--|------|----------|---------|
| **Monthly price** | $0 | $10 | $20 |
| **Annual price** | $0 | $100 | $200 |
| **Trade fee** | 0.5% | 0.1% | 0% |
| **Builder fee** | - | 10 BPS | 10 BPS |
| **Cost to serve** (blended) | ~$0.73 | ~$0.73 | ~$0.73 |
| **Gross margin (moderate)** | ~-$0.73 | ~$38.7 | ~$143.4 |
| **Break-even at current run-rate** | N/A | 4 users (subs only, ~$32/mo total) | 2 users (subs only) |

> "Cost to serve" is the naive per-user split of measured LLM spend at current traffic. It's dominated by fixed news-pipeline cost (classifier + enrichment) not per-user cost, so real per-tier attribution will likely show free users much closer to $0 and per-paid-user marginal cost also low. Refresh from `llm_call_log` grouped by `task_name` for decision-grade numbers.

The business is volume-driven at these price points. Subscriptions serve as
activation/commitment fees while trade fees and builder fees generate the
majority of revenue. This aligns well with a "grow users first, monetize
through usage" strategy. Low entry pricing ($10/$20) reduces friction and
gives room to increase later as the product proves value.
