import type { TierConfig, SubscriptionTier } from '../types';

/**
 * Hardcoded tier definitions for the upgrade comparison UI.
 * These will eventually come from the `tier_configs` table in Supabase,
 * but are defined here until the backend is wired up.
 */
export const TIER_DEFINITIONS: TierConfig[] = [
  {
    tier: 'free',
    display_name: 'Free',
    trade_fee_pct: 0,
    max_position_size_usd: 0,
    max_leverage: 0,
    signal_frequency_hours: 4,
    max_active_positions: 0,
    max_assets: 1,
    features: {
      auto_mode: false,
      semi_auto: false,
      view_only: true,
      email_alerts: true,
      telegram_alerts: false,
    },
    monthly_price_usd: 0,
    annual_price_usd: 0,
  },
  {
    tier: 'standard',
    display_name: 'Standard',
    trade_fee_pct: 0.1,
    max_position_size_usd: 20_000,
    max_leverage: 5,
    signal_frequency_hours: 2,
    max_active_positions: 3,
    max_assets: 3,
    features: {
      auto_mode: false,
      semi_auto: true,
      view_only: true,
      email_alerts: true,
      telegram_alerts: true,
    },
    monthly_price_usd: 29,
    annual_price_usd: 290,
  },
  {
    tier: 'premium',
    display_name: 'Premium',
    trade_fee_pct: 0,
    max_position_size_usd: 0, // 0 = unlimited
    max_leverage: 20,
    signal_frequency_hours: 1,
    max_active_positions: 10,
    max_assets: 0, // 0 = unlimited
    features: {
      auto_mode: true,
      semi_auto: true,
      view_only: true,
      email_alerts: true,
      telegram_alerts: true,
    },
    monthly_price_usd: 79,
    annual_price_usd: 790,
  },
];

/** Feature rows for the tier comparison table */
export const COMPARISON_FEATURES: {
  key: string;
  label: string;
  getValue: (tier: TierConfig) => string;
}[] = [
  {
    key: 'assets',
    label: 'Assets tracked',
    getValue: t => (t.max_assets === 0 ? 'Unlimited' : String(t.max_assets)),
  },
  {
    key: 'mode',
    label: 'Trading mode',
    getValue: t =>
      t.features.auto_mode ? 'Full auto' : t.features.semi_auto ? 'Semi-auto' : 'View only',
  },
  {
    key: 'signal',
    label: 'Signal frequency',
    getValue: t => `Every ${t.signal_frequency_hours}h`,
  },
  {
    key: 'position',
    label: 'Max position size',
    getValue: t =>
      t.tier === 'free'
        ? '\u2014'
        : t.max_position_size_usd === 0
          ? 'Unlimited'
          : `$${t.max_position_size_usd.toLocaleString()}`,
  },
  {
    key: 'leverage',
    label: 'Max leverage',
    getValue: t => (t.tier === 'free' ? '\u2014' : `${t.max_leverage}x`),
  },
  {
    key: 'positions',
    label: 'Active positions',
    getValue: t => (t.tier === 'free' ? '\u2014' : String(t.max_active_positions)),
  },
  {
    key: 'fee',
    label: 'Fee per trade',
    getValue: t =>
      t.tier === 'free' ? '\u2014' : t.trade_fee_pct > 0 ? `${t.trade_fee_pct}%` : 'Free',
  },
  {
    key: 'telegram',
    label: 'Telegram alerts',
    getValue: t => (t.features.telegram_alerts ? 'Yes' : 'No'),
  },
];

/** Get a single tier definition by tier name */
export function getTierConfig(tier: SubscriptionTier): TierConfig {
  return TIER_DEFINITIONS.find(t => t.tier === tier) ?? TIER_DEFINITIONS[0];
}
