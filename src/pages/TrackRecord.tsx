import { useState } from 'react';
import { Card, Badge, PageHeader } from '../components/VelaComponents';
import VelaLogo from '../components/VelaLogo';
import ShareTradeCard from '../components/ShareTradeCard';
import { useTrackRecord, DEFAULT_POSITION_SIZE, type EnrichedTrade } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import TierComparisonSheet from '../components/TierComparisonSheet';
import TradeProposalCard from '../components/TradeProposalCard';
import { getCoinIcon, formatPrice, reasonCodeToPlainEnglish } from '../lib/helpers';
import {
  calculateUnrealizedPnL,
  pctToDollar,
  computePositionPnl,
  aggregatePositionStats,
  formatDurationMs,
  getEffectivePnl,
  computePositionFees,
} from '../utils/calculations';
import type { TradeDirection, Position } from '../types';

// BB2 trades use 30% of standard position size
const BB2_POSITION_MULT = 0.3;
const BB2_POSITION_SIZE = DEFAULT_POSITION_SIZE * BB2_POSITION_MULT; // $300

/**
 * Curated metrics from backtested model performance.
 * Manually updated when backtests are re-run. These match marketing site claims.
 */
const CURATED_METRICS = {
  winRate: 73,
  totalPositions: 94,
  avgReturnPct: 4.2,
  avgHoldingPeriod: '3.1 days',
  lastUpdated: 'Mar 2026',
};

/** Is this a BB2 (short-term mean-reversion) trade? */
function isBB2Direction(d: TradeDirection | null | undefined): boolean {
  return d === 'bb2_long' || d === 'bb2_short';
}

/** Old BB overlays (bb_long/bb_short) — attached to parent EMA positions */
const isOldOverlayDirection = (d?: string | null) => d === 'bb_long' || d === 'bb_short';

/** Map raw direction to user-facing label */
function directionLabel(d: TradeDirection | null | undefined): string {
  if (!d) return 'Long';
  if (d === 'short' || d === 'bb_short' || d === 'bb2_short') return 'Short';
  if (d === 'trim') return 'Trim';
  return 'Long';
}

/** Is this a short-side trade? */
function isShortTrade(d: TradeDirection | null | undefined): boolean {
  return d === 'short' || d === 'bb_short' || d === 'bb2_short';
}

/** Position size for a given trade direction */
function tradePositionSize(d: TradeDirection | null | undefined): number {
  return isBB2Direction(d) ? BB2_POSITION_SIZE : DEFAULT_POSITION_SIZE;
}

/** Format a date range: omit year on the first date if both are in the same year */
const fmtDate = (d: Date, includeYear: boolean) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: '2-digit' } : {}),
  });

function formatDateRange(openedAt: string, closedAt?: string | null): string {
  const open = new Date(openedAt);
  if (!closedAt) return fmtDate(open, true);
  const close = new Date(closedAt);
  const sameYear = open.getFullYear() === close.getFullYear();
  return `${fmtDate(open, !sameYear)} — ${fmtDate(close, true)}`;
}

/** Inline "⚡ Fast trade" label shown on BB2 date lines */
function FastTradeBadge() {
  return <span style={{ whiteSpace: 'nowrap' }}>{' · '}&#9889; Fast trade</span>;
}

/** Info card shown in expanded BB2 cards — connects to the ⚡ badge */
function FastTradeInfoCard() {
  return (
    <div
      style={{
        background: 'var(--cream-dark, #f5f0e8)',
        borderRadius: '8px',
        padding: '8px 10px',
        marginTop: 'var(--space-2)',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.68rem',
          fontWeight: 600,
          color: 'var(--gray-600, #6b6b6b)',
          lineHeight: 1.3,
        }}
      >
        &#9889; Fast trade
      </p>
      <p
        style={{
          margin: 0,
          marginTop: '2px',
          fontSize: '0.65rem',
          color: 'var(--gray-500, #8a8a8a)',
          lineHeight: 1.4,
        }}
      >
        Vela spotted a short-term market opportunity and placed a smaller trade to try to take
        advantage.
      </p>
    </div>
  );
}

/** A parent trade with its associated trims grouped together */
interface GroupedTrade {
  trade: EnrichedTrade;
  trims: EnrichedTrade[];
  overlays: EnrichedTrade[];
}

/**
 * Group trades into positions:
 * - EMA trades (long/short) are parents with trims matched by time window
 * - BB2 trades (bb2_long/bb2_short) are standalone atomic positions
 * - Old BB overlays (bb_long/bb_short) are attached to EMA parents or dropped
 * - Trims without a parent show as standalone cards
 */
function groupTradesWithTrims(trades: EnrichedTrade[]): GroupedTrade[] {
  const parents = trades.filter(t => t.direction !== 'trim' && !isOldOverlayDirection(t.direction));
  const trims = trades.filter(t => t.direction === 'trim');
  const overlays = trades.filter(t => isOldOverlayDirection(t.direction));

  const grouped: GroupedTrade[] = parents.map(parent => {
    // BB2 trades are atomic — no trims or overlays
    if (isBB2Direction(parent.direction)) {
      return { trade: parent, trims: [], overlays: [] };
    }

    // EMA parents: match trims and old overlays by asset + time window
    const parentOpen = new Date(parent.opened_at).getTime();
    const parentClose = parent.closed_at ? new Date(parent.closed_at).getTime() : Date.now();

    const inWindow = (child: EnrichedTrade) => {
      if (child.asset_id !== parent.asset_id) return false;
      const t = new Date(child.opened_at).getTime();
      return t >= parentOpen && t <= parentClose;
    };

    return {
      trade: parent,
      trims: trims.filter(inWindow),
      overlays: overlays.filter(inWindow),
    };
  });

  // Orphaned trims → standalone cards
  const assignedTrimIds = new Set(grouped.flatMap(g => g.trims.map(t => t.id)));
  const orphanedTrims = trims.filter(t => !assignedTrimIds.has(t.id));
  for (const trim of orphanedTrims) {
    grouped.push({ trade: trim, trims: [], overlays: [] });
  }

  return grouped;
}

export default function TrackRecord() {
  const { trades, livePrices, assetMap, loading } = useTrackRecord();
  const { isAuthenticated } = useAuthContext();
  const { positions, closedPositions, proposals, acceptProposal, declineProposal, wallet } =
    useTrading();
  const { canTrade, tier, upgradeLabel, startCheckout } = useTierAccess();
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [showVelaHistory, setShowVelaHistory] = useState(false);
  const [showTierSheet, setShowTierSheet] = useState(false);

  const hasLivePositions = isAuthenticated && positions.length > 0;

  // Pending + in-flight proposals (show on this page so user can act on them)
  const pendingProposals = proposals.filter(p => p.status === 'pending');
  const activeProposals = proposals.filter(
    p =>
      (p.status === 'approved' || p.status === 'auto_approved' || p.status === 'executing') &&
      new Date(p.expires_at).getTime() > Date.now()
  );

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 64,
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <VelaLogo variant="mark" size={48} pulse />
        <span className="vela-body-sm vela-text-muted">Loading trades...</span>
      </div>
    );
  }

  // ── Partition trades into user's live trades vs Vela's paper/backtest trades ──
  const userTrades = trades.filter(t => t.source === 'live');
  const paperTrades = trades.filter(t => t.source === 'backtest');

  const userClosed = userTrades.filter(
    (t): t is typeof t & { pnl_pct: number } => t.status === 'closed' && t.pnl_pct != null
  );
  const userOpen = userTrades.filter(t => t.status === 'open');

  // ── Helper: get live price for an asset ──
  const getLivePrice = (coingeckoId: string | undefined): number | null => {
    if (!coingeckoId) return null;
    return livePrices[coingeckoId]?.price ?? null;
  };

  // ── Real position stats (from positions table, not paper_trades) ──
  // Includes both open and closed positions for a complete picture.
  const realPositionStats = (() => {
    const allPositions = [...closedPositions, ...positions];
    if (allPositions.length === 0) return null;

    let totalPnl = 0;
    let wins = 0;
    const total = allPositions.length;

    for (const pos of closedPositions) {
      const posFees = computePositionFees(pos);
      const hasPosFees = posFees.totalFees > 0.005;
      const pnl = hasPosFees
        ? posFees.netPnlDollar
        : pos.total_pnl != null && pos.total_pnl !== 0
          ? pos.total_pnl
          : pctToDollar(pos.closed_pnl_pct ?? 0, pos.original_size_usd ?? pos.size_usd);
      const pct = hasPosFees ? posFees.netPnlPct : (pos.closed_pnl_pct ?? 0);
      totalPnl += pnl;
      if (pct > 0) wins++;
    }

    for (const pos of positions) {
      const posAsset = assetMap[pos.asset_id];
      const livePrice = getLivePrice(posAsset?.coingecko_id);
      const { pnlDollar } = getEffectivePnl(pos, livePrice ?? undefined);
      totalPnl += pnlDollar;
      if (pnlDollar > 0) wins++;
    }

    return {
      total,
      wins,
      totalPnl,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
      openCount: positions.length,
    };
  })();

  const groupedPaperClosed = groupTradesWithTrims(paperTrades).filter(
    g => g.trade.status === 'closed' && g.trade.pnl_pct != null
  );
  const paperPositions = groupedPaperClosed.map(g =>
    computePositionPnl(
      g.trade.pnl_pct!,
      g.trims.map(t => ({ pnl_pct: t.pnl_pct, trim_pct: t.trim_pct })),
      tradePositionSize(g.trade.direction)
    )
  );
  const paperStats = aggregatePositionStats(paperPositions);
  const hasUserTrades =
    userTrades.length > 0 ||
    hasLivePositions ||
    pendingProposals.length > 0 ||
    closedPositions.length > 0;

  // Best paper POSITION by total position P&L (parent + trims, not individual trade pnl_pct)
  const bestPaperIdx = paperPositions.reduce<number | null>(
    (bestIdx, pos, idx) => {
      if (bestIdx === null || pos.totalDollarPnl > paperPositions[bestIdx].totalDollarPnl)
        return idx;
      return bestIdx;
    },
    paperPositions.length > 0 ? 0 : null
  );
  const bestPaperGroup = bestPaperIdx != null ? groupedPaperClosed[bestPaperIdx] : null;
  const bestPaperPnl = bestPaperIdx != null ? paperPositions[bestPaperIdx] : null;

  // ── Helper: format duration ──
  const formatDuration = (openedAt: string): string =>
    formatDurationMs(Date.now() - new Date(openedAt).getTime());

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 80,
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      <PageHeader title="Trades" subtitle="Your trades and Vela's signal performance" />

      {/* ══════════════════════════════════════════════════════
          ZONE 1: YOUR TRADES (primary)
          ══════════════════════════════════════════════════════ */}
      <span
        className="vela-label-sm vela-text-muted"
        style={{
          textTransform: 'uppercase',
          display: 'block',
          marginBottom: 'var(--space-3)',
          paddingLeft: 'var(--space-1)',
        }}
      >
        Your trades
      </span>

      {!hasUserTrades ? (
        /* Empty state for "Your trades" */
        !canTrade ? (
          <Card style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
              <p
                className="vela-heading-base"
                style={{ marginBottom: 'var(--space-2)', fontSize: '1rem' }}
              >
                Start trading to build your track record
              </p>
              <p
                className="vela-body-sm vela-text-secondary"
                style={{ maxWidth: 280, margin: '0 auto var(--space-4)', lineHeight: 1.6 }}
              >
                {upgradeLabel('start trading and track your performance')}
              </p>
              <button
                className="vela-btn vela-btn-primary vela-btn-sm"
                onClick={() => setShowTierSheet(true)}
              >
                View plans
              </button>
            </div>
          </Card>
        ) : (
          <Card style={{ marginBottom: 'var(--space-5)' }}>
            <p className="vela-body-sm" style={{ color: 'var(--gray-500)', margin: 0 }}>
              When you approve your first trade, it&rsquo;ll show up here.
            </p>
          </Card>
        )
      ) : (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          {/* Real position stats — open + closed from positions table */}
          {realPositionStats && (
            <Card style={{ marginBottom: 'var(--space-3)' }}>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-xl)',
                  color: realPositionStats.totalPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {realPositionStats.totalPnl >= 0 ? '+' : '-'}$
                {Math.abs(realPositionStats.totalPnl).toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })}{' '}
                total {realPositionStats.totalPnl >= 0 ? 'profit' : 'loss'}
              </p>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-600)', margin: 0, marginTop: 'var(--space-1)' }}
              >
                {realPositionStats.total} position
                {realPositionStats.total !== 1 ? 's' : ''} · {realPositionStats.wins} profitable
                {realPositionStats.total > 0 && ` (${realPositionStats.winRate}%)`}
                {realPositionStats.openCount > 0 && ` · ${realPositionStats.openCount} open`}
              </p>
            </Card>
          )}

          {/* Pending proposals — actionable trades waiting for approval */}
          {(pendingProposals.length > 0 || activeProposals.length > 0) && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                Pending trades
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {pendingProposals.map(proposal => {
                  const asset = assetMap[proposal.asset_id];
                  const symbol = asset?.symbol ?? proposal.asset_id.toUpperCase();
                  const coingeckoId = asset?.coingecko_id;
                  const livePrice = coingeckoId ? livePrices[coingeckoId]?.price : undefined;
                  const assetPosition = positions.find(p => p.asset_id === proposal.asset_id);
                  return (
                    <TradeProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      assetSymbol={symbol}
                      onAccept={acceptProposal}
                      onDecline={declineProposal}
                      walletBalance={wallet?.balance_usdc}
                      walletEnvironment={wallet?.environment}
                      canTrade={canTrade}
                      upgradeLabel={canTrade ? undefined : upgradeLabel('start trading')}
                      onUpgradeClick={canTrade ? undefined : () => setShowTierSheet(true)}
                      currentPrice={livePrice ?? undefined}
                      iconUrl={getCoinIcon(coingeckoId)}
                      positionEntryPrice={assetPosition?.entry_price}
                      positionSizeUsd={assetPosition?.size_usd}
                    />
                  );
                })}
                {activeProposals.map(proposal => {
                  const asset = assetMap[proposal.asset_id];
                  const symbol = asset?.symbol ?? proposal.asset_id.toUpperCase();
                  return (
                    <TradeProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      assetSymbol={symbol}
                      onAccept={acceptProposal}
                      onDecline={declineProposal}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Live positions */}
          {hasLivePositions && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                Open positions
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {positions.map(pos => {
                  const posAsset = assetMap[pos.asset_id];
                  const posCoingeckoId = posAsset?.coingecko_id;
                  const posLivePrice = posCoingeckoId
                    ? livePrices[posCoingeckoId]?.price
                    : undefined;
                  return (
                    <LivePositionCard
                      key={pos.id}
                      position={pos}
                      livePrice={posLivePrice}
                      expanded={expandedTradeId === pos.id}
                      onToggle={() =>
                        setExpandedTradeId(expandedTradeId === pos.id ? null : pos.id)
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* User's open trades */}
          {userOpen.length > 0 && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                Open trades
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {userOpen.map(trade => (
                  <OpenTradeCard
                    key={trade.id}
                    trade={trade}
                    currentPrice={getLivePrice(trade.asset_coingecko_id)}
                    coingeckoId={trade.asset_coingecko_id}
                    formatDuration={formatDuration}
                    entryHeadline={
                      trade.entry_headline ??
                      reasonCodeToPlainEnglish(trade.entry_reason_code) ??
                      undefined
                    }
                    expanded={expandedTradeId === trade.id}
                    onToggle={() =>
                      setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)
                    }
                    positionSize={tradePositionSize(trade.direction)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Closed positions (from positions table — real user trades) */}
          {closedPositions.length > 0 && (
            <div style={{ marginBottom: userClosed.length > 0 ? 'var(--space-3)' : 0 }}>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                Closed positions
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {closedPositions.map(pos => (
                  <ClosedPositionCard
                    key={pos.id}
                    position={pos}
                    expanded={expandedTradeId === pos.id}
                    onToggle={() => setExpandedTradeId(expandedTradeId === pos.id ? null : pos.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* User's closed trades (legacy, from paper_trades table with source=live) */}
          {/* Hide when user has real positions — positions table is the canonical source */}
          {userClosed.length > 0 && closedPositions.length === 0 && (
            <div>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                Closed trades
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {userClosed.map(trade => (
                  <ClosedTradeCard
                    key={trade.id}
                    trade={trade}
                    coingeckoId={trade.asset_coingecko_id}
                    entryHeadline={
                      trade.entry_headline ??
                      reasonCodeToPlainEnglish(trade.entry_reason_code) ??
                      undefined
                    }
                    exitHeadline={
                      trade.exit_headline ??
                      reasonCodeToPlainEnglish(trade.exit_reason_code) ??
                      undefined
                    }
                    expanded={expandedTradeId === trade.id}
                    onToggle={() =>
                      setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)
                    }
                    positionSize={tradePositionSize(trade.direction)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ZONE 2: VELA'S TRACK RECORD (curated metrics + best trade)
          ══════════════════════════════════════════════════════ */}
      <div>
        {/* Collapsible header */}
        <button
          onClick={() => setShowVelaHistory(!showVelaHistory)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: 'var(--space-3) var(--space-1)',
            background: 'none',
            border: 'none',
            borderTop: '2px solid var(--gray-200)',
            cursor: 'pointer',
            marginBottom: showVelaHistory ? 'var(--space-3)' : 0,
          }}
        >
          <div style={{ textAlign: 'left' }}>
            <span
              className="vela-label-sm"
              style={{
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                display: 'block',
              }}
            >
              Vela&rsquo;s track record
            </span>
            <span className="vela-body-sm" style={{ color: 'var(--gray-400)', fontSize: '0.7rem' }}>
              Model performance since Jan 2026
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              className="vela-mono"
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--green-dark)',
              }}
            >
              {CURATED_METRICS.winRate}% win rate
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              style={{
                flexShrink: 0,
                transform: showVelaHistory ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="var(--gray-400)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </button>

        {showVelaHistory && (
          <div>
            {/* Disclaimer */}
            <p
              className="vela-body-sm"
              style={{
                color: 'var(--gray-400)',
                margin: 0,
                marginBottom: 'var(--space-3)',
                fontSize: '0.7rem',
                textAlign: 'center',
              }}
            >
              Based on backtested model performance, not real money. Past performance does not
              guarantee future results.
            </p>

            {/* Curated metrics card */}
            <Card style={{ marginBottom: 'var(--space-3)' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-3)',
                }}
              >
                <div>
                  <p
                    className="vela-label-sm"
                    style={{ color: 'var(--gray-500)', margin: 0, marginBottom: 2 }}
                  >
                    Win rate
                  </p>
                  <p
                    className="vela-mono"
                    style={{
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      color: 'var(--green-dark)',
                      margin: 0,
                    }}
                  >
                    {CURATED_METRICS.winRate}%
                  </p>
                </div>
                <div>
                  <p
                    className="vela-label-sm"
                    style={{ color: 'var(--gray-500)', margin: 0, marginBottom: 2 }}
                  >
                    Total positions
                  </p>
                  <p
                    className="vela-mono"
                    style={{
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                      margin: 0,
                    }}
                  >
                    {CURATED_METRICS.totalPositions}
                  </p>
                </div>
                <div>
                  <p
                    className="vela-label-sm"
                    style={{ color: 'var(--gray-500)', margin: 0, marginBottom: 2 }}
                  >
                    Avg return per trade
                  </p>
                  <p
                    className="vela-mono"
                    style={{
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      color: 'var(--green-dark)',
                      margin: 0,
                    }}
                  >
                    +{CURATED_METRICS.avgReturnPct}%
                  </p>
                </div>
                <div>
                  <p
                    className="vela-label-sm"
                    style={{ color: 'var(--gray-500)', margin: 0, marginBottom: 2 }}
                  >
                    Avg holding period
                  </p>
                  <p
                    className="vela-mono"
                    style={{
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                      margin: 0,
                    }}
                  >
                    {CURATED_METRICS.avgHoldingPeriod}
                  </p>
                </div>
              </div>
              <p
                className="vela-body-sm"
                style={{
                  color: 'var(--gray-400)',
                  margin: 0,
                  marginTop: 'var(--space-3)',
                  fontSize: '0.7rem',
                }}
              >
                Last updated {CURATED_METRICS.lastUpdated}
              </p>
            </Card>

            {/* Best trade (paper) */}
            {bestPaperGroup && bestPaperPnl && paperStats.totalClosed >= 3 && (
              <BestTradeCard
                group={bestPaperGroup}
                positionPnl={bestPaperPnl}
                coingeckoId={assetMap[bestPaperGroup.trade.asset_id]?.coingecko_id}
              />
            )}
          </div>
        )}
      </div>

      {/* Tier comparison overlay */}
      {showTierSheet && (
        <TierComparisonSheet
          currentTier={tier}
          onClose={() => setShowTierSheet(false)}
          onStartCheckout={async (t, billingCycle) => {
            try {
              await startCheckout(t, billingCycle);
              setShowTierSheet(false);
            } catch (err) {
              setShowTierSheet(false);
              console.error('[TrackRecord] Checkout error:', err);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Open Trade Card ──

function OpenTradeCard({
  trade,
  currentPrice,
  coingeckoId,
  formatDuration,
  entryHeadline,
  expanded,
  onToggle,
  positionSize = DEFAULT_POSITION_SIZE,
}: {
  trade: EnrichedTrade;
  currentPrice: number | null;
  coingeckoId: string | undefined;
  formatDuration: (openedAt: string) => string;
  entryHeadline?: string;
  expanded: boolean;
  onToggle: () => void;
  positionSize?: number;
}) {
  const short = isShortTrade(trade.direction);
  const unrealizedPct =
    currentPrice != null
      ? calculateUnrealizedPnL(trade.entry_price, currentPrice, short ? 'short' : 'long')
      : null;
  const unrealizedDollar = unrealizedPct != null ? pctToDollar(unrealizedPct, positionSize) : null;

  const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();

  return (
    <Card
      compact
      style={{
        borderLeft: `4px solid ${short ? 'var(--red-primary)' : 'var(--green-primary)'}`,
        cursor: 'pointer',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Top row: logo + name | P&L */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AssetIcon iconUrl={iconUrl} symbol={symbol} size={28} />
            <div>
              <span className="vela-heading-base">{symbol}</span>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, lineHeight: 1.3 }}
              >
                {directionLabel(trade.direction)} · Open {formatDuration(trade.opened_at)}
              </p>
            </div>
          </div>

          {unrealizedPct != null ? (
            <div style={{ textAlign: 'right' }}>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-base)',
                  color: unrealizedPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {unrealizedPct >= 0 ? '+' : ''}
                {unrealizedPct.toFixed(1)}%
              </p>
              {unrealizedDollar != null && (
                <p
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)',
                    color: unrealizedDollar >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    margin: 0,
                  }}
                >
                  {unrealizedDollar >= 0 ? '+' : '-'}$
                  {Math.abs(unrealizedDollar).toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  {unrealizedDollar >= 0 ? 'profit' : 'loss'}
                </p>
              )}
            </div>
          ) : (
            <Badge variant="buy">Open</Badge>
          )}
        </div>

        {/* Entry headline */}
        {entryHeadline && (
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              margin: 0,
              marginTop: 'var(--space-2)',
              paddingLeft: 'var(--space-2)',
              borderLeft: `2px solid ${short ? 'var(--red-primary)' : 'var(--green-primary)'}`,
              lineHeight: 1.4,
            }}
          >
            &ldquo;{entryHeadline}&rdquo;
          </p>
        )}

        {/* Price row */}
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--gray-600)',
            fontFamily: 'var(--type-mono-base-font)',
            marginTop: 'var(--space-2)',
            marginBottom: 0,
          }}
        >
          Entry {formatPrice(trade.entry_price)}
          {currentPrice != null && ` → Current ${formatPrice(currentPrice)}`}
        </p>

        {/* Date */}
        <p
          className="vela-body-sm"
          style={{ color: 'var(--gray-400)', marginTop: 'var(--space-2)', marginBottom: 0 }}
        >
          {formatDateRange(trade.opened_at)}
          {isBB2Direction(trade.direction) && <FastTradeBadge />}
        </p>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '2px solid var(--gray-200)',
          }}
        >
          {/* Position line items */}
          <DetailRow label="Position size" value={`$${positionSize.toLocaleString()}`} />
          <DetailRow label="Entry price" value={formatPrice(trade.entry_price)} />
          {currentPrice != null && (
            <DetailRow label="Current price" value={formatPrice(currentPrice)} />
          )}
          <DetailRow label="Duration" value={formatDuration(trade.opened_at)} />
          {unrealizedPct != null && unrealizedDollar != null && (
            <DetailRow
              label="Unrealized P&L"
              value={`${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}% · ${unrealizedDollar >= 0 ? '+' : '-'}$${Math.abs(unrealizedDollar).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${unrealizedPct >= 0 ? 'profit' : 'loss'}`}
              valueColor={unrealizedPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
            />
          )}

          {/* Yellow events */}
          {trade.yellow_events && trade.yellow_events.length > 0 && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <p
                className="vela-label"
                style={{
                  color: 'var(--gray-500)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Alerts
              </p>
              {trade.yellow_events.map((ye, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: 'var(--amber-primary)',
                      border: '1px solid var(--gray-900)',
                      marginTop: 5,
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <span className="vela-body-sm" style={{ color: 'var(--amber-dark)' }}>
                    {ye.suggested_action}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Exit strategy */}
          <div
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2)',
              backgroundColor: 'var(--gray-100)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--gray-400)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="vela-body-sm" style={{ color: 'var(--gray-500)', margin: 0 }}>
              Position closes when signal flips to {short ? 'Buy' : 'Sell'}
            </p>
          </div>

          {/* Fast trade info card — at bottom of expanded detail */}
          {isBB2Direction(trade.direction) && <FastTradeInfoCard />}
        </div>
      )}
    </Card>
  );
}

// ── Closed Trade Card ──

function ClosedTradeCard({
  trade,
  trims,
  coingeckoId,
  entryHeadline,
  exitHeadline,
  expanded,
  onToggle,
  positionSize = DEFAULT_POSITION_SIZE,
}: {
  trade: EnrichedTrade;
  trims?: EnrichedTrade[];
  coingeckoId: string | undefined;
  entryHeadline?: string;
  exitHeadline?: string;
  expanded: boolean;
  onToggle: () => void;
  positionSize?: number;
}) {
  // Position-level P&L: includes close P&L + all trim P&Ls
  const positionPnl =
    trade.pnl_pct != null
      ? computePositionPnl(
          trade.pnl_pct,
          (trims ?? []).map(t => ({ pnl_pct: t.pnl_pct, trim_pct: t.trim_pct })),
          positionSize
        )
      : null;
  const totalDollarPnl = positionPnl?.totalDollarPnl ?? null;
  const totalPnlPct = positionPnl?.totalPnlPct ?? null;
  const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();

  return (
    <Card compact style={{ cursor: 'pointer' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Top row: logo + name | P&L */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AssetIcon iconUrl={iconUrl} symbol={symbol} size={28} />
            <div>
              <span className="vela-heading-base">{symbol}</span>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, lineHeight: 1.3 }}
              >
                {directionLabel(trade.direction)}
                {trade.direction === 'trim' && trade.trim_pct != null && ` (${trade.trim_pct}%)`} ·
                Closed
                {trims &&
                  trims.length > 0 &&
                  ` · ${trims.length} trim${trims.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          {totalPnlPct != null && (
            <div style={{ textAlign: 'right' }}>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-base)',
                  color: (totalDollarPnl ?? 0) >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {totalPnlPct >= 0 ? '+' : ''}
                {totalPnlPct.toFixed(1)}%
              </p>
              {totalDollarPnl != null && (
                <p
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)',
                    color: totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    margin: 0,
                  }}
                >
                  {totalDollarPnl >= 0 ? '+' : '-'}$
                  {Math.abs(totalDollarPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}{' '}
                  {totalDollarPnl >= 0 ? 'profit' : 'loss'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Entry headline (collapsed state) */}
        {entryHeadline && (
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              margin: 0,
              marginTop: 'var(--space-2)',
              paddingLeft: 'var(--space-2)',
              borderLeft: `2px solid ${isShortTrade(trade.direction) ? 'var(--red-primary)' : 'var(--green-primary)'}`,
              lineHeight: 1.4,
            }}
          >
            &ldquo;{entryHeadline}&rdquo;
          </p>
        )}

        {/* Price row */}
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--gray-600)',
            fontFamily: 'var(--type-mono-base-font)',
            marginTop: 'var(--space-2)',
            marginBottom: 0,
          }}
        >
          Entry {formatPrice(trade.entry_price)}
          {trade.exit_price != null && ` → Exit ${formatPrice(trade.exit_price)}`}
        </p>

        {/* Date range */}
        <p
          className="vela-body-sm"
          style={{ color: 'var(--gray-400)', marginTop: 'var(--space-2)', marginBottom: 0 }}
        >
          {formatDateRange(trade.opened_at, trade.closed_at)}
          {isBB2Direction(trade.direction) && <FastTradeBadge />}
        </p>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '2px solid var(--gray-200)',
          }}
        >
          {/* Position line items */}
          <DetailRow label="Position size" value={`$${positionSize.toLocaleString()}`} />
          {trade.trim_pct != null && (
            <DetailRow
              label="Trimmed"
              value={`${trade.trim_pct}% of position · $${Math.round((positionSize * trade.trim_pct) / 100).toLocaleString()}`}
            />
          )}
          <DetailRow label="Entry price" value={formatPrice(trade.entry_price)} />
          {trade.exit_price != null && (
            <DetailRow label="Exit price" value={formatPrice(trade.exit_price)} />
          )}
          {trade.opened_at && trade.closed_at && (
            <DetailRow
              label="Duration"
              value={formatHoldingPeriod(trade.opened_at, trade.closed_at)}
            />
          )}
          {positionPnl != null && totalPnlPct != null && totalDollarPnl != null && (
            <DetailRow
              label="Total Position P&L"
              value={`${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}% · ${totalDollarPnl >= 0 ? '+' : '-'}$${Math.abs(totalDollarPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${totalDollarPnl >= 0 ? 'profit' : 'loss'}`}
              valueColor={totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
            />
          )}

          {/* Exit headline (expanded state) */}
          {exitHeadline && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <p
                className="vela-label"
                style={{ color: 'var(--gray-500)', marginBottom: 'var(--space-1)' }}
              >
                Exit reason
              </p>
              <p
                className="vela-body-sm"
                style={{
                  color: 'var(--color-text-secondary)',
                  fontStyle: 'italic',
                  margin: 0,
                  paddingLeft: 'var(--space-2)',
                  borderLeft: `2px solid ${isShortTrade(trade.direction) ? 'var(--green-primary)' : 'var(--red-primary)'}`,
                  lineHeight: 1.4,
                }}
              >
                &ldquo;{exitHeadline}&rdquo;
              </p>
            </div>
          )}

          {/* Yellow events */}
          {trade.yellow_events && trade.yellow_events.length > 0 && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <p
                className="vela-label"
                style={{
                  color: 'var(--gray-500)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Alerts during trade
              </p>
              {trade.yellow_events.map((ye, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: 'var(--amber-primary)',
                      border: '1px solid var(--gray-900)',
                      marginTop: 5,
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <span className="vela-body-sm" style={{ color: 'var(--amber-dark)' }}>
                    {ye.suggested_action}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Position timeline: trims + close with running cost basis */}
          {trims && trims.length > 0 && positionPnl && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--gray-50)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--gray-200)',
              }}
            >
              <span
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-600)',
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Position Timeline
              </span>

              {/* Entry */}
              <div
                style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
              >
                <div
                  style={{
                    width: 2,
                    backgroundColor: isShortTrade(trade.direction)
                      ? 'var(--red-primary)'
                      : 'var(--green-primary)',
                    borderRadius: 1,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <span
                    className="vela-body-sm"
                    style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}
                  >
                    Entry at {formatPrice(trade.entry_price)}
                  </span>
                  <span
                    className="vela-body-sm"
                    style={{ color: 'var(--gray-400)', display: 'block' }}
                  >
                    ${positionSize.toLocaleString()} position
                  </span>
                </div>
              </div>

              {/* Trims with running cost basis */}
              {trims.map((trim, idx) => {
                const breakdown = positionPnl.trimBreakdown[idx];
                const trimDollar = breakdown?.dollarPnl ?? 0;
                const costBasisAfter = breakdown?.costBasisAfter ?? 100;
                const remainingDollars = Math.round((costBasisAfter / 100) * positionSize);
                return (
                  <div
                    key={trim.id}
                    style={{
                      display: 'flex',
                      gap: 'var(--space-2)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    <div
                      style={{
                        width: 2,
                        backgroundColor: '#FFD700',
                        borderRadius: 1,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                        }}
                      >
                        <span className="vela-body-sm" style={{ fontWeight: 600 }}>
                          Trimmed {trim.trim_pct != null ? `${trim.trim_pct}%` : ''} at{' '}
                          {trim.exit_price != null ? formatPrice(trim.exit_price) : '—'}
                        </span>
                        <span
                          className="vela-body-sm"
                          style={{
                            fontFamily: 'var(--type-mono-base-font)',
                            fontWeight: 600,
                            color: trimDollar >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {trimDollar >= 0 ? '+' : '-'}$
                          {Math.abs(trimDollar).toLocaleString('en-US', {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      <span
                        className="vela-body-sm"
                        style={{ color: 'var(--gray-400)', display: 'block' }}
                      >
                        {new Date(trim.opened_at).toLocaleDateString('en-GB', {
                          month: 'short',
                          day: 'numeric',
                        })}
                        {costBasisAfter <= 0
                          ? ' · Fully in the money'
                          : ` · Initial capital: $${remainingDollars.toLocaleString()} left`}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Close */}
              <div
                style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
              >
                <div
                  style={{
                    width: 2,
                    backgroundColor: 'var(--gray-400)',
                    borderRadius: 1,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span className="vela-body-sm" style={{ fontWeight: 600 }}>
                      Closed {positionPnl.costBasisPct}% at{' '}
                      {trade.exit_price != null ? formatPrice(trade.exit_price) : '—'}
                    </span>
                    <span
                      className="vela-body-sm"
                      style={{
                        fontFamily: 'var(--type-mono-base-font)',
                        fontWeight: 600,
                        color:
                          positionPnl.closeDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {positionPnl.closeDollarPnl >= 0 ? '+' : '-'}$
                      {Math.abs(positionPnl.closeDollarPnl).toLocaleString('en-US', {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                  <span
                    className="vela-body-sm"
                    style={{ color: 'var(--gray-400)', display: 'block' }}
                  >
                    {trade.closed_at &&
                      new Date(trade.closed_at).toLocaleDateString('en-GB', {
                        month: 'short',
                        day: 'numeric',
                      })}
                  </span>
                </div>
              </div>

              {/* Position P&L summary */}
              <div
                style={{
                  marginTop: 'var(--space-2)',
                  paddingTop: 'var(--space-2)',
                  borderTop: '1px solid var(--gray-200)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className="vela-body-sm" style={{ color: 'var(--gray-500)' }}>
                  Trim {positionPnl.trimDollarPnl >= 0 ? 'profit' : 'loss'}:{' '}
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        positionPnl.trimDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    }}
                  >
                    {positionPnl.trimDollarPnl >= 0 ? '+' : '-'}$
                    {Math.abs(positionPnl.trimDollarPnl).toLocaleString('en-US', {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </span>
                <span
                  className="vela-body-sm"
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontWeight: 700,
                    color: (totalDollarPnl ?? 0) >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  }}
                >
                  Total: {(totalDollarPnl ?? 0) >= 0 ? '+' : '-'}$
                  {Math.abs(totalDollarPnl ?? 0).toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  {(totalDollarPnl ?? 0) >= 0 ? 'profit' : 'loss'}
                </span>
              </div>

              {/* House money badge */}
              {positionPnl.costBasisPct <= 0 && (
                <div
                  style={{
                    marginTop: 'var(--space-2)',
                    padding: 'var(--space-1) var(--space-2)',
                    backgroundColor: 'rgba(0, 208, 132, 0.1)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'inline-block',
                  }}
                >
                  <span className="vela-label-sm" style={{ color: 'var(--green-dark)' }}>
                    Position is house money
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Fast trade info card — before share */}
          {isBB2Direction(trade.direction) && <FastTradeInfoCard />}

          {/* Share trade card — always last */}
          {trade.exit_price != null && totalPnlPct != null && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-2)',
                borderTop: '1px solid var(--gray-200)',
              }}
            >
              <ShareTradeCard
                trade={{
                  symbol,
                  direction: trade.direction ?? 'long',
                  entryPrice: trade.entry_price,
                  exitPrice: trade.exit_price,
                  pnlPct: totalPnlPct,
                  duration:
                    trade.opened_at && trade.closed_at
                      ? formatHoldingPeriod(trade.opened_at, trade.closed_at)
                      : undefined,
                }}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Best Trade Hero Card ──

function BestTradeCard({
  group,
  positionPnl,
  coingeckoId,
  onTap,
}: {
  group: GroupedTrade;
  positionPnl: ReturnType<typeof computePositionPnl>;
  coingeckoId: string | undefined;
  onTap?: () => void;
}) {
  const trade = group.trade;
  const dollarPnl = positionPnl.totalDollarPnl;
  const pnlPct = positionPnl.totalPnlPct;
  const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();
  const short = isShortTrade(trade.direction);
  const isPositive = dollarPnl >= 0;

  const entryText =
    trade.entry_headline ?? reasonCodeToPlainEnglish(trade.entry_reason_code) ?? null;
  const exitText = trade.exit_headline ?? reasonCodeToPlainEnglish(trade.exit_reason_code) ?? null;

  const holdingPeriod =
    trade.opened_at && trade.closed_at
      ? formatDurationMs(new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime())
      : null;

  return (
    <Card
      variant={isPositive ? 'mint' : 'peach'}
      style={{ marginBottom: 'var(--space-3)', cursor: onTap ? 'pointer' : undefined }}
      onClick={onTap}
    >
      {/* Label */}
      <p
        className="vela-label"
        style={{
          color: 'var(--gray-500)',
          margin: 0,
          marginBottom: 'var(--space-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)' }}>&#9733;</span>
        Best trade
      </p>

      {/* Asset + direction + P&L */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AssetIcon iconUrl={iconUrl} symbol={symbol} size={32} />
          <div>
            <span className="vela-heading-base" style={{ fontSize: 'var(--text-lg)' }}>
              {symbol} {directionLabel(trade.direction)}
            </span>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <p
            style={{
              fontFamily: 'var(--type-mono-base-font)',
              fontWeight: 700,
              fontSize: 'var(--text-lg)',
              color: isPositive ? 'var(--green-dark)' : 'var(--red-dark)',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {isPositive ? '+' : ''}
            {pnlPct.toFixed(1)}%
          </p>
          <p
            style={{
              fontFamily: 'var(--type-mono-base-font)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              color: isPositive ? 'var(--green-dark)' : 'var(--red-dark)',
              margin: 0,
            }}
          >
            {dollarPnl >= 0 ? '+' : '-'}$
            {Math.abs(dollarPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}{' '}
            {dollarPnl >= 0 ? 'profit' : 'loss'}
          </p>
        </div>
      </div>

      {/* Entry headline */}
      {entryText && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-secondary)',
            fontStyle: 'italic',
            margin: 0,
            marginTop: 'var(--space-3)',
            paddingLeft: 'var(--space-2)',
            borderLeft: `2px solid ${short ? 'var(--red-primary)' : 'var(--green-primary)'}`,
            lineHeight: 1.4,
          }}
        >
          &ldquo;{entryText}&rdquo;
        </p>
      )}

      {/* Price + date row */}
      <p
        className="vela-body-sm"
        style={{
          color: 'var(--gray-600)',
          fontFamily: 'var(--type-mono-base-font)',
          marginTop: 'var(--space-3)',
          marginBottom: 0,
        }}
      >
        Entry {formatPrice(trade.entry_price)}
        {trade.exit_price != null && ` → Exit ${formatPrice(trade.exit_price)}`}
      </p>
      <p
        className="vela-body-sm"
        style={{ color: 'var(--gray-400)', marginTop: 'var(--space-1)', marginBottom: 0 }}
      >
        {formatDateRange(trade.opened_at, trade.closed_at)}
        {holdingPeriod && ` · ${holdingPeriod}`}
        {isBB2Direction(trade.direction) && <FastTradeBadge />}
      </p>

      {/* Exit headline */}
      {exitText && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-secondary)',
            fontStyle: 'italic',
            margin: 0,
            marginTop: 'var(--space-3)',
            paddingLeft: 'var(--space-2)',
            borderLeft: `2px solid ${short ? 'var(--green-primary)' : 'var(--red-primary)'}`,
            lineHeight: 1.4,
          }}
        >
          &ldquo;{exitText}&rdquo;
        </p>
      )}
    </Card>
  );
}

// ── Shared Sub-Components ──

function DetailRow({
  label,
  value,
  valueColor,
  hint,
}: {
  label: string;
  value: string;
  valueColor?: string;
  /** Optional tooltip hint shown below the row when tapped */
  hint?: string;
}) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span
          className="vela-body-sm"
          style={{ color: 'var(--gray-500)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {label}
          {hint && (
            <button
              onClick={e => {
                e.stopPropagation();
                setShowHint(prev => !prev);
              }}
              aria-label={`What is ${label.toLowerCase()}?`}
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
                width="12"
                height="12"
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
          )}
        </span>
        <span
          className="vela-body-sm"
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            color: valueColor || undefined,
            fontWeight: valueColor ? 600 : undefined,
          }}
        >
          {value}
        </span>
      </div>
      {showHint && (
        <p
          className="vela-body-sm"
          style={{
            margin: 0,
            marginTop: 'var(--space-1)',
            fontSize: '0.68rem',
            lineHeight: 1.4,
            color: 'var(--gray-500)',
            backgroundColor: 'var(--gray-100)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function AssetIcon({
  iconUrl,
  symbol,
  size = 28,
}: {
  iconUrl: string | null;
  symbol: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid var(--gray-900)',
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
          alt={symbol}
          width={size - 4}
          height={size - 4}
          style={{ objectFit: 'cover', borderRadius: '50%' }}
          onError={e => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span style={{ fontWeight: 700, fontSize: size * 0.4, color: 'var(--gray-900)' }}>
          {symbol.charAt(0)}
        </span>
      )}
    </div>
  );
}

function formatHoldingPeriod(openedAt: string, closedAt: string): string {
  return formatDurationMs(new Date(closedAt).getTime() - new Date(openedAt).getTime());
}

// ── Live Position Card (real trading) ──

function LivePositionCard({
  position,
  livePrice,
  expanded,
  onToggle,
}: {
  position: Position;
  livePrice?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = position.side === 'long';
  const { pnlPct, pnlDollar } = getEffectivePnl(position, livePrice);

  const formatDuration = (createdAt: string): string =>
    formatDurationMs(Date.now() - new Date(createdAt).getTime());

  return (
    <Card
      compact
      style={{
        borderLeft: `4px solid ${isLong ? 'var(--green-primary)' : 'var(--red-primary)'}`,
        cursor: 'pointer',
        backgroundColor: isLong ? 'var(--color-status-buy-bg)' : 'var(--color-status-sell-bg)',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Top row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              className="vela-label-sm"
              style={{
                backgroundColor: isLong ? 'var(--green-primary)' : 'var(--red-primary)',
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
              {isLong ? 'Long' : 'Short'}
            </span>
            <div>
              <span className="vela-heading-base">{position.asset_id.toUpperCase()}</span>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, lineHeight: 1.3 }}
              >
                {position.leverage > 1 ? `${position.leverage}x · ` : ''}Open{' '}
                {formatDuration(position.created_at)}
              </p>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <p
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontWeight: 700,
                fontSize: 'var(--text-base)',
                color: pnlPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {pnlPct >= 0 ? '+' : ''}
              {pnlPct.toFixed(2)}%
            </p>
            <p
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontWeight: 600,
                fontSize: 'var(--text-xs)',
                color: pnlDollar >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                margin: 0,
              }}
            >
              {pnlDollar >= 0 ? '+' : '-'}$
              {Math.abs(pnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
              {pnlDollar >= 0 ? 'profit' : 'loss'}
            </p>
          </div>
        </div>

        {/* Price row + expand hint */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'var(--space-2)',
          }}
        >
          <p
            className="vela-body-sm"
            style={{
              color: 'var(--gray-600)',
              fontFamily: 'var(--type-mono-base-font)',
              margin: 0,
            }}
          >
            Entry {formatPrice(position.entry_price)}
            {(livePrice ?? position.current_price) != null &&
              ` → Current ${formatPrice(livePrice ?? position.current_price)}`}
          </p>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform var(--motion-fast) var(--motion-ease-out)',
              flexShrink: 0,
            }}
          >
            <path
              d="M3 5L7 9L11 5"
              style={{ stroke: 'var(--gray-400)' }}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '2px solid var(--gray-200)',
          }}
        >
          <DetailRow
            label="Position size"
            value={`$${position.size_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
          {position.leverage > 1 && <DetailRow label="Leverage" value={`${position.leverage}x`} />}
          <DetailRow label="Entry price" value={formatPrice(position.entry_price)} />
          {(livePrice ?? position.current_price) != null && (
            <DetailRow
              label="Current price"
              value={formatPrice(livePrice ?? position.current_price)}
            />
          )}
          <DetailRow label="Duration" value={formatDuration(position.created_at)} />
          {position.stop_loss_price != null && (
            <DetailRow
              label="Stop-loss"
              value={formatPrice(position.stop_loss_price)}
              valueColor="var(--red-dark)"
              hint="Your safety net. If the price drops to this level, Vela automatically exits the position to limit your loss."
            />
          )}
          {position.take_profit_price != null && (
            <DetailRow
              label="Take-profit"
              value={formatPrice(position.take_profit_price)}
              valueColor="var(--green-dark)"
            />
          )}
          <DetailRow
            label="Unrealized P&L"
            value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% · ${pnlDollar >= 0 ? '+' : '-'}$${Math.abs(pnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${pnlPct >= 0 ? 'profit' : 'loss'}`}
            valueColor={pnlPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
          />

          {/* Trim history */}
          {position.trim_history && position.trim_history.length > 0 && (
            <div
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2)',
                backgroundColor: 'rgba(255, 215, 0, 0.08)',
                borderRadius: 'var(--radius-sm)',
                borderLeft: '3px solid #FFD700',
              }}
            >
              <span
                className="vela-label-sm"
                style={{ color: '#B8860B', display: 'block', marginBottom: 'var(--space-1)' }}
              >
                Trimmed {position.trim_history.length}x
                {position.original_size_usd && (
                  <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>
                    {' '}
                    (Original: $
                    {position.original_size_usd.toLocaleString('en-US', {
                      maximumFractionDigits: 0,
                    })}
                    )
                  </span>
                )}
              </span>
              {position.trim_history.map((trim, i) => (
                <span
                  key={i}
                  className="vela-body-sm"
                  style={{ color: 'var(--color-text-muted)', display: 'block' }}
                >
                  {trim.trim_pct}% at {trim.fill_price ? formatPrice(trim.fill_price) : '—'}
                  {' · '}$
                  {trim.size_before_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })} → $
                  {trim.size_after_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              ))}
            </div>
          )}

          {/* Share live position */}
          {position.current_price != null && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-2)',
                borderTop: '1px solid var(--gray-200)',
              }}
            >
              <ShareTradeCard
                trade={{
                  symbol: position.asset_id.toUpperCase(),
                  direction: position.side,
                  entryPrice: position.entry_price,
                  exitPrice: position.current_price,
                  pnlPct: pnlPct,
                  duration: formatDuration(position.created_at),
                  leverage: position.leverage > 1 ? position.leverage : undefined,
                }}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Card for a closed position from the positions table */
function ClosedPositionCard({
  position,
  expanded,
  onToggle,
}: {
  position: Position;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = position.side === 'long';
  const grossPnlPct = position.closed_pnl_pct ?? 0;
  const posSize = position.original_size_usd ?? position.size_usd;
  const grossPnlDollar =
    position.total_pnl != null && position.total_pnl !== 0
      ? position.total_pnl
      : posSize > 0
        ? pctToDollar(grossPnlPct, posSize)
        : 0;
  const fees = computePositionFees(position);
  const hasFees = fees.totalFees > 0.005; // threshold to avoid displaying $0.00
  // Use net PnL as primary display when fees exist
  const pnlPct = hasFees ? fees.netPnlPct : grossPnlPct;
  const pnlDollar = hasFees ? fees.netPnlDollar : grossPnlDollar;
  // Treat near-zero PnL as breakeven (< 0.05% either way) to avoid "-0.0% loss" display
  const isBreakeven = Math.abs(pnlPct) < 0.05 && Math.abs(pnlDollar) < 0.01;
  const isPositive = isBreakeven || pnlPct >= 0;

  const holdingPeriod =
    position.created_at && position.closed_at
      ? formatDurationMs(
          new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()
        )
      : null;

  const closedDate = position.closed_at
    ? new Date(position.closed_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : null;

  return (
    <Card
      compact
      style={{
        borderLeft: `4px solid ${isBreakeven ? 'var(--gray-300)' : isPositive ? 'var(--green-primary)' : 'var(--red-primary)'}`,
        cursor: 'pointer',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Top row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              className="vela-label-sm"
              style={{
                backgroundColor: 'var(--gray-200)',
                color: 'var(--gray-600)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                border: '1.5px solid var(--gray-300)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontSize: 10,
              }}
            >
              {isLong ? 'Long' : 'Short'}
            </span>
            <div>
              <span className="vela-heading-base">{position.asset_id.toUpperCase()}</span>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, lineHeight: 1.3 }}
              >
                Closed{closedDate ? ` ${closedDate}` : ''}
                {holdingPeriod ? ` · Held ${holdingPeriod}` : ''}
              </p>
            </div>
          </div>

          <div
            style={{
              textAlign: 'right',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-base)',
                  color: isBreakeven ? 'var(--gray-500)' : isPositive ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {isBreakeven ? '' : isPositive ? '+' : ''}
                {isBreakeven ? '0.0' : pnlPct.toFixed(1)}%
              </p>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 600,
                  fontSize: 'var(--text-xs)',
                  color: isBreakeven ? 'var(--gray-500)' : isPositive ? 'var(--green-dark)' : 'var(--red-dark)',
                  margin: 0,
                }}
              >
                {isBreakeven
                  ? 'breakeven'
                  : `${isPositive ? '+' : '-'}$${Math.abs(pnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${isPositive ? 'profit' : 'loss'}`}
              </p>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform var(--motion-fast) var(--motion-ease-out)',
                flexShrink: 0,
              }}
            >
              <path
                d="M3 5L7 9L11 5"
                style={{ stroke: 'var(--gray-400)' }}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Price row */}
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--gray-600)',
            fontFamily: 'var(--type-mono-base-font)',
            marginTop: 'var(--space-2)',
            marginBottom: 0,
          }}
        >
          Entry {formatPrice(position.entry_price)}
          {position.current_price != null && ` → Exit ${formatPrice(position.current_price)}`}
        </p>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '2px solid var(--gray-200)',
          }}
        >
          <DetailRow
            label="Position size"
            value={`$${(position.original_size_usd ?? position.size_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
          {position.leverage > 1 && <DetailRow label="Leverage" value={`${position.leverage}x`} />}
          <DetailRow label="Entry price" value={formatPrice(position.entry_price)} />
          {position.current_price != null && (
            <DetailRow label="Exit price" value={formatPrice(position.current_price)} />
          )}
          {holdingPeriod && <DetailRow label="Duration" value={holdingPeriod} />}
          <div style={{ height: 'var(--space-2)' }} />
          {hasFees ? (
            <>
              <DetailRow
                label="Gross P&L"
                value={`${grossPnlPct >= 0 ? '+' : ''}${grossPnlPct.toFixed(1)}% · ${grossPnlPct >= 0 ? '+' : '-'}$${Math.abs(grossPnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
              />
              <DetailRow
                label="Fee"
                value={`-$${fees.totalFees.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                valueColor="var(--gray-500)"
              />
              <DetailRow
                label="Net P&L"
                value={`${isPositive ? '+' : ''}${pnlPct.toFixed(1)}% · ${isPositive ? '+' : '-'}$${Math.abs(pnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${isPositive ? 'profit' : 'loss'}`}
                valueColor={isPositive ? 'var(--green-dark)' : 'var(--red-dark)'}
              />
            </>
          ) : (
            <DetailRow
              label="Realized P&L"
              value={`${isPositive ? '+' : ''}${pnlPct.toFixed(1)}% · ${isPositive ? '+' : '-'}$${Math.abs(pnlDollar).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${isPositive ? 'profit' : 'loss'}`}
              valueColor={isPositive ? 'var(--green-dark)' : 'var(--red-dark)'}
            />
          )}
        </div>
      )}
    </Card>
  );
}
