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
