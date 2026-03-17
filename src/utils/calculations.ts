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
 * Compute total position P&L from a parent close trade and its trims.
 * TRUST-CRITICAL: This is the core position-level P&L calculation.
 *
 * A position = 1 entry + N trims + 1 close.
 * Total P&L = close P&L (on remaining position) + sum of trim P&Ls.
 * Win = totalDollarPnl >= 0.
 *
 * @param parentPnlPct - The close trade's pnl_pct (entry→exit price change %)
 * @param trims - Array of trim trades with pnl_pct and trim_pct
 * @param positionSize - Dollar position size (e.g., 1000)
 * @returns Position-level P&L breakdown
 */
export function computePositionPnl(
  parentPnlPct: number,
  trims: { pnl_pct: number | null; trim_pct: number | null }[],
  positionSize: number
): {
  totalDollarPnl: number;
  totalPnlPct: number;
  closeDollarPnl: number;
  trimDollarPnl: number;
  costBasisPct: number;
  trimBreakdown: { dollarPnl: number; trimPct: number; costBasisAfter: number }[];
} {
  if (positionSize <= 0) {
    return {
      totalDollarPnl: 0,
      totalPnlPct: 0,
      closeDollarPnl: 0,
      trimDollarPnl: 0,
      costBasisPct: 100,
      trimBreakdown: [],
    };
  }

  // Each trim: dollar P&L = (trim.pnl_pct / 100) * (trim.trim_pct / 100) * positionSize
  let cumulativeTrimPct = 0;
  let trimDollarPnl = 0;
  const trimBreakdown: { dollarPnl: number; trimPct: number; costBasisAfter: number }[] = [];

  for (const trim of trims) {
    const trimPnlPct = trim.pnl_pct ?? 0;
    const trimPct = trim.trim_pct ?? 0;
    const dollarPnl = Math.round((trimPnlPct / 100) * (trimPct / 100) * positionSize * 100) / 100;
    trimDollarPnl += dollarPnl;
    cumulativeTrimPct += trimPct;
    trimBreakdown.push({
      dollarPnl,
      trimPct,
      costBasisAfter: Math.round((100 - cumulativeTrimPct) * 10) / 10,
    });
  }

  // Parent close: remaining fraction = 1 - cumulative trim fraction
  const remainingFraction = 1.0 - cumulativeTrimPct / 100;
  const closeDollarPnl =
    Math.round((parentPnlPct / 100) * remainingFraction * positionSize * 100) / 100;

  const totalDollarPnl = Math.round((closeDollarPnl + trimDollarPnl) * 100) / 100;
  const totalPnlPct = Math.round((totalDollarPnl / positionSize) * 100 * 10) / 10;
  const costBasisPct = Math.round((100 - cumulativeTrimPct) * 10) / 10;

  return {
    totalDollarPnl,
    totalPnlPct,
    closeDollarPnl,
    trimDollarPnl,
    costBasisPct,
    trimBreakdown,
  };
}

/**
 * Aggregate position-level stats from computed positions.
 * TRUST-CRITICAL: These numbers are displayed prominently on the Track Record page.
 * Replaces the old close-only aggregateTradeStats().
 *
 * @param positions - Array of position P&L results from computePositionPnl()
 * @returns Aggregated stats: totalClosed, wins, winRate, totalDollarPnl, avgPnlPct
 */
export function aggregatePositionStats(
  positions: { totalDollarPnl: number; totalPnlPct: number }[]
): {
  totalClosed: number;
  wins: number;
  winRate: number;
  totalDollarPnl: number;
  avgPnlPct: number;
} {
  const totalClosed = positions.length;
  if (totalClosed === 0) {
    return { totalClosed: 0, wins: 0, winRate: 0, totalDollarPnl: 0, avgPnlPct: 0 };
  }

  const wins = positions.filter(p => p.totalDollarPnl >= 0).length;
  const winRate = Math.round((wins / totalClosed) * 100 * 10) / 10;
  const totalDollarPnl =
    Math.round(positions.reduce((sum, p) => sum + p.totalDollarPnl, 0) * 100) / 100;
  const avgPnlPct =
    Math.round((positions.reduce((sum, p) => sum + p.totalPnlPct, 0) / totalClosed) * 10) / 10;

  return { totalClosed, wins, winRate, totalDollarPnl, avgPnlPct };
}

/**
 * @deprecated Use computePositionPnl() + aggregatePositionStats() instead.
 * Kept temporarily for backward compatibility during migration.
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
 * @param positionSize - Dollar position size per standard trade
 * @param bb2PositionSize - Optional position size for BB2 (quick opportunity) trades
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
  positionSize: number,
  bb2PositionSize?: number
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

  /** Get the correct position size for a given trade direction */
  const sizeForDirection = (d?: string | null): number =>
    bb2PositionSize != null && (d === 'bb2_long' || d === 'bb2_short')
      ? bb2PositionSize
      : positionSize;

  // Win/loss counts (by dollar P&L, respecting variable sizing)
  const wins = closedTrades.filter(
    t => pctToDollar(t.pnl_pct, sizeForDirection(t.direction)) >= 0
  ).length;
  const losses = closedTrades.length - wins;

  // Best/worst trade by dollar P&L (respecting variable sizing)
  let bestTrade = closedTrades[0];
  let bestDollar = pctToDollar(bestTrade.pnl_pct, sizeForDirection(bestTrade.direction));
  let worstTrade = closedTrades[0];
  let worstDollar = bestDollar;
  for (const t of closedTrades) {
    const dollar = pctToDollar(t.pnl_pct, sizeForDirection(t.direction));
    if (dollar > bestDollar) {
      bestTrade = t;
      bestDollar = dollar;
    }
    if (dollar < worstDollar) {
      worstTrade = t;
      worstDollar = dollar;
    }
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
    t =>
      !t.direction ||
      t.direction === 'long' ||
      t.direction === 'bb_long' ||
      t.direction === 'bb2_long'
  );
  const shorts = nonTrimTrades.filter(
    t => t.direction === 'short' || t.direction === 'bb_short' || t.direction === 'bb2_short'
  );

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
    bestTradeDollar: bestDollar,
    bestTradeAsset: bestTrade.asset_symbol || bestTrade.asset_id.toUpperCase(),
    bestTradeDate: formatDate(bestTrade.closed_at),
    worstTradeDollar: worstDollar,
    worstTradeAsset: worstTrade.asset_symbol || worstTrade.asset_id.toUpperCase(),
    worstTradeDate: formatDate(worstTrade.closed_at),
    longCount: longs.length,
    longWins: longs.filter(t => pctToDollar(t.pnl_pct, sizeForDirection(t.direction)) >= 0).length,
    shortCount: shorts.length,
    shortWins: shorts.filter(t => pctToDollar(t.pnl_pct, sizeForDirection(t.direction)) >= 0)
      .length,
    avgDurationMs,
    longestDurationMs,
    shortestDurationMs,
  };
}

/**
 * Get effective P&L values for a position, with client-side fallback.
 * TRUST-CRITICAL: When the backend fast loop hasn't updated unrealized_pnl
 * (e.g. stale data, E2E test positions), compute from entry/current prices.
 *
 * @param position - Must have entry_price, current_price, side, unrealized_pnl, unrealized_pnl_pct, size_usd
 * @returns { pnlPct, pnlDollar } — either from DB or computed client-side
 */
export function getEffectivePnl(
  position: {
    entry_price: number;
    current_price: number | null;
    side: 'long' | 'short';
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
    size_usd: number;
  },
  /** Live price override — use when a fresher price (e.g. CoinGecko) is available */
  livePriceOverride?: number | null,
): { pnlPct: number; pnlDollar: number } {
  const { entry_price, side, unrealized_pnl, unrealized_pnl_pct, size_usd } = position;

  // If a live price override is provided, always compute from it (freshest source)
  const bestPrice = livePriceOverride != null && livePriceOverride > 0
    ? livePriceOverride
    : position.current_price;

  // If DB P&L values are non-zero and no live override, trust them
  if (livePriceOverride == null && (unrealized_pnl !== 0 || unrealized_pnl_pct !== 0)) {
    return { pnlPct: unrealized_pnl_pct, pnlDollar: unrealized_pnl };
  }

  // Compute from best available price
  if (bestPrice != null && bestPrice > 0 && entry_price > 0) {
    const priceDiff = Math.abs(bestPrice - entry_price);
    // Only compute if prices meaningfully differ (>0.01% to avoid floating point noise)
    if (priceDiff / entry_price > 0.0001) {
      const pnlPct = calculateUnrealizedPnL(entry_price, bestPrice, side);
      const pnlDollar = pctToDollar(pnlPct, size_usd);
      return { pnlPct, pnlDollar };
    }
  }

  // Genuinely zero
  return { pnlPct: 0, pnlDollar: 0 };
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
