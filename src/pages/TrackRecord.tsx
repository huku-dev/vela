import { useState } from 'react';
import { Card, PageHeader } from '../components/VelaComponents';
import VelaLogo from '../components/VelaLogo';
import ShareTradeCard from '../components/ShareTradeCard';
import { useTrackRecord, DEFAULT_POSITION_SIZE, type EnrichedTrade } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import TierComparisonSheet from '../components/TierComparisonSheet';
import TradeProposalCard from '../components/TradeProposalCard';
import { getCoinIcon, formatPrice } from '../lib/helpers';
import {
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

/** Track record only includes trades from Jan 2026 onwards */
const TRACK_RECORD_START = '2026-01-01T00:00:00Z';

/** Is this a BB2 (short-term mean-reversion) trade? */
function isBB2Direction(d: TradeDirection | null | undefined): boolean {
  return d === 'bb2_long' || d === 'bb2_short';
}

/** Is this a BB2 position (from positions table)? */
function isBB2Position(pos: Position): boolean {
  return pos.position_type === 'bb2' || pos.position_type === 'bb2_30m';
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
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null); // null = all assets

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

  // ── All signal-generated trades for track record (Jan 2026+) ──
  // Includes both backtest and live-source paper trades
  const paperTrades = trades.filter(t => t.opened_at >= TRACK_RECORD_START);

  // ── Helper: get live price for an asset ──
  const getLivePrice = (coingeckoId: string | null | undefined): number | null => {
    if (!coingeckoId) return null;
    return livePrices[coingeckoId]?.price ?? null;
  };

  // ── Unique traded assets for filter dropdown ──
  const tradedAssets = (() => {
    const ids = new Set<string>();
    for (const pos of positions) ids.add(pos.asset_id);
    for (const pos of closedPositions) ids.add(pos.asset_id);
    return Array.from(ids).map(id => ({
      id,
      symbol: assetMap[id]?.symbol ?? id.toUpperCase(),
      coingeckoId: assetMap[id]?.coingecko_id,
    }));
  })();

  // ── Filtered positions based on selected asset ──
  const filteredOpenPositions = selectedAsset
    ? positions.filter(p => p.asset_id === selectedAsset)
    : positions;
  const filteredClosedPositions = selectedAsset
    ? closedPositions.filter(p => p.asset_id === selectedAsset)
    : closedPositions;

  // ── Filtered stats (recomputed for selected asset) ──
  const filteredStats = (() => {
    const allPos = [...filteredClosedPositions, ...filteredOpenPositions];
    if (allPos.length === 0) return null;

    let totalPnl = 0;
    let wins = 0;

    for (const pos of filteredClosedPositions) {
      const posFees = computePositionFees(pos);
      const hasPosFees = posFees.totalFees > 0.005;
      const pnl = hasPosFees
        ? posFees.netPnlDollar
        : pos.total_pnl != null && pos.total_pnl !== 0
          ? pos.total_pnl
          : pctToDollar(pos.closed_pnl_pct ?? 0, pos.original_size_usd ?? pos.size_usd);
      const pct = hasPosFees ? posFees.netPnlPct : (pos.closed_pnl_pct ?? 0);
      totalPnl += pnl;
      if (pct >= 0) wins++;
    }

    for (const pos of filteredOpenPositions) {
      const posAsset = assetMap[pos.asset_id];
      const livePrice = getLivePrice(posAsset?.coingecko_id);
      const { pnlDollar } = getEffectivePnl(pos, livePrice ?? undefined);
      totalPnl += pnlDollar;
      if (pnlDollar >= 0) wins++;
    }

    const total = allPos.length;
    return {
      total,
      wins,
      totalPnl,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
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

  // Average holding period for paper trades (for track record display)
  const avgHoldingPeriod = (() => {
    const durations = groupedPaperClosed
      .filter(g => g.trade.closed_at)
      .map(g => new Date(g.trade.closed_at!).getTime() - new Date(g.trade.opened_at).getTime());
    if (durations.length === 0) return null;
    const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    return formatDurationMs(avgMs);
  })();

  const hasUserTrades =
    hasLivePositions || pendingProposals.length > 0 || closedPositions.length > 0;

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
          paddingLeft: 'var(--space-1)',
        }}
      >
        <span className="vela-label-sm vela-text-muted" style={{ textTransform: 'uppercase' }}>
          {selectedAsset
            ? `Your ${assetMap[selectedAsset]?.symbol ?? selectedAsset.toUpperCase()} trades`
            : 'Your trades'}
        </span>
        {tradedAssets.length > 1 && (
          <select
            value={selectedAsset ?? ''}
            onChange={e => setSelectedAsset(e.target.value || null)}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              padding: '5px 28px 5px 10px',
              border: '1.5px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              background: `var(--color-bg-surface) url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center`,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            <option value="">All assets</option>
            {tradedAssets.map(a => (
              <option key={a.id} value={a.id}>
                {a.symbol}
              </option>
            ))}
          </select>
        )}
      </div>

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
          {/* Position stats — 3-cell row, updates when asset filter changes */}
          {filteredStats && (
            <Card
              compact
              style={{ marginBottom: 'var(--space-3)', padding: 0, overflow: 'hidden' }}
            >
              <div style={{ display: 'flex' }}>
                {[
                  {
                    label: 'Total P&L',
                    value: `${filteredStats.totalPnl >= 0 ? '+' : '-'}$${Math.abs(filteredStats.totalPnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
                    color: filteredStats.totalPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    mono: true,
                  },
                  {
                    label: 'Trades',
                    value: String(filteredStats.total),
                    color: 'var(--color-text-primary)',
                    mono: false,
                  },
                  {
                    label: 'Win rate',
                    value: `${filteredStats.winRate}%`,
                    color: 'var(--color-text-primary)',
                    mono: false,
                  },
                ].map((stat, i) => (
                  <div
                    key={stat.label}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: 'var(--space-4) var(--space-2)',
                      borderLeft: i > 0 ? '1px solid var(--gray-200)' : undefined,
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: 4,
                      }}
                    >
                      {stat.label}
                    </span>
                    <span
                      className={stat.mono ? 'vela-mono' : undefined}
                      style={{
                        fontWeight: 700,
                        fontSize: '1.1rem',
                        color: stat.color,
                        lineHeight: 1.2,
                      }}
                    >
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
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
                      iconUrl={asset?.icon_url ?? (coingeckoId ? getCoinIcon(coingeckoId) : undefined)}
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

          {/* Live positions (filtered) */}
          {filteredOpenPositions.length > 0 && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                {selectedAsset
                  ? `${assetMap[selectedAsset]?.symbol ?? selectedAsset.toUpperCase()} open positions`
                  : 'Open positions'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {filteredOpenPositions.map(pos => {
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
                      coingeckoId={posCoingeckoId ?? undefined}
                      assetIconUrl={posAsset?.icon_url}
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

          {/* Closed positions (filtered) */}
          {filteredClosedPositions.length > 0 && (
            <div>
              <p
                className="vela-label-sm"
                style={{
                  color: 'var(--gray-400)',
                  marginBottom: 'var(--space-2)',
                  paddingLeft: 'var(--space-1)',
                }}
              >
                {selectedAsset
                  ? `${assetMap[selectedAsset]?.symbol ?? selectedAsset.toUpperCase()} closed positions`
                  : 'Closed positions'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {filteredClosedPositions.map(pos => {
                  const closedAsset = assetMap[pos.asset_id];
                  return (
                    <ClosedPositionCard
                      key={pos.id}
                      position={pos}
                      coingeckoId={closedAsset?.coingecko_id ?? undefined}
                      assetIconUrl={closedAsset?.icon_url}
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
              {paperStats.winRate}% win rate
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
                    {paperStats.winRate}%
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
                    {paperStats.totalClosed}
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
                      color: paperStats.avgPnlPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                      margin: 0,
                    }}
                  >
                    {paperStats.avgPnlPct >= 0 ? '+' : ''}
                    {paperStats.avgPnlPct}%
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
                    {avgHoldingPeriod ?? '—'}
                  </p>
                </div>
              </div>
            </Card>

            {/* Best trade (paper) */}
            {bestPaperGroup && bestPaperPnl && paperStats.totalClosed >= 3 && (
              <BestTradeCard
                group={bestPaperGroup}
                positionPnl={bestPaperPnl}
                coingeckoId={assetMap[bestPaperGroup.trade.asset_id]?.coingecko_id ?? undefined}
                assetIconUrl={assetMap[bestPaperGroup.trade.asset_id]?.icon_url}
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

// ── Best Trade Hero Card ──

function BestTradeCard({
  group,
  positionPnl,
  coingeckoId,
  assetIconUrl,
  onTap,
}: {
  group: GroupedTrade;
  positionPnl: ReturnType<typeof computePositionPnl>;
  coingeckoId: string | undefined;
  assetIconUrl?: string | null;
  onTap?: () => void;
}) {
  const trade = group.trade;
  const dollarPnl = positionPnl.totalDollarPnl;
  const pnlPct = positionPnl.totalPnlPct;
  const iconUrl = assetIconUrl ?? (coingeckoId ? getCoinIcon(coingeckoId) : null);
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();
  const isPositive = dollarPnl >= 0;

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

// ── Live Position Card (real trading) ──

function LivePositionCard({
  position,
  livePrice,
  coingeckoId,
  assetIconUrl,
  expanded,
  onToggle,
}: {
  position: Position;
  livePrice?: number;
  coingeckoId?: string;
  assetIconUrl?: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = position.side === 'long';
  const { pnlPct, pnlDollar } = getEffectivePnl(position, livePrice);
  const iconUrl = assetIconUrl ?? (coingeckoId ? getCoinIcon(coingeckoId) : null);
  const symbol = position.asset_id.toUpperCase();
  const isBB2 = isBB2Position(position);
  const leverageLabel = position.leverage > 1 ? `${position.leverage}x ` : '';
  const directionLabel = isLong ? 'Long' : 'Short';

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
            <AssetIcon iconUrl={iconUrl} symbol={symbol} size={36} />
            <div>
              {/* Line 1: Asset name · badge */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="vela-heading-base">{symbol}</span>
                <span style={{ color: 'var(--gray-400)' }}>·</span>
                <span
                  className="vela-label-sm"
                  style={{
                    backgroundColor: isLong ? 'var(--green-primary)' : 'var(--red-primary)',
                    color: 'var(--white)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--black)',
                    fontWeight: 700,
                    fontSize: 10,
                    position: 'relative',
                    top: '-1px',
                  }}
                >
                  {leverageLabel}
                  {directionLabel}
                </span>
              </div>
              {/* Line 2: ⚡ Fast trade · Open duration */}
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, marginTop: 2, lineHeight: 1.3 }}
              >
                {isBB2 && (
                  <>
                    <span style={{ color: '#F59E0B', fontSize: '0.75rem' }}>⚡</span> Fast trade
                    ·{' '}
                  </>
                )}
                Open {formatDuration(position.created_at)}
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
  coingeckoId,
  assetIconUrl,
  expanded,
  onToggle,
}: {
  position: Position;
  coingeckoId?: string;
  assetIconUrl?: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = position.side === 'long';
  const iconUrl = assetIconUrl ?? (coingeckoId ? getCoinIcon(coingeckoId) : null);
  const symbol = position.asset_id.toUpperCase();
  const isBB2 = isBB2Position(position);
  const leverageLabel = position.leverage > 1 ? `${position.leverage}x ` : '';
  const directionLabel = isLong ? 'Long' : 'Short';
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
            <AssetIcon iconUrl={iconUrl} symbol={symbol} size={36} />
            <div>
              {/* Line 1: Asset name · badge */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="vela-heading-base">{symbol}</span>
                <span style={{ color: 'var(--gray-400)' }}>·</span>
                <span
                  className="vela-label-sm"
                  style={{
                    backgroundColor: 'var(--gray-200)',
                    color: 'var(--gray-600)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--gray-300)',
                    fontWeight: 700,
                    fontSize: 10,
                    position: 'relative',
                    top: '-1px',
                  }}
                >
                  {leverageLabel}
                  {directionLabel}
                </span>
              </div>
              {/* Line 2: ⚡ Fast trade · Closed date · Held duration */}
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-500)', margin: 0, marginTop: 2, lineHeight: 1.3 }}
              >
                {isBB2 && (
                  <>
                    <span style={{ color: '#F59E0B', fontSize: '0.75rem' }}>⚡</span> Fast trade
                    ·{' '}
                  </>
                )}
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
                  color: isBreakeven
                    ? 'var(--gray-500)'
                    : isPositive
                      ? 'var(--green-dark)'
                      : 'var(--red-dark)',
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
                  color: isBreakeven
                    ? 'var(--gray-500)'
                    : isPositive
                      ? 'var(--green-dark)'
                      : 'var(--red-dark)',
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
