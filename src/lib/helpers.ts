import type { Brief, BriefGroup, SignalColor } from '../types';

/**
 * Breaks a block of text into paragraphs of ~2-3 sentences each,
 * to improve readability (addresses the "wall of text" feedback).
 */
export function breakIntoParagraphs(text: string, sentencesPerParagraph = 3): string[] {
  if (!text) return [];

  // Split on sentence boundaries (period + space + capital letter, or end of string)
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];

  const paragraphs: string[] = [];
  let current = '';
  let count = 0;

  for (const sentence of sentences) {
    current += sentence;
    count++;
    if (count >= sentencesPerParagraph) {
      paragraphs.push(current.trim());
      current = '';
      count = 0;
    }
  }

  if (current.trim()) {
    paragraphs.push(current.trim());
  }

  return paragraphs;
}

/**
 * Strips redundant asset name/symbol prefix from brief headlines.
 * e.g. "HYPE: no clear direction" → "No clear direction"
 */
export function stripAssetPrefix(headline: string, symbol: string): string {
  if (!headline || !symbol) return headline;

  // Match patterns like "HYPE: ...", "HYPE - ...", "Bitcoin: ..."
  const regex = new RegExp(`^${symbol}\\s*[:–—-]\\s*`, 'i');
  const stripped = headline.replace(regex, '');

  if (stripped === headline) return headline;

  // Capitalize first letter of remaining text
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Maps CoinGecko IDs to their image URLs.
 * Uses coin-images.coingecko.com CDN for reliable icons.
 */
export function getCoinIcon(coingeckoId: string): string {
  // Debug logging
  console.log('getCoinIcon called with:', coingeckoId);

  // Direct mapping for our tracked assets - try multiple possible IDs for HYPE
  const icons: Record<string, string> = {
    bitcoin: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
    ethereum: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
    hyperliquid: 'https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg',
    hype: 'https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg',
    'hyperliquid-hype':
      'https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg',
  };

  const iconUrl = icons[coingeckoId] || '';
  console.log('Returning icon URL:', iconUrl, 'for ID:', coingeckoId);

  return iconUrl;
}

/**
 * Formats a price for display — adaptive decimal places.
 */
export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '—';
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1)
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${price.toFixed(4)}`;
}

/**
 * Splits text into segments, highlighting dollar amounts with styled spans.
 * Returns an array of strings and objects: { type: 'price', value: string }
 * so the caller can render them with appropriate styling.
 */
export interface PriceSegment {
  type: 'text' | 'price';
  value: string;
}

export function parsePriceSegments(text: string): PriceSegment[] {
  if (!text) return [];

  const priceRegex = /\$[\d,]+(?:\.\d+)?/g;
  const segments: PriceSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = priceRegex.exec(text)) !== null) {
    // Add text before the price
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    // Add the price
    segments.push({ type: 'price', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Friendly indicator labels — spells out abbreviations for clarity.
 */
export const indicatorLabels: Record<string, string> = {
  ema_9: 'Short Trend (EMA 9)',
  ema_21: 'Medium Trend (EMA 21)',
  rsi_14: 'Momentum (RSI 14)',
  sma_50_daily: '50-Day Average (SMA 50)',
  adx_4h: 'Trend Strength (ADX)',
};

/**
 * Groups an array of briefs (newest-first) by signal state.
 *
 * Briefs with the same signal color are grouped together. A new group
 * only starts when the signal color actually changes (regardless of
 * brief_type). This avoids showing separate cards for the same signal.
 *
 * If the signal lookup is empty (no signal_ids matched), all briefs
 * are placed in a single group using `fallbackColor`.
 *
 * @param briefs — ordered newest-first (as returned by Supabase)
 * @param signalLookup — maps signal_id → SignalColor (from the signals table)
 * @param fallbackColor — color to use when lookup misses (e.g. current signal color)
 * @returns BriefGroup[] — ordered newest-first
 */
export function groupBriefsBySignalState(
  briefs: Brief[],
  signalLookup: Record<string, SignalColor>,
  fallbackColor: SignalColor = 'grey'
): BriefGroup[] {
  if (!briefs.length) return [];

  // Resolve each brief's signal color
  const resolvedBriefs = briefs.map(b => ({
    brief: b,
    color: (b.signal_id ? signalLookup[b.signal_id] : null) ?? fallbackColor,
  }));

  const groups: BriefGroup[] = [];
  let currentColor = resolvedBriefs[0].color;
  let currentBriefs: Brief[] = [resolvedBriefs[0].brief];
  // Track whether any brief in the group is a signal_change
  let hasSignalChange = resolvedBriefs[0].brief.brief_type === 'signal_change';

  for (let i = 1; i < resolvedBriefs.length; i++) {
    const { brief, color } = resolvedBriefs[i];

    if (color !== currentColor) {
      // Color changed — flush current group
      groups.push({
        type: hasSignalChange ? 'signal_change' : 'continuation',
        signalColor: currentColor,
        briefs: currentBriefs,
        dateRange: [
          currentBriefs[currentBriefs.length - 1].created_at,
          currentBriefs[0].created_at,
        ],
      });
      currentBriefs = [brief];
      currentColor = color;
      hasSignalChange = brief.brief_type === 'signal_change';
    } else {
      // Same color — add to group
      currentBriefs.push(brief);
      if (brief.brief_type === 'signal_change') hasSignalChange = true;
    }
  }

  // Flush remaining
  if (currentBriefs.length > 0) {
    groups.push({
      type: hasSignalChange ? 'signal_change' : 'continuation',
      signalColor: currentColor,
      briefs: currentBriefs,
      dateRange: [currentBriefs[currentBriefs.length - 1].created_at, currentBriefs[0].created_at],
    });
  }

  return groups;
}
