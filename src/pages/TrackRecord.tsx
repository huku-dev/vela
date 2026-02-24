import { useState } from 'react';
import { Card, Badge, LoadingSpinner, PageHeader } from '../components/VelaComponents';
import EmptyState from '../components/EmptyState';
import { useTrackRecord, DEFAULT_POSITION_SIZE, type EnrichedTrade } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import { getCoinIcon, formatPrice, reasonCodeToPlainEnglish } from '../lib/helpers';
import {
  calculateUnrealizedPnL,
  pctToDollar,
  aggregateTradeStats,
  computeDetailedStats,
  formatDurationMs,
} from '../utils/calculations';
import type { TradeDirection, Position } from '../types';

type AssetFilter = 'all' | string; // 'all' or asset_id

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
  const { trades, bestTrade, livePrices, assetMap, loading, loadingMore, hasMore, loadMore } =
    useTrackRecord();
  const { isAuthenticated } = useAuthContext();
  const { positions } = useTrading();
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const hasLivePositions = isAuthenticated && positions.length > 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <LoadingSpinner size={28} />
      </div>
    );
  }

  // ── Filter trades ──
  const assetFiltered =
    assetFilter === 'all' ? trades : trades.filter(t => t.asset_id === assetFilter);
  const filteredTrades =
    statusFilter === 'all' ? assetFiltered : assetFiltered.filter(t => t.status === statusFilter);

  const filteredClosed = assetFiltered.filter(
    (t): t is typeof t & { pnl_pct: number } => t.status === 'closed' && t.pnl_pct != null
  );
  const filteredOpen = assetFiltered.filter(t => t.status === 'open');

  const { totalClosed, totalDollarPnl, avgPnlPct } = aggregateTradeStats(
    filteredClosed,
    DEFAULT_POSITION_SIZE
  );

  const detailedStats = computeDetailedStats(filteredClosed, DEFAULT_POSITION_SIZE);

  // ── Build unique asset list for filter ──
  const uniqueAssets = [...new Set(trades.map(t => t.asset_id))]
    .map(id => ({
      id,
      symbol: assetMap[id]?.symbol || id.toUpperCase(),
      coingeckoId: assetMap[id]?.coingecko_id || '',
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // ── Helper: get live price for an asset ──
  const getLivePrice = (coingeckoId: string | undefined): number | null => {
    if (!coingeckoId) return null;
    return livePrices[coingeckoId]?.price ?? null;
  };

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
      <PageHeader title="Vela's Track Record" subtitle="Here's how signals have performed" />

      {/* ── Live Positions (authenticated users only) ── */}
      {hasLivePositions && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <p
            className="vela-label"
            style={{
              color: 'var(--gray-500)',
              marginBottom: 'var(--space-2)',
              paddingLeft: 'var(--space-1)',
            }}
          >
            Live Positions
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

      {/* Separator between live positions and paper trades */}
      {hasLivePositions && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <div style={{ flex: 1, borderTop: '2px solid var(--gray-200)' }} />
            <span className="vela-label-sm" style={{ color: 'var(--gray-400)' }}>
              Paper Trades
            </span>
            <div style={{ flex: 1, borderTop: '2px solid var(--gray-200)' }} />
          </div>
          <p className="vela-body-sm vela-text-muted" style={{ textAlign: 'center', margin: 0 }}>
            Theoretical model performance — not real money
          </p>
        </div>
      )}

      {/* ── Narrative Stats ── */}
      {totalClosed > 0 ? (
        <Card style={{ marginBottom: 'var(--space-3)' }}>
          <p
            style={{
              fontFamily: 'var(--type-mono-base-font)',
              fontWeight: 700,
              fontSize: 'var(--text-xl)',
              color: totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {totalDollarPnl >= 0 ? '+' : '-'}$
            {Math.abs(totalDollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} total{' '}
            {totalDollarPnl >= 0 ? 'profit' : 'loss'}
          </p>
          <p
            className="vela-body-sm"
            style={{ color: 'var(--gray-600)', margin: 0, marginTop: 'var(--space-1)' }}
          >
            {totalClosed} trade{totalClosed !== 1 ? 's' : ''} · {detailedStats.wins} profitable
            {totalClosed > 0 && ` (${Math.round((detailedStats.wins / totalClosed) * 100)}%)`}
            {filteredOpen.length > 0 && ` · ${filteredOpen.length} open`}
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
            Based on ${DEFAULT_POSITION_SIZE.toLocaleString()} per trade. Total is cumulative across
            all closed trades.
          </p>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--space-3)' }}>
          <p className="vela-body-sm" style={{ color: 'var(--gray-500)', margin: 0 }}>
            No closed trades yet. Signals are running — trades will appear here when positions
            close.
          </p>
        </Card>
      )}

      {/* ── Best Call Hero ── */}
      {bestTrade && totalClosed >= 3 && (
        <BestCallCard trade={bestTrade} coingeckoId={assetMap[bestTrade.asset_id]?.coingecko_id} />
      )}

      {/* ── Sort By Filter ── */}
      {uniqueAssets.length > 1 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <p
            className="vela-label"
            style={{
              color: 'var(--gray-500)',
              marginBottom: 'var(--space-1)',
              paddingLeft: 'var(--space-1)',
            }}
          >
            Filters
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              onClick={() => setAssetFilter('all')}
              className={`vela-btn vela-btn-sm ${assetFilter === 'all' ? 'vela-btn-primary' : 'vela-btn-ghost'}`}
            >
              All
            </button>
            {uniqueAssets.map(a => {
              const iconUrl = getCoinIcon(a.coingeckoId);
              return (
                <button
                  key={a.id}
                  onClick={() => setAssetFilter(a.id)}
                  className={`vela-btn vela-btn-sm ${assetFilter === a.id ? 'vela-btn-primary' : 'vela-btn-ghost'}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {iconUrl && (
                    <img
                      src={iconUrl}
                      alt=""
                      width={16}
                      height={16}
                      style={{ borderRadius: '50%' }}
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  {a.symbol}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Status Filter ── */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {(['all', 'open', 'closed'] as const).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`vela-btn vela-btn-sm ${statusFilter === status ? 'vela-btn-primary' : 'vela-btn-ghost'}`}
          >
            {status === 'all'
              ? `All (${assetFiltered.length})`
              : status === 'open'
                ? `Open (${filteredOpen.length})`
                : `Closed (${filteredClosed.length})`}
          </button>
        ))}
      </div>

      {filteredTrades.length === 0 ? (
        <EmptyState type="no-trades" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredTrades.map(trade =>
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
                onToggle={() => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)}
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
                onToggle={() => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)}
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
      )}

      {/* ── Performance Breakdown (collapsible, reference data) ── */}
      {totalClosed > 0 && (
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
                value={`${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%`}
                valueColor={avgPnlPct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
              />
              <DetailRow
                label="Avg trade size"
                value={`$${DEFAULT_POSITION_SIZE.toLocaleString()}`}
              />
              <DetailRow
                label="Biggest profit"
                value={
                  detailedStats.bestTradeDollar >= 0
                    ? `+$${detailedStats.bestTradeDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${detailedStats.bestTradeAsset}${detailedStats.bestTradeDate ? ` · ${detailedStats.bestTradeDate}` : ''})`
                    : '—'
                }
                valueColor="var(--green-dark)"
              />
              <DetailRow
                label="Biggest loss"
                value={
                  detailedStats.worstTradeDollar < 0
                    ? `-$${Math.abs(detailedStats.worstTradeDollar).toLocaleString(undefined, { maximumFractionDigits: 0 })} (${detailedStats.worstTradeAsset}${detailedStats.worstTradeDate ? ` · ${detailedStats.worstTradeDate}` : ''})`
                    : '—'
                }
                valueColor={detailedStats.worstTradeDollar < 0 ? 'var(--red-dark)' : undefined}
              />

              {/* By Direction */}
              {(detailedStats.longCount > 0 || detailedStats.shortCount > 0) && (
                <>
                  <SectionLabel style={{ marginTop: 'var(--space-3)' }}>By direction</SectionLabel>
                  {detailedStats.longCount > 0 && (
                    <DetailRow
                      label="Long trades"
                      value={`${detailedStats.longWins} / ${detailedStats.longCount} profitable (${Math.round((detailedStats.longWins / detailedStats.longCount) * 100)}%)`}
                    />
                  )}
                  {detailedStats.shortCount > 0 && (
                    <DetailRow
                      label="Short trades"
                      value={`${detailedStats.shortWins} / ${detailedStats.shortCount} profitable (${Math.round((detailedStats.shortWins / detailedStats.shortCount) * 100)}%)`}
                    />
                  )}
                </>
              )}

              {/* Timing */}
              {detailedStats.avgDurationMs > 0 && (
                <>
                  <SectionLabel style={{ marginTop: 'var(--space-3)' }}>Timing</SectionLabel>
                  <DetailRow
                    label="Avg holding period"
                    value={formatDurationMs(detailedStats.avgDurationMs)}
                  />
                  <DetailRow
                    label="Longest trade"
                    value={formatDurationMs(detailedStats.longestDurationMs)}
                  />
                  <DetailRow
                    label="Shortest trade"
                    value={formatDurationMs(detailedStats.shortestDurationMs)}
                  />
                </>
              )}
            </Card>
          )}
        </div>
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
                  {Math.abs(unrealizedDollar).toLocaleString(undefined, {
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
              value={`${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}% · ${unrealizedDollar >= 0 ? '+' : '-'}$${Math.abs(unrealizedDollar).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unrealizedPct >= 0 ? 'profit' : 'loss'}`}
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
                  {Math.abs(dollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
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
              value={`${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(1)}% · ${dollarPnl >= 0 ? '+' : '-'}$${Math.abs(dollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${trade.pnl_pct >= 0 ? 'profit' : 'loss'}`}
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
                {Math.abs(dollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
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
              {Math.abs(pnlDollar).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
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
            value={`$${position.size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
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
            value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% · ${pnlDollar >= 0 ? '+' : '-'}$${Math.abs(pnlDollar).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${pnlPct >= 0 ? 'profit' : 'loss'}`}
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
                    {position.original_size_usd.toLocaleString(undefined, {
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
                  {trim.size_before_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} → $
                  {trim.size_after_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
