import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  parsePriceSegments,
  breakIntoParagraphs,
  reasonCodeToPlainEnglish,
  computeCostOfDelay,
} from './helpers';

describe('formatPrice (adaptive decimals) - TRUST CRITICAL', () => {
  it('formats large prices (>=$1000) with no decimals and commas', () => {
    expect(formatPrice(45230)).toBe('$45,230');
    expect(formatPrice(89443)).toBe('$89,443');
    expect(formatPrice(1000)).toBe('$1,000');
  });

  it('formats medium prices (>=$1) with 2 decimals', () => {
    expect(formatPrice(29.15)).toBe('$29.15');
    expect(formatPrice(1.5)).toBe('$1.50');
    expect(formatPrice(999.99)).toBe('$999.99');
  });

  it('formats small prices (<$1) with 4 decimals', () => {
    expect(formatPrice(0.1234)).toBe('$0.1234');
    expect(formatPrice(0.0001)).toBe('$0.0001');
  });

  it('returns dash for null/undefined', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
  });

  it('CRITICAL: BTC-range prices display correctly', () => {
    expect(formatPrice(66940)).toBe('$66,940');
    expect(formatPrice(89443)).toBe('$89,443');
  });

  it('CRITICAL: ETH-range prices display correctly', () => {
    expect(formatPrice(1948)).toBe('$1,948');
    expect(formatPrice(3836)).toBe('$3,836');
  });

  it('CRITICAL: HYPE-range prices display correctly', () => {
    expect(formatPrice(29.15)).toBe('$29.15');
    expect(formatPrice(30.71)).toBe('$30.71');
  });
});

describe('breakIntoParagraphs - TRUST CRITICAL', () => {
  it('does not split on decimal points in prices like $29.86', () => {
    const text =
      'The signal would change if price breaks strongly upward through $29.86 or continues falling below $27.70.';
    const result = breakIntoParagraphs(text, 2);
    // Should be a single paragraph — $29.86 must not cause a split
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('$29.86');
  });

  it('still splits on real sentence boundaries', () => {
    const text =
      'Bitcoin is at $67,000. Ethereum is at $1,950. The market is fearful. Consider waiting.';
    const result = breakIntoParagraphs(text, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('Ethereum');
    expect(result[1]).toContain('Consider');
  });

  it('handles prices at end of sentence correctly', () => {
    const text =
      'The price dropped to $29.86. This is significant. A recovery would need momentum.';
    const result = breakIntoParagraphs(text, 2);
    // "$29.86." — the period after 86 IS a sentence end (not followed by digit)
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('$29.86');
    expect(result[0]).toContain('significant');
  });
});

describe('parsePriceSegments', () => {
  it('extracts dollar amounts from text', () => {
    const segments = parsePriceSegments('Price moved from $100 to $200');
    expect(segments).toEqual([
      { type: 'text', value: 'Price moved from ' },
      { type: 'price', value: '$100' },
      { type: 'text', value: ' to ' },
      { type: 'price', value: '$200' },
    ]);
  });

  it('handles text with no prices', () => {
    const segments = parsePriceSegments('No prices here');
    expect(segments).toEqual([{ type: 'text', value: 'No prices here' }]);
  });

  it('handles empty string', () => {
    expect(parsePriceSegments('')).toEqual([]);
  });

  it('handles prices with commas and decimals', () => {
    const segments = parsePriceSegments('BTC at $66,940.50');
    expect(segments).toEqual([
      { type: 'text', value: 'BTC at ' },
      { type: 'price', value: '$66,940.50' },
    ]);
  });
});

// ── reasonCodeToPlainEnglish ──

describe('reasonCodeToPlainEnglish', () => {
  it('maps known reason codes to plain English strings', () => {
    expect(reasonCodeToPlainEnglish('ema_cross_up')).toContain('momentum shifting up');
    expect(reasonCodeToPlainEnglish('ema_cross_down')).toContain('momentum shifting down');
    expect(reasonCodeToPlainEnglish('stop_loss')).toContain('safety threshold');
    expect(reasonCodeToPlainEnglish('trend_break')).toContain('reversed direction');
    expect(reasonCodeToPlainEnglish('chop')).toContain('choppy');
    expect(reasonCodeToPlainEnglish('trailing_stop')).toContain('profit');
    expect(reasonCodeToPlainEnglish('rsi_out_of_range')).toContain('extreme');
    expect(reasonCodeToPlainEnglish('trend_disagree')).toContain('conflicted');
    expect(reasonCodeToPlainEnglish('anti_whipsaw')).toContain('noise');
  });

  it('returns null for unknown reason codes', () => {
    expect(reasonCodeToPlainEnglish('unknown_code')).toBeNull();
    expect(reasonCodeToPlainEnglish('some_future_reason')).toBeNull();
  });

  it('returns null for undefined/null input', () => {
    expect(reasonCodeToPlainEnglish(undefined)).toBeNull();
    expect(reasonCodeToPlainEnglish(null)).toBeNull();
  });
});

// ── computeCostOfDelay — TRUST CRITICAL ──

describe('computeCostOfDelay - TRUST CRITICAL', () => {
  it('long trade: higher execution price = positive cost (user paid more)', () => {
    const result = computeCostOfDelay(100, 101, 'long', 1000);
    expect(result.delayPct).toBe(1);
    expect(result.delayDollar).toBe(10);
  });

  it('long trade: lower execution price = negative cost (user got a deal)', () => {
    const result = computeCostOfDelay(100, 99, 'long', 1000);
    expect(result.delayPct).toBe(-1);
    expect(result.delayDollar).toBe(-10);
  });

  it('short trade: lower execution price = positive cost (user sold lower)', () => {
    const result = computeCostOfDelay(100, 99, 'short', 1000);
    expect(result.delayPct).toBe(1);
    expect(result.delayDollar).toBe(10);
  });

  it('short trade: higher execution price = negative cost (user got a deal)', () => {
    const result = computeCostOfDelay(100, 101, 'short', 1000);
    expect(result.delayPct).toBe(-1);
    expect(result.delayDollar).toBe(-10);
  });

  it('zero difference returns zero cost', () => {
    const result = computeCostOfDelay(50000, 50000, 'long', 1000);
    expect(result.delayPct).toBe(0);
    expect(result.delayDollar).toBe(0);
  });

  it('handles zero signal price without crashing', () => {
    const result = computeCostOfDelay(0, 100, 'long', 1000);
    expect(result.delayPct).toBe(0);
    expect(result.delayDollar).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const result = computeCostOfDelay(100, 100.33, 'long', 1000);
    expect(result.delayPct).toBe(0.33);
    expect(result.delayDollar).toBe(3.3);
  });
});
