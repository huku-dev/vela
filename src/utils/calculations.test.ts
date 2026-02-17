import { describe, it, expect } from 'vitest';
import {
  calculatePnL,
  calculatePnLPercentage,
  formatPrice,
  formatPercentChange,
  isDataStale,
  validateSignalStatusAlignment,
} from './calculations';

describe('calculatePnL - TRUST CRITICAL', () => {
  it('calculates profit correctly for winning trade', () => {
    const entryPrice = 100;
    const exitPrice = 110;
    const amount = 10;

    const pnl = calculatePnL(entryPrice, exitPrice, amount);

    // (110 - 100) * 10 = 100
    expect(pnl).toBe(100);
  });

  it('calculates loss correctly for losing trade', () => {
    const entryPrice = 100;
    const exitPrice = 90;
    const amount = 10;

    const pnl = calculatePnL(entryPrice, exitPrice, amount);

    // (90 - 100) * 10 = -100
    expect(pnl).toBe(-100);
  });

  it('CRITICAL: never shows positive P&L for losing trade', () => {
    const entryPrice = 50000;
    const exitPrice = 45000;
    const amount = 1;

    const pnl = calculatePnL(entryPrice, exitPrice, amount);

    expect(pnl).toBeLessThan(0);
    expect(pnl).toBe(-5000);
  });

  it('rounds to 2 decimal places for USD', () => {
    const entryPrice = 100.123;
    const exitPrice = 105.789;
    const amount = 10;

    const pnl = calculatePnL(entryPrice, exitPrice, amount);

    // Should round to cents
    expect(pnl).toBe(56.66);
  });

  it('throws error for zero or negative prices', () => {
    expect(() => calculatePnL(0, 100, 10)).toThrow();
    expect(() => calculatePnL(100, 0, 10)).toThrow();
    expect(() => calculatePnL(-100, 100, 10)).toThrow();
  });

  it('throws error for zero or negative amount', () => {
    expect(() => calculatePnL(100, 110, 0)).toThrow();
    expect(() => calculatePnL(100, 110, -10)).toThrow();
  });

  it('handles very large trade amounts accurately', () => {
    const entryPrice = 45000;
    const exitPrice = 46000;
    const amount = 100;

    const pnl = calculatePnL(entryPrice, exitPrice, amount);

    expect(pnl).toBe(100000);
  });
});

describe('calculatePnLPercentage - TRUST CRITICAL', () => {
  it('calculates positive percentage correctly', () => {
    const entryPrice = 100;
    const exitPrice = 110;

    const percentage = calculatePnLPercentage(entryPrice, exitPrice);

    // (110 - 100) / 100 * 100 = 10%
    expect(percentage).toBe(10.0);
  });

  it('calculates negative percentage correctly', () => {
    const entryPrice = 100;
    const exitPrice = 90;

    const percentage = calculatePnLPercentage(entryPrice, exitPrice);

    // (90 - 100) / 100 * 100 = -10%
    expect(percentage).toBe(-10.0);
  });

  it('CRITICAL: never shows positive % for price decline', () => {
    const entryPrice = 50000;
    const exitPrice = 45000;

    const percentage = calculatePnLPercentage(entryPrice, exitPrice);

    expect(percentage).toBeLessThan(0);
    expect(percentage).toBe(-10.0);
  });

  it('rounds to 1 decimal place', () => {
    const entryPrice = 100;
    const exitPrice = 102.34;

    const percentage = calculatePnLPercentage(entryPrice, exitPrice);

    expect(percentage).toBe(2.3);
  });

  it('handles small percentage changes accurately', () => {
    const entryPrice = 45000;
    const exitPrice = 45050;

    const percentage = calculatePnLPercentage(entryPrice, exitPrice);

    // (45050 - 45000) / 45000 * 100 = 0.11%
    expect(percentage).toBe(0.1);
  });

  it('throws error for zero or negative prices', () => {
    expect(() => calculatePnLPercentage(0, 100)).toThrow();
    expect(() => calculatePnLPercentage(100, 0)).toThrow();
    expect(() => calculatePnLPercentage(-100, 100)).toThrow();
  });
});

describe('formatPrice', () => {
  it('formats USD price with 2 decimal places by default', () => {
    expect(formatPrice(45230.5)).toBe('$45,230.50');
    expect(formatPrice(100)).toBe('$100.00');
    expect(formatPrice(0.5)).toBe('$0.50');
  });

  it('formats large numbers with commas', () => {
    expect(formatPrice(1234567.89)).toBe('$1,234,567.89');
  });

  it('handles custom decimal places', () => {
    expect(formatPrice(45230.5678, 4)).toBe('$45,230.5678');
    expect(formatPrice(100, 0)).toBe('$100');
  });

  it('throws error for invalid input', () => {
    expect(() => formatPrice(NaN)).toThrow();
    expect(() => formatPrice('not a number' as unknown as number)).toThrow();
  });

  it('handles negative prices', () => {
    expect(formatPrice(-100.5)).toBe('-$100.50');
  });
});

describe('formatPercentChange', () => {
  it('formats positive change with + sign', () => {
    expect(formatPercentChange(5.2)).toBe('+5.2%');
    expect(formatPercentChange(0.1)).toBe('+0.1%');
  });

  it('formats negative change with - sign', () => {
    expect(formatPercentChange(-3.1)).toBe('-3.1%');
    expect(formatPercentChange(-0.5)).toBe('-0.5%');
  });

  it('formats zero with + sign', () => {
    expect(formatPercentChange(0)).toBe('+0.0%');
  });

  it('rounds to 1 decimal place', () => {
    expect(formatPercentChange(5.234)).toBe('+5.2%');
    expect(formatPercentChange(-3.789)).toBe('-3.8%');
  });

  it('throws error for invalid input', () => {
    expect(() => formatPercentChange(NaN)).toThrow();
    expect(() => formatPercentChange('not a number' as unknown as number)).toThrow();
  });
});

describe('isDataStale - TRUST CRITICAL', () => {
  it('returns false for fresh data (<5 minutes)', () => {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    expect(isDataStale(twoMinutesAgo)).toBe(false);
  });

  it('returns true for stale data (>5 minutes)', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    expect(isDataStale(tenMinutesAgo)).toBe(true);
  });

  it('handles exactly 5 minutes boundary', () => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Should be false at exactly 5 minutes (not yet stale)
    expect(isDataStale(fiveMinutesAgo)).toBe(false);
  });

  it('handles ISO timestamp strings', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    expect(isDataStale(tenMinutesAgo.toISOString())).toBe(true);
  });

  it('throws error for invalid timestamp', () => {
    expect(() => isDataStale('invalid-date')).toThrow();
  });

  it('CRITICAL: flags stale price data that could mislead users', () => {
    const now = new Date();
    const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000);

    // Price data older than 5 minutes is dangerously stale for trading
    expect(isDataStale(sixMinutesAgo)).toBe(true);
  });
});

describe('validateSignalStatusAlignment - TRUST CRITICAL', () => {
  it('CRITICAL: rejects BUY signal on strong negative trend', () => {
    const signal = 'BUY';
    const priceChange = -5.0; // Strong bearish move

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(false);
  });

  it('CRITICAL: rejects SELL signal on strong positive trend', () => {
    const signal = 'SELL';
    const priceChange = 5.0; // Strong bullish move

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(false);
  });

  it('allows BUY signal on positive trend', () => {
    const signal = 'BUY';
    const priceChange = 3.0;

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(true);
  });

  it('allows SELL signal on negative trend', () => {
    const signal = 'SELL';
    const priceChange = -3.0;

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(true);
  });

  it('allows BUY signal on small negative trend (consolidation)', () => {
    const signal = 'BUY';
    const priceChange = -1.0; // Small pullback in uptrend

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(true);
  });

  it('allows SELL signal on small positive trend (dead cat bounce)', () => {
    const signal = 'SELL';
    const priceChange = 1.0; // Small bounce in downtrend

    const isValid = validateSignalStatusAlignment(signal, priceChange);

    expect(isValid).toBe(true);
  });

  it('always allows WAIT signal regardless of trend', () => {
    expect(validateSignalStatusAlignment('WAIT', 5.0)).toBe(true);
    expect(validateSignalStatusAlignment('WAIT', -5.0)).toBe(true);
    expect(validateSignalStatusAlignment('WAIT', 0)).toBe(true);
  });
});
