import { useState } from 'react';
import { Card, Badge, LoadingSpinner, PageHeader } from '../components/VelaComponents';
import EmptyState from '../components/EmptyState';
import { useTrackRecord, DEFAULT_POSITION_SIZE } from '../hooks/useData';
import { getCoinIcon, formatPrice } from '../lib/helpers';
import {
  calculateUnrealizedPnL,
  pctToDollar,
  aggregateTradeStats,
  computeDetailedStats,
  formatDurationMs,
} from '../utils/calculations';
import type { PaperTrade, TradeDirection } from '../types';

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
  const { trades, livePrices, assetMap, loading, loadingMore, hasMore, loadMore } =
    useTrackRecord();
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

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
      <PageHeader
        title="Your Trades"
        subtitle={`Paper trading · $${DEFAULT_POSITION_SIZE.toLocaleString()} position size`}
      />

      {/* ── Stats Overview (2×2 grid) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <StatCard label="Balance" value="$—" subtitle="Coming soon" variant="sky" />
        <StatCard
          label="Total P&L"
          value={
            totalClosed === 0
              ? '—'
              : `${totalDollarPnl >= 0 ? '+' : ''}$${Math.abs(totalDollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          }
          subtitle={totalClosed > 0 ? `across ${totalClosed} trades` : undefined}
          variant={totalDollarPnl >= 0 ? 'mint' : 'peach'}
          valueColor={
            totalClosed === 0
              ? undefined
              : totalDollarPnl >= 0
                ? 'var(--green-dark)'
                : 'var(--red-dark)'
          }
        />
        <StatCard
          label="Trades"
          value={String(filteredClosed.length + filteredOpen.length)}
          variant="default"
        />
        <StatCard
          label="Profitable"
          value={totalClosed === 0 ? '—' : `${detailedStats.wins} of ${totalClosed}`}
          variant={
            totalClosed === 0
              ? 'default'
              : detailedStats.wins / totalClosed >= 0.5
                ? 'mint'
                : 'peach'
          }
          valueColor={
            totalClosed === 0
              ? undefined
              : detailedStats.wins / totalClosed >= 0.5
                ? 'var(--green-dark)'
                : 'var(--red-dark)'
          }
        />
      </div>

      {/* ── Performance Breakdown (collapsible) ── */}
      {totalClosed > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
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
              ▼
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
                expanded={expandedTradeId === trade.id}
                onToggle={() => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)}
              />
            ) : (
              <ClosedTradeCard
                key={trade.id}
                trade={trade}
                coingeckoId={trade.asset_coingecko_id}
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
    </div>
  );
}

// ── Open Trade Card ──

function OpenTradeCard({
  trade,
  currentPrice,
  coingeckoId,
  formatDuration,
  expanded,
  onToggle,
}: {
  trade: PaperTrade & { asset_symbol?: string; asset_coingecko_id?: string };
  currentPrice: number | null;
  coingeckoId: string | undefined;
  formatDuration: (openedAt: string) => string;
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
          {new Date(trade.opened_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
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
  expanded,
  onToggle,
}: {
  trade: PaperTrade & { asset_symbol?: string; asset_coingecko_id?: string };
  coingeckoId: string | undefined;
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
          {new Date(trade.opened_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
          {trade.closed_at &&
            ` — ${new Date(trade.closed_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
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

function StatCard({
  label,
  value,
  subtitle,
  variant = 'default',
  valueColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'sky' | 'mint' | 'peach';
  valueColor?: string;
}) {
  return (
    <Card variant={variant} tight>
      <div style={{ textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontWeight: 800,
            fontSize: 'var(--text-base)',
            color: valueColor || 'var(--gray-900)',
            margin: 0,
          }}
        >
          {value}
        </p>
        <p
          className="vela-label-sm"
          style={{
            color: 'var(--gray-500)',
            marginTop: 2,
            marginBottom: 0,
          }}
        >
          {label}
        </p>
        {subtitle && (
          <p
            style={{
              fontFamily: 'var(--type-body-sm-font)',
              fontSize: 'var(--text-2xs)',
              color: 'var(--gray-400)',
              margin: 0,
              marginTop: 1,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </Card>
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
