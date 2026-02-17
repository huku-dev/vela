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
 * Friendly indicator labels — spells out abbreviations for clarity.
 */
export const indicatorLabels: Record<string, string> = {
  ema_9: 'Short Trend (EMA 9)',
  ema_21: 'Medium Trend (EMA 21)',
  rsi_14: 'Momentum (RSI 14)',
  sma_50_daily: '50-Day Average (SMA 50)',
  adx_4h: 'Trend Strength (ADX)',
};
