import { getCoinIcon, stripAssetPrefix } from '../lib/helpers';
import type { Asset } from '../types';

interface LockedSignalCardProps {
  asset: Asset;
  /** Label for the upgrade CTA — e.g. "Upgrade your plan to see ETH signals" */
  upgradeLabel: string;
  onUpgradeClick: () => void;
  /** Optional brief headline to tease — shown faded before upgrade CTA */
  briefHeadline?: string | null;
}

/**
 * Dimmed/locked signal card shown for assets the user's tier can't access.
 * Shows the real asset icon and a faded brief teaser, then an upgrade CTA.
 * Follows the same layout rhythm as SignalCard for visual consistency.
 */
export default function LockedSignalCard({
  asset,
  upgradeLabel,
  onUpgradeClick,
  briefHeadline,
}: LockedSignalCardProps) {
  const iconUrl = getCoinIcon(asset.coingecko_id);
  const cleanHeadline = briefHeadline ? stripAssetPrefix(briefHeadline, asset.symbol) : null;

  return (
    <div
      className="vela-card"
      onClick={onUpgradeClick}
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
        opacity: 0.7,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top row — matches SignalCard layout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Asset icon — real icon from CoinGecko with letter fallback */}
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
                color: 'var(--color-text-muted)',
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

        {/* Lock icon */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
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
      </div>

      {/* Brief teaser — blurs from start of first line, single line only */}
      {cleanHeadline && (
        <div
          style={{
            position: 'relative',
            marginTop: 'var(--space-3)',
            maxHeight: '1.6em',
            overflow: 'hidden',
          }}
        >
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              margin: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {cleanHeadline}
          </p>
          {/* Fade-out gradient overlay — starts early for aggressive blur */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '70%',
              height: '100%',
              background:
                'linear-gradient(to right, transparent 0%, var(--background-primary, #FFFBF5) 80%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}

      {/* Upgrade CTA */}
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
        {upgradeLabel}{' '}
        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>→</span>
      </p>
    </div>
  );
}
