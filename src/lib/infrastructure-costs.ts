/**
 * Vela infrastructure cost catalog.
 *
 * Single source of truth for monthly infrastructure spend. Consumed by:
 *   - docs/financial-model.md (referenced, not auto-generated)
 *   - src/components/admin/AdminSections.tsx (rendered in the admin dashboard)
 *
 * Two categories:
 *   - Fixed: contractual recurring bills. Change only when a plan tier changes.
 *   - Variable: measured spend that scales with load (LLM providers, Stripe fees).
 *     These are trailing-30d observed averages, not commitments; refresh them
 *     periodically from the source-of-truth (`llm_call_log`, Stripe dashboard).
 *
 * Anchors:
 *   2026-09-08: 24h Vela outage on Supabase Free; RO lockout from WAL bloat.
 *   2026-09-11: Second outage same class; moved back to Pro. Free is not
 *   viable past initial development for Vela's WAL profile.
 */

export interface FixedInfrastructureCost {
  provider: string;
  plan: string;
  monthly_usd: number;
  /** Why we're on this tier today; kept short for the admin tile. */
  notes: string;
}

export interface VariableInfrastructureCost {
  provider: string;
  category: "llm" | "payments" | "other";
  /** Trailing-30d observed spend estimate, in USD. */
  monthly_usd_estimate: number;
  /** How the estimate was derived; must record the sample window. */
  measurement: string;
  notes: string;
}

/**
 * Fixed monthly costs. Ordered highest-cost first for clean rendering in the
 * admin tile. Free tiers are included so the picture is complete, not just
 * the paid line items.
 */
export const FIXED_INFRASTRUCTURE_COSTS: FixedInfrastructureCost[] = [
  {
    provider: "Supabase",
    plan: "Pro",
    monthly_usd: 25,
    notes:
      "Moved back to Pro on 2026-09-11 after two Free-tier RO outages (WAL bloat on the smaller disk). Free is not viable at production load.",
  },
  {
    provider: "Domain",
    plan: "Annual",
    // $13/yr ÷ 12 = $1.083/mo. Confirmed with Henry 2026-09-11.
    monthly_usd: 1.08,
    notes: "getvela.xyz. $13/yr amortized.",
  },
  {
    provider: "Vercel",
    plan: "Hobby (Free)",
    monthly_usd: 0,
    notes:
      "Free tier: unlimited deploys, 100 GB bandwidth. Not paying for Pro. Officially non-commercial but fine at this scale.",
  },
  {
    provider: "Resend",
    plan: "Free",
    monthly_usd: 0,
    notes: "3,000 emails/mo. Move to Pro at ~50 users.",
  },
  {
    provider: "Privy",
    plan: "Free",
    monthly_usd: 0,
    notes: "50K wallet signatures/mo. Move to paid at ~500 trading users.",
  },
  {
    provider: "CoinGecko",
    plan: "Free",
    monthly_usd: 0,
    notes: "10K calls/mo. Only used for daily-digest macro context.",
  },
  {
    provider: "Telegram Bot",
    plan: "Free",
    monthly_usd: 0,
    notes: "Bot API is free.",
  },
];

/**
 * Variable monthly costs. Trailing-30d estimates from measured data.
 * REFRESH periodically: LLM entries from `llm_call_log`, Stripe from dashboard.
 */
export const VARIABLE_INFRASTRUCTURE_COSTS: VariableInfrastructureCost[] = [
  {
    provider: "DeepSeek",
    category: "llm",
    monthly_usd_estimate: 4.4,
    measurement: "3,056 calls / $1.02 over 7 days ending 2026-09-09; extrapolated ×30/7.",
    notes:
      "Primary paid LLM provider. Classifier + enrichment paths. Scales with news volume.",
  },
  {
    provider: "Groq",
    category: "llm",
    monthly_usd_estimate: 0,
    measurement: "788 calls / $0 over 7 days ending 2026-09-09 (free tier).",
    notes: "Free tier, gpt-oss-120b primary. 200K TPD daily cap — monitor headroom.",
  },
  {
    provider: "NVIDIA",
    category: "llm",
    monthly_usd_estimate: 0,
    measurement: "139 calls / $0 over 7 days ending 2026-09-09 (free tier).",
    notes: "Fallback provider, free tier. See incident_2026_07_nvidia_silent_eol.md.",
  },
  {
    provider: "Anthropic",
    category: "llm",
    monthly_usd_estimate: 0,
    measurement:
      "0 paid calls observed in 7d window ending 2026-09-09. Whitelisted for signal_explanation / news_summary / news_vela_take last-resort only.",
    notes:
      "Zero at current traffic. Any cost from this line indicates last-resort fallback firing (investigate why cheaper providers didn't serve).",
  },
  {
    provider: "Stripe",
    category: "payments",
    monthly_usd_estimate: 0,
    measurement: "Not yet computed; depends on subscription mix.",
    notes: "2.9% + $0.30 per subscription charge. At 6 paid subs today, roughly $1-2/mo.",
  },
];

export const TOTAL_MONTHLY_FIXED_USD = FIXED_INFRASTRUCTURE_COSTS.reduce(
  (sum, item) => sum + item.monthly_usd,
  0,
);

export const TOTAL_MONTHLY_VARIABLE_USD = VARIABLE_INFRASTRUCTURE_COSTS.reduce(
  (sum, item) => sum + item.monthly_usd_estimate,
  0,
);

export const TOTAL_MONTHLY_ESTIMATED_USD =
  TOTAL_MONTHLY_FIXED_USD + TOTAL_MONTHLY_VARIABLE_USD;
