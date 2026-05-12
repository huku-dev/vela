import SignalChip from './SignalChip';
import PriceArrow from './PriceArrow';
import { getCoinIcon, formatPrice } from '../lib/helpers';
import { track, AnalyticsEvent } from '../lib/analytics';
import type { Asset, PriceData, Signal } from '../types';

interface LockedSignalCardProps {
  asset: Asset;
  /** Label for the upgrade CTA, e.g. "Upgrade your plan to see ETH signals" */
  upgradeLabel: string;
  onUpgradeClick: () => void;
  /** Latest signal for this asset. Direction (BUY/SELL/WAIT) shown to free users. */
  signal?: Signal | null;
  /** Live price data. Price and 24h change shown to free users. */
  priceData?: PriceData | null;
}

/**
 * Tier-locked asset card shown to users whose tier can't access full signal details.
 *
 * Free users still see signal direction (BUY/SELL/WAIT), price, and 24h change — the
 * basics that let them follow the market. Detailed brief, news rationale, and the
 * trade action are gated behind a paid plan. The card is fully clickable into the
 * upgrade sheet, with a subtle lock indicator on the action area only.
 */
export default function LockedSignalCard({
  asset,
  upgradeLabel,
  onUpgradeClick,
  signal,
  priceData,
}: LockedSignalCardProps) {
  const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);
  const price = priceData?.price ?? signal?.price_at_signal;

  return (
    <div
      className="vela-card"
      onClick={() => {
        track(AnalyticsEvent.LOCKED_CARD_CLICKED, { asset_id: asset.id });
        onUpgradeClick();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Upgrade to unlock ${asset.name} signals`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onUpgradeClick();
        }
      }}
      style={{
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      {/* Top row: icon + name/symbol + price/change — matches SignalCard layout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Asset icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1.5px solid var(--gray-200)',
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
              width={28}
              height={28}
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

        {/* Price + 24h change */}
        {price != null && (
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
            {priceData?.change24h != null && priceData.priceSource !== 'signal' && (
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
                    fontSize: '0.75rem',
                    color: priceData.change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {Math.abs(priceData.change24h).toFixed(1)}%
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom row: signal chip + locked CTA + chevron — direction is visible, brief is gated */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: '1px solid var(--gray-200)',
        }}
      >
        {/* Only render chip when there's a real signal. Falling back to a grey 'WAIT'
            chip when signal is null would be a semantic-color misuse: WAIT is a
            meaningful direction-neutral state, not a 'no data yet' placeholder. */}
        {signal && (
          <SignalChip
            color={signal.signal_color}
            size="small"
            nearConfirmation={signal.near_confirmation}
          />
        )}
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          {/* Small lock glyph signals that the action and detail are gated */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
          >
            <rect
              x="4"
              y="9"
              width="12"
              height="9"
              rx="2"
              fill="var(--gray-300)"
              stroke="var(--gray-400)"
              strokeWidth="1.5"
            />
            <path
              d="M7 9V6a3 3 0 116 0v3"
              stroke="var(--gray-400)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{upgradeLabel}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
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
