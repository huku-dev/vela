import { describe, it, expect } from 'vitest';
import { formatPrice, parsePriceSegments } from './helpers';

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
