import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import SignalCard from '../components/SignalCard';
import { useDashboard } from '../hooks/useData';

export default function Home() {
  const { data, digest, loading, error, refresh } = useDashboard();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={32} sx={{ color: 'text.secondary' }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Error: {error}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, mt: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ color: 'text.primary' }}>
            Signals
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', mt: 0.5 }}>
            Updated every 4 hours
          </Typography>
        </Box>
        <IconButton onClick={refresh} size="small" sx={{ color: 'text.secondary' }}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Signal Cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
        {data.map((item) => (
          <SignalCard key={item.asset.id} data={item} />
        ))}
      </Box>

      {/* Daily Digest */}
      {digest && (
        <Card sx={{ mt: 1 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography
              variant="overline"
              sx={{
                color: 'text.secondary',
                fontSize: '0.65rem',
                letterSpacing: '0.12em',
                display: 'block',
                mb: 1,
              }}
            >
              Daily Digest
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                fontSize: '0.85rem',
                lineHeight: 1.7,
              }}
            >
              {digest.summary || digest.context}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 1.5,
                color: 'rgba(148,163,184,0.5)',
                fontSize: '0.7rem',
              }}
            >
              {new Date(digest.created_at).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
