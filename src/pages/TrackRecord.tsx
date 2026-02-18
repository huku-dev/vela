import { useState } from 'react';
import { Card, Badge, LoadingSpinner, PageHeader } from '../components/VelaComponents';
import EmptyState from '../components/EmptyState';
import { useTrackRecord, DEFAULT_POSITION_SIZE } from '../hooks/useData';
import type { TradeSource } from '../types';

type SourceFilter = 'all' | TradeSource;

export default function TrackRecord() {
  const { trades, loading } = useTrackRecord();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <LoadingSpinner size={28} />
      </div>
    );
  }

  const hasBacktestTrades = trades.some(t => t.source === 'backtest');

  // Filter trades by source
  const filteredTrades =
    sourceFilter === 'all' ? trades : trades.filter(t => t.source === sourceFilter);

  const filteredClosed = filteredTrades.filter(t => t.status === 'closed' && t.pnl_pct != null);
  const totalClosed = filteredClosed.length;
  const totalWins = filteredClosed.filter(t => t.pnl_pct! > 0).length;
  const overallWinRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(0) : '—';

  const totalDollarPnl = filteredClosed.reduce(
    (sum, t) => sum + (t.pnl_pct! / 100) * DEFAULT_POSITION_SIZE,
    0
  );

  // Per-asset breakdown from filtered trades
  const assetIds = [...new Set(filteredTrades.map(t => t.asset_id))];
  const filteredStats = assetIds.map(assetId => {
    const assetTrades = filteredClosed.filter(t => t.asset_id === assetId);
    const wins = assetTrades.filter(t => t.pnl_pct! > 0);
    const losses = assetTrades.filter(t => t.pnl_pct! <= 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl_pct!, 0) / wins.length : null;
    const avgLoss =
      losses.length > 0 ? losses.reduce((s, t) => s + t.pnl_pct!, 0) / losses.length : null;
    const pnl = assetTrades.reduce((s, t) => s + (t.pnl_pct! / 100) * DEFAULT_POSITION_SIZE, 0);
    return {
      assetId,
      total: assetTrades.length,
      wins: wins.length,
      losses: losses.length,
      avgWin,
      avgLoss,
      pnl,
    };
  });

  return (
    <div style={{ padding: '16px', paddingBottom: 80, maxWidth: 600, margin: '0 auto' }}>
      <PageHeader
        title="Your Trades"
        subtitle={`Paper trading · $${DEFAULT_POSITION_SIZE.toLocaleString()} position size`}
      />

      {/* Source filter — only show if backtest trades exist */}
      {hasBacktestTrades && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['all', 'live', 'backtest'] as SourceFilter[]).map(filter => (
            <button
              key={filter}
              onClick={() => setSourceFilter(filter)}
              className={`vela-btn vela-btn-sm ${sourceFilter === filter ? 'vela-btn-primary' : 'vela-btn-ghost'}`}
            >
              {filter === 'all' ? 'All' : filter === 'live' ? 'Live' : 'Backtest'}
            </button>
          ))}
        </div>
      )}

      {/* Stats Overview */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}
      >
        <StatCard label="Trades" value={String(totalClosed)} variant="sky" />
        <StatCard
          label="Win Rate"
          value={overallWinRate === '—' ? '—' : `${overallWinRate}%`}
          variant="mint"
        />
        <StatCard
          label="Net P&L"
          value={
            totalClosed === 0
              ? '—'
              : `${totalDollarPnl >= 0 ? '+' : ''}$${Math.abs(totalDollarPnl).toFixed(0)}`
          }
          variant={totalDollarPnl >= 0 ? 'mint' : 'peach'}
          valueColor={totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
        />
      </div>

      {/* Per-Asset Breakdown */}
      {filteredStats.length > 0 && filteredStats.some(s => s.total > 0) && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>By Asset</SectionLabel>
          {filteredStats.map(s => (
            <Card key={s.assetId} compact style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className="vela-heading-base">{s.assetId?.toUpperCase()}</span>
                <div
                  style={{
                    display: 'flex',
                    gap: 20,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '0.72rem',
                  }}
                >
                  <StatMini label="W / L" value={`${s.wins} / ${s.losses}`} />
                  <StatMini
                    label="Avg Win"
                    value={s.avgWin != null ? `+${s.avgWin.toFixed(1)}%` : '—'}
                    color="var(--green-dark)"
                  />
                  <StatMini
                    label="Avg Loss"
                    value={s.avgLoss != null ? `${s.avgLoss.toFixed(1)}%` : '—'}
                    color="var(--red-dark)"
                  />
                  <StatMini
                    label="Net P&L"
                    value={`${s.pnl >= 0 ? '+' : ''}$${Math.abs(s.pnl).toFixed(0)}`}
                    color={s.pnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Trade History */}
      <SectionLabel>Trade History</SectionLabel>

      {filteredTrades.length === 0 ? (
        <EmptyState type="no-trades" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredTrades.map(trade => {
            const dollarPnl =
              trade.pnl_pct != null ? (trade.pnl_pct / 100) * DEFAULT_POSITION_SIZE : null;

            return (
              <Card key={trade.id} compact>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span className="vela-heading-base">
                        {trade.asset_symbol || trade.asset_id.toUpperCase()}
                      </span>
                      <Badge variant={trade.status === 'open' ? 'buy' : 'neutral'}>
                        {trade.status === 'open' ? 'Open' : 'Closed'}
                      </Badge>
                      {trade.source === 'backtest' && <Badge variant="wait">Backtest</Badge>}
                    </div>
                    <p
                      className="vela-body-sm"
                      style={{
                        color: 'var(--gray-500)',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      Entry: ${trade.entry_price.toLocaleString()}
                      {trade.exit_price != null && ` → Exit: $${trade.exit_price.toLocaleString()}`}
                    </p>
                  </div>

                  {trade.pnl_pct != null && (
                    <div style={{ textAlign: 'right' }}>
                      <p
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontWeight: 700,
                          fontSize: '0.9rem',
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
                            fontFamily: '"JetBrains Mono", monospace',
                            fontWeight: 600,
                            fontSize: '0.7rem',
                            color: dollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                            margin: 0,
                          }}
                        >
                          {dollarPnl >= 0 ? '+' : ''}${Math.abs(dollarPnl).toFixed(0)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Yellow Events */}
                {trade.yellow_events && trade.yellow_events.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: '2px solid var(--gray-200)',
                    }}
                  >
                    {trade.yellow_events.map((ye, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: 'var(--amber-primary)',
                            border: '1px solid var(--gray-900)',
                            marginTop: 4,
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

                <p
                  className="vela-body-sm vela-text-muted"
                  style={{ marginTop: 6, fontSize: '0.62rem' }}
                >
                  {new Date(trade.created_at).toLocaleDateString(undefined, {
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
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="vela-label"
      style={{
        fontWeight: 800,
        fontSize: '0.7rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--gray-500)',
        marginBottom: 8,
        paddingLeft: 4,
      }}
    >
      {children}
    </p>
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
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <p
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800,
            fontSize: '1.1rem',
            color: valueColor || 'var(--gray-900)',
            margin: 0,
          }}
        >
          {value}
        </p>
        <p
          className="vela-label"
          style={{
            fontWeight: 700,
            fontSize: '0.6rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--gray-500)',
            marginTop: 2,
          }}
        >
          {label}
        </p>
      </div>
    </Card>
  );
}

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <span
        className="vela-body-sm vela-text-muted"
        style={{ display: 'block', marginBottom: 2, fontWeight: 600, fontSize: '0.58rem' }}
      >
        {label}
      </span>
      <span style={{ color: color || 'var(--gray-900)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
