import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, LoadingSpinner, PageHeader } from '../components/VelaComponents';
import EmptyState from '../components/EmptyState';
import { useTrackRecord, DEFAULT_POSITION_SIZE } from '../hooks/useData';
import { getCoinIcon, formatPrice } from '../lib/helpers';
import type { PaperTrade } from '../types';

type AssetFilter = 'all' | string; // 'all' or asset_id

export default function TrackRecord() {
  const { trades, livePrices, assetMap, loading, loadingMore, hasMore, loadMore } =
    useTrackRecord();
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <LoadingSpinner size={28} />
      </div>
    );
  }

  // ── Filter trades ──
  const filteredTrades =
    assetFilter === 'all' ? trades : trades.filter(t => t.asset_id === assetFilter);

  const filteredClosed = filteredTrades.filter(t => t.status === 'closed' && t.pnl_pct != null);
  const filteredOpen = filteredTrades.filter(t => t.status === 'open');
  const totalClosed = filteredClosed.length;

  const totalDollarPnl = filteredClosed.reduce(
    (sum, t) => sum + (t.pnl_pct! / 100) * DEFAULT_POSITION_SIZE,
    0
  );

  const avgPnlPct =
    totalClosed > 0 ? filteredClosed.reduce((sum, t) => sum + t.pnl_pct!, 0) / totalClosed : 0;

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
  const formatDuration = (openedAt: string): string => {
    const ms = Date.now() - new Date(openedAt).getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (days > 0) return `${days}d ${remainingHours}h`;
    if (hours > 0) return `${hours}h`;
    return '<1h';
  };

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

      {/* ── Stats Overview ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <StatCard label="Trades" value={String(totalClosed)} variant="sky" />
        <StatCard
          label="Avg Return"
          value={totalClosed === 0 ? '—' : `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%`}
          variant={avgPnlPct >= 0 ? 'mint' : 'peach'}
          valueColor={
            totalClosed === 0
              ? undefined
              : avgPnlPct >= 0
                ? 'var(--green-dark)'
                : 'var(--red-dark)'
          }
        />
        <StatCard
          label="Net P&L"
          value={
            totalClosed === 0
              ? '—'
              : `${totalDollarPnl >= 0 ? '+' : ''}$${Math.abs(totalDollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          }
          variant={totalDollarPnl >= 0 ? 'mint' : 'peach'}
          valueColor={
            totalClosed === 0
              ? undefined
              : totalDollarPnl >= 0
                ? 'var(--green-dark)'
                : 'var(--red-dark)'
          }
        />
      </div>

      {/* ── Sort By Filter ── */}
      {uniqueAssets.length > 1 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <p
            className="vela-label"
            style={{
              color: 'var(--gray-500)',
              marginBottom: 'var(--space-2)',
              paddingLeft: 'var(--space-1)',
            }}
          >
            Sort by
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
          <p
            className="vela-label"
            style={{
              color: 'var(--gray-400)',
              marginTop: 'var(--space-1)',
              paddingLeft: 'var(--space-1)',
              fontSize: '0.6rem',
            }}
          >
            CRYPTO
          </p>
        </div>
      )}

      {/* ── Trade History ── */}
      <p
        className="vela-label"
        style={{
          color: 'var(--gray-500)',
          marginBottom: 'var(--space-2)',
          paddingLeft: 'var(--space-1)',
        }}
      >
        Trade History
      </p>

      {filteredTrades.length === 0 ? (
        <EmptyState type="no-trades" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Open trades first */}
          {filteredOpen.map(trade => (
            <OpenTradeCard
              key={trade.id}
              trade={trade}
              currentPrice={getLivePrice(trade.asset_coingecko_id)}
              coingeckoId={trade.asset_coingecko_id}
              formatDuration={formatDuration}
              expanded={expandedTradeId === trade.id}
              onToggle={() =>
                setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)
              }
              onViewBrief={() => navigate(`/asset/${trade.asset_id}`)}
            />
          ))}

          {/* Closed trades */}
          {filteredClosed.map(trade => (
            <ClosedTradeCard
              key={trade.id}
              trade={trade}
              coingeckoId={trade.asset_coingecko_id}
              expanded={expandedTradeId === trade.id}
              onToggle={() =>
                setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)
              }
            />
          ))}

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
  onViewBrief,
}: {
  trade: PaperTrade & { asset_symbol?: string; asset_coingecko_id?: string };
  currentPrice: number | null;
  coingeckoId: string | undefined;
  formatDuration: (openedAt: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onViewBrief: () => void;
}) {
  const unrealizedPct =
    currentPrice != null ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100 : null;
  const unrealizedDollar =
    unrealizedPct != null ? (unrealizedPct / 100) * DEFAULT_POSITION_SIZE : null;

  const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
  const symbol = trade.asset_symbol || trade.asset_id.toUpperCase();

  return (
    <Card
      compact
      style={{
        borderLeft: '4px solid var(--green-primary)',
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
                Long · Open {formatDuration(trade.opened_at)}
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
                  {unrealizedDollar >= 0 ? '+' : ''}${Math.abs(unrealizedDollar).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
          {/* Yellow events */}
          {trade.yellow_events && trade.yellow_events.length > 0 && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
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

          <button
            onClick={e => {
              e.stopPropagation();
              onViewBrief();
            }}
            className="vela-btn vela-btn-sm vela-btn-ghost"
            style={{ width: '100%' }}
          >
            View Full Brief
          </button>
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
  const dollarPnl = trade.pnl_pct != null ? (trade.pnl_pct / 100) * DEFAULT_POSITION_SIZE : null;
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
                Long · Closed
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
                  {dollarPnl >= 0 ? '+' : ''}${Math.abs(dollarPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
          {/* Duration */}
          {trade.opened_at && trade.closed_at && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-2)',
              }}
            >
              <span className="vela-body-sm" style={{ color: 'var(--gray-500)' }}>
                Duration
              </span>
              <span
                className="vela-body-sm"
                style={{ fontFamily: 'var(--type-mono-base-font)' }}
              >
                {formatHoldingPeriod(trade.opened_at, trade.closed_at)}
              </span>
            </div>
          )}

          {/* Position size */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}
          >
            <span className="vela-body-sm" style={{ color: 'var(--gray-500)' }}>
              Position size
            </span>
            <span
              className="vela-body-sm"
              style={{ fontFamily: 'var(--type-mono-base-font)' }}
            >
              ${DEFAULT_POSITION_SIZE.toLocaleString()}
            </span>
          </div>

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
  variant = 'default',
  valueColor,
}: {
  label: string;
  value: string;
  variant?: 'default' | 'sky' | 'mint' | 'peach';
  valueColor?: string;
}) {
  return (
    <Card variant={variant} compact>
      <div style={{ textAlign: 'center', padding: 'var(--space-1) 0' }}>
        <p
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontWeight: 800,
            fontSize: 'var(--text-lg)',
            color: valueColor || 'var(--gray-900)',
            margin: 0,
          }}
        >
          {value}
        </p>
        <p
          className="vela-label"
          style={{
            color: 'var(--gray-500)',
            marginTop: 'var(--space-1)',
            marginBottom: 0,
          }}
        >
          {label}
        </p>
      </div>
    </Card>
  );
}

function formatHoldingPeriod(openedAt: string, closedAt: string): string {
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  if (hours > 0) return `${hours}h`;
  return '<1h';
}
