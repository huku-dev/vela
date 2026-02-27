import { useNavigate } from 'react-router-dom';
import SignalChip from './SignalChip';
import PriceArrow from './PriceArrow';
import { getCoinIcon, formatPrice, stripAssetPrefix } from '../lib/helpers';
import type { AssetDashboard, Position } from '../types';

interface SignalCardProps {
  data: AssetDashboard;
  /** Open position for this asset, if the authenticated user has one */
  position?: Position;
}

/**
 * Generate a position-aware headline for the signal card.
 * Tone: understated, encouraging when profitable, reassuring when losing.
 * Follows the "You Stay in Control" pillar — calm, confident, supportive.
 */
function getPositionHeadline(position: Position, symbol: string): string {
  const side = position.side === 'long' ? 'long' : 'short';
  const pnl = position.unrealized_pnl_pct;
  const pnlAbs = Math.abs(pnl).toFixed(1);
  const pnlSign = pnl >= 0 ? '+' : '-';

  if (pnl >= 20) {
    return `Your ${symbol} ${side} is ${pnlSign}${pnlAbs}% — looking great, consider taking some profit`;
  }
  if (pnl >= 5) {
    return `Your ${symbol} ${side} is ${pnlSign}${pnlAbs}% — looking good!`;
  }
  if (pnl >= 0) {
    return `${symbol} ${side} position open — ${pnlSign}${pnlAbs}% so far`;
  }
  if (pnl > -5) {
    return `${symbol} ${side} position open — ${pnlSign}${pnlAbs}%. Still early, Vela is watching`;
  }
  if (pnl > -8) {
    return `${symbol} ${side} is ${pnlSign}${pnlAbs}% — Vela is monitoring and will act if needed`;
  }
  return `${symbol} ${side} position — stop-loss level approaching. Vela has you covered`;
}

export default function SignalCard({ data, position }: SignalCardProps) {
  const navigate = useNavigate();
  const { asset, signal, brief, priceData } = data;

  const price = priceData?.price ?? signal?.price_at_signal;
  const iconUrl = getCoinIcon(asset.coingecko_id);

  // Position-aware headline takes priority over generic brief headline
  const headline = position
    ? getPositionHeadline(position, asset.symbol.toUpperCase())
    : brief?.headline
      ? stripAssetPrefix(brief.headline, asset.symbol)
      : null;

  return (
    <div
      className="vela-card"
      onClick={() => navigate(`/asset/${asset.id}`)}
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
      {/* Top row */}
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

        {/* Name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            className="vela-heading-base"
            style={{
              display: 'block',
              fontWeight: 'var(--weight-bold)',
              lineHeight: 1.2,
            }}
          >
            {asset.symbol}
          </span>
          <span
            className="vela-body-sm vela-text-muted"
            style={{ fontSize: 'var(--text-xs)', lineHeight: 1.3 }}
          >
            {asset.name}
          </span>
        </div>

        {/* Price + arrow */}
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

        {/* Signal chip */}
        <SignalChip color={signal?.signal_color || 'grey'} size="small" />

        {/* Chevron */}
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

      {/* Headline — position-aware when user has an open position */}
      {headline && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: 'var(--border-medium) solid var(--gray-200)',
          }}
        >
          {headline}
        </p>
      )}
    </div>
  );
}
