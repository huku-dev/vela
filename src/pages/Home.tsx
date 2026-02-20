import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import SignalCard from '../components/SignalCard';
import EmptyState from '../components/EmptyState';
import VelaLogo from '../components/VelaLogo';
import { useDashboard } from '../hooks/useData';
import { breakIntoParagraphs } from '../lib/helpers';

const DIGEST_COLLAPSED_HEIGHT = 96; // ~4 lines at 0.85rem with 1.7 line-height

export default function Home() {
  const { data, digest, loading, error, lastUpdated } = useDashboard();
  const [digestExpanded, setDigestExpanded] = useState(false);

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
        <VelaLogo variant="full" size={40} />
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
          onClick={() => setDigestExpanded(!digestExpanded)}
          sx={{
            mb: 2.5,
            backgroundColor: '#EDE9FE',
            border: '2.5px solid #1A1A1A',
            boxShadow: '4px 4px 0px #1A1A1A',
            cursor: 'pointer',
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
              Daily digest
            </Typography>

            {/* Paragraphed text — truncated with "View more" */}
            <Box
              sx={{
                position: 'relative',
                maxHeight: digestExpanded ? 'none' : `${DIGEST_COLLAPSED_HEIGHT}px`,
                overflow: 'hidden',
                transition: 'max-height 0.3s ease',
              }}
            >
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
              {!digestExpanded && (
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 40,
                    background: 'linear-gradient(transparent, #EDE9FE)',
                  }}
                />
              )}
            </Box>
            {digestParagraphs.length > 1 && (
              <Typography
                onClick={() => setDigestExpanded(!digestExpanded)}
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#6B7280',
                  mt: 1,
                  cursor: 'pointer',
                  '&:hover': { color: '#1A1A1A' },
                }}
              >
                {digestExpanded ? 'Show less' : 'View more'}
              </Typography>
            )}
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
