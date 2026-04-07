import { useState, useEffect, useRef, useCallback } from 'react';
import { useBriefRating } from '../hooks/useBriefRating';
import { getCoinIcon, formatPrice } from '../lib/helpers';
import { track, AnalyticsEvent } from '../lib/analytics';
import type { SignalColor } from '../types';

// ── Types ──

interface EngagementCardProps {
  briefId: string;
  assetId: string;
  assetName: string;
  coingeckoId: string | null;
  iconUrl?: string | null;
  signal: SignalColor | null;
  price: number | null;
  priceChange24h: number | null;
  headline: string | null;
}

// ── Signal card image generator ──

const CARD_W = 1200;
const CARD_H = 628;

const SIGNAL_COLORS: Record<string, { accent: string; text: string }> = {
  green: { accent: '#0FE68C', text: '#0B9E5E' },
  red: { accent: '#FF4757', text: '#D63441' },
  grey: { accent: '#999999', text: '#666666' },
};

function generateSignalImage(props: {
  assetName: string;
  signal: SignalColor;
  price: number;
  priceChange24h: number | null;
  headline: string | null;
  iconImg: HTMLImageElement | null;
}): string {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  const colors = SIGNAL_COLORS[props.signal] || SIGNAL_COLORS.grey;
  const signalLabel = props.signal === 'green' ? 'BUY' : props.signal === 'red' ? 'SELL' : 'WAIT';

  // Background — cream
  ctx.fillStyle = '#FFFBF5';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Accent bar (top)
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, 0, CARD_W, 6);

  // Subtle gradient glow (top-left)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 400);
  const glowAlpha = props.signal === 'grey' ? '0a' : '14';
  glow.addColorStop(0, colors.accent + glowAlpha);
  glow.addColorStop(1, colors.accent + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 500, 280);

  // Asset icon (circle clipped)
  if (props.iconImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(64 + 26, 56 + 26, 26, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(props.iconImg, 64, 56, 52, 52);
    ctx.restore();
  }

  // Asset name
  ctx.fillStyle = '#0A0A0A';
  ctx.font = '800 42px "Space Grotesk", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(props.assetName, 132, 96);

  // Signal badge (right side)
  ctx.font = '700 18px "Space Grotesk", sans-serif';
  const badgeTextW = ctx.measureText(signalLabel).width;
  const badgePadX = 24;
  const badgeTotalW = badgeTextW + badgePadX * 2;
  const badgeX = CARD_W - 64 - badgeTotalW;
  const badgeY = 63;
  const badgeH = 38;

  // Badge background
  ctx.fillStyle = colors.accent + '1F';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeTotalW, badgeH, badgeH / 2);
  ctx.fill();

  // Badge border
  ctx.strokeStyle = colors.accent + '66';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeTotalW, badgeH, badgeH / 2);
  ctx.stroke();

  // Badge text
  ctx.fillStyle = colors.text;
  ctx.font = '700 18px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(signalLabel, badgeX + badgeTotalW / 2, badgeY + 26);

  // Price
  ctx.fillStyle = '#0A0A0A';
  ctx.font = '700 52px "Space Grotesk", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(formatPrice(props.price), 64, 168);

  // Price change
  if (props.priceChange24h !== null) {
    const changeStr = `${props.priceChange24h >= 0 ? '+' : ''}${props.priceChange24h.toFixed(1)}% (24h)`;
    const priceWidth = ctx.measureText(formatPrice(props.price)).width;
    ctx.fillStyle = colors.text;
    ctx.font = '600 22px "Space Grotesk", sans-serif';
    ctx.fillText(changeStr, 64 + priceWidth + 16, 168);
  }

  // Headline
  if (props.headline) {
    ctx.fillStyle = '#444444';
    ctx.font = '400 24px "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';

    // Word wrap
    const maxW = 900;
    const lineH = 36;
    const words = props.headline.split(' ');
    let line = '';
    let y = 228;
    const maxLines = 3;
    let lineCount = 0;

    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, 64, y);
        y += lineH;
        lineCount++;
        if (lineCount >= maxLines) break;
        line = word;
      } else {
        line = test;
      }
    }
    if (lineCount < maxLines && line) {
      ctx.fillText(line, 64, y);
    }
  }

  // Divider
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, CARD_H - 88);
  ctx.lineTo(CARD_W - 64, CARD_H - 88);
  ctx.stroke();

  // Vela eye logo (bottom-left)
  const eyeX = 64;
  const eyeY = CARD_H - 52;
  ctx.save();
  ctx.translate(eyeX + 18, eyeY);

  // Eye outline
  ctx.strokeStyle = '#0A0A0A';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(0, -9);
  ctx.lineTo(18, 0);
  ctx.lineTo(0, 9);
  ctx.closePath();
  ctx.stroke();

  // Iris diamond
  ctx.fillStyle = '#0FE68C';
  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-4.5, -4.5, 9, 9);
  ctx.restore();
  ctx.restore();

  // "vela" wordmark
  ctx.fillStyle = '#0A0A0A';
  ctx.font = '800 20px "Space Grotesk", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('vela', eyeX + 44, eyeY + 6);

  // Middle dot + URL
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.font = '500 16px "Space Grotesk", sans-serif';
  const velaW = ctx.measureText('vela').width;
  ctx.fillText('·', eyeX + 44 + velaW + 6, eyeY + 5);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillText('getvela.xyz', eyeX + 44 + velaW + 18, eyeY + 5);

  // Timestamp (bottom-right)
  const now = new Date();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const timeStr = `${months[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()} · ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.font = '400 14px "Space Grotesk", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, CARD_W - 64, eyeY + 5);

  return canvas.toDataURL('image/png');
}

// ── Component ──

export default function EngagementCard({
  briefId,
  assetId,
  assetName,
  coingeckoId,
  iconUrl: iconUrlProp,
  signal,
  price,
  priceChange24h,
  headline,
}: EngagementCardProps) {
  const { rating, isLoading, isSubmitting, submitRating } = useBriefRating(briefId);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [copied, setCopied] = useState(false);
  const commentRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  // Reset local state when briefId changes
  useEffect(() => {
    setShowCommentInput(false);
    setCommentText('');
    setCopied(false);
  }, [briefId]);

  // ── Rating handlers ──
  const handleRate = async (isPositive: boolean) => {
    if (isSubmitting) return;
    await submitRating(isPositive);
    if (!isPositive) {
      setShowCommentInput(true);
      setTimeout(
        () => commentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        50
      );
    }
    track(AnalyticsEvent.SIGNAL_RATED, {
      asset_id: assetId,
      rating: isPositive ? 'useful' : 'not_helpful',
    });
  };

  const handleSubmitComment = async () => {
    if (isSubmitting) return;
    await submitRating(false, commentText.trim() || undefined);
    setShowCommentInput(false);
  };

  // ── Share handlers ──
  const handleShare = useCallback(async () => {
    if (!signal || !price) return;

    track(AnalyticsEvent.SIGNAL_SHARED, { asset_id: assetId, signal, method: 'share' });

    // Pre-load asset icon
    const iconUrl = iconUrlProp ?? (coingeckoId ? getCoinIcon(coingeckoId) : null);
    const iconImg: HTMLImageElement | null = iconUrl
      ? await new Promise<HTMLImageElement | null>(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = iconUrl;
        })
      : null;

    const dataUrl = generateSignalImage({
      assetName,
      signal,
      price,
      priceChange24h,
      headline,
      iconImg,
    });

    // Try native share (mobile)
    if (navigator.share && navigator.canShare) {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], `vela-${assetId}-signal.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `${assetName} — ${signal === 'green' ? 'BUY' : signal === 'red' ? 'SELL' : 'WAIT'} signal`,
            url: `https://getvela.xyz/assets/${assetId}/`,
          });
          return;
        }
      } catch {
        // User cancelled — fall through to download
      }
    }

    // Fallback: download image
    const a = linkRef.current;
    if (a) {
      a.href = dataUrl;
      a.download = `vela-${assetId}-signal.png`;
      a.click();
    }
  }, [assetId, assetName, coingeckoId, iconUrlProp, signal, price, priceChange24h, headline]);

  const handleCopyLink = useCallback(() => {
    const url = `https://getvela.xyz/assets/${assetId}/`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    track(AnalyticsEvent.SIGNAL_SHARED, { asset_id: assetId, signal, method: 'copy_link' });
  }, [assetId, signal]);

  if (isLoading) return null;

  const symbol = assetId.toUpperCase();

  // ── Rated state — compact confirmation + share row ──
  const ratedConfirmation = rating !== null && !showCommentInput;

  return (
    <div
      style={{
        marginTop: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        background: 'var(--background-secondary)',
        padding: 'var(--space-4)',
      }}
    >
      {/* Rating section */}
      {ratedConfirmation ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <span style={{ fontSize: 14 }}>{rating === true ? '👍' : '👎'}</span>
          <span
            className="vela-body-sm"
            style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}
          >
            Thanks for your feedback
          </span>
        </div>
      ) : (
        <>
          <p
            className="vela-label-sm"
            style={{
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-3)',
              textAlign: 'center',
            }}
          >
            Was this {symbol} signal helpful?
          </p>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              marginBottom: showCommentInput ? 0 : 'var(--space-3)',
            }}
          >
            {[
              { emoji: '👍', label: 'Useful', positive: true },
              { emoji: '🤔', label: 'Unsure', positive: false },
              { emoji: '👎', label: 'Not helpful', positive: false },
            ].map(opt => (
              <button
                key={opt.label}
                onClick={() => handleRate(opt.positive)}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--background-primary)',
                  textAlign: 'center',
                  cursor: isSubmitting ? 'default' : 'pointer',
                  opacity: isSubmitting ? 0.5 : 1,
                }}
              >
                <span style={{ display: 'block', fontSize: 20, marginBottom: 2 }}>{opt.emoji}</span>
                <span
                  className="vela-body-sm"
                  style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}
                >
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Comment input after negative rating */}
      {showCommentInput && rating === false && (
        <div
          ref={commentRef}
          style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}
        >
          <textarea
            className="vela-body-sm"
            value={commentText}
            onChange={e => setCommentText(e.target.value.slice(0, 280))}
            placeholder="What could be better? (optional)"
            maxLength={280}
            rows={2}
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--background-primary)',
              color: 'var(--text-primary)',
              resize: 'none',
              fontFamily: 'inherit',
            }}
          />
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={handleSubmitComment}
              disabled={isSubmitting}
              className="vela-label-sm"
              style={{
                padding: 'var(--space-1) var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--background-primary)',
                color: 'var(--text-primary)',
                cursor: isSubmitting ? 'default' : 'pointer',
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Submit
            </button>
            <button
              onClick={() => setShowCommentInput(false)}
              className="vela-label-sm"
              style={{
                padding: 'var(--space-1) var(--space-3)',
                border: 'none',
                background: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: 'var(--color-border)',
          marginBottom: 'var(--space-3)',
        }}
      />

      {/* Share row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          onClick={handleShare}
          disabled={!signal || !price}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--mint-100)',
            color: 'var(--color-signal-buy)',
            border: '1px solid var(--mint-200, rgba(15, 230, 140, 0.2))',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: signal && price ? 'pointer' : 'default',
            opacity: signal && price ? 1 : 0.5,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
          </svg>
          Share signal
        </button>
        <button
          onClick={handleCopyLink}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--background-primary)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      {/* Hidden download link */}
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/anchor-is-valid */}
      <a ref={linkRef} download style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
