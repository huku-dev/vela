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
