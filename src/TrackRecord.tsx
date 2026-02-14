import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import { useTrackRecord } from '../hooks/useData';

export default function TrackRecord() {
  const { trades, stats, loading } = useTrackRecord();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={32} sx={{ color: 'text.secondary' }} />
      </Box>
    );
  }

  const totalClosed = stats.reduce((sum, s) => sum + (s.total_closed || 0), 0);
  const totalWins = stats.reduce((sum, s) => sum + (s.wins || 0), 0);
  const overallWinRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(0) : '—';

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3, mt: 1 }}>
        <Typography variant="h5" sx={{ color: 'text.primary' }}>
          Track Record
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.75rem', mt: 0.5 }}>
          Paper trading performance
        </Typography>
      </Box>

      {/* Stats Overview */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 3 }}>
        <StatCard label="Trades" value={String(totalClosed)} />
        <StatCard label="Win Rate" value={overallWinRate === '—' ? '—' : `${overallWinRate}%`} />
        <StatCard
          label="Open"
          value={String(trades.filter((t) => t.status === 'open').length)}
        />
      </Box>

      {/* Per-Asset Stats */}
      {stats.length > 0 && (
        <Box sx={{ mb: 3 }}>
          {stats.map((s) => (
            <Card key={s.asset_id} sx={{ mb: 1.5 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {s.asset_id?.toUpperCase()}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem' }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: '0.6rem' }}>
                        W / L
                      </Typography>
                      <span style={{ color: '#e2e8f0' }}>
                        {s.wins ?? 0} / {s.losses ?? 0}
                      </span>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: '0.6rem' }}>
                        Avg Win
                      </Typography>
                      <span style={{ color: '#22c55e' }}>
                        {s.avg_win_pct != null ? `+${Number(s.avg_win_pct).toFixed(1)}%` : '—'}
                      </span>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: '0.6rem' }}>
                        Avg Loss
                      </Typography>
                      <span style={{ color: '#ef4444' }}>
                        {s.avg_loss_pct != null ? `${Number(s.avg_loss_pct).toFixed(1)}%` : '—'}
                      </span>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Trade History */}
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', fontSize: '0.65rem', letterSpacing: '0.12em', display: 'block', mb: 1.5, px: 0.5 }}
      >
        Trade History
      </Typography>

      {trades.length === 0 ? (
        <Card>
          <CardContent sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No trades yet. The system will open a paper trade when the first Green signal fires.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        trades.map((trade) => (
          <Card key={trade.id} sx={{ mb: 1.5 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {trade.asset_symbol || trade.asset_id.toUpperCase()}
                    </Typography>
                    <Chip
                      label={trade.status === 'open' ? 'Open' : 'Closed'}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        backgroundColor:
                          trade.status === 'open'
                            ? 'rgba(34,197,94,0.15)'
                            : 'rgba(100,116,139,0.15)',
                        color: trade.status === 'open' ? '#22c55e' : '#94a3b8',
                      }}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace' }}
                  >
                    Entry: ${trade.entry_price.toLocaleString()}
                    {trade.exit_price != null && ` → Exit: $${trade.exit_price.toLocaleString()}`}
                  </Typography>
                </Box>

                {trade.pnl_pct != null && (
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: trade.pnl_pct >= 0 ? '#22c55e' : '#ef4444',
                    }}
                  >
                    {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(1)}%
                  </Typography>
                )}
              </Box>

              {/* Yellow Events */}
              {trade.yellow_events && trade.yellow_events.length > 0 && (
                <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  {trade.yellow_events.map((ye, i) => (
                    <Typography
                      key={i}
                      variant="caption"
                      sx={{ display: 'block', color: '#eab308', fontSize: '0.7rem', mb: 0.25 }}
                    >
                      ⚠ {ye.suggested_action}
                    </Typography>
                  ))}
                </Box>
              )}

              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 0.75, color: 'rgba(148,163,184,0.4)', fontSize: '0.65rem' }}
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
              </Typography>
            </CardContent>
          </Card>
        ))
      )}
    </Box>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent sx={{ p: 1.5, textAlign: 'center', '&:last-child': { pb: 1.5 } }}>
        <Typography
          variant="h6"
          sx={{
            color: 'text.primary',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '1.1rem',
          }}
        >
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', letterSpacing: '0.08em' }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}
