import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import DepositSheet from '../components/DepositSheet';
import { useDashboard } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import { useOnboarding } from '../hooks/useOnboarding';
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

function safeGetItem(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

const DIGEST_COLLAPSED_HEIGHT = 96;
const TG_NUDGE_DISMISSED_KEY = 'vela_telegram_nudge_dismissed';

type BannerPriority = 'fund-wallet' | 'pending-proposals' | 'connect-telegram' | 'upgrade' | null;
type FirstTradeMoment =
  | { type: 'first-trade'; assetId: string; side: string; price: number }
  | { type: 'first-decline' }
  | { type: 'first-expiry' }
  | null;

export default function Home() {
  const navigate = useNavigate();
  const { data, digest, loading, error, lastUpdated } = useDashboard();
  const { isAuthenticated } = useAuthContext();
  const { positions, preferences, wallet, proposals, refresh, enableTrading } = useTrading();
  const {
    tier,
    partitionAssets,
    upgradeLabel,
    startCheckout,
    needsFunding,
    refresh: refreshSubscription,
  } = useTierAccess();
  const { completeOnboarding: markOnboarded } = useOnboarding();
  const [digestExpanded, setDigestExpanded] = useState(false);
  const [showTierSheet, setShowTierSheet] = useState(false);
  const [showDepositSheet, setShowDepositSheet] = useState(false);
  const [provisioningWallet, setProvisioningWallet] = useState(false);

  /**
   * Opens the deposit sheet, provisioning a wallet first if one doesn't exist.
   *
   * Free / trial users don't get wallets at sign-up (lazy-provisioning
   * pattern — see docs/threat-reports/onboarding-simplification.md). The
   * first time they click Deposit, we create the wallet on demand so the
   * flow stays linear: click → loader for ~2s → deposit sheet opens.
   *
   * Idempotent: if a wallet already exists, enableTrading only updates
   * preferences and returns quickly. Paid users returning from a successful
   * Stripe checkout already have wallets (provisioned in the checkout
   * success effect) so this path is a no-op for them.
   */
  const openDepositSheet = useCallback(async () => {
    if (wallet?.master_address) {
      setShowDepositSheet(true);
      return;
    }
    setProvisioningWallet(true);
    try {
      await enableTrading('semi_auto');
      setShowDepositSheet(true);
    } catch (err) {
      console.warn('[Home] wallet provisioning failed on deposit click:', err);
      // Soft-fail: leave the provisioning state up briefly, then clear so
      // the user can retry. Sentry captures the error via useTrading.
    } finally {
      setProvisioningWallet(false);
    }
  }, [wallet?.master_address, enableTrading]);
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
  const [tgNudgeDismissed, setTgNudgeDismissed] = useState(() =>
    safeGetItem(TG_NUDGE_DISMISSED_KEY)
  );

  // ── Post-checkout interstitial (one-time after first Stripe checkout) ──
  const [showInterstitial, setShowInterstitial] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return false;
    if (safeGetItem('vela_post_checkout_shown')) return false;
    return true;
  });

  // Mark onboarding complete immediately on successful-checkout arrival.
  // Stripe only redirects to the success_url after a completed session, so
  // if this effect fires the user has paid. We do NOT wait for subscription
  // poll confirmation — a slow webhook would otherwise leave a paid user
  // stuck as non-onboarded on subsequent navigations.
  //
  // Trust model: the ?checkout=success param is trusted because the Privy
  // auth gate runs before Home mounts. Worst-case URL-share abuse flips a
  // friend's onboarded flag without granting paid tier — harmless UX delta.
  // Payment authorisation still depends on the Stripe webhook updating the
  // subscriptions table. Never gate a paid feature on the onboarded flag.
  // Capture the tier Stripe redirected with exactly once, at mount. Used by
  // the tier-watch effect below to trigger wallet provisioning and the
  // mode write when the subscription row catches up. Lazy initializer
  // ensures we read the URL before anything else (like dismissInterstitial)
  // strips the params.
  const [purchasedTier] = useState<'standard' | 'premium' | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return null;
    const t = params.get('tier');
    return t === 'premium' || t === 'standard' ? t : null;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;

    (async () => {
      try {
        await markOnboarded();
      } catch (err) {
        console.warn('[Home] markOnboarded failed after checkout success:', err);
      }
    })();

    // Clear the persisted tier preference set during the checkout redirect
    // (see Onboarding.tsx handlePlanCheckout) so it doesn't leak into a
    // future cancel-return restore on the same tab.
    sessionStorage.removeItem('vela_pending_tier');

    // Poll subscription for up to 30s so the tier badge / gated UI flips
    // paid as soon as the Stripe webhook writes. Without this the header
    // might show a stale "Free" badge until the next app-level refresh.
    refreshSubscription();
    const timer = setInterval(() => refreshSubscription(), 2000);
    const timeout = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wallet provisioning + mode write — gated on tier confirmation.
  //
  // Why a separate effect: the DB has a validate_user_mode trigger that
  // rejects preference writes when the requested mode isn't allowed on the
  // user's current tier (e.g. full_auto requires premium). If we called
  // enableTrading() immediately on post-checkout arrival, a slow Stripe
  // webhook would cause the write to race the tier flip and get rejected,
  // leaving premium users stuck with their prior mode.
  //
  // Instead, watch currentTier and fire enableTrading exactly once, after
  // currentTier matches the purchased tier. The refreshSubscription poll
  // above makes this happen within a few seconds of the webhook writing.
  // If the webhook never writes (hard failure), enableTrading never fires
  // here, and the user can still manually provision via the Account page.
  const enableTradingFiredRef = useRef(false);
  useEffect(() => {
    if (!purchasedTier || enableTradingFiredRef.current) return;
    if (tier !== purchasedTier) return;
    enableTradingFiredRef.current = true;
    const mode = purchasedTier === 'premium' ? 'full_auto' : 'semi_auto';
    (async () => {
      try {
        await enableTrading(mode);
      } catch (err) {
        console.warn('[Home] enableTrading failed after checkout success:', err);
      }
    })();
  }, [purchasedTier, tier, enableTrading]);

  const dismissInterstitial = (openDeposit: boolean) => {
    safeSetItem('vela_post_checkout_shown', 'true');
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('tier');
    window.history.replaceState({}, '', url.toString());
    setShowInterstitial(false);
    if (openDeposit) openDepositSheet();
  };

  // ── First-trade moment cards (one-time celebrations/nudges) ──
  const [momentDismissed, setMomentDismissed] = useState(false);

  const firstTradeMoment: FirstTradeMoment = useMemo(() => {
    if (!isAuthenticated || tier === 'free') return null;

    // First successfully executed trade (must be status=executed, not just auto-approved).
    // Only trigger if exactly 1 executed proposal exists — prevents showing to existing users
    // who had trades before this feature shipped (they lack the localStorage key but have many trades).
    const executedProposals = proposals.filter(p => p.status === 'executed');
    if (executedProposals.length === 1 && !safeGetItem('vela_first_trade_celebrated')) {
      const executedProposal = executedProposals[0];
      return {
        type: 'first-trade',
        assetId: executedProposal.asset_id,
        side: executedProposal.side,
        price: executedProposal.entry_price_at_proposal,
      };
    }

    // First decline
    if (proposals.some(p => p.status === 'declined') && !safeGetItem('vela_first_decline_shown')) {
      return { type: 'first-decline' };
    }

    // First expiry
    if (proposals.some(p => p.status === 'expired') && !safeGetItem('vela_first_expiry_shown')) {
      return { type: 'first-expiry' };
    }

    return null;
  }, [isAuthenticated, tier, proposals]);

  // Auto-dismiss after 24h
  useEffect(() => {
    if (!firstTradeMoment || momentDismissed) return;
    const tsKey = `vela_first_${firstTradeMoment.type}_shown_at`;
    let existing: string | null = null;
    try {
      existing = localStorage.getItem(tsKey);
    } catch {
      /* noop */
    }
    if (!existing) {
      safeSetItem(tsKey, Date.now().toString());
    } else if (Date.now() - Number(existing) > 24 * 60 * 60 * 1000) {
      const dismissKey =
        firstTradeMoment.type === 'first-trade'
          ? 'vela_first_trade_celebrated'
          : firstTradeMoment.type === 'first-decline'
            ? 'vela_first_decline_shown'
            : 'vela_first_expiry_shown';
      safeSetItem(dismissKey, 'true');
      setMomentDismissed(true);
    }
  }, [firstTradeMoment, momentDismissed]);

  const dismissMoment = () => {
    if (!firstTradeMoment) return;
    const key =
      firstTradeMoment.type === 'first-trade'
        ? 'vela_first_trade_celebrated'
        : firstTradeMoment.type === 'first-decline'
          ? 'vela_first_decline_shown'
          : 'vela_first_expiry_shown';
    safeSetItem(key, 'true');
    setMomentDismissed(true);
  };

  // Persist selected asset class tab
  useEffect(() => {
    safeSetItem('vela_signal_tab', selectedClass);
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
    [data, selectedClass]
  );

  const availableTabs = useMemo(() => {
    const tabs: Array<{ key: 'all' | AssetClass; label: string }> = [{ key: 'all', label: 'All' }];
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

  const dismissTgNudge = () => {
    setTgNudgeDismissed(true);
    safeSetItem(TG_NUDGE_DISMISSED_KEY, 'true');
  };

  // ── Banner priority system ──
  const tierConfig = getTierConfig(tier);
  const hasPendingProposals = proposals.some(p => p.status === 'pending');

  const activeBanner: BannerPriority = useMemo(() => {
    if (
      isAuthenticated &&
      tier !== 'free' &&
      wallet &&
      needsFunding(wallet.balance_usdc) &&
      positions.filter(p => p.status === 'open').length === 0
    )
      return 'fund-wallet';
    if (hasPendingProposals) return 'pending-proposals';
    if (
      isAuthenticated &&
      tierConfig.features.telegram_alerts &&
      preferences !== null &&
      !preferences.telegram_chat_id &&
      !tgNudgeDismissed
    )
      return 'connect-telegram';
    if (isAuthenticated && tier === 'free') return 'upgrade';
    return null;
  }, [
    isAuthenticated,
    tier,
    wallet,
    needsFunding,
    positions,
    hasPendingProposals,
    tierConfig.features.telegram_alerts,
    preferences,
    tgNudgeDismissed,
  ]);

  // Note: interstitial renders as a fixed overlay inside the main return, not an early return.
  // This keeps hooks stable and covers the bottom nav.

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

  // Look up asset symbol for first-trade celebration card
  const firstTradeAssetSymbol =
    firstTradeMoment?.type === 'first-trade'
      ? (data.find(d => d.asset.id === firstTradeMoment.assetId)?.asset.symbol ??
        firstTradeMoment.assetId.toUpperCase())
      : null;

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

      {/* ── Single banner slot (priority system) ── */}
      {activeBanner === 'fund-wallet' && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--blue-bg)',
            border: '2px solid var(--blue-accent)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '2px 2px 0 var(--black)',
          }}
        >
          <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: 0 }}>
            Fund your wallet to start trading
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {hasPendingProposals
              ? 'You have a trade proposal waiting. Fund your wallet to act on it.'
              : 'Vela is ready to trade for you. Add funds so we can execute when an opportunity appears.'}
          </p>
          <button
            onClick={openDepositSheet}
            disabled={provisioningWallet}
            style={{
              marginTop: 'var(--space-2)',
              padding: '6px 16px',
              fontSize: '0.78rem',
              fontWeight: 700,
              fontFamily: 'var(--type-heading-base-font)',
              backgroundColor: 'var(--blue-accent)',
              color: 'var(--white)',
              border: 'none',
              borderRadius: '6px',
              cursor: provisioningWallet ? 'wait' : 'pointer',
              opacity: provisioningWallet ? 0.8 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {provisioningWallet && (
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255, 255, 255, 0.4)',
                  borderTopColor: 'var(--white)',
                  borderRadius: '50%',
                  animation: 'vela-spin 700ms linear infinite',
                }}
              />
            )}
            Deposit now
          </button>
        </div>
      )}

      {activeBanner === 'pending-proposals' && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <PendingProposalsBanner />
        </div>
      )}

      {activeBanner === 'connect-telegram' && (
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

      {activeBanner === 'upgrade' && (
        <UpgradeNudgeBanner onUpgrade={() => setShowTierSheet(true)} />
      )}

      {/* ── First-trade moment cards (between banner and digest) ── */}
      {firstTradeMoment && !momentDismissed && firstTradeMoment.type === 'first-trade' && (
        <div
          style={{
            position: 'relative',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-status-buy-bg)',
            border: '2px solid var(--green-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '2px 2px 0 var(--black)',
          }}
        >
          <button
            onClick={dismissMoment}
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--green-dark)',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '4px',
            }}
          >
            ✕
          </button>
          <p
            style={{
              fontWeight: 700,
              fontSize: '0.85rem',
              margin: 0,
              paddingRight: 'var(--space-6)',
            }}
          >
            <span className="vela-interstitial-emoji">🎉</span> Congrats on your first Vela trade!
          </p>
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--gray-600)',
              margin: 'var(--space-2) 0 0',
              lineHeight: 1.5,
              paddingRight: 'var(--space-6)',
            }}
          >
            Vela spotted an opportunity for {firstTradeAssetSymbol} and executed a{' '}
            {firstTradeMoment.side} at ${firstTradeMoment.price.toLocaleString()}. Based on your
            settings, we set targets to maximize upside and limit any downside.
          </p>
          <button
            onClick={() => navigate(`/asset/${firstTradeMoment.assetId}`)}
            style={{
              marginTop: 'var(--space-2)',
              background: 'none',
              border: 'none',
              color: 'var(--green-dark)',
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            View trade details &rarr;
          </button>
        </div>
      )}

      {firstTradeMoment && !momentDismissed && firstTradeMoment.type === 'first-decline' && (
        <div
          style={{
            position: 'relative',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <button
            onClick={dismissMoment}
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
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--gray-600)',
              margin: 0,
              lineHeight: 1.5,
              paddingRight: 'var(--space-8, 32px)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
              You passed on your first proposal.
            </span>{' '}
            No worries, Vela will keep watching and send another when conditions are right.
          </p>
          <button
            onClick={() => navigate('/account')}
            style={{
              marginTop: 'var(--space-2)',
              padding: '5px 14px',
              fontSize: '0.78rem',
              fontWeight: 600,
              fontFamily: 'Inter, system-ui, sans-serif',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--gray-300)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Give feedback
          </button>
        </div>
      )}

      {firstTradeMoment && !momentDismissed && firstTradeMoment.type === 'first-expiry' && (
        <div
          style={{
            position: 'relative',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-bg-surface)',
            border: '2px solid var(--color-status-yellow, #f59e0b)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <button
            onClick={dismissMoment}
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
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--gray-600)',
              margin: 0,
              lineHeight: 1.5,
              paddingRight: 'var(--space-8, 32px)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Your first trade proposal expired.
            </span>{' '}
            No worries, these come regularly. Next time, tap Approve or Decline to let Vela know.
          </p>
        </div>
      )}

      {/* Daily brief card — inline title + short date (wireframe v2). */}
      {digest && (
        <Card
          variant="lavender"
          onClick={() => setDigestExpanded(!digestExpanded)}
          style={{ marginBottom: 'var(--space-5)', cursor: 'pointer' }}
        >
          <p
            style={{
              fontFamily: 'var(--type-heading-base-font)',
              fontWeight: 800,
              fontSize: '0.82rem',
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-3)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <span>Daily brief</span>
            <span
              aria-hidden="true"
              style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}
            >
              ·
            </span>
            <span
              style={{
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                fontSize: '0.78rem',
              }}
            >
              {new Date(digest.created_at).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </p>

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
          {digestExpanded && (
            <span
              className="vela-body-sm"
              role="button"
              tabIndex={0}
              style={{
                color: 'var(--color-text-primary)',
                fontWeight: 600,
                marginTop: 'var(--space-2)',
                cursor: 'pointer',
                display: 'block',
              }}
              onClick={e => {
                e.stopPropagation();
                navigate('/brief');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  navigate('/brief');
                }
              }}
            >
              Read full brief &rarr;
            </span>
          )}
        </Card>
      )}

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
            padding: '4px 2px 6px',
            maskImage: 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)',
          }}
        >
          {availableTabs.map(tab => {
            const isActive = selectedClass === tab.key;
            return (
              <span
                key={tab.key}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedClass(tab.key)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedClass(tab.key);
                }}
                style={{
                  flexShrink: 0,
                  borderRadius: '9999px',
                  background: isActive ? 'var(--color-border-default)' : '#fff',
                  color: isActive ? '#fff' : 'var(--gray-600)',
                  border: '2px solid var(--color-border-default)',
                  boxShadow: '2px 2px 0 var(--color-border-default)',
                  padding: '7px 16px',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  WebkitTapHighlightColor: 'transparent',
                  transition:
                    'transform 120ms ease-out, box-shadow 120ms ease-out, background 120ms ease-out, color 120ms ease-out',
                  userSelect: 'none',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translate(-1px, -1px)';
                  e.currentTarget.style.boxShadow = '3px 3px 0 var(--color-border-default)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = '2px 2px 0 var(--color-border-default)';
                }}
                onMouseDown={e => {
                  e.currentTarget.style.transform = 'translate(0, 0)';
                  e.currentTarget.style.boxShadow = '1px 1px 0 var(--color-border-default)';
                }}
                onMouseUp={e => {
                  e.currentTarget.style.transform = 'translate(-1px, -1px)';
                  e.currentTarget.style.boxShadow = '3px 3px 0 var(--color-border-default)';
                }}
              >
                {tab.label}
                <span style={{ opacity: isActive ? 0.7 : 0.5, fontSize: 11 }}>
                  {classCounts[tab.key] ?? 0}
                </span>
              </span>
            );
          })}
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
                i => (i.asset.asset_class ?? 'crypto') === cls
              );
              const classLocked = locked.filter(i => (i.asset.asset_class ?? 'crypto') === cls);
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
                </span>
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

      {/* Keyframes for the inline deposit-button spinner used during lazy
          wallet provisioning. Defined once at the component level so the
          rule is always available even before the first provision click. */}
      <style>{`@keyframes vela-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Deposit sheet (triggered from fund-wallet banner or interstitial) */}
      {showDepositSheet && wallet && (
        <DepositSheet
          wallet={wallet}
          onClose={() => setShowDepositSheet(false)}
          onRefresh={() => refresh()}
        />
      )}

      {/* Post-checkout interstitial modal (covers entire viewport including nav) */}
      {showInterstitial && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'var(--color-bg-page)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-6)',
            textAlign: 'center',
          }}
        >
          <span className="vela-interstitial-emoji" style={{ fontSize: 48, marginBottom: 16 }}>
            🎉
          </span>
          <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
            You&apos;re in!
          </h2>
          <p
            className="vela-body-base vela-text-muted"
            style={{ maxWidth: 340, lineHeight: 1.5, marginBottom: 'var(--space-6)' }}
          >
            Your account is all set up. Fund your wallet so Vela can start executing trades for you.
          </p>
          <button
            className="vela-btn vela-btn-primary"
            onClick={() => dismissInterstitial(true)}
            style={{ width: '100%', maxWidth: 320, marginBottom: 'var(--space-3)' }}
          >
            Deposit now
          </button>
          <button
            onClick={() => dismissInterstitial(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
              padding: 'var(--space-2)',
            }}
          >
            I&apos;ll do this later
          </button>
        </div>
      )}
    </div>
  );
}
