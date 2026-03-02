import { useCallback, useRef, useState } from 'react';

// ── Types ──

interface ShareTradeData {
  symbol: string;
  direction: 'long' | 'short' | string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  /** Duration string e.g. "3d 2h" */
  duration?: string;
  /** Leverage multiplier */
  leverage?: number;
}

interface ShareTradeCardProps {
  trade: ShareTradeData;
}

// ── Canvas Image Generator ──

const CARD_WIDTH = 600;
const CARD_HEIGHT = 340;

function generateTradeImage(trade: ShareTradeData): string {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const isProfit = trade.pnlPct >= 0;
  const accentColor = isProfit ? '#00D084' : '#FF4757';
  const bgColor = '#0A0A0A';
  const textPrimary = '#FFFBF5';
  const textMuted = '#9CA3AF';

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Accent bar (left edge)
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 5, CARD_HEIGHT);

  // Vela branding (top-right)
  ctx.fillStyle = textMuted;
  ctx.font = '600 14px "Space Grotesk", "Inter", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('vela', CARD_WIDTH - 28, 36);

  // Asset symbol + direction
  ctx.fillStyle = textPrimary;
  ctx.font = '800 36px "Space Grotesk", "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(trade.symbol, 32, 56);

  const dirLabel = trade.direction === 'long' ? 'LONG' : trade.direction === 'short' ? 'SHORT' : trade.direction.toUpperCase();
  const dirColor = trade.direction === 'long' ? '#00D084' : trade.direction === 'short' ? '#FF4757' : textMuted;

  ctx.fillStyle = dirColor;
  ctx.font = '700 16px "Inter", sans-serif';
  // Measure symbol width with the heading font used above
  ctx.font = '800 36px "Space Grotesk", "Inter", sans-serif';
  const actualSymbolWidth = ctx.measureText(trade.symbol).width;
  ctx.font = '700 16px "Inter", sans-serif';
  ctx.fillText(dirLabel, 32 + actualSymbolWidth + 12, 56);

  if (trade.leverage && trade.leverage > 1) {
    ctx.fillStyle = textMuted;
    ctx.font = '600 14px "Inter", sans-serif';
    ctx.font = '700 16px "Inter", sans-serif';
    const actualDirWidth = ctx.measureText(dirLabel).width;
    ctx.font = '600 14px "Inter", sans-serif';
    ctx.fillText(`${trade.leverage}x`, 32 + actualSymbolWidth + 12 + actualDirWidth + 8, 56);
  }

  // Separator line
  ctx.strokeStyle = '#1F2937';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 80);
  ctx.lineTo(CARD_WIDTH - 32, 80);
  ctx.stroke();

  // P&L (large, center)
  const pnlStr = `${isProfit ? '+' : ''}${trade.pnlPct.toFixed(1)}%`;
  ctx.fillStyle = accentColor;
  ctx.font = '800 72px "Space Grotesk", "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(pnlStr, CARD_WIDTH / 2, 170);

  // Result label
  ctx.fillStyle = textMuted;
  ctx.font = '500 16px "Inter", sans-serif';
  ctx.fillText(isProfit ? 'profit' : 'loss', CARD_WIDTH / 2, 196);

  // Bottom separator
  ctx.strokeStyle = '#1F2937';
  ctx.beginPath();
  ctx.moveTo(32, 220);
  ctx.lineTo(CARD_WIDTH - 32, 220);
  ctx.stroke();

  // Entry → Exit prices
  ctx.fillStyle = textMuted;
  ctx.font = '500 14px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Entry', 32, 254);
  ctx.fillText('Exit', CARD_WIDTH / 2 + 16, 254);

  ctx.fillStyle = textPrimary;
  ctx.font = '600 18px "JetBrains Mono", monospace, "Inter", sans-serif';
  ctx.fillText(formatCardPrice(trade.entryPrice), 32, 278);
  ctx.fillText(formatCardPrice(trade.exitPrice), CARD_WIDTH / 2 + 16, 278);

  // Arrow between entry and exit
  ctx.fillStyle = textMuted;
  ctx.font = '400 18px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('→', CARD_WIDTH / 2, 278);

  // Duration (if available)
  if (trade.duration) {
    ctx.fillStyle = textMuted;
    ctx.font = '500 14px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Duration', 32, 316);

    ctx.fillStyle = textPrimary;
    ctx.font = '600 14px "Inter", sans-serif';
    ctx.fillText(trade.duration, 110, 316);
  }

  // "getvela.xyz" branding (bottom-right)
  ctx.fillStyle = textMuted;
  ctx.font = '500 12px "Inter", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('getvela.xyz', CARD_WIDTH - 28, 316);

  return canvas.toDataURL('image/png');
}

function formatCardPrice(price: number): string {
  if (price >= 10000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (price >= 100) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

// ── Share Button Component ──

export default function ShareTradeCard({ trade }: ShareTradeCardProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const handleShare = useCallback(async () => {
    const dataUrl = generateTradeImage(trade);
    setImageUrl(dataUrl);

    // Try native share first (mobile)
    if (navigator.share && navigator.canShare) {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], `vela-${trade.symbol.toLowerCase()}-trade.png`, {
          type: 'image/png',
        });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `${trade.symbol} ${trade.direction.toUpperCase()} — ${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%`,
          });
          return;
        }
      } catch {
        // User cancelled or share failed — fall through to download
      }
    }

    // Fallback: show preview with download
    setShowPreview(true);
  }, [trade]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    const a = linkRef.current;
    if (a) {
      a.href = imageUrl;
      a.download = `vela-${trade.symbol.toLowerCase()}-trade.png`;
      a.click();
    }
  }, [imageUrl, trade.symbol]);

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        className="vela-btn vela-btn-ghost vela-btn-sm"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontSize: 13,
        }}
        aria-label={`Share ${trade.symbol} trade result`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        Share
      </button>

      {/* Hidden download link */}
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/anchor-is-valid */}
      <a ref={linkRef} download style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />

      {/* Preview overlay */}
      {showPreview && imageUrl && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="dialog"
          aria-label="Trade card preview"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setShowPreview(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setShowPreview(false);
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              maxWidth: '90vw',
            }}
          >
            <img
              src={imageUrl}
              alt={`${trade.symbol} trade card`}
              style={{
                maxWidth: '100%',
                borderRadius: 'var(--radius-md)',
                border: '2px solid var(--gray-600)',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="vela-btn vela-btn-primary vela-btn-sm"
                onClick={handleDownload}
              >
                Download image
              </button>
              <button
                className="vela-btn vela-btn-ghost vela-btn-sm"
                onClick={() => setShowPreview(false)}
                style={{ color: 'var(--white)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
