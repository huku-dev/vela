import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Alert } from '../components/VelaComponents';
import VelaLogo from '../components/VelaLogo';
import SignalChip from '../components/SignalChip';
import PriceArrow from '../components/PriceArrow';
import FearGreedGauge from '../components/FearGreedGauge';
import TradeProposalCard from '../components/TradeProposalCard';
import TierComparisonSheet from '../components/TierComparisonSheet';
import { useAssetDetail, useDashboard } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import EngagementCard from '../components/EngagementCard';
import {
  breakIntoParagraphs,
  formatPrice,
  getCoinIcon,
  stripAssetPrefix,
  groupBriefsBySignalState,
  parsePriceSegments,
  plainEnglish,
} from '../lib/helpers';
import { getEffectivePnl } from '../utils/calculations';
import type { SignalColor, BriefGroup } from '../types';

const signalTitles: Record<SignalColor, string> = {
  green: 'Buy',
  red: 'Sell',
  grey: 'Wait',
};

const signalBg: Record<SignalColor, string> = {
  green: 'var(--mint-100)',
  red: 'var(--red-light)',
  grey: 'var(--sky-100)',
};

/** Stop-loss detail row with info icon tooltip */
function StopLossRow({ price }: { price: number }) {
  const [showTip, setShowTip] = React.useState(false);
  return (
    <div style={{ paddingBottom: 'var(--space-2)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          className="vela-body-sm vela-text-muted"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Stop-loss
          <button
            onClick={e => {
              e.stopPropagation();
              setShowTip(prev => !prev);
            }}
            aria-label="What is a stop-loss?"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--gray-400)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </span>
        <span
          className="vela-mono vela-body-sm"
          style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--red-dark)' }}
        >
          {formatPrice(price)}
        </span>
      </div>
      {showTip && (
        <p
          className="vela-body-sm"
          style={{
            margin: 0,
            marginTop: 'var(--space-1)',
            fontSize: '0.7rem',
            lineHeight: 1.4,
            color: 'var(--gray-500)',
            backgroundColor: 'var(--gray-100)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
          }}
        >
          Your safety net. If the price drops to this level, Vela automatically exits the position
          to limit your loss.
        </p>
      )}
    </div>
  );
}

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    asset,
    signal,
    brief,
    recentBriefs,
    priceData,
    signalLookup,
    signalTimeline,
    loading,
    notFound,
  } = useAssetDetail(assetId!);
  const { isAuthenticated } = useAuthContext();
  const { proposals, positions, wallet, acceptProposal, declineProposal } = useTrading();
  const { tier, canAccessAsset, canTrade, upgradeLabel, startCheckout } = useTierAccess();
  const { data: dashboardData } = useDashboard();
  const [showTierSheet, setShowTierSheet] = useState(false);
  const [headerStuck, setHeaderStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Check tier access — use dashboard data for ordered asset list
  const allAssets = dashboardData.map(d => d.asset);
  const hasAccess = !isAuthenticated || canAccessAsset(assetId!, allAssets);

  // Email redirect result banner
  const resultParam = searchParams.get('result');
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  useEffect(() => {
    if (resultParam) {
      if (resultParam === 'approved') {
        setActionBanner('Trade approved and executing');
      } else if (resultParam === 'declined') {
        setActionBanner('Trade proposal declined');
      } else if (resultParam === 'error') {
        setActionBanner(
          'Unable to process trade action. The proposal may have expired or already been handled.'
        );
      }
      // Clear query params
      searchParams.delete('result');
      searchParams.delete('proposal');
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
      // Auto-dismiss after 5 seconds
      setTimeout(() => setActionBanner(null), 5000);
    }
  }, [resultParam, searchParams, setSearchParams]);

  // Get proposals for this asset — pending (actionable) + recently actioned (status feedback)
  const pendingProposals = isAuthenticated
    ? proposals.filter(p => p.asset_id === assetId && p.status === 'pending')
    : [];
  // Failed proposals are shown as toasts, not persistent cards
  const IN_FLIGHT_STATUSES = ['approved', 'auto_approved', 'executing', 'executed', 'declined'];
  const TERMINAL_STATUSES = ['executed', 'expired', 'declined'];
  const STALE_THRESHOLD_MS = 5_000; // Don't show terminal proposals older than 5s
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const allActiveProposals = isAuthenticated
    ? proposals.filter(p => {
        if (p.asset_id !== assetId) return false;
        if (!IN_FLIGHT_STATUSES.includes(p.status)) return false;
        // Skip terminal proposals that reached their final state >5s ago
        if (TERMINAL_STATUSES.includes(p.status)) {
          const updatedAt = new Date(p.updated_at).getTime();
          if (Date.now() - updatedAt > STALE_THRESHOLD_MS) return false;
        }
        return true;
      })
    : [];
  const activeProposals = allActiveProposals.filter(p => !dismissedIds.has(p.id));

  // Auto-dismiss terminal-state cards after 2s
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const p of allActiveProposals) {
      if (TERMINAL_STATUSES.includes(p.status) && !dismissedIds.has(p.id)) {
        timers.push(
          setTimeout(() => {
            setDismissedIds(prev => new Set(prev).add(p.id));
          }, 2000)
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [allActiveProposals.map(p => `${p.id}:${p.status}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Failed trade toasts are now handled globally in Layout.tsx

  // Open position for this asset (if any)
  const assetPosition = isAuthenticated
    ? positions.find(p => p.asset_id === assetId && p.status === 'open')
    : undefined;
  const [positionExpanded, setPositionExpanded] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  if (loading && !asset) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 'var(--space-16)',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <VelaLogo variant="mark" size={48} pulse />
        <span className="vela-body-sm vela-text-muted">Loading asset...</span>
      </div>
    );
  }

  if (notFound && !asset) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <p style={{ color: 'var(--color-error)' }}>Asset not found</p>
      </div>
    );
  }

  // Still waiting for data — cache miss and fetch in progress
  if (!asset) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 'var(--space-16)',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <VelaLogo variant="mark" size={48} pulse />
        <span className="vela-body-sm vela-text-muted">Loading asset...</span>
      </div>
    );
  }

  // Tier gate: show upgrade prompt if asset is outside user's tier allowance
  if (!hasAccess) {
    const price = priceData?.price ?? signal?.price_at_signal;
    const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);

    return (
      <div
        style={{
          padding: 'var(--space-4)',
          paddingBottom: 'var(--space-20)',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        {/* Header with back button + asset name + price */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
            marginTop: 'var(--space-2)',
          }}
        >
          <button
            onClick={() => navigate('/')}
            aria-label="Go back"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'var(--border-medium) solid var(--color-border-default)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-xs)',
              width: 36,
              height: 36,
              background: 'var(--color-bg-surface)',
              cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M9 2L4 7L9 12"
                style={{ stroke: 'var(--color-text-primary)' }}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {iconUrl && (
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
              <img
                src={iconUrl}
                alt={asset.symbol}
                width={36}
                height={36}
                style={{ borderRadius: '50%' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <span className="vela-heading-base" style={{ fontWeight: 'var(--weight-bold)' }}>
              {asset.symbol}
            </span>
            <span className="vela-body-sm vela-text-muted" style={{ display: 'block' }}>
              {asset.name}
            </span>
          </div>
          {price && (
            <span
              className="vela-mono"
              style={{ fontWeight: 'var(--weight-semibold)', fontSize: '0.95rem' }}
            >
              {formatPrice(price)}
            </span>
          )}
        </div>

        {/* Upgrade prompt */}
        <Card
          style={{
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-4)',
          }}
        >
          {/* Lock icon */}
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            style={{ margin: '0 auto var(--space-4)' }}
          >
            <rect
              x="8"
              y="18"
              width="24"
              height="18"
              rx="3"
              fill="var(--gray-200)"
              stroke="var(--gray-400)"
              strokeWidth="2"
            />
            <path
              d="M14 18V12a6 6 0 1112 0v6"
              stroke="var(--gray-400)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <h3
            className="vela-heading-base"
            style={{ marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-bold)' }}
          >
            Unlock {asset.symbol} signals
          </h3>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ marginBottom: 'var(--space-5)', lineHeight: 1.6 }}
          >
            Get trend analysis, AI briefs, and trade proposals for {asset.name}. Upgrade your plan
            to access more assets.
          </p>
          <button
            className="vela-btn vela-btn-primary"
            onClick={() => setShowTierSheet(true)}
            style={{ width: '100%', maxWidth: 280 }}
          >
            {upgradeLabel(`access ${asset.symbol}`)}
          </button>
        </Card>

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

  const price = priceData?.price ?? signal?.price_at_signal;
  const change24h = priceData?.change24h;
  const signalColor = signal?.signal_color || 'grey';
  const detail = brief?.detail;

  // Extract fear/greed from market context string if available
  const fearGreedMatch = detail?.market_context?.fear_greed?.match(/(\d+)/);
  const fearGreedValue = fearGreedMatch ? parseInt(fearGreedMatch[1], 10) : null;
  const fearGreedLabel =
    detail?.market_context?.fear_greed?.match(
      /extreme fear|extreme greed|fear|neutral|greed/i
    )?.[0] || '';

  // Parse summary into paragraphs (used by WhyWeThinkThis expandable section)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const summaryParagraphs = breakIntoParagraphs(
    (brief?.summary || '').replace(/<\/?cite[^>]*>/g, ''),
    2
  );
  const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 'var(--space-20)',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Scroll sentinel for sticky header border */}
      <div ref={sentinelRef} style={{ height: 0 }} />

      {/* Header (sticky) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          paddingBottom: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          paddingLeft: 'var(--space-4)',
          paddingRight: 'var(--space-4)',
          marginLeft: 'calc(-1 * var(--space-4))',
          marginRight: 'calc(-1 * var(--space-4))',
          position: 'sticky',
          top: 0,
          zIndex: 200,
          backgroundColor: 'var(--color-bg-page)',
          borderBottom: headerStuck
            ? '1px solid var(--color-border-default)'
            : '1px solid transparent',
          transition: 'border-color 150ms ease',
          marginBottom: 'var(--space-3)',
        }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label="Go back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'var(--border-medium) solid var(--color-border-default)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-xs)',
            width: 36,
            height: 36,
            background: 'var(--color-bg-surface)',
            cursor: 'pointer',
            transition:
              'transform var(--motion-fast) var(--motion-ease-out), box-shadow var(--motion-fast) var(--motion-ease-out)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 2L4 7L9 12"
              style={{ stroke: 'var(--color-text-primary)' }}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

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

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="vela-heading-xl" style={{ fontSize: 'var(--text-xl)' }}>
              {asset.symbol}
            </h1>
            <SignalChip
              color={signalColor}
              size="small"
              nearConfirmation={signal?.near_confirmation}
            />
          </div>
          <span className="vela-body-sm vela-text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {asset.name}
          </span>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span
            className="vela-mono"
            style={{
              fontWeight: 'var(--weight-bold)',
              fontSize: '1.1rem',
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
              Price may be delayed
            </span>
          ) : change24h != null ? (
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
              <PriceArrow change24h={change24h} />
              <span
                className="vela-mono"
                style={{
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: '0.7rem',
                  color: change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.abs(change24h).toFixed(1)}% 24h
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Email action result banner */}
      {actionBanner && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert
            variant={actionBanner.includes('approved') ? 'success' : 'info'}
            onDismiss={() => setActionBanner(null)}
          >
            {actionBanner.includes('approved') ? '✅' : '❌'} {actionBanner}
          </Alert>
        </div>
      )}

      {/* Trade proposals — pending (actionable) + in-flight (status feedback) */}
      {pendingProposals.map(proposal => (
        <div key={proposal.id} style={{ marginBottom: 'var(--space-4)' }}>
          <TradeProposalCard
            proposal={proposal}
            assetSymbol={asset.symbol}
            onAccept={acceptProposal}
            onDecline={declineProposal}
            walletBalance={wallet?.balance_usdc}
            walletEnvironment={wallet?.environment}
            canTrade={canTrade}
            upgradeLabel={canTrade ? undefined : upgradeLabel('start trading')}
            onUpgradeClick={canTrade ? undefined : () => setShowTierSheet(true)}
            currentPrice={price ?? undefined}
            iconUrl={iconUrl ?? undefined}
            positionEntryPrice={assetPosition?.entry_price}
            positionSizeUsd={assetPosition?.size_usd}
          />
        </div>
      ))}
      {activeProposals.map(proposal => (
        <div key={proposal.id} style={{ marginBottom: 'var(--space-4)' }}>
          <TradeProposalCard
            proposal={proposal}
            assetSymbol={asset.symbol}
            onAccept={acceptProposal}
            onDecline={declineProposal}
            walletBalance={wallet?.balance_usdc}
            walletEnvironment={wallet?.environment}
            canTrade={canTrade}
            upgradeLabel={canTrade ? undefined : upgradeLabel('start trading')}
            onUpgradeClick={canTrade ? undefined : () => setShowTierSheet(true)}
            currentPrice={price ?? undefined}
            iconUrl={iconUrl ?? undefined}
            positionEntryPrice={assetPosition?.entry_price}
            positionSizeUsd={assetPosition?.size_usd}
          />
        </div>
      ))}

      {/* Position card — shown if user has an open position for this asset */}
      {assetPosition && (
        <Card
          variant={assetPosition.side === 'long' ? 'mint' : 'peach'}
          style={{
            marginBottom: 'var(--space-4)',
            cursor: 'pointer',
          }}
          onClick={() => setPositionExpanded(!positionExpanded)}
        >
          {/* Header row: label + side badge + chevron */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span
              className="vela-label-sm"
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-primary)',
                fontWeight: 'var(--weight-bold)',
              }}
            >
              YOUR POSITION
            </span>
            <span
              style={{
                marginLeft: 'var(--space-2)',
                backgroundColor:
                  assetPosition.side === 'long' ? 'var(--green-primary)' : 'var(--red-primary)',
                color: 'var(--white)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                border: '1.5px solid var(--black)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontSize: 10,
              }}
            >
              {assetPosition.side.toUpperCase()}
            </span>
            <div style={{ flex: 1 }} />
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              style={{
                transform: positionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform var(--motion-fast) var(--motion-ease-out)',
              }}
            >
              <path
                d="M3 5L7 9L11 5"
                style={{ stroke: 'var(--color-text-primary)' }}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* P&L hero — big number, bold, uses fallback calc */}
          {(() => {
            const { pnlPct, pnlDollar } = getEffectivePnl(assetPosition, price);
            const isPositive = pnlDollar >= 0;
            const pnlColor =
              pnlDollar > 0
                ? 'var(--green-dark)'
                : pnlDollar < 0
                  ? 'var(--red-dark)'
                  : 'var(--color-text-primary)';
            return (
              <div>
                <span
                  className="vela-mono"
                  style={{
                    fontWeight: 'var(--weight-bold)',
                    fontSize: '1.25rem',
                    color: pnlColor,
                    lineHeight: 1.2,
                  }}
                >
                  {isPositive ? '+' : ''}${Math.abs(pnlDollar).toFixed(2)}{' '}
                  {isPositive ? 'profit' : 'loss'}
                </span>
                <span
                  className="vela-mono"
                  style={{
                    fontWeight: 'var(--weight-semibold)',
                    fontSize: '0.85rem',
                    color: pnlColor,
                    opacity: 0.7,
                    marginLeft: 'var(--space-2)',
                  }}
                >
                  ({pnlPct >= 0 ? '+' : ''}
                  {pnlPct.toFixed(1)}%)
                </span>
              </div>
            );
          })()}

          {/* Compact details — entry price + leverage */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-1)',
            }}
          >
            <span className="vela-mono vela-body-sm vela-text-muted">
              Entry {formatPrice(assetPosition.entry_price)}
            </span>
            {assetPosition.leverage > 1 && (
              <>
                <span className="vela-body-sm vela-text-muted">·</span>
                <span className="vela-mono vela-body-sm vela-text-muted">
                  {assetPosition.leverage}x
                </span>
              </>
            )}
          </div>

          {/* Expanded details */}
          {positionExpanded && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-3)',
                borderTop: 'var(--border-medium) solid var(--gray-200)',
              }}
            >
              {[
                [
                  'Position size',
                  `$${assetPosition.size_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                ],
                ['Entry price', formatPrice(assetPosition.entry_price)],
                ['Current price', formatPrice(price ?? assetPosition.current_price)],
                [
                  'Time open',
                  (() => {
                    const days = Math.floor(
                      (Date.now() - new Date(assetPosition.created_at).getTime()) /
                        (1000 * 60 * 60 * 24)
                    );
                    return days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
                  })(),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: 'var(--space-2)',
                  }}
                >
                  <span className="vela-body-sm vela-text-muted">{label}</span>
                  <span
                    className="vela-mono vela-body-sm"
                    style={{ fontWeight: 'var(--weight-semibold)' }}
                  >
                    {value}
                  </span>
                </div>
              ))}

              {/* Stop-loss row with info tooltip */}
              {assetPosition.stop_loss_price != null && (
                <StopLossRow price={assetPosition.stop_loss_price} />
              )}

              {/* Manual close button with friction */}
              {canTrade && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  {!showCloseConfirm ? (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setShowCloseConfirm(true);
                      }}
                      className="vela-body-sm"
                      style={{
                        color: 'var(--color-text-muted)',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                      }}
                    >
                      Close position
                    </button>
                  ) : (
                    <div
                      role="presentation"
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      style={{
                        padding: 'var(--space-3)',
                        backgroundColor: 'var(--color-status-yellow-bg, #fffbeb)',
                        borderRadius: 'var(--radius-sm)',
                        border: '2px solid var(--color-status-yellow, #f59e0b)',
                      }}
                    >
                      <p
                        className="vela-body-sm"
                        style={{ fontWeight: 600, margin: 0, marginBottom: 'var(--space-1)' }}
                      >
                        Close your {asset.symbol} {assetPosition.side}?
                      </p>
                      <p
                        className="vela-body-sm vela-text-muted"
                        style={{ margin: 0, marginBottom: 'var(--space-2)' }}
                      >
                        Vela&apos;s signals haven&apos;t recommended closing this position yet.
                        Manual exits sometimes miss further gains.
                      </p>
                      {(() => {
                        const { pnlPct: closePnlPct, pnlDollar: closePnlDollar } = getEffectivePnl(
                          assetPosition,
                          price
                        );
                        return (
                          <p
                            className="vela-mono vela-body-sm"
                            style={{ margin: 0, marginBottom: 'var(--space-3)', fontWeight: 600 }}
                          >
                            Current P&L: {closePnlDollar >= 0 ? '+' : ''}$
                            {Math.abs(closePnlDollar).toFixed(2)} ({closePnlPct >= 0 ? '+' : ''}
                            {closePnlPct.toFixed(1)}%)
                          </p>
                        );
                      })()}
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          className="vela-btn vela-btn-ghost vela-btn-sm"
                          onClick={() => setShowCloseConfirm(false)}
                          style={{ flex: 1 }}
                        >
                          Keep position
                        </button>
                        <button
                          className="vela-btn vela-btn-sm"
                          onClick={() => {
                            // TODO: Call close-position edge function
                            // For now, just close the confirmation
                            setShowCloseConfirm(false);
                          }}
                          style={{
                            flex: 1,
                            backgroundColor: 'var(--color-status-yellow, #f59e0b)',
                            color: 'var(--black)',
                            border: '2px solid var(--black)',
                          }}
                        >
                          Close anyway
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Tier 1: Key Signal — expandable with signal history */}
      {brief &&
        (() => {
          // Include ALL briefs so the first group always matches the current
          // signal color — prevents KEY SIGNAL showing WAIT while first
          // history entry shows BUY
          const signalGroups =
            recentBriefs.length > 0
              ? groupBriefsBySignalState(
                  recentBriefs,
                  signalLookup as Record<string, SignalColor>,
                  signalColor,
                  signalTimeline
                )
              : [];
          const hasHistory = signalGroups.length > 1; // Need >1 groups (first is current)
          const latestGroupIsNew =
            hasHistory &&
            signalGroups[1].type === 'signal_change' &&
            Date.now() - new Date(signalGroups[1].briefs[0].created_at).getTime() <
              24 * 60 * 60 * 1000;

          return (
            <SignalHistoryCard
              signalColor={signalColor}
              headline={stripAssetPrefix(brief.headline, asset.symbol)}
              groups={signalGroups}
              hasHistory={hasHistory}
              symbol={asset.symbol}
              isNew={latestGroupIsNew}
            />
          );
        })()}

      {/* Tier 2: Where price stands — narrative price context with 7d range */}
      {detail?.indicators && price != null && (
        <WherePriceStands
          indicators={detail.indicators}
          price={price}
          detail={detail}
          symbol={asset.symbol}
          change24h={change24h}
        />
      )}

      {/* Tier 3: What's moving — only shown when there are actual news events */}
      {detail?.events_moving_markets && detail.events_moving_markets.length > 0 && (
        <WhatsMovingSection events={detail.events_moving_markets} assetName={asset.name} />
      )}

      {/* Tier 4: Market mood — simplified inline Fear & Greed */}
      {fearGreedValue != null && <MarketMoodInline value={fearGreedValue} label={fearGreedLabel} />}

      {/* Tier 5: Why we think this — collapsible technical details */}
      {detail && (
        <WhyWeThinkThis detail={detail} brief={brief} recentBriefs={recentBriefs} price={price} />
      )}

      {/* Engagement — rating + share */}
      {isAuthenticated && brief && asset && (
        <EngagementCard
          briefId={brief.id}
          assetId={assetId!}
          assetName={asset.name}
          coingeckoId={asset.coingecko_id}
          iconUrl={asset.icon_url}
          signal={signal?.signal_color ?? null}
          price={price ?? null}
          priceChange24h={change24h ?? null}
          headline={brief.summary ?? null}
        />
      )}

      {/* Timestamp — show signal check recency + brief age */}
      {(signal || brief) && (
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '0.68rem' }}
        >
          {signal && <>Signal last changed {formatTimeAgo(signal.created_at)}</>}
          {signal && brief && ' · '}
          {brief && <>Analysis written {formatTimeAgo(brief.created_at)}</>}
        </p>
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

// ── Helpers: build signal_breakdown / market_context from raw indicators ──

function buildSignalBreakdown(
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  },
  price: number
): Record<string, string> {
  const { ema_9: ema9, ema_21: ema21, rsi_14: rsi, adx_4h: adx, sma_50_daily: sma50 } = indicators;
  const fmt = (n: number) =>
    n >= 100 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

  const result: Record<string, string> = {};

  result.ema_cross =
    ema9 > ema21
      ? `Short-term average at ${fmt(ema9)} is above medium-term at ${fmt(ema21)}, suggesting short-term upward pressure.`
      : `Short-term average at ${fmt(ema9)} is below medium-term at ${fmt(ema21)}, suggesting short-term downward pressure.`;

  result.rsi =
    rsi > 70
      ? `Buying pressure at ${rsi.toFixed(0)} indicates overbought conditions. Price may be due for a pullback.`
      : rsi < 30
        ? `Buying pressure at ${rsi.toFixed(0)} indicates oversold conditions. Price may be due for a bounce.`
        : `Buying pressure at ${rsi.toFixed(0)} is in neutral territory. No extreme buying or selling pressure.`;

  result.trend_filter =
    price > sma50
      ? `Price is above the 50-day trend line (${fmt(sma50)}), which supports the broader uptrend.`
      : `Price is below the 50-day trend line (${fmt(sma50)}), which suggests the broader trend is bearish.`;

  result.adx =
    adx > 25
      ? `Trend strength at ${adx.toFixed(0)} shows a strong directional move in progress.`
      : adx > 20
        ? `Trend strength at ${adx.toFixed(0)} shows moderate directional momentum.`
        : `Trend strength at ${adx.toFixed(0)} shows a weak or absent trend. Choppy conditions.`;

  return result;
}

function buildWhatWouldChange(
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  },
  price: number
): string {
  const { ema_9: ema9, ema_21: ema21, rsi_14: rsi, adx_4h: adx, sma_50_daily: sma50 } = indicators;
  const bullLevel = Math.max(ema9, ema21);
  const fmt = (n: number) =>
    n >= 100 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

  // Determine what's missing for a clear signal
  const conditions: string[] = [];

  if (price < bullLevel) {
    conditions.push(`a clear break above ${fmt(bullLevel)}`);
  }
  if (rsi <= 40 || rsi >= 70) {
    conditions.push(`buying pressure moving into the 40–70 range`);
  } else if (rsi < 60) {
    conditions.push(`buying pressure pushing above 60`);
  }
  if (adx < 25) {
    conditions.push(`trend strength rising above 25`);
  }
  if (price < sma50) {
    conditions.push(`price recovering above the 50-day average at ${fmt(sma50)}`);
  }

  if (conditions.length === 0) {
    return 'Current conditions are close to triggering a signal. Vela is watching for confirmation.';
  }

  const joined =
    conditions.length === 1
      ? conditions[0]
      : conditions.slice(0, -1).join(', ') + ' and ' + conditions[conditions.length - 1];

  return `${joined.charAt(0).toUpperCase() + joined.slice(1)} would likely shift the signal towards a clearer direction.`;
}

// ── Collapsible "Why we think this" section (replaces MUI Accordion) ──

function WhyWeThinkThis({
  detail,
  brief,
  recentBriefs,
  price,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brief: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentBriefs: any[];
  price: number | undefined | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const indicators = detail?.indicators;

  // Always have signal_breakdown — use AI data if available, else generate from raw indicators
  const signalBreakdown: Record<string, string> =
    detail.signal_breakdown && Object.keys(detail.signal_breakdown).length > 0
      ? detail.signal_breakdown
      : indicators && price
        ? buildSignalBreakdown(indicators, price)
        : {};

  // Always have market_context — use AI data if available, else empty (Fear & Greed not in raw indicators)
  const marketContext: Record<string, string> =
    detail.market_context && Object.keys(detail.market_context).length > 0
      ? detail.market_context
      : {};

  return (
    <div
      className="vela-card"
      style={{ marginBottom: 'var(--space-4)', padding: 0, overflow: 'hidden' }}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 'var(--space-4) var(--space-5)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          minHeight: 48,
        }}
      >
        <SectionLabel style={{ marginBottom: 0 }}>Why we think this</SectionLabel>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--motion-normal) var(--motion-ease-out)',
          }}
        >
          <path
            d="M3 6L8 11L13 6"
            style={{ stroke: 'var(--color-text-primary)' }}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          {/* Signal Breakdown — always shown; uses AI data or indicator-generated fallback */}
          {Object.keys(signalBreakdown).length > 0 && (
            <>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <SubLabel>Technical analysis</SubLabel>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', listStyle: 'disc' }}>
                  {Object.entries(signalBreakdown).map(([key, value]) => (
                    <li
                      key={key}
                      className="vela-body-sm"
                      style={{
                        color: 'var(--color-text-secondary)',
                        marginBottom: 'var(--space-2)',
                        lineHeight: 1.6,
                      }}
                    >
                      {(() => {
                        const t = plainEnglish(value as string);
                        return t.charAt(0).toUpperCase() + t.slice(1);
                      })()}
                    </li>
                  ))}
                </ul>
              </div>
              <Divider />
            </>
          )}

          {/* Market Context — bullets only (Fear & Greed gauge moved to top-level MarketMoodInline) */}
          {Object.keys(marketContext).length > 0 && (
            <>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <SubLabel>Market context</SubLabel>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', listStyle: 'disc' }}>
                  {Object.entries(marketContext)
                    .sort(([keyA], [keyB]) => {
                      // Push dominance-related keys to end of list
                      const isDomA = /dominance/i.test(keyA);
                      const isDomB = /dominance/i.test(keyB);
                      if (isDomA && !isDomB) return 1;
                      if (!isDomA && isDomB) return -1;
                      return 0;
                    })
                    .map(([key, value]) => (
                      <li
                        key={key}
                        className="vela-body-sm"
                        style={{
                          color: 'var(--color-text-secondary)',
                          marginBottom: 'var(--space-1)',
                          lineHeight: 1.6,
                        }}
                      >
                        {(() => {
                          const t = plainEnglish(value as string);
                          return t.charAt(0).toUpperCase() + t.slice(1);
                        })()}
                      </li>
                    ))}
                </ul>
              </div>
              <Divider />
            </>
          )}

          {/* Indicators — Plain English (price levels moved to top-level PriceLevelsCard) */}
          {indicators && (
            <IndicatorsSection
              indicators={indicators}
              price={price}
              brief={brief}
              recentBriefs={recentBriefs}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Indicators Section ──

function IndicatorsSection({
  indicators,
  price,
  brief,
  recentBriefs,
}: {
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  };
  price: number | undefined | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brief: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentBriefs: any[];
}) {
  const currentPrice = price ?? 0;
  const { ema_9: ema9, ema_21: ema21, rsi_14: rsi, adx_4h: adx, sma_50_daily: sma50 } = indicators;

  // Find oldest brief with indicators for delta comparison
  const oldestWithIndicators = [...recentBriefs]
    .reverse()
    .find(b => b.detail?.indicators && b.id !== brief?.id);
  const oldInd = oldestWithIndicators?.detail?.indicators;

  const rsiDelta = oldInd ? rsi - oldInd.rsi_14 : null;
  const adxDelta = oldInd ? adx - oldInd.adx_4h : null;

  const deltaLabel = oldestWithIndicators
    ? (() => {
        const diffMs =
          new Date(brief!.created_at).getTime() -
          new Date(oldestWithIndicators.created_at).getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return diffDays <= 1 ? 'vs yesterday' : `vs ${diffDays} days ago`;
      })()
    : null;

  const tooltipTimeframe = deltaLabel
    ? deltaLabel === 'vs yesterday'
      ? 'in the last day'
      : `in the last ${deltaLabel.replace('vs ', '').replace(' ago', '')}`
    : null;

  const trendLabel =
    currentPrice > ema9 && currentPrice > ema21
      ? 'Above short & medium averages'
      : currentPrice > ema9
        ? 'Above short-term but below medium-term average'
        : currentPrice > ema21
          ? 'Below short-term but above medium-term average'
          : 'Below short & medium averages';
  const trendColor =
    currentPrice > ema9 && currentPrice > ema21
      ? 'var(--green-dark)'
      : currentPrice < ema9 && currentPrice < ema21
        ? 'var(--red-dark)'
        : 'var(--amber-dark)';

  const rsiLabel =
    rsi >= 70
      ? 'Overbought \u2014 may pull back'
      : rsi >= 60
        ? 'Strong buying pressure'
        : rsi >= 40
          ? 'Neutral'
          : rsi >= 30
            ? 'Weak'
            : 'Oversold \u2014 potential bounce';
  const rsiColor =
    rsi >= 70
      ? 'var(--red-dark)'
      : rsi >= 60
        ? 'var(--green-dark)'
        : rsi >= 40
          ? 'var(--color-text-muted)'
          : rsi >= 30
            ? 'var(--amber-dark)'
            : 'var(--red-dark)';

  // ADX is direction-agnostic — cross-reference with EMA trend to give context
  const isBullishTrend = currentPrice > ema9 && currentPrice > ema21;
  const isBearishTrend = currentPrice < ema9 && currentPrice < ema21;

  const adxLabel =
    adx >= 25
      ? isBullishTrend
        ? 'Strong uptrend'
        : isBearishTrend
          ? 'Strong downtrend'
          : 'Trending (mixed signals)'
      : adx >= 15
        ? 'Weak trend'
        : 'No clear trend';
  const adxColor =
    adx >= 25
      ? isBullishTrend
        ? 'var(--green-dark)'
        : isBearishTrend
          ? 'var(--red-dark)'
          : 'var(--amber-dark)'
      : adx >= 15
        ? 'var(--amber-dark)'
        : 'var(--color-text-muted)';

  const smaLabel = currentPrice > sma50 ? 'Above 50-day average' : 'Below 50-day average';
  const smaColor = currentPrice > sma50 ? 'var(--green-dark)' : 'var(--red-dark)';
  const smaDist = currentPrice && sma50 ? ((currentPrice - sma50) / sma50) * 100 : 0;

  const smaTooltip = (() => {
    const base =
      'Compares the current price to its 50-day average. Being above it generally indicates a healthy longer-term trend; being below may signal weakness.';
    if (smaDist !== 0) {
      const aboveBelow = smaDist > 0 ? 'above' : 'below';
      return `${base} Currently ${Math.abs(smaDist).toFixed(1)}% ${aboveBelow} the 50-day average.`;
    }
    return base;
  })();

  const rsiTooltip = (() => {
    const base =
      'Measures buying vs selling pressure on a 0-100 scale. Above 70 means overbought (may pull back), below 30 means oversold (may bounce).';
    if (rsiDelta != null && Math.abs(rsiDelta) >= 0.1 && tooltipTimeframe) {
      const direction = rsiDelta > 0 ? 'up' : 'down';
      return `${base} At ${rsi.toFixed(0)}, it's ${direction} ${Math.abs(rsiDelta).toFixed(1)} ${tooltipTimeframe}.`;
    }
    return base;
  })();

  const adxTooltip = (() => {
    const base =
      'ADX measures trend strength. Combined with price position relative to averages, it tells us if the market is trending strongly up or down. Above 25 means a clear trend; below 15 means the market is drifting sideways.';
    if (adxDelta != null && Math.abs(adxDelta) >= 0.1 && tooltipTimeframe) {
      const direction = adxDelta > 0 ? 'up' : 'down';
      return `${base} At ${adx.toFixed(0)}, it's ${direction} ${Math.abs(adxDelta).toFixed(1)} ${tooltipTimeframe}.`;
    }
    return base;
  })();

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-1)' }}>
        <span className="vela-label-sm" style={{ color: 'var(--color-text-primary)' }}>
          Momentum indicators
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          border: '1.5px solid var(--gray-200)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <IndicatorRow
          label="Short-term trend"
          description={trendLabel}
          color={trendColor}
          tooltip="Compares the current price to its 9-day and 21-day moving averages. When price is above both, the short-term trend is up."
        />
        <IndicatorRow
          label="Longer-term trend"
          description={smaLabel}
          color={smaColor}
          tooltip={smaTooltip}
        />
        <IndicatorRow
          label="Momentum"
          description={`${rsiLabel} (${rsi.toFixed(0)})`}
          color={rsiColor}
          tooltip={rsiTooltip}
        />
        <IndicatorRow
          label="Trend strength"
          description={`${adxLabel} (${adx.toFixed(0)})`}
          color={adxColor}
          tooltip={adxTooltip}
        />
      </div>
    </div>
  );
}

// ── Price Level Triggers ──

// ── "Where Price Stands" — narrative replacement for Key Price Levels ──

/** Format price compactly for tight spaces (e.g. $64.2K, $1.8K, $126.8) */
function compactPrice(p: number): string {
  if (p >= 1000) return `$${(p / 1000).toFixed(1)}K`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

/** Fetch 7-day high/low from Hyperliquid hourly candles */
async function fetch7dRange(symbol: string): Promise<{ high: number; low: number } | null> {
  try {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: symbol, interval: '1h', startTime: sevenDaysAgo, endTime: now },
      }),
    });
    if (!res.ok) return null;
    const candles = await res.json();
    if (!Array.isArray(candles) || candles.length === 0) return null;
    const highs = candles.map((c: { h: string }) => parseFloat(c.h));
    const lows = candles.map((c: { l: string }) => parseFloat(c.l));
    return { high: Math.max(...highs), low: Math.min(...lows) };
  } catch {
    return null;
  }
}

function WherePriceStands({
  price,
  indicators,
  detail,
  symbol,
  change24h,
}: {
  price: number;
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  symbol: string;
  change24h: number | null | undefined;
}) {
  const [range7d, setRange7d] = useState<{ high: number; low: number } | null>(null);
  const [change7d, setChange7d] = useState<number | null>(null);

  useEffect(() => {
    fetch7dRange(symbol).then(r => {
      if (r) {
        setRange7d(r);
        // Approximate 7d change from range: (current - 7d-ago open) / 7d-ago open
        // More accurate: use first candle's open as the 7d-ago price
      }
    });
  }, [symbol]);

  // Fetch 7d change from candles (first candle open vs current price)
  useEffect(() => {
    (async () => {
      try {
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const res = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'candleSnapshot',
            req: { coin: symbol, interval: '1d', startTime: sevenDaysAgo, endTime: now },
          }),
        });
        if (!res.ok) return;
        const candles = await res.json();
        if (Array.isArray(candles) && candles.length > 0) {
          const openPrice = parseFloat(candles[0].o);
          if (openPrice > 0) {
            setChange7d(((price - openPrice) / openPrice) * 100);
          }
        }
      } catch {
        // Silent fail
      }
    })();
  }, [symbol, price]);

  // Build "what would change" with bidirectional framing
  const wwcText: string = detail?.what_would_change || buildWhatWouldChange(indicators, price);

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <SectionLabel>Where price stands</SectionLabel>

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {change24h != null && (
          <div
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-2)',
              background: 'var(--gray-50)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 2,
              }}
            >
              Last 24H
            </span>
            <span
              className="vela-mono"
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
              }}
            >
              {change24h >= 0 ? '+' : ''}
              {change24h.toFixed(1)}%
            </span>
          </div>
        )}
        {change7d != null && (
          <div
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-2)',
              background: 'var(--gray-50)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 2,
              }}
            >
              Last 7D
            </span>
            <span
              className="vela-mono"
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: change7d >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
              }}
            >
              {change7d >= 0 ? '+' : ''}
              {change7d.toFixed(1)}%
            </span>
          </div>
        )}
        {range7d && (
          <div
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-2)',
              background: 'var(--gray-50)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 2,
              }}
            >
              7D range
            </span>
            <span
              className="vela-mono"
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
              }}
            >
              {compactPrice(range7d.low)}–{compactPrice(range7d.high)}
            </span>
          </div>
        )}
      </div>

      {/* What would change */}
      {wwcText && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
            borderTop: '1px solid var(--gray-200)',
            paddingTop: 'var(--space-3)',
          }}
        >
          {parsePriceSegments(plainEnglish(wwcText)).map((seg, i) =>
            seg.type === 'price' ? (
              <strong key={i} className="vela-mono" style={{ fontWeight: 600 }}>
                {seg.value}
              </strong>
            ) : (
              <React.Fragment key={i}>{seg.value}</React.Fragment>
            )
          )}
        </p>
      )}
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PriceLevelTriggers({
  indicators,
  price,
  detail,
  signalColor,
}: {
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  };
  price: number | undefined | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  signalColor: string;
}) {
  const cp = price ?? 0;
  const bullLevel = Math.max(indicators.ema_9, indicators.ema_21);
  const bearLevel = indicators.sma_50_daily;
  const aboveBull = cp > bullLevel;
  const belowBear = cp < bearLevel;

  return (
    <div>
      <SectionLabel>Key price levels</SectionLabel>
      <div className="vela-stack" style={{ gap: 'var(--space-2)' }}>
        <TriggerCard
          direction="bullish"
          level={formatPrice(bullLevel)}
          active={aboveBull}
          label={
            aboveBull
              ? signalColor === 'green'
                ? 'Price is above short-term averages. Maintaining this with rising momentum strengthens our Buy signal'
                : 'Price is above short-term averages. Sustained momentum here could shift the signal towards Buy'
              : 'A sustained break above short-term averages with rising momentum could shift the signal towards Buy'
          }
        />
        <TriggerCard
          direction="bearish"
          level={formatPrice(bearLevel)}
          active={belowBear}
          label={
            belowBear
              ? signalColor === 'red'
                ? `Price is ${(((bearLevel - cp) / bearLevel) * 100).toFixed(0)}% below this level. This weakness supports our Sell signal`
                : `Price is ${(((bearLevel - cp) / bearLevel) * 100).toFixed(0)}% below this level. Continued weakness here adds bearish pressure`
              : 'A break below the 50-day average would signal meaningful bearish pressure and could trigger a Sell'
          }
        />
      </div>
      {(() => {
        // Use AI-generated text, or build a fallback from indicator data
        const wwcText = detail.what_would_change || buildWhatWouldChange(indicators, cp);
        if (!wwcText) return null;
        return (
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-muted)',
              lineHeight: 1.6,
              marginTop: 'var(--space-3)',
              fontStyle: 'italic',
            }}
          >
            {parsePriceSegments(plainEnglish(wwcText)).map((seg, i) =>
              seg.type === 'price' ? (
                <span
                  key={i}
                  className="vela-mono"
                  style={{
                    fontWeight: 'var(--weight-semibold)',
                    fontStyle: 'normal',
                    color: 'var(--color-text-primary)',
                    backgroundColor: 'var(--gray-100)',
                    borderRadius: '4px',
                    padding: '0 var(--space-1)',
                  }}
                >
                  {seg.value}
                </span>
              ) : (
                <React.Fragment key={i}>{seg.value}</React.Fragment>
              )
            )}
          </p>
        );
      })()}
    </div>
  );
}

// ── Promoted Sections (extracted from WhyWeThinkThis per Damola feedback 2026-03-23) ──

/** Key price levels promoted to top-level card — most actionable info for users */

/** News events driving this asset — summary bullets removed (redundant with "Where Price Stands") */
function WhatsMovingSection({
  events,
  assetName,
}: {
  events: Array<{ title: string; impact: string; source?: string; url?: string; date?: string }>;
  assetName: string;
}) {
  const [showAll, setShowAll] = useState(false);

  // External news events only — filter out Vela's own analysis (redundant with signal card)
  const externalEvents = events.filter(e => !e.source?.toLowerCase().includes('vela'));
  const allItems = externalEvents.map(event => ({
    type: 'event' as const,
    title: event.title,
    impact: event.impact,
    source: event.source,
    url: event.url,
    date: event.date,
  }));
  if (allItems.length === 0) return null;

  const visibleCount = 3;
  const hasMore = allItems.length > visibleCount;
  const displayed = showAll ? allItems : allItems.slice(0, visibleCount);

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <SectionLabel>What&apos;s moving {assetName}</SectionLabel>
      <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', listStyle: 'disc' }}>
        {displayed.map((item, i) => (
          <li
            key={i}
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-2)',
              lineHeight: 1.6,
            }}
          >
            <>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {item.title.replace(/<\/?cite[^>]*>/g, '')}
              </span>
              {showAll && item.impact && (
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {' '}
                  &mdash; {item.impact.replace(/<\/?cite[^>]*>/g, '')}
                </span>
              )}
              {item.source && (
                <>
                  <br />
                  <a
                    href={
                      item.url ||
                      `https://www.google.com/search?q=${encodeURIComponent(item.title + ' ' + item.source)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="vela-label-sm"
                    style={{
                      color: 'var(--color-text-muted)',
                      textDecoration: 'underline',
                      textDecorationColor: 'var(--gray-300)',
                      textUnderlineOffset: '2px',
                    }}
                  >
                    {item.date
                      ? `${new Date(item.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${item.source}`
                      : item.source}
                  </a>
                </>
              )}
            </>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="vela-label-sm"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-2) 0 0',
            textDecoration: 'underline',
            textDecorationColor: 'var(--gray-300)',
            textUnderlineOffset: '2px',
          }}
        >
          {showAll ? 'Show less' : `Show ${allItems.length - visibleCount} more`}
        </button>
      )}
    </Card>
  );
}

/** Fear & Greed gauge with plain-English context */
function MarketMoodInline({ value, label }: { value: number; label: string }) {
  // Plain-English context line based on the value range
  const getMoodContext = (v: number): string => {
    if (v <= 15)
      return 'Investors are extremely nervous. Historically, extreme fear has often preceded recoveries.';
    if (v <= 30)
      return 'Most investors are cautious right now. Fear can mean opportunity, but also continued selling.';
    if (v <= 45) return 'Sentiment is leaning cautious. Markets are uncertain about direction.';
    if (v <= 55)
      return 'Sentiment is balanced. No strong conviction either way from the broader market.';
    if (v <= 70)
      return 'Investors are feeling optimistic. Confidence is building but not overheated yet.';
    if (v <= 85)
      return 'Markets are very confident. High greed can sometimes signal prices are stretched.';
    return 'Extreme optimism. Historically, this level of greed has often preceded pullbacks.';
  };

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <SectionLabel>Market mood</SectionLabel>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <FearGreedGauge value={value} label={label} />
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            margin: 0,
            flex: 1,
          }}
        >
          {getMoodContext(value)}
        </p>
      </div>
    </Card>
  );
}

// ── Helper Components ──

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SectionLabel({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="vela-label-sm vela-text-muted"
      style={{
        textTransform: 'uppercase',
        display: 'block',
        marginBottom: 'var(--space-2)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="vela-label-sm"
      style={{
        color: 'var(--color-text-primary)',
        display: 'block',
        marginBottom: 'var(--space-1)',
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div
      style={{
        borderTop: 'var(--border-medium) solid var(--gray-200)',
        margin: 'var(--space-3) 0',
      }}
    />
  );
}

function IndicatorRow({
  label,
  description,
  color,
  tooltip,
}: {
  label: string;
  description: string;
  color: string;
  tooltip: string;
}) {
  const [showTip, setShowTip] = React.useState(false);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--space-3)',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}
        >
          <span
            className="vela-body-sm"
            style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
          >
            {label}
          </span>
          <span
            onClick={() => setShowTip(!showTip)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter') setShowTip(!showTip);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '1px solid var(--gray-300)',
              fontSize: '0.55rem',
              fontWeight: 700,
              color: 'var(--gray-400)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ?
          </span>
        </div>
        <span
          className="vela-body-sm"
          style={{
            fontSize: '0.72rem',
            fontWeight: 'var(--weight-semibold)',
            color,
            textAlign: 'right',
          }}
        >
          {description}
        </span>
      </div>
      {showTip && (
        <p
          className="vela-body-sm"
          style={{
            fontSize: '0.65rem',
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--gray-100)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2)',
            marginTop: 'var(--space-1)',
            lineHeight: 1.5,
          }}
        >
          {tooltip}
        </p>
      )}
    </div>
  );
}

function TriggerCard({
  direction,
  level,
  label,
  active = false,
}: {
  direction: 'bullish' | 'bearish';
  level: string;
  label: string;
  active?: boolean;
}) {
  const isBull = direction === 'bullish';
  const color = isBull ? 'var(--green-dark)' : 'var(--red-dark)';
  const bg = isBull ? 'var(--green-light)' : 'var(--red-light)';

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-medium) solid var(--color-border-default)',
        boxShadow: 'var(--shadow-sm)',
        backgroundColor: bg,
      }}
    >
      {/* Direction icon */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-sm)',
          border: 'var(--border-medium) solid var(--color-border-default)',
          backgroundColor: 'var(--white)',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          {isBull ? (
            <polygon
              points="6,0 12,10 0,10"
              style={{ fill: color }}
              stroke="#1A1A1A"
              strokeWidth="1"
            />
          ) : (
            <polygon
              points="6,10 12,0 0,0"
              style={{ fill: color }}
              stroke="#1A1A1A"
              strokeWidth="1"
            />
          )}
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: 2,
          }}
        >
          <span
            className="vela-mono"
            style={{
              fontWeight: 'var(--weight-bold)',
              fontSize: '0.88rem',
              color: 'var(--color-text-primary)',
            }}
          >
            {level}
          </span>
          {active && (
            <span
              className="vela-label-sm"
              style={{
                color,
                backgroundColor: 'var(--white)',
                border: `1.5px solid ${color}`,
                borderRadius: '4px',
                padding: '1px var(--space-2)',
                lineHeight: 1.4,
                fontSize: '0.58rem',
              }}
            >
              {isBull ? 'Above' : 'Below'}
            </span>
          )}
        </div>
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
            fontSize: '0.72rem',
          }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

/* ── Signal color mapping for group borders & badges ── */
const groupColorMap: Record<
  SignalColor,
  { border: string; bg: string; text: string; label: string }
> = {
  green: {
    border: 'var(--green-dark)',
    bg: 'var(--green-light)',
    text: 'var(--green-dark)',
    label: 'Buy',
  },
  red: {
    border: 'var(--red-dark)',
    bg: 'var(--red-light)',
    text: 'var(--red-dark)',
    label: 'Sell',
  },
  grey: {
    border: 'var(--color-text-muted)',
    bg: 'var(--sky-100)',
    text: 'var(--color-text-muted)',
    label: 'Wait',
  },
};

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString(undefined, opts);
  }
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

/**
 * Key Signal card with expandable signal history.
 */
function SignalHistoryCard({
  signalColor,
  headline,
  groups,
  hasHistory,
  symbol,
  isNew,
}: {
  signalColor: SignalColor;
  headline: string;
  groups: BriefGroup[];
  hasHistory: boolean;
  symbol: string;
  isNew?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(5);

  const GROUPS_INCREMENT = 5;
  const displayGroups = groups.slice(0, visibleCount);
  const hasMore = groups.length > visibleCount;

  // NEW badge color matches signal color
  const newBadgeColors =
    signalColor === 'green'
      ? { text: 'var(--green-dark)', bg: 'var(--green-light)', border: 'var(--green-primary)' }
      : signalColor === 'red'
        ? { text: 'var(--red-dark)', bg: 'var(--red-light)', border: 'var(--red-primary)' }
        : { text: 'var(--color-text-primary)', bg: 'var(--gray-100)', border: 'var(--gray-300)' };

  return (
    <div
      className="vela-card"
      style={{
        marginBottom: 'var(--space-4)',
        backgroundColor: signalBg[signalColor],
        cursor: hasHistory ? 'pointer' : 'default',
        padding: 0,
      }}
    >
      {/* Always-visible: signal title + bold headline */}
      <div
        role={hasHistory ? 'button' : undefined}
        tabIndex={hasHistory ? 0 : undefined}
        onClick={() => hasHistory && setExpanded(!expanded)}
        onKeyDown={e => {
          if (hasHistory && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        style={{
          padding: 'var(--space-5)',
          paddingBottom: hasHistory ? 'var(--space-3)' : 'var(--space-5)',
          cursor: hasHistory ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel style={{ marginBottom: 0 }}>
            Key Signal · {signalTitles[signalColor]}
          </SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {isNew && !expanded && (
              <span
                style={{
                  fontSize: '0.55rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: newBadgeColors.text,
                  backgroundColor: newBadgeColors.bg,
                  border: `1.5px solid ${newBadgeColors.border}`,
                  borderRadius: '4px',
                  padding: '1px var(--space-2)',
                  lineHeight: 1.3,
                }}
              >
                NEW
              </span>
            )}
            {hasHistory && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform var(--motion-normal) var(--motion-ease-out)',
                }}
              >
                <path
                  d="M3 6L8 11L13 6"
                  style={{ stroke: 'var(--gray-400)' }}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </div>
        <p
          className="vela-heading-base"
          style={{
            marginTop: 'var(--space-2)',
            fontWeight: 'var(--weight-bold)',
            fontSize: '0.92rem',
            color: 'var(--color-text-primary)',
            lineHeight: 1.45,
          }}
        >
          {headline}
        </p>
      </div>

      {/* Expandable: signal history timeline */}
      {expanded && hasHistory && (
        <div
          style={{
            borderTop: '1.5px solid rgba(0,0,0,0.08)',
            padding: 'var(--space-3) var(--space-5) var(--space-4)',
          }}
        >
          <span
            className="vela-label-sm"
            style={{
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: '0.62rem',
            }}
          >
            Signal history
          </span>
          <div className="vela-stack" style={{ gap: 'var(--space-2)' }}>
            {displayGroups.map((group, gi) => {
              const gc = group.signalColor ? groupColorMap[group.signalColor] : groupColorMap.grey;
              const leadBrief = group.briefs[0];
              const isNewEntry = gi === 0 && isNew;
              const priceAtSignal = leadBrief.detail?.price_at_brief;

              return (
                <div
                  key={gi}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) 0',
                    borderBottom:
                      gi < displayGroups.length - 1 ? '1px solid var(--gray-100)' : 'none',
                  }}
                >
                  {/* Signal badge */}
                  <span
                    style={{
                      fontSize: '0.55rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: gc.text,
                      backgroundColor: gc.bg,
                      border: `1.5px solid ${gc.border}`,
                      borderRadius: '4px',
                      padding: '2px 0',
                      lineHeight: 1.3,
                      flexShrink: 0,
                      width: 38,
                      textAlign: 'center',
                      marginTop: 2,
                    }}
                  >
                    {gc.label}
                  </span>

                  {/* Headline + date + price stacked */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span
                        className="vela-body-sm"
                        style={{
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--color-text-primary)',
                          lineHeight: 1.4,
                          fontSize: '0.72rem',
                        }}
                      >
                        {stripAssetPrefix(leadBrief.headline, symbol)}
                      </span>
                      {isNewEntry && (
                        <span
                          style={{
                            fontSize: '0.5rem',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: newBadgeColors.text,
                            backgroundColor: newBadgeColors.bg,
                            border: `1.5px solid ${newBadgeColors.border}`,
                            borderRadius: '3px',
                            padding: '0 4px',
                            lineHeight: 1.4,
                            flexShrink: 0,
                          }}
                        >
                          NEW
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '0.58rem',
                        color: 'var(--gray-400)',
                        display: 'block',
                        marginTop: 2,
                      }}
                    >
                      {gi === 0 ? 'Since ' : ''}
                      {formatDateRange(group.dateRange[0], group.dateRange[1])}
                      {priceAtSignal != null && (
                        <>
                          {' · Signal triggered at '}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                            {formatPrice(priceAtSignal)}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progressive disclosure — show 5 more at a time */}
          {hasMore && (
            <button
              onClick={e => {
                e.stopPropagation();
                setVisibleCount(prev => prev + GROUPS_INCREMENT);
              }}
              className="vela-body-sm"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-action-primary)',
                fontWeight: 600,
                fontSize: '0.65rem',
                padding: 'var(--space-2) 0',
                textAlign: 'center',
                width: '100%',
                marginTop: 'var(--space-1)',
              }}
            >
              View more ({Math.min(GROUPS_INCREMENT, groups.length - visibleCount)})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
