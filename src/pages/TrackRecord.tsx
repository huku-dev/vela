import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import EmptyState from '../components/EmptyState';
import { useTrackRecord, DEFAULT_POSITION_SIZE } from '../hooks/useData';

export default function TrackRecord() {
  const { trades, stats, loading } = useTrackRecord();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={28} sx={{ color: '#1A1A1A' }} />
      </Box>
    );
  }

  const totalClosed = stats.reduce((sum: number, s: any) => sum + (s.total_closed || 0), 0);
  const totalWins = stats.reduce((sum: number, s: any) => sum + (s.wins || 0), 0);
  const overallWinRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(0) : '—';

  const totalDollarPnl = trades
    .filter((t) => t.status === 'closed' && t.pnl_pct != null)
    .reduce((sum, t) => sum + (t.pnl_pct! / 100) * DEFAULT_POSITION_SIZE, 0);

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 2.5, mt: 1 }}>
        <Typography variant="h4">Your Trades</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: '#9CA3AF', mt: 0.5 }}>
          Paper trading · ${DEFAULT_POSITION_SIZE.toLocaleString()} position size
        </Typography>
      </Box>

      {/* Stats Overview */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 2.5 }}>
        <StatCard label="Trades" value={String(totalClosed)} bg="#DBEAFE" />
        <StatCard
          label="Win Rate"
          value={overallWinRate === '—' ? '—' : `${overallWinRate}%`}
          bg="#DCFCE7"
        />
        <StatCard
          label="Net P&L"
          value={
            totalClosed === 0
              ? '—'
              : `${totalDollarPnl >= 0 ? '+' : ''}$${Math.abs(totalDollarPnl).toFixed(0)}`
          }
          bg={totalDollarPnl >= 0 ? '#DCFCE7' : '#FEE2E2'}
          valueColor={totalDollarPnl >= 0 ? '#15803D' : '#DC2626'}
        />
      </Box>

      {/* Per-Asset Breakdown */}
      {stats.length > 0 && stats.some((s: any) => s.total_closed > 0) && (
        <Box sx={{ mb: 2.5 }}>
          <SectionLabel>By Asset</SectionLabel>
          {stats.map((s: any) => {
            const assetPnl = trades
              .filter((t) => t.asset_id === s.asset_id && t.status === 'closed' && t.pnl_pct != null)
              .reduce((sum, t) => sum + (t.pnl_pct! / 100) * DEFAULT_POSITION_SIZE, 0);

            return (
              <Card key={s.asset_id} sx={{ mb: 1.5 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: '#1A1A1A' }}>
                      {s.asset_id?.toUpperCase()}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2.5, fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem' }}>
                      <StatMini label="W / L" value={`${s.wins ?? 0} / ${s.losses ?? 0}`} />
                      <StatMini
                        label="Avg Win"
                        value={s.avg_win_pct != null ? `+${Number(s.avg_win_pct).toFixed(1)}%` : '—'}
                        color="#15803D"
                      />
                      <StatMini
                        label="Avg Loss"
                        value={s.avg_loss_pct != null ? `${Number(s.avg_loss_pct).toFixed(1)}%` : '—'}
                        color="#DC2626"
                      />
                      <StatMini
                        label="Net P&L"
                        value={`${assetPnl >= 0 ? '+' : ''}$${Math.abs(assetPnl).toFixed(0)}`}
                        color={assetPnl >= 0 ? '#15803D' : '#DC2626'}
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Equity Curve Placeholder */}
      {totalClosed > 0 && (
        <Card sx={{ mb: 2.5, backgroundColor: '#F9FAFB' }}>
          <CardContent sx={{ p: 2.5, textAlign: 'center' }}>
            <SectionLabel sx={{ textAlign: 'center' }}>Growth Over Time</SectionLabel>
            <Box
              sx={{
                height: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography sx={{ fontSize: '0.8rem', color: '#9CA3AF' }}>
                Chart coming soon — needs more trade history
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Trade History — tighter spacing */}
      <SectionLabel>Trade History</SectionLabel>

      {trades.length === 0 ? (
        <EmptyState type="no-trades" />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {trades.map((trade) => {
            const dollarPnl =
              trade.pnl_pct != null ? (trade.pnl_pct / 100) * DEFAULT_POSITION_SIZE : null;

            return (
              <Card key={trade.id}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#1A1A1A' }}>
                          {trade.asset_symbol || trade.asset_id.toUpperCase()}
                        </Typography>
                        <Chip
                          label={trade.status === 'open' ? 'Open' : 'Closed'}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            border: '1.5px solid #1A1A1A',
                            borderRadius: '6px',
                            backgroundColor: trade.status === 'open' ? '#DCFCE7' : '#F3F4F6',
                            color: trade.status === 'open' ? '#15803D' : '#6B7280',
                          }}
                        />
                      </Box>
                      <Typography
                        sx={{
                          fontSize: '0.72rem',
                          color: '#6B7280',
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        Entry: ${trade.entry_price.toLocaleString()}
                        {trade.exit_price != null && ` → Exit: $${trade.exit_price.toLocaleString()}`}
                      </Typography>
                    </Box>

                    {trade.pnl_pct != null && (
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography
                          sx={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            color: trade.pnl_pct >= 0 ? '#15803D' : '#DC2626',
                            lineHeight: 1.2,
                          }}
                        >
                          {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(1)}%
                        </Typography>
                        {dollarPnl != null && (
                          <Typography
                            sx={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontWeight: 600,
                              fontSize: '0.7rem',
                              color: dollarPnl >= 0 ? '#15803D' : '#DC2626',
                            }}
                          >
                            {dollarPnl >= 0 ? '+' : ''}${Math.abs(dollarPnl).toFixed(0)}
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Box>

                  {/* Yellow Events */}
                  {trade.yellow_events && trade.yellow_events.length > 0 && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '2px solid #E5E7EB' }}>
                      {trade.yellow_events.map((ye, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mb: 0.25 }}>
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: '#F59E0B',
                              border: '1px solid #1A1A1A',
                              mt: '4px',
                              flexShrink: 0,
                            }}
                          />
                          <Typography sx={{ fontSize: '0.7rem', color: '#92400E' }}>
                            {ye.suggested_action}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}

                  <Typography sx={{ mt: 0.75, color: '#9CA3AF', fontSize: '0.62rem' }}>
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
                  </Typography>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function SectionLabel({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  return (
    <Typography
      sx={{
        fontWeight: 800,
        fontSize: '0.7rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#6B7280',
        mb: 1,
        px: 0.5,
        ...sx,
      }}
    >
      {children}
    </Typography>
  );
}

function StatCard({
  label,
  value,
  bg,
  valueColor,
}: {
  label: string;
  value: string;
  bg: string;
  valueColor?: string;
}) {
  return (
    <Card sx={{ backgroundColor: bg, border: '2.5px solid #1A1A1A', boxShadow: '4px 4px 0px #1A1A1A' }}>
      <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800,
            fontSize: '1.1rem',
            color: valueColor || '#1A1A1A',
          }}
        >
          {value}
        </Typography>
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: '0.6rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#6B7280',
            mt: 0.25,
          }}
        >
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.58rem', color: '#9CA3AF', display: 'block', mb: 0.25, fontWeight: 600 }}>
        {label}
      </Typography>
      <span style={{ color: color || '#1A1A1A', fontWeight: 600 }}>{value}</span>
    </Box>
  );
}
