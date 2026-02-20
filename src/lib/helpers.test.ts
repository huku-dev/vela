import { describe, it, expect } from 'vitest';
import { formatPrice, parsePriceSegments, breakIntoParagraphs } from './helpers';

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
