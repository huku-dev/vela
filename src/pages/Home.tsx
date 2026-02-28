import { useState } from 'react';
import { Card } from '../components/VelaComponents';
import SignalCard from '../components/SignalCard';
import LockedSignalCard from '../components/LockedSignalCard';
import EmptyState from '../components/EmptyState';
import VelaLogo from '../components/VelaLogo';
import PendingProposalsBanner from '../components/PendingProposalsBanner';
import TierComparisonSheet from '../components/TierComparisonSheet';
import { useDashboard } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import { breakIntoParagraphs } from '../lib/helpers';

const DIGEST_COLLAPSED_HEIGHT = 96; // ~4 lines at 0.85rem with 1.7 line-height

export default function Home() {
  const { data, digest, loading, error, lastUpdated } = useDashboard();
  const { isAuthenticated } = useAuthContext();
  const { positions } = useTrading();
  const { tier, partitionAssets, upgradeLabel, startCheckout } = useTierAccess();
  const [digestExpanded, setDigestExpanded] = useState(false);
  const [showTierSheet, setShowTierSheet] = useState(false);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 'var(--space-20)',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <VelaLogo variant="mark" size={48} pulse />
        <span className="vela-body-sm vela-text-muted">Loading signals...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-4)', maxWidth: 600, margin: '0 auto' }}>
        <EmptyState type="loading-error" message={error} />
      </div>
    );
  }

  const digestText = digest?.summary || digest?.context || '';
  const digestParagraphs = breakIntoParagraphs(digestText, 2);

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 'var(--space-20)',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <VelaLogo variant="full" size={40} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 8px',
              borderRadius: '3px',
              lineHeight: 1.4,
              color:
                tier === 'premium'
                  ? 'var(--green-dark)'
                  : tier === 'standard'
                    ? 'var(--green-dark)'
                    : 'var(--color-text-muted)',
              backgroundColor:
                tier === 'premium'
                  ? 'var(--color-status-buy-bg)'
                  : tier === 'standard'
                    ? 'var(--color-status-buy-bg)'
                    : 'var(--gray-100)',
              border:
                tier === 'premium' || tier === 'standard'
                  ? '1px solid var(--green-primary)'
                  : '1px solid var(--gray-200)',
            }}
          >
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </span>
        </div>
        {lastUpdated && (
          <span
            className="vela-body-sm vela-text-muted"
            style={{
              fontSize: 'var(--text-xs)',
              display: 'block',
              marginTop: 'var(--space-1)',
            }}
          >
            Updates every 15 mins ·{' '}
            {lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Pending trade proposals banner */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <PendingProposalsBanner />
      </div>

      {/* Daily Digest — at top, with paragraph breaks */}
      {digest && (
        <Card
          variant="lavender"
          onClick={() => setDigestExpanded(!digestExpanded)}
          style={{ marginBottom: 'var(--space-5)', cursor: 'pointer' }}
        >
          {/* Date as prominent header */}
          <p
            style={{
              fontFamily: 'var(--type-heading-base-font)',
              fontWeight: 800,
              fontSize: '0.82rem',
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {new Date(digest.created_at).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <span
            className="vela-label-sm vela-text-muted"
            style={{
              textTransform: 'uppercase',
              display: 'block',
              marginBottom: 'var(--space-3)',
            }}
          >
            Daily digest
          </span>

          {/* Paragraphed text — truncated with "View more" */}
          <div
            style={{
              position: 'relative',
              maxHeight: digestExpanded ? 'none' : `${DIGEST_COLLAPSED_HEIGHT}px`,
              overflow: 'hidden',
              transition: 'max-height var(--motion-slow) var(--motion-ease-in-out)',
            }}
          >
            {digestParagraphs.map((para, i) => (
              <p
                key={i}
                className="vela-body-sm"
                style={{
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.7,
                  marginBottom: i < digestParagraphs.length - 1 ? 'var(--space-3)' : 0,
                }}
              >
                {para}
              </p>
            ))}
            {!digestExpanded && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 40,
                  background: 'linear-gradient(transparent, var(--lavender-50))',
                }}
              />
            )}
          </div>
          {digestParagraphs.length > 1 && (
            <span
              className="vela-label-sm"
              style={{
                color: 'var(--color-text-muted)',
                marginTop: 'var(--space-2)',
                cursor: 'pointer',
                display: 'block',
              }}
            >
              {digestExpanded ? 'Show less' : 'View more'}
            </span>
          )}
        </Card>
      )}

      {/* Signals section */}
      <span
        className="vela-label-sm vela-text-muted"
        style={{
          textTransform: 'uppercase',
          display: 'block',
          marginBottom: 'var(--space-3)',
          paddingLeft: 'var(--space-1)',
        }}
      >
        Signals
      </span>

      {data.length === 0 ? (
        <EmptyState type="no-signals" />
      ) : (
        (() => {
          const { accessible, locked } = partitionAssets(data);
          return (
            <div className="vela-stack" style={{ gap: 'var(--space-4)' }}>
              {accessible.map(item => {
                const assetPosition = isAuthenticated
                  ? positions.find(p => p.asset_id === item.asset.id && p.status === 'open')
                  : undefined;
                return <SignalCard key={item.asset.id} data={item} position={assetPosition} />;
              })}
              {locked.map(item => (
                <LockedSignalCard
                  key={item.asset.id}
                  asset={item.asset}
                  briefHeadline={item.brief?.headline}
                  upgradeLabel={upgradeLabel(`see ${item.asset.symbol} signals`)}
                  onUpgradeClick={() => setShowTierSheet(true)}
                />
              ))}
            </div>
          );
        })()
      )}

      {/* Tier comparison sheet */}
      {showTierSheet && (
        <TierComparisonSheet
          currentTier={tier}
          onClose={() => setShowTierSheet(false)}
          onStartCheckout={startCheckout}
        />
      )}
    </div>
  );
}
