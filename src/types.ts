export type SignalColor = 'green' | 'red' | 'grey';
export type BriefType = 'signal_change' | 'notable_update' | 'daily_digest';
export type TradeStatus = 'open' | 'closed';

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  coingecko_id: string;
  enabled: boolean;
}

export interface Signal {
  id: string;
  asset_id: string;
  timestamp: string;
  signal_color: SignalColor;
  reason_code: string;
  price_at_signal: number;
  ema_9: number;
  ema_21: number;
  rsi_14: number;
  sma_50_daily: number;
  adx_4h: number;
  created_at: string;
}

export interface Brief {
  id: string;
  asset_id: string | null;
  signal_id: string | null;
  brief_type: BriefType;
  headline: string;
  summary: string;
  detail: {
    signal_breakdown?: Record<string, string>;
    market_context?: Record<string, string>;
    what_would_change?: string;
    indicators?: {
      ema_9: number;
      ema_21: number;
      rsi_14: number;
      sma_50_daily: number;
      adx_4h: number;
    };
    price_at_brief?: number;
  } | null;
  context: string | null;
  created_at: string;
}

export type TradeSource = 'live' | 'backtest';
export type TradeDirection = 'long' | 'short' | 'trim' | 'bb_long' | 'bb_short';

export interface PaperTrade {
  id: string;
  asset_id: string;
  entry_signal_id: string;
  exit_signal_id: string | null;
  entry_price: number;
  exit_price: number | null;
  pnl_pct: number | null;
  status: TradeStatus;
  source: TradeSource;
  direction: TradeDirection | null;
  trim_pct: number | null;
  yellow_events: Array<{
    timestamp: string;
    rsi: number;
    type: string;
    suggested_action: string;
  }> | null;
  opened_at: string;
  closed_at: string | null;
}

export interface PaperTradeStats {
  asset_id: string;
  total_closed: number;
  wins: number;
  losses: number;
  avg_win_pct: number | null;
  avg_loss_pct: number | null;
}

export interface PriceData {
  price: number;
  change24h: number;
}

/**
 * A group of consecutive briefs sharing the same signal state.
 * Used by Recent Updates to collapse repetitive daily updates.
 */
export interface BriefGroup {
  /** 'signal_change' = this group starts with a signal flip; 'continuation' = same signal */
  type: 'signal_change' | 'continuation';
  /** Signal color during this group (green/red/grey) — null if unknown */
  signalColor: SignalColor | null;
  /** The briefs in this group, newest-first */
  briefs: Brief[];
  /** Date range as [oldest, newest] ISO strings */
  dateRange: [string, string];
}

export interface AssetDashboard {
  asset: Asset;
  signal: Signal | null;
  brief: Brief | null;
  priceData: PriceData | null;
}

// ── Phase 0: Auth & Subscription types ──────────────────

export type TradingMode = 'semi_auto' | 'full_auto' | 'view_only';
export type SubscriptionTier = 'free' | 'standard' | 'premium';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing';

export interface Profile {
  id: string;
  privy_did: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  privy_wallet_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  mode: TradingMode;
  default_position_size_usd: number;
  max_leverage: number;
  max_daily_loss_pct: number;
  max_position_pct: number;
  stop_loss_pct: number;
  allowed_assets: string[];
  notifications_telegram: boolean;
  notifications_email: boolean;
  created_at: string;
  updated_at: string;
}

export interface TierConfig {
  tier: SubscriptionTier;
  display_name: string;
  trade_fee_pct: number;
  max_position_size_usd: number;
  max_leverage: number;
  signal_frequency_hours: number;
  max_active_positions: number;
  max_assets: number;
  features: Record<string, boolean>;
  monthly_price_usd: number;
  annual_price_usd: number;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  billing_cycle: 'monthly' | 'annual' | null;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}
