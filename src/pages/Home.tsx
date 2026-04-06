import { useState, useEffect, useMemo } from 'react';
import type { AssetClass } from '../types';
import { Card } from '../components/VelaComponents';
import SignalCard from '../components/SignalCard';
import LockedSignalCard from '../components/LockedSignalCard';
import EmptyState from '../components/EmptyState';
import VelaLogo from '../components/VelaLogo';
import PendingProposalsBanner from '../components/PendingProposalsBanner';
import UpgradeNudgeBanner from '../components/UpgradeNudgeBanner';
import TelegramConnectButton from '../components/TelegramConnectButton';
import TierComparisonSheet from '../components/TierComparisonSheet';
import { useDashboard } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import { breakIntoParagraphs } from '../lib/helpers';
import { getTierConfig } from '../lib/tier-definitions';

function telegramIcon(size: number) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="var(--color-text-muted)"
      style={{ flexShrink: 0 }}
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

const DIGEST_COLLAPSED_HEIGHT = 96; // ~4 lines at 0.85rem with 1.7 line-height
const TG_NUDGE_DISMISSED_KEY = 'vela_telegram_nudge_dismissed';
const TG_CHECKOUT_PROMPT_KEY = 'vela_show_telegram_prompt';

export default function Home() {
  const { data, digest, loading, error, lastUpdated } = useDashboard();
  const { isAuthenticated } = useAuthContext();
  const { positions, preferences } = useTrading();
  const { tier, partitionAssets, upgradeLabel, startCheckout } = useTierAccess();
  const [digestExpanded, setDigestExpanded] = useState(false);
  const [showTierSheet, setShowTierSheet] = useState(false);
  const [selectedClass, setSelectedClass] = useState<'all' | AssetClass>(() => {
    try {
      const stored = localStorage.getItem('vela_signal_tab');
      if (
        stored === 'all' ||
        stored === 'crypto' ||
        stored === 'equities' ||
        stored === 'commodities' ||
        stored === 'indices'
      )
        return stored;
    } catch {
      /* noop */
    }
    return 'all';
  });
  const [tgNudgeDismissed, setTgNudgeDismissed] = useState(() => {
    try {
      return localStorage.getItem(TG_NUDGE_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [showCheckoutPrompt, setShowCheckoutPrompt] = useState(() => {
    try {
      return localStorage.getItem(TG_CHECKOUT_PROMPT_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Persist selected asset class tab
  useEffect(() => {
    try {
      localStorage.setItem('vela_signal_tab', selectedClass);
    } catch {
      /* noop */
    }
  }, [selectedClass]);

  // Asset class filtering
  const classCounts = useMemo(() => {
    const counts: Record<string, number> = { all: data.length };
    for (const item of data) {
      const cls = item.asset.asset_class ?? 'crypto';
      counts[cls] = (counts[cls] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const filteredData = useMemo(
    () =>
      selectedClass === 'all'
        ? data
        : data.filter(item => (item.asset.asset_class ?? 'crypto') === selectedClass),
    [data, selectedClass],
  );

  const availableTabs = useMemo(() => {
    const tabs: Array<{ key: 'all' | AssetClass; label: string }> = [
      { key: 'all', label: 'All' },
    ];
    if (classCounts.crypto) tabs.push({ key: 'crypto', label: 'Crypto' });
    if (classCounts.equities) tabs.push({ key: 'equities', label: 'Equities' });
    if (classCounts.commodities) tabs.push({ key: 'commodities', label: 'Commodities' });
    if (classCounts.indices) tabs.push({ key: 'indices', label: 'Indices' });
    return tabs;
  }, [classCounts]);

  const CLASS_ORDER: AssetClass[] = ['crypto', 'equities', 'commodities', 'indices'];
  const CLASS_LABELS: Record<AssetClass, string> = {
    crypto: 'Crypto',
    equities: 'Equities',
    commodities: 'Commodities',
    indices: 'Indices',
  };

  // Set post-checkout prompt flag when returning from successful checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;
    // Wait for tier to settle, then check if new tier has telegram_alerts
    const tierConfig = getTierConfig(tier);
    if (tierConfig.features.telegram_alerts && !preferences?.telegram_chat_id) {
      try {
        localStorage.setItem(TG_CHECKOUT_PROMPT_KEY, 'true');
      } catch {
        /* noop */
      }
      setShowCheckoutPrompt(true);
    }
  }, [tier, preferences?.telegram_chat_id]);

  const dismissTgNudge = () => {
    setTgNudgeDismissed(true);
    try {
      localStorage.setItem(TG_NUDGE_DISMISSED_KEY, 'true');
    } catch {
      /* noop */
    }
  };

  const dismissCheckoutPrompt = () => {
    setShowCheckoutPrompt(false);
    try {
      localStorage.removeItem(TG_CHECKOUT_PROMPT_KEY);
    } catch {
      /* noop */
    }
  };

  // Show Telegram nudge only for paid users who haven't connected and haven't dismissed.
  // Wait for preferences to load (not null) to prevent flash.
  const tierConfig = getTierConfig(tier);
  const showTgNudge =
    isAuthenticated &&
    tierConfig.features.telegram_alerts &&
    preferences !== null &&
    !preferences.telegram_chat_id &&
    !tgNudgeDismissed &&
    !showCheckoutPrompt; // Don't show both nudge and checkout prompt

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

      {/* Upgrade nudge for free-tier users */}
      {isAuthenticated && tier === 'free' && (
        <UpgradeNudgeBanner onUpgrade={() => setShowTierSheet(true)} />
      )}

      {/* Pending trade proposals banner */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <PendingProposalsBanner />
      </div>

      {/* Post-checkout Telegram prompt (one-time, after upgrade) */}
      {showCheckoutPrompt && (
        <div
          style={{
            position: 'relative',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            border: '1px solid var(--green-primary)',
            background: 'var(--color-status-buy-bg)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <p
            style={{
              fontWeight: 700,
              fontSize: '0.85rem',
              margin: 0,
              paddingRight: 'var(--space-6)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {telegramIcon(16)}
            Get Telegram alerts
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ margin: 'var(--space-1) 0 0' }}>
            Signals and account updates sent to your phone in real time.
          </p>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <TelegramConnectButton
              chatId={preferences?.telegram_chat_id ?? null}
              onStatusChange={dismissCheckoutPrompt}
              compact
            />
          </div>
          <button
            onClick={dismissCheckoutPrompt}
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Telegram nudge for paid users without Telegram connected */}
      {showTgNudge && (
        <div
          style={{
            position: 'relative',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            border: '1px solid var(--green-primary)',
            background: 'var(--color-status-buy-bg)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <p
            style={{
              fontWeight: 700,
              fontSize: '0.85rem',
              margin: 0,
              paddingRight: 'var(--space-6)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {telegramIcon(16)}
            Get alerts on Telegram
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ margin: 'var(--space-1) 0 0' }}>
            Trading signals and account updates sent to your phone.
          </p>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <TelegramConnectButton chatId={null} onStatusChange={dismissTgNudge} compact />
          </div>
          <button
            onClick={dismissTgNudge}
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>
      )}

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

      {/* Asset class tab bar */}
      {availableTabs.length > 2 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            marginBottom: 'var(--space-4)',
            maskImage:
              'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
          }}
        >
          {availableTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setSelectedClass(tab.key)}
              className={
                selectedClass === tab.key
                  ? 'vela-btn vela-btn-primary'
                  : 'vela-btn vela-btn-secondary'
              }
              style={{
                flexShrink: 0,
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-sm)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 'var(--space-1)',
                  opacity: 0.5,
                  fontSize: 'var(--text-xs)',
                }}
              >
                {classCounts[tab.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {filteredData.length === 0 && data.length > 0 ? (
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}
        >
          No {selectedClass} signals available
        </p>
      ) : data.length === 0 ? (
        <EmptyState type="no-signals" />
      ) : (
        (() => {
          const { accessible, locked } = partitionAssets(filteredData);

          const renderCard = (item: (typeof accessible)[0], isLocked: boolean) => {
            if (isLocked) {
              return (
                <LockedSignalCard
                  key={item.asset.id}
                  asset={item.asset}
                  briefHeadline={item.brief?.headline}
                  upgradeLabel={upgradeLabel(`see ${item.asset.symbol} signals`)}
                  onUpgradeClick={() => setShowTierSheet(true)}
                />
              );
            }
            const assetPosition = isAuthenticated
              ? positions.find(p => p.asset_id === item.asset.id && p.status === 'open')
              : undefined;
            return <SignalCard key={item.asset.id} data={item} position={assetPosition} />;
          };

          if (selectedClass === 'all') {
            const elements: React.ReactNode[] = [];
            for (const cls of CLASS_ORDER) {
              const classAccessible = accessible.filter(
                i => (i.asset.asset_class ?? 'crypto') === cls,
              );
              const classLocked = locked.filter(
                i => (i.asset.asset_class ?? 'crypto') === cls,
              );
              if (classAccessible.length + classLocked.length === 0) continue;

              elements.push(
                <span
                  key={`header-${cls}`}
                  className="vela-label-sm vela-text-muted"
                  style={{
                    textTransform: 'uppercase',
                    display: 'block',
                    letterSpacing: '0.06em',
                    paddingTop: elements.length > 0 ? 'var(--space-3)' : 0,
                  }}
                >
                  {CLASS_LABELS[cls]}
                </span>,
              );

              for (const item of classAccessible) elements.push(renderCard(item, false));
              for (const item of classLocked) elements.push(renderCard(item, true));
            }
            return (
              <div className="vela-stack" style={{ gap: 'var(--space-4)' }}>
                {elements}
              </div>
            );
          }

          return (
            <div className="vela-stack" style={{ gap: 'var(--space-4)' }}>
              {accessible.map(item => renderCard(item, false))}
              {locked.map(item => renderCard(item, true))}
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
