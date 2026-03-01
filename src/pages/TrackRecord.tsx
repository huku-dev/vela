import { useState } from 'react';
import { Card, Badge, PageHeader } from '../components/VelaComponents';
import VelaLogo from '../components/VelaLogo';
import { useTrackRecord, DEFAULT_POSITION_SIZE, type EnrichedTrade } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { useTierAccess } from '../hooks/useTierAccess';
import TierComparisonSheet from '../components/TierComparisonSheet';
import { getCoinIcon, formatPrice, reasonCodeToPlainEnglish } from '../lib/helpers';
import {
  calculateUnrealizedPnL,
  pctToDollar,
  aggregateTradeStats,
  computeDetailedStats,
  formatDurationMs,
} from '../utils/calculations';
import type { TradeDirection, Position } from '../types';

/** Map raw direction to user-facing label */
function directionLabel(d: TradeDirection | null | undefined): string {
  if (!d) return 'Long';
  if (d === 'short' || d === 'bb_short') return 'Short';
  if (d === 'trim') return 'Trim';
  return 'Long';
}

/** Is this a short-side trade? */
function isShortTrade(d: TradeDirection | null | undefined): boolean {
  return d === 'short' || d === 'bb_short';
}

export default function TrackRecord() {
  const { trades, livePrices, assetMap, loading, loadingMore, hasMore, loadMore } =
    useTrackRecord();
  const { isAuthenticated } = useAuthContext();
  const { positions } = useTrading();
  const { canTrade, tier, upgradeLabel, startCheckout } = useTierAccess();
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [showVelaHistory, setShowVelaHistory] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showTierSheet, setShowTierSheet] = useState(false);

  const hasLivePositions = isAuthenticated && positions.length > 0;

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
  const userStats = aggregateTradeStats(userClosed, DEFAULT_POSITION_SIZE);
  const userDetailedStats = computeDetailedStats(userClosed, DEFAULT_POSITION_SIZE);

  const paperClosed = paperTrades.filter(
    (t): t is typeof t & { pnl_pct: number } => t.status === 'closed' && t.pnl_pct != null
  );
  const paperStats = aggregateTradeStats(paperClosed, DEFAULT_POSITION_SIZE);
  const paperDetailedStats = computeDetailedStats(paperClosed, DEFAULT_POSITION_SIZE);

  const hasUserTrades = userTrades.length > 0 || hasLivePositions;

  // Best paper trade for the "Vela's signal history" hero card
  const bestPaperTrade = paperTrades.reduce<EnrichedTrade | null>((best, t) => {
    if (t.status !== 'closed' || t.pnl_pct == null) return best;
    if (!best || (best.pnl_pct ?? 0) < t.pnl_pct) return t;
    return best;
  }, null);

  // ── Helper: get live price for an asset ──
  const getLivePrice = (coingeckoId: string | undefined): number | null => {
    if (!coingeckoId) return null;
    return livePrices[coingeckoId]?.price ?? null;
  };

  // ── Helper: format duration ──
  const formatDuration = (openedAt: string): string =>
    formatDurationMs(Date.now() - new Date(openedAt).getTime());

  // Earliest paper trade date for the "since" label
  const earliestPaperDate =
    paperTrades.length > 0
      ? new Date(
          paperTrades.reduce(
            (earliest, t) => (t.opened_at < earliest ? t.opened_at : earliest),
            paperTrades[0].opened_at
          )
        ).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : null;

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 80,
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      <PageHeader title="Track Record" subtitle="Your trades and Vela's signal performance" />

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
          {/* User trade stats */}
          {userStats.totalClosed > 0 && (
            <Card style={{ marginBottom: 'var(--space-3)' }}>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-xl)',
                  color: userStats.totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {userStats.totalDollarPnl >= 0 ? '+' : '-'}$
                {Math.abs(userStats.totalDollarPnl).toLocaleString('en-US', {
                  maximumFractionDigits: 0,
                })}{' '}
                total {userStats.totalDollarPnl >= 0 ? 'profit' : 'loss'}
              </p>
              <p
                className="vela-body-sm"
                style={{ color: 'var(--gray-600)', margin: 0, marginTop: 'var(--space-1)' }}
              >
                {userStats.totalClosed} trade{userStats.totalClosed !== 1 ? 's' : ''} ·{' '}
                {userDetailedStats.wins} profitable
                {userStats.totalClosed > 0 &&
                  ` (${Math.round((userDetailedStats.wins / userStats.totalClosed) * 100)}%)`}
                {(userOpen.length > 0 || hasLivePositions) &&
                  ` · ${userOpen.length + positions.length} open`}
              </p>
            </Card>
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
                {positions.map(pos => (
                  <LivePositionCard
                    key={pos.id}
                    position={pos}
                    expanded={expandedTradeId === pos.id}
                    onToggle={() => setExpandedTradeId(expandedTradeId === pos.id ? null : pos.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* User's closed trades */}
          {userClosed.length > 0 && (
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
                  />
                ))}
              </div>
            </div>
          )}

          {/* User's open paper trades (rare but possible — open backtests) */}
          {userOpen.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
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
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ZONE 2: VELA'S SIGNAL HISTORY (secondary, collapsible)
          ══════════════════════════════════════════════════════ */}
      {paperTrades.length > 0 && (
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
                Vela&rsquo;s signal history
              </span>
              {earliestPaperDate && (
                <span
                  className="vela-body-sm"
                  style={{ color: 'var(--gray-400)', fontSize: '0.7rem' }}
                >
                  Simulated trades since {earliestPaperDate}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {/* Quick stats pill */}
              {paperStats.totalClosed > 0 && (
                <span
                  className="vela-mono"
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: paperStats.totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  }}
                >
                  {paperStats.totalDollarPnl >= 0 ? '+' : '-'}$
                  {Math.abs(paperStats.totalDollarPnl).toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}
                  {' · '}
                  {paperStats.totalClosed} trades
                </span>
              )}
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
                Theoretical model performance — not real money
              </p>

              {/* Paper trade aggregate stats */}
              {paperStats.totalClosed > 0 && (
                <Card style={{ marginBottom: 'var(--space-3)' }}>
                  <p
                    style={{
                      fontFamily: 'var(--type-mono-base-font)',
                      fontWeight: 700,
                      fontSize: 'var(--text-lg)',
                      color:
                        paperStats.totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                      margin: 0,
                      lineHeight: 1.2,
                    }}
                  >
                    {paperStats.totalDollarPnl >= 0 ? '+' : '-'}$
                    {Math.abs(paperStats.totalDollarPnl).toLocaleString('en-US', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    total {paperStats.totalDollarPnl >= 0 ? 'profit' : 'loss'}
                  </p>
                  <p
                    className="vela-body-sm"
                    style={{
                      color: 'var(--gray-600)',
                      margin: 0,
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    {paperStats.totalClosed} trade{paperStats.totalClosed !== 1 ? 's' : ''} ·{' '}
                    {paperDetailedStats.wins} profitable
                    {paperStats.totalClosed > 0 &&
                      ` (${Math.round((paperDetailedStats.wins / paperStats.totalClosed) * 100)}%)`}
                  </p>
                  <p
                    className="vela-body-sm"
                    style={{
                      color: 'var(--gray-400)',
                      margin: 0,
                      marginTop: 'var(--space-2)',
                      fontSize: '0.7rem',
                    }}
                  >
                    Based on ${DEFAULT_POSITION_SIZE.toLocaleString()} per trade. Total is
                    cumulative across all closed trades.
                  </p>
                </Card>
              )}

              {/* Best call (paper) */}
              {bestPaperTrade && paperStats.totalClosed >= 3 && (
                <BestCallCard
                  trade={bestPaperTrade}
                  coingeckoId={assetMap[bestPaperTrade.asset_id]?.coingecko_id}
                />
              )}

              {/* Paper trade list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {paperTrades.map(trade =>
                  trade.status === 'open' ? (
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
                    />
                  ) : (
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
                    />
                  )
                )}

                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="vela-btn vela-btn-ghost"
                    style={{ width: '100%', marginTop: 'var(--space-2)', padding: '12px 0' }}
                  >
                    {loadingMore ? 'Loading...' : 'View more trades'}
                  </button>
                )}
              </div>

              {/* ── Performance Breakdown (collapsible) ── */}
              {paperStats.totalClosed > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <button
                    onClick={() => setShowBreakdown(!showBreakdown)}
                    className="vela-btn vela-btn-ghost"
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 'var(--space-2) var(--space-3)',
                      marginBottom: showBreakdown ? 'var(--space-2)' : 0,
                    }}
                  >
                    <span className="vela-label" style={{ color: 'var(--gray-600)' }}>
                      Performance breakdown
                    </span>
                    <span
                      style={{
                        transform: showBreakdown ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--gray-400)',
                      }}
                    >
                      &#9660;
                    </span>
                  </button>

                  {showBreakdown && (
                    <Card compact>
                      {/* Returns */}
                      <SectionLabel>Returns</SectionLabel>
                      <DetailRow
                        label="Avg return per trade"
                        value={`${paperStats.avgPnlPct >= 0 ? '+' : ''}${paperStats.avgPnlPct.toFixed(1)}%`}
                        valueColor={
                          paperStats.avgPnlPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'
                        }
                      />
                      <DetailRow
                        label="Avg trade size"
                        value={`$${DEFAULT_POSITION_SIZE.toLocaleString()}`}
                      />
                      <DetailRow
                        label="Biggest profit"
                        value={
                          paperDetailedStats.bestTradeDollar >= 0
                            ? `+$${paperDetailedStats.bestTradeDollar.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${paperDetailedStats.bestTradeAsset}${paperDetailedStats.bestTradeDate ? ` · ${paperDetailedStats.bestTradeDate}` : ''})`
                            : '—'
                        }
                        valueColor="var(--green-dark)"
                      />
                      <DetailRow
                        label="Biggest loss"
                        value={
                          paperDetailedStats.worstTradeDollar < 0
                            ? `-$${Math.abs(paperDetailedStats.worstTradeDollar).toLocaleString('en-US', { maximumFractionDigits: 0 })} (${paperDetailedStats.worstTradeAsset}${paperDetailedStats.worstTradeDate ? ` · ${paperDetailedStats.worstTradeDate}` : ''})`
                            : '—'
                        }
                        valueColor={
                          paperDetailedStats.worstTradeDollar < 0 ? 'var(--red-dark)' : undefined
                        }
                      />

                      {/* By Direction */}
                      {(paperDetailedStats.longCount > 0 || paperDetailedStats.shortCount > 0) && (
                        <>
                          <SectionLabel style={{ marginTop: 'var(--space-3)' }}>
                            By direction
                          </SectionLabel>
                          {paperDetailedStats.longCount > 0 && (
                            <DetailRow
                              label="Long trades"
                              value={`${paperDetailedStats.longWins} / ${paperDetailedStats.longCount} profitable (${Math.round((paperDetailedStats.longWins / paperDetailedStats.longCount) * 100)}%)`}
                            />
                          )}
                          {paperDetailedStats.shortCount > 0 && (
                            <DetailRow
                              label="Short trades"
                              value={`${paperDetailedStats.shortWins} / ${paperDetailedStats.shortCount} profitable (${Math.round((paperDetailedStats.shortWins / paperDetailedStats.shortCount) * 100)}%)`}
                            />
                          )}
                        </>
                      )}

                      {/* Timing */}
                      {paperDetailedStats.avgDurationMs > 0 && (
                        <>
                          <SectionLabel style={{ marginTop: 'var(--space-3)' }}>
                            Timing
                          </SectionLabel>
                          <DetailRow
                            label="Avg holding period"
                            value={formatDurationMs(paperDetailedStats.avgDurationMs)}
                          />
                          <DetailRow
                            label="Longest trade"
                            value={formatDurationMs(paperDetailedStats.longestDurationMs)}
                          />
                          <DetailRow
                            label="Shortest trade"
                            value={formatDurationMs(paperDetailedStats.shortestDurationMs)}
                          />
                        </>
                      )}
                    </Card>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
}: {
  trade: EnrichedTrade;
  currentPrice: number | null;
  coingeckoId: string | undefined;
  formatDuration: (openedAt: string) => string;
  entryHeadline?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const short = isShortTrade(trade.direction);
  const unrealizedPct =
    currentPrice != null
      ? calculateUnrealizedPnL(trade.entry_price, currentPrice, short ? 'short' : 'long')
      : null;
  const unrealizedDollar =
    unrealizedPct != null ? pctToDollar(unrealizedPct, DEFAULT_POSITION_SIZE) : null;

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
          {new Date(trade.opened_at).toLocaleDateString('en-GB', {
            month: 'short',
            day: 'numeric',
            year: '2-digit',
          })}
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
          <DetailRow label="Position size" value={`$${DEFAULT_POSITION_SIZE.toLocaleString()}`} />
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
        </div>
      )}
    </Card>
  );
}

// ── Closed Trade Card ──

function ClosedTradeCard({
  trade,
  coingeckoId,
  entryHeadline,
  exitHeadline,
  expanded,
  onToggle,
}: {
  trade: EnrichedTrade;
  coingeckoId: string | undefined;
  entryHeadline?: string;
  exitHeadline?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dollarPnl =
    trade.pnl_pct != null ? pctToDollar(trade.pnl_pct, DEFAULT_POSITION_SIZE) : null;
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
              </p>
            </div>
          </div>

          {trade.pnl_pct != null && (
            <div style={{ textAlign: 'right' }}>
              <p
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontWeight: 700,
                  fontSize: 'var(--text-base)',
                  color: trade.pnl_pct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {trade.pnl_pct >= 0 ? '+' : ''}
                {trade.pnl_pct.toFixed(1)}%
              </p>
              {dollarPnl != null && (
                <p
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)',
                    color: dollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                    margin: 0,
                  }}
                >
                  {dollarPnl >= 0 ? '+' : '-'}$
                  {Math.abs(dollarPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}{' '}
                  {dollarPnl >= 0 ? 'profit' : 'loss'}
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
          {new Date(trade.opened_at).toLocaleDateString('en-GB', {
            month: 'short',
            day: 'numeric',
            year: '2-digit',
          })}
          {trade.closed_at &&
            ` — ${new Date(trade.closed_at).toLocaleDateString('en-GB', {
              month: 'short',
              day: 'numeric',
              year: '2-digit',
            })}`}
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
          <DetailRow label="Position size" value={`$${DEFAULT_POSITION_SIZE.toLocaleString()}`} />
          {trade.trim_pct != null && (
            <DetailRow
              label="Trimmed"
              value={`${trade.trim_pct}% of position · $${Math.round((DEFAULT_POSITION_SIZE * trade.trim_pct) / 100).toLocaleString()}`}
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
          {trade.pnl_pct != null && dollarPnl != null && (
            <DetailRow
              label="Realized P&L"
              value={`${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(1)}% · ${dollarPnl >= 0 ? '+' : '-'}$${Math.abs(dollarPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${trade.pnl_pct >= 0 ? 'profit' : 'loss'}`}
              valueColor={trade.pnl_pct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
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
        </div>
      )}
    </Card>
  );
}

// ── Best Call Hero Card ──

function BestCallCard({
  trade,
  coingeckoId,
}: {
  trade: EnrichedTrade;
  coingeckoId: string | undefined;
}) {
  const dollarPnl =
    trade.pnl_pct != null ? pctToDollar(trade.pnl_pct, DEFAULT_POSITION_SIZE) : null;
  const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();
  const short = isShortTrade(trade.direction);
  const isPositive = (trade.pnl_pct ?? 0) >= 0;

  const entryText =
    trade.entry_headline ?? reasonCodeToPlainEnglish(trade.entry_reason_code) ?? null;
  const exitText = trade.exit_headline ?? reasonCodeToPlainEnglish(trade.exit_reason_code) ?? null;

  const holdingPeriod =
    trade.opened_at && trade.closed_at
      ? formatDurationMs(new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime())
      : null;

  return (
    <Card variant={isPositive ? 'mint' : 'peach'} style={{ marginBottom: 'var(--space-3)' }}>
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
        Best call
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

        {trade.pnl_pct != null && (
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
              {trade.pnl_pct.toFixed(1)}%
            </p>
            {dollarPnl != null && (
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
            )}
          </div>
        )}
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
        {new Date(trade.opened_at).toLocaleDateString('en-GB', {
          month: 'short',
          day: 'numeric',
        })}
        {trade.closed_at &&
          ` — ${new Date(trade.closed_at).toLocaleDateString('en-GB', {
            month: 'short',
            day: 'numeric',
            year: '2-digit',
          })}`}
        {holdingPeriod && ` · ${holdingPeriod}`}
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
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-2)',
      }}
    >
      <span className="vela-body-sm" style={{ color: 'var(--gray-500)' }}>
        {label}
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

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <p
      className="vela-label-sm"
      style={{
        color: 'var(--gray-400)',
        marginBottom: 'var(--space-2)',
        ...style,
      }}
    >
      {children}
    </p>
  );
}

function formatHoldingPeriod(openedAt: string, closedAt: string): string {
  return formatDurationMs(new Date(closedAt).getTime() - new Date(openedAt).getTime());
}

// ── Live Position Card (real trading) ──

function LivePositionCard({
  position,
  expanded,
  onToggle,
}: {
  position: Position;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = position.side === 'long';
  const pnlPct = position.unrealized_pnl_pct;
  const pnlDollar = position.unrealized_pnl;

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
                {position.leverage}x · Open {formatDuration(position.created_at)}
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
          {position.current_price != null && ` → Current ${formatPrice(position.current_price)}`}
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
            value={`$${position.size_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          />
          <DetailRow label="Leverage" value={`${position.leverage}x`} />
          <DetailRow label="Entry price" value={formatPrice(position.entry_price)} />
          {position.current_price != null && (
            <DetailRow label="Current price" value={formatPrice(position.current_price)} />
          )}
          <DetailRow label="Duration" value={formatDuration(position.created_at)} />
          {position.stop_loss_price != null && (
            <DetailRow
              label="Stop-loss"
              value={formatPrice(position.stop_loss_price)}
              valueColor="var(--red-dark)"
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

          {/* Position info */}
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
              Live position on Hyperliquid testnet · Updated by fast loop
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
