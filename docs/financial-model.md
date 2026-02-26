# Vela Financial Model

> Last updated: 2026-02-26
> Purpose: Determine tier pricing, project costs/revenue, inform Stripe product creation

---

## 1. Platform Operating Costs (Fixed Monthly)

| Provider | Plan | Monthly | Notes |
|----------|------|---------|-------|
| Supabase | Free → Pro | $0 → $25 | Free: 500MB DB, 500K edge fn invocations. Gotcha: projects pause after 1 week inactivity. Upgrade to Pro when real users arrive. |
| Vercel | Hobby → Pro | $0 → $20 | Hobby: unlimited deploys, 100GB bandwidth, serverless. Officially non-commercial but fine for pre-revenue. Upgrade when you need team seats or Pro analytics. |
| Resend | Free | $0 | 3,000 emails/mo (scales to $20/mo Pro at ~50 users) |
| CoinGecko | Free | $0 | Only used for daily digest macro context (market cap, BTC dominance). Signal data comes from Hyperliquid directly. 10K calls/mo free tier is more than sufficient for 1-2 digest calls/day. |
| Privy | Free | $0 | 50K sigs/mo (scales at ~500 trading users) |
| Telegram | Free | $0 | Bot API is free |
| Stripe | Per-txn | Variable | 2.9% + $0.30 per subscription charge |
| Domain | - | ~$2 | ~$20/year amortized |

> **Note on data sources:** Hyperliquid provides all data needed for signal generation —
> real-time mark/index prices, full OHLCV candle history (EMA, RSI, ADX inputs), order book
> depth, recent trades, and funding rates. CoinGecko is only needed for the daily digest's
> macro market context (total market cap, BTC/ETH dominance, circulating supply) which
> Hyperliquid doesn't surface. This eliminates CoinGecko as a scaling cost entirely.

### Fixed cost at different stages:
| Stage | Users | Monthly Fixed |
|-------|-------|--------------|
| **Day zero (true cost)** | <30 | **~$2** (domain only — Supabase Free + Vercel Hobby) |
| **First paying users** | <30 | **$47** (upgrade to Supabase Pro to avoid inactivity pauses + Vercel Pro) |
| **Early traction** | 30-100 | **$67** (+ Resend Pro $20) |
| **Growth** | 100-500 | **$67** (CoinGecko stays free — only used for digest) |
| **Scale** | 500+ | **$370+** (Privy paid ~$300 + higher Supabase tier) |

---

## 2. Variable Costs Per User Per Month

### AI Brief Generation (Claude Sonnet 4.5)

Pricing: $3/M input tokens, $15/M output tokens

| Brief Type | Input Tokens | Output Tokens | Cost/Brief |
|------------|-------------|---------------|------------|
| Signal change brief | ~1,500 | ~800 | ~$0.017 |
| Brief with web search | ~3,000 | ~1,200 | ~$0.027 |
| Daily digest | ~2,000 | ~600 | ~$0.015 |

| Tier | Signal Briefs/mo | Digests/mo | AI Cost/mo |
|------|-----------------|------------|------------|
| **Free** (1 asset, 4h) | ~3 | 30 | **$0.50** |
| **Standard** (3 assets, 2h) | ~12 | 30 | **$0.66** |
| **Premium** (5+ assets, 1h) | ~25 | 30 | **$0.88** |

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

| Tier | AI | Sigs | Email | **Total/User/Mo** |
|------|-----|------|-------|--------------------|
| **Free** | $0.50 | $0 | $0 | **$0.50** |
| **Standard** | $0.66 | $0 | $0 | **$0.66** |
| **Premium** | $0.88 | $0 | $0 | **$0.88** |

> Variable costs per user are very low. AI briefs are the dominant cost.

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
| Variable cost | -$0.66 | -$0.66 | -$0.66 |
| **Gross margin/user** | **$23.75** | **$38.75** | **$68.75** |

> At $10/mo subscription, trade fees are the primary revenue driver for Standard.
> A moderate user generates 3× more from trade fees ($30) than subscriptions ($9.41).

### Premium Tier (Monthly Billing)

| | Conservative | Moderate | Active |
|--|-------------|----------|--------|
| Subscription (net) | $19.12 | $19.12 | $19.12 |
| Trade fee (0%) | $0 | $0 | $0 |
| Builder fee (if 10 BPS) | $50 | $125 | $250 |
| Variable cost | -$0.88 | -$0.88 | -$0.88 |
| **Gross margin/user** | **$68.24** | **$143.24** | **$268.24** |

> Premium revenue is dominated by builder fees from trading volume.
> Subscription is the "floor" — active traders generate 13× more.

### Free Tier (Cost Center)

| | Per User |
|--|---------|
| Revenue | $0 |
| Variable cost | -$0.50 |
| **Gross margin** | **-$0.50** |

> Free users cost ~$0.50/mo each. 100 free users = $50/mo.
> They're essentially free until you hit hundreds of them.

---

## 5. Break-Even Analysis

### Monthly fixed costs to cover: ~$2 (day zero) to ~$67 (with Pro plans + Resend)

| Scenario | Paid Users Needed | Mix |
|----------|-------------------|-----|
| **Day zero ($2/mo)** | 1 Standard | 1 × $9.41 sub ≈ $9 (covers domain easily) |
| **With Pro plans ($47/mo)** | 5 Standard | 5 × $9.41 = $47 (subs alone; trade fees add ~$150) |
| **With Resend ($67/mo)** | 7 Standard | 7 × $9.41 = $66 (or 4 Premium × $19 = $76) |
| **Trade fees accelerate** | 3 Standard + trades | 3 × ($9.41 + $30) = $118 → covers $67 easily |

> Break-even requires more paid users at lower price points, but trade fees
> compensate significantly. 3 active Standard users generating trade fees
> already cover the $67 Pro-plan fixed costs.

---

## 6. Growth Scenarios (Monthly Revenue Projections)

### Assumptions
- **Conversion rate:** 5% free→standard, 2% free→premium (industry avg for dev tools)
- **Annual billing discount:** 2 months free (~17% off)
- **Billing mix:** 60% monthly / 40% annual
- **Churn:** 5% monthly for standard, 3% for premium
- **Average trades/mo:** Standard=10, Premium=25
- **Average trade size:** Standard=$3K, Premium=$5K
- **Builder fee:** 10 BPS (option 2 from above)

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
| Fixed | -$67 |
| Variable (219 users) | -$120 |
| Stripe fees | -$12 |
| **Net** | **$966** |

### Month 12 — Growth

| Tier | Users | Sub Revenue | Trade Fees | Builder Fees | Total |
|------|-------|-------------|------------|-------------|-------|
| Free | 800 | $0 | $0 | $0 | $0 |
| Standard | 50 | $467 | $1,500 | $0 | $1,967 |
| Premium | 16 | $299 | $0 | $2,000 | $2,299 |
| **Total** | **866** | **$766** | **$1,500** | **$2,000** | **$4,266** |

| Costs | |
|-------|------|
| Fixed | -$67 |
| Variable | -$470 |
| Stripe fees | -$40 |
| **Net** | **$3,689** |

### Month 24 — Scale

| Tier | Users | Sub Revenue | Trade Fees | Builder Fees | Total |
|------|-------|-------------|------------|-------------|-------|
| Free | 3,000 | $0 | $0 | $0 | $0 |
| Standard | 200 | $1,866 | $6,000 | $0 | $7,866 |
| Premium | 60 | $1,120 | $0 | $7,500 | $8,620 |
| **Total** | **3,260** | **$2,986** | **$6,000** | **$7,500** | **$16,486** |

| Costs | |
|-------|------|
| Fixed | -$370 |
| Variable | -$1,780 |
| Stripe fees | -$150 |
| **Net** | **$14,186** |

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

### What if free users cost more? (e.g., web search enabled)

With web search enabled on all briefs, free user cost rises to ~$1.00/mo.
1,000 free users = $1,000/mo. Consider disabling web search for free tier briefs.

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
| AI cost per user | <$1.50/mo |
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
| **Cost to serve** | $0.50/mo | $0.66/mo | $0.88/mo |
| **Gross margin (moderate)** | -$0.50 | ~$39 | ~$143 |
| **Break-even** | N/A | 5 users (subs only) | 3 users (subs only) |

The business is volume-driven at these price points. Subscriptions serve as
activation/commitment fees while trade fees and builder fees generate the
majority of revenue. This aligns well with a "grow users first, monetize
through usage" strategy. Low entry pricing ($10/$20) reduces friction and
gives room to increase later as the product proves value.
