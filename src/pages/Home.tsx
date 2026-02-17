import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import SignalCard from '../components/SignalCard';
import EmptyState from '../components/EmptyState';
import { useDashboard } from '../hooks/useData';
import { breakIntoParagraphs } from '../lib/helpers';

export default function Home() {
  const { data, digest, loading, error, lastUpdated } = useDashboard();

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          pt: 10,
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <CircularProgress size={28} sx={{ color: '#1A1A1A' }} />
        <Typography sx={{ fontSize: '0.8rem', color: '#6B7280' }}>Loading signals...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
        <EmptyState type="loading-error" message={error} />
      </Box>
    );
  }

  const digestText = digest?.summary || digest?.context || '';
  const digestParagraphs = breakIntoParagraphs(digestText, 2);

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 2.5, mt: 1 }}>
        <Typography variant="h4">Vela</Typography>
        {lastUpdated && (
          <Typography sx={{ fontSize: '0.7rem', color: '#9CA3AF', mt: 0.5 }}>
            Updates every 15 mins ·{' '}
            {lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </Typography>
        )}
      </Box>

      {/* Daily Digest — at top, with paragraph breaks */}
      {digest && (
        <Card
          sx={{
            mb: 2.5,
            backgroundColor: '#EDE9FE',
            border: '2.5px solid #1A1A1A',
            boxShadow: '4px 4px 0px #1A1A1A',
          }}
        >
          <CardContent sx={{ p: 2.5 }}>
            {/* Date as prominent header */}
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: '0.82rem',
                color: '#1A1A1A',
                mb: 0.5,
              }}
            >
              {new Date(digest.created_at).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Typography>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: '0.65rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#6B7280',
                mb: 1.5,
              }}
            >
              Daily Digest
            </Typography>

            {/* Paragraphed text */}
            {digestParagraphs.map((para, i) => (
              <Typography
                key={i}
                sx={{
                  fontSize: '0.85rem',
                  color: '#374151',
                  lineHeight: 1.7,
                  mb: i < digestParagraphs.length - 1 ? 1.25 : 0,
                }}
              >
                {para}
              </Typography>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Signals section */}
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: '0.7rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#6B7280',
          mb: 1.5,
          px: 0.5,
        }}
      >
        Signals
      </Typography>

      {data.length === 0 ? (
        <EmptyState type="no-signals" />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.map(item => (
            <SignalCard key={item.asset.id} data={item} />
          ))}
        </Box>
      )}
    </Box>
  );
}
