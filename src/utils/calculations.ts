/**
 * TRUST-CRITICAL CALCULATIONS
 * These functions handle financial data and must be exact.
 * Every function here MUST have comprehensive test coverage.
 */

/**
 * Calculate profit/loss for a trade
 * @param entryPrice - Price when entered trade
 * @param exitPrice - Price when exited trade
 * @param amount - Amount traded (in base currency)
 * @returns P&L in dollars (positive = profit, negative = loss)
 */
export function calculatePnL(entryPrice: number, exitPrice: number, amount: number): number {
  if (entryPrice <= 0 || exitPrice <= 0 || amount <= 0) {
    throw new Error('Prices and amount must be positive numbers');
  }

  const pnl = (exitPrice - entryPrice) * amount;

  // Round to 2 decimal places for USD
  return Math.round(pnl * 100) / 100;
}

/**
 * Calculate profit/loss percentage
 * @param entryPrice - Price when entered trade
 * @param exitPrice - Price when exited trade
 * @returns Percentage gain/loss (e.g., 5.2 for +5.2%)
 */
export function calculatePnLPercentage(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0 || exitPrice <= 0) {
    throw new Error('Prices must be positive numbers');
  }

  const percentChange = ((exitPrice - entryPrice) / entryPrice) * 100;

  // Round to 1 decimal place
  return Math.round(percentChange * 10) / 10;
}

/**
 * Format price with appropriate decimal places
 * @param price - Price to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted price string (e.g., "$45,230.50")
 */
export function formatPrice(price: number, decimals: number = 2): string {
  if (typeof price !== 'number' || isNaN(price)) {
    throw new Error('Price must be a valid number');
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}

/**
 * Format percentage change with sign
 * @param change - Percentage change value
 * @returns Formatted string (e.g., "+5.2%" or "-3.1%")
 */
export function formatPercentChange(change: number): string {
  if (typeof change !== 'number' || isNaN(change)) {
    throw new Error('Change must be a valid number');
  }

  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

/**
 * Calculate unrealized P&L percentage for an open position, accounting for direction.
 * TRUST-CRITICAL: Shorts profit when price falls, longs profit when price rises.
 * @param entryPrice - Price when position was opened
 * @param currentPrice - Current live price
 * @param direction - Trade direction ('long' or 'short')
 * @returns Unrealized P&L as a percentage (e.g., 52.5 for +52.5%)
 */
export function calculateUnrealizedPnL(
  entryPrice: number,
  currentPrice: number,
  direction: 'long' | 'short'
): number {
  if (entryPrice <= 0 || currentPrice <= 0) {
    throw new Error('Prices must be positive numbers');
  }

  const raw =
    direction === 'short'
      ? ((entryPrice - currentPrice) / entryPrice) * 100
      : ((currentPrice - entryPrice) / entryPrice) * 100;

  return Math.round(raw * 10) / 10;
}

/**
 * Convert a P&L percentage to a dollar amount given a position size.
 * TRUST-CRITICAL: This is the core formula used in stats and per-trade display.
 * @param pnlPct - Profit/loss percentage (e.g., 52.5 for +52.5%)
 * @param positionSize - Dollar position size (e.g., 1000)
 * @returns Dollar P&L, rounded to 2 decimal places
 */
export function pctToDollar(pnlPct: number, positionSize: number): number {
  if (positionSize <= 0) {
    throw new Error('Position size must be positive');
  }
  return Math.round((pnlPct / 100) * positionSize * 100) / 100;
}

/**
 * Aggregate trade stats from a list of closed trades.
 * TRUST-CRITICAL: These numbers are displayed prominently on the Your Trades page.
 * @param closedTrades - Array of objects with pnl_pct (non-null)
 * @param positionSize - Dollar position size per trade
 * @returns Aggregated stats: totalClosed, totalDollarPnl, avgPnlPct
 */
export function aggregateTradeStats(
  closedTrades: { pnl_pct: number }[],
  positionSize: number
): { totalClosed: number; totalDollarPnl: number; avgPnlPct: number } {
  const totalClosed = closedTrades.length;
  if (totalClosed === 0) {
    return { totalClosed: 0, totalDollarPnl: 0, avgPnlPct: 0 };
  }

  const totalDollarPnl = closedTrades.reduce(
    (sum, t) => sum + pctToDollar(t.pnl_pct, positionSize),
    0
  );

  const avgPnlPct =
    Math.round((closedTrades.reduce((sum, t) => sum + t.pnl_pct, 0) / totalClosed) * 10) / 10;

  return { totalClosed, totalDollarPnl, avgPnlPct };
}

/**
 * Format a time duration from milliseconds into human-readable form.
 * Used for both open trade durations and closed trade holding periods.
 * @param ms - Duration in milliseconds
 * @returns Human-readable string (e.g., "3d 14h", "6h", "<1h")
 */
export function formatDurationMs(ms: number): string {
  if (ms < 0) return '<1h';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  if (hours > 0) return `${hours}h`;
  return '<1h';
}

/**
 * Detailed breakdown stats for the Performance Breakdown section.
 * TRUST-CRITICAL: These numbers inform user decisions about strategy.
 */
export interface DetailedTradeStats {
  wins: number;
  losses: number;
  bestTradeDollar: number;
  bestTradeAsset: string;
  bestTradeDate: string;
  worstTradeDollar: number;
  worstTradeAsset: string;
  worstTradeDate: string;
  longCount: number;
  longWins: number;
  shortCount: number;
  shortWins: number;
  avgDurationMs: number;
  longestDurationMs: number;
  shortestDurationMs: number;
}

/**
 * Compute detailed trade stats for the Performance Breakdown section.
 * TRUST-CRITICAL: All financial metrics must be accurate.
 * @param closedTrades - Array of closed trades with required fields
 * @param positionSize - Dollar position size per trade
 * @returns Detailed stats breakdown
 */
export function computeDetailedStats(
  closedTrades: {
    pnl_pct: number;
    direction?: string | null;
    asset_id: string;
    asset_symbol?: string;
    closed_at?: string | null;
    opened_at: string;
  }[],
  positionSize: number
): DetailedTradeStats {
  const empty: DetailedTradeStats = {
    wins: 0,
    losses: 0,
    bestTradeDollar: 0,
    bestTradeAsset: '',
    bestTradeDate: '',
    worstTradeDollar: 0,
    worstTradeAsset: '',
    worstTradeDate: '',
    longCount: 0,
    longWins: 0,
    shortCount: 0,
    shortWins: 0,
    avgDurationMs: 0,
    longestDurationMs: 0,
    shortestDurationMs: 0,
  };

  if (closedTrades.length === 0) return empty;

  // Win/loss counts
  const wins = closedTrades.filter(t => t.pnl_pct >= 0).length;
  const losses = closedTrades.length - wins;

  // Best/worst trade by dollar P&L
  let bestTrade = closedTrades[0];
  let worstTrade = closedTrades[0];
  for (const t of closedTrades) {
    if (t.pnl_pct > bestTrade.pnl_pct) bestTrade = t;
    if (t.pnl_pct < worstTrade.pnl_pct) worstTrade = t;
  }

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  // Direction breakdown — exclude trims (partial exits, not directional bets)
  const nonTrimTrades = closedTrades.filter(t => t.direction !== 'trim');
  const longs = nonTrimTrades.filter(
    t => !t.direction || t.direction === 'long' || t.direction === 'bb_long'
  );
  const shorts = nonTrimTrades.filter(t => t.direction === 'short' || t.direction === 'bb_short');

  // Duration stats — only trades with both dates
  const durations = closedTrades
    .filter(t => t.opened_at && t.closed_at)
    .map(t => new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime())
    .filter(d => d >= 0);

  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
  const longestDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
  const shortestDurationMs = durations.length > 0 ? Math.min(...durations) : 0;

  return {
    wins,
    losses,
    bestTradeDollar: pctToDollar(bestTrade.pnl_pct, positionSize),
    bestTradeAsset: bestTrade.asset_symbol || bestTrade.asset_id.toUpperCase(),
    bestTradeDate: formatDate(bestTrade.closed_at),
    worstTradeDollar: pctToDollar(worstTrade.pnl_pct, positionSize),
    worstTradeAsset: worstTrade.asset_symbol || worstTrade.asset_id.toUpperCase(),
    worstTradeDate: formatDate(worstTrade.closed_at),
    longCount: longs.length,
    longWins: longs.filter(t => t.pnl_pct >= 0).length,
    shortCount: shorts.length,
    shortWins: shorts.filter(t => t.pnl_pct >= 0).length,
    avgDurationMs,
    longestDurationMs,
    shortestDurationMs,
  };
}

/**
 * Check if price data is stale (>5 minutes old)
 * @param timestamp - ISO timestamp string or Date object
 * @returns true if data is stale (older than 5 minutes)
 */
export function isDataStale(timestamp: string | Date): boolean {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  const timestampDate = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  if (isNaN(timestampDate.getTime())) {
    throw new Error('Invalid timestamp');
  }

  const now = new Date();
  const ageMs = now.getTime() - timestampDate.getTime();

  return ageMs > STALE_THRESHOLD_MS;
}

/**
 * Validate that signal status matches price trend
 * This is a CRITICAL trust check - never show BUY on bearish data
 * @param signal - Signal status ('BUY', 'SELL', 'WAIT')
 * @param priceChange - Percentage price change
 * @returns true if signal and price change are aligned
 */
export function validateSignalStatusAlignment(
  signal: 'BUY' | 'SELL' | 'WAIT',
  priceChange: number
): boolean {
  // BUY signals should not be shown on negative trends
  if (signal === 'BUY' && priceChange < -2) {
    return false;
  }

  // SELL signals should not be shown on strong positive trends
  if (signal === 'SELL' && priceChange > 2) {
    return false;
  }

  return true;
}
