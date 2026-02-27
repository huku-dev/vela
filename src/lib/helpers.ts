import type { Brief, BriefGroup, SignalColor } from '../types';

/**
 * Breaks a block of text into paragraphs of ~2-3 sentences each,
 * to improve readability (addresses the "wall of text" feedback).
 */
export function breakIntoParagraphs(text: string, sentencesPerParagraph = 3): string[] {
  if (!text) return [];

  // Split on sentence boundaries, but NOT after:
  //   - Decimal points in numbers (e.g. "$29.86")
  //   - Single-letter abbreviations (e.g. "U.S.", "E.U.", "A.I.")
  // Strategy: replace abbreviation periods with a placeholder, split, then restore.
  const ABBR_PLACEHOLDER = '\u200B'; // zero-width space
  const escaped = text.replace(/\b([A-Z]\.){2,}/g, match =>
    match.split('.').join(ABBR_PLACEHOLDER)
  );
  const sentences = escaped.match(/(?:[^.!?]|\.(?=\d))*[.!?]+[\s]*/g) || [escaped];

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

  // Restore abbreviation periods
  return paragraphs.map(p => p.split(ABBR_PLACEHOLDER).join('.'));
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
    solana: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png',
    sol: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png',
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
 * Replaces technical jargon with plain-english equivalents.
 * Applied to AI-generated text (e.g. what_would_change) so the UI stays
 * consistent with our indicator labels.
 */
const jargonMap: [RegExp, string][] = [
  // Specific indicator patterns first
  [/\bEMA\s*\(?9\)?/gi, 'short-term average'],
  [/\bEMA\s*\(?21\)?/gi, 'medium-term average'],
  [/\bSMA\s*\(?50\)?/gi, '50-day average'],
  [/\bRSI\s*\(?14\)?/gi, 'buying pressure'],
  [/\bADX\s*\(?4[hH]\)?/gi, 'trend strength'],
  [/\bcrossover\b/gi, 'cross above'],
  [/\bcrossunder\b/gi, 'cross below'],

  // Contextual phrases (before generic catch-alls to avoid partial matches)
  [/\boversold\s+levels?\b/gi, 'low buying activity'],
  [/\boverbought\s+levels?\b/gi, 'high buying activity'],
  [/\bbullish\s+divergence\b/gi, 'early signs of a turnaround'],
  [/\bbearish\s+divergence\b/gi, 'early signs of weakness'],
  [/\bmomentum\s+shift(?:s|ing)\b/gi, 'pressure changing'],
  [/\bconsolidation\b/gi, 'sideways movement'],
  [/\bsupport\s+level\b/gi, 'price floor'],
  [/\bresistance\s+level\b/gi, 'price ceiling'],
  [/\bstop[_\s-]?loss\b/gi, 'safety net triggered'],
  [/\btrend[_\s-]?break\b/gi, 'trend reversed'],
  [/\btrailing[_\s-]?stop\b/gi, 'trailing safety net'],
  [/\bliquidat(?:ion|ed)\b/gi, 'position closed by exchange'],
  [/\bvolatility\b/gi, 'price swings'],
  [/\bretracement\b/gi, 'pullback'],
  [/\bbreakout\b/gi, 'price broke through'],

  // Generic catch-alls last
  [/\bEMA\b/gi, 'moving average'],
  [/\bSMA\b/gi, 'moving average'],
  [/\bRSI\b/gi, 'buying pressure'],
  [/\bADX\b/gi, 'trend strength'],
  [/\bMACD\b/gi, 'trend momentum'],
];

export function plainEnglish(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, replacement] of jargonMap) {
    result = result.replace(pattern, replacement);
  }
  return result;
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

// ── Signal reason code → plain English (fallback when no brief headline exists) ──

const reasonCodeMap: Record<string, string> = {
  ema_cross_up: 'Short-term trend crossed above medium-term — momentum shifting up',
  ema_cross_down: 'Short-term trend crossed below medium-term — momentum shifting down',
  stop_loss: 'Price dropped below safety threshold',
  trend_break: 'Underlying trend reversed direction',
  chop: 'Market choppy with no clear direction',
  trailing_stop: 'Locked in profit as price reversed',
  profit_ladder: 'Locked in partial profit at milestone',
  bb2_expiry: 'Short-term trade reached its time limit',
  bb2_target: 'Short-term trade hit its profit target',
  bb2_stop: 'Short-term trade hit its safety stop',
  rsi_out_of_range: 'Buying pressure hit extreme levels',
  trend_disagree: 'Short-term and long-term trends conflicted',
  anti_whipsaw: 'Signal held steady through market noise',
  no_change: 'No significant change in conditions',
};

/**
 * Maps a signal engine reason code to a plain English sentence.
 * Returns null for unknown/undefined codes — caller falls back to showing nothing.
 */
export function reasonCodeToPlainEnglish(code: string | undefined | null): string | null {
  if (!code) return null;
  return reasonCodeMap[code] ?? null;
}

// ── Cost of delay (signal price vs execution price) ──

/**
 * Calculates the price difference between when Vela signaled and when the user's
 * trade actually executed. Direction-aware: for longs, higher execution = cost.
 * For shorts, lower execution = cost.
 */
export function computeCostOfDelay(
  signalPrice: number,
  executionPrice: number,
  side: 'long' | 'short',
  positionSize: number
): { delayPct: number; delayDollar: number } {
  if (signalPrice === 0) return { delayPct: 0, delayDollar: 0 };

  const rawPct =
    side === 'long'
      ? ((executionPrice - signalPrice) / signalPrice) * 100
      : ((signalPrice - executionPrice) / signalPrice) * 100;

  const delayPct = Math.round(rawPct * 100) / 100;
  const delayDollar = Math.round((rawPct / 100) * positionSize * 100) / 100;

  return { delayPct, delayDollar };
}
