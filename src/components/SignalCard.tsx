import { useNavigate } from 'react-router-dom';
import SignalChip from './SignalChip';
import PriceArrow from './PriceArrow';
import { getCoinIcon, formatPrice, stripAssetPrefix } from '../lib/helpers';
import { getEffectivePnl } from '../utils/calculations';
import { track, AnalyticsEvent } from '../lib/analytics';
import type { AssetDashboard, Position } from '../types';

interface SignalCardProps {
  data: AssetDashboard;
  /** Open position for this asset, if the authenticated user has one */
  position?: Position;
}

/**
 * Strip trading-action language from brief headlines for users with no position.
 *
 * Backend headlines include signal context like "going long on the breakout" or
 * "short signal active on weak momentum". This is confusing for users who don't
 * have a position — they see "going long" and wonder what that means for them.
 *
 * Strategy: remove known trading-action phrases. The market observation part
 * of the headline remains (e.g. "Up 3.6% in 24 hours as momentum builds").
 */
function stripTradingAction(headline: string): string {
  // Patterns that indicate trading-action language (case insensitive)
  const TRADING_PHRASES = [
    /,?\s*going (long|short)\b.*/i,
    /,?\s*confirmed signals? turn (green|red)\b.*/i,
    /,?\s*short signal active\b.*/i,
    /,?\s*waiting for (a )?(better|clearer?) entry\b.*/i,
  ];

  let cleaned = headline;
  for (const pattern of TRADING_PHRASES) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Trim trailing punctuation artifacts
  cleaned = cleaned.replace(/[,\s]+$/, '').trim();

  // If we stripped everything (shouldn't happen), return original
  return cleaned.length >= 20 ? cleaned : headline;
}

/**
 * Generate a position-aware headline for the signal card.
 * Tone: understated, encouraging when profitable, reassuring when losing.
 * Follows the "You Stay in Control" pillar — calm, confident, supportive.
 */
function getPositionHeadline(
  position: Position,
  symbol: string,
  briefHeadline?: string | null,
  livePrice?: number | null
): string {
  const side = position.side === 'long' ? 'long' : 'short';
  const { pnlPct: pnl } = getEffectivePnl(position, livePrice);
  const pnlAbs = Math.abs(pnl).toFixed(1);
  const pnlSign = pnl >= 0 ? '+' : '-';

  // ── Position status messages ──
  // When position is positive, we can safely append brief context with natural connectors.
  // When negative, just show the calming status — don't mix in market context.
  // The brief headline is always visible in the asset detail page for full context.

  if (pnl >= 20) {
    return `Your ${symbol} ${side} is ${pnlSign}${pnlAbs}%. Looking great, consider taking some profit`;
  }
  if (pnl >= 5) {
    return `Your ${symbol} ${side} is up ${pnlAbs}%. Looking good!`;
  }
  if (pnl >= 0) {
    return `Your ${symbol} ${side} is up ${pnlAbs}% so far`;
  }
  if (pnl > -5) {
    return `Your ${symbol} ${side} is down ${pnlAbs}%. Still early, Vela is watching. Tap for more`;
  }
  if (pnl > -8) {
    return `Your ${symbol} ${side} is down ${pnlAbs}%. Vela is monitoring and will act if needed. Tap for more`;
  }
  return `Your ${symbol} ${side} is nearing its stop-loss. Vela has you covered. Tap for more`;
}

export default function SignalCard({ data, position }: SignalCardProps) {
  const navigate = useNavigate();
  const { asset, signal, brief, priceData } = data;

  const price = priceData?.price ?? signal?.price_at_signal;
  const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);

  // Position-aware headline: users with a position see P&L status,
  // users without see market context (trading-action language stripped).
  const headline = position
    ? getPositionHeadline(position, asset.symbol.toUpperCase(), brief?.headline, price)
    : brief?.headline
      ? stripTradingAction(stripAssetPrefix(brief.headline, asset.symbol))
      : null;

  return (
    <div
      className="vela-card"
      onClick={() => {
        track(AnalyticsEvent.SIGNAL_CARD_CLICKED, {
          asset_id: asset.id,
          signal: signal?.signal_color ?? null,
        });
        navigate(`/asset/${asset.id}`);
      }}
      role="button"
      tabIndex={0}
      aria-label={`View ${asset.name} signal details`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/asset/${asset.id}`);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* Top row: icon + name/symbol + price/change */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Asset icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'var(--border-medium) solid var(--color-border-default)',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--gray-100)',
          }}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt={asset.symbol}
              width={36}
              height={36}
              style={{ objectFit: 'cover', borderRadius: '50%' }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span
              style={{
                fontWeight: 800,
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-primary)',
              }}
            >
              {asset.symbol.charAt(0)}
            </span>
          )}
        </div>

        {/* Name + symbol */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            className="vela-heading-base"
            style={{
              fontWeight: 'var(--weight-bold)',
              lineHeight: 1.2,
            }}
          >
            {asset.name}
          </span>
          <span
            className="vela-body-sm vela-text-muted"
            style={{ fontSize: 'var(--text-xs)', marginLeft: 'var(--space-2)' }}
          >
            {asset.symbol}
          </span>
        </div>

        {/* Price + change */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span
            className="vela-mono"
            style={{
              fontWeight: 'var(--weight-semibold)',
              fontSize: '0.95rem',
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
              display: 'block',
            }}
          >
            {formatPrice(price)}
          </span>
          {priceData?.priceSource === 'signal' ? (
            <span
              className="vela-body-sm"
              style={{
                fontSize: '0.6rem',
                color: 'var(--color-text-muted)',
                marginTop: 2,
                display: 'block',
                textAlign: 'right',
              }}
            >
              May be delayed
            </span>
          ) : priceData?.change24h != null ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                justifyContent: 'flex-end',
                marginTop: 2,
                whiteSpace: 'nowrap',
              }}
            >
              <PriceArrow change24h={priceData.change24h} />
              <span
                className="vela-mono"
                style={{
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: '0.65rem',
                  color: priceData.change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.abs(priceData.change24h).toFixed(1)}%
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Bottom row: signal chip + headline + chevron */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--gray-200)',
        }}
      >
        <SignalChip
          color={signal?.signal_color || 'grey'}
          size="small"
          nearConfirmation={signal?.near_confirmation}
        />
        {headline && (
          <span
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-muted)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
            }}
          >
            {headline}
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{
            flexShrink: 0,
            transition: 'transform var(--motion-fast) var(--motion-ease-out)',
          }}
        >
          <path
            d="M6 3L11 8L6 13"
            style={{ stroke: 'var(--gray-400)' }}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
