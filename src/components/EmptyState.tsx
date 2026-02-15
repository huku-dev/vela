import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface EmptyStateProps {
  type: 'no-trades' | 'no-signals' | 'loading-error';
  message?: string;
}

export default function EmptyState({ type, message }: EmptyStateProps) {
  return (
    <Box sx={{ textAlign: 'center', py: 4, px: 3 }}>
      <Box sx={{ mb: 2 }}>
        {type === 'no-trades' && <NoTradesIllustration />}
        {type === 'no-signals' && <NoSignalsIllustration />}
        {type === 'loading-error' && <ErrorIllustration />}
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: '#1A1A1A', mb: 0.75 }}>
        {type === 'no-trades' && 'No trades yet'}
        {type === 'no-signals' && 'No signals yet'}
        {type === 'loading-error' && 'Something went wrong'}
      </Typography>
      <Typography sx={{ fontSize: '0.85rem', color: '#6B7280', maxWidth: 280, mx: 'auto', lineHeight: 1.6 }}>
        {message ||
          (type === 'no-trades'
            ? 'The system will open a paper trade when the first green signal fires. Sit tight!'
            : type === 'no-signals'
              ? 'Waiting for the signal engine to run. It checks every 4 hours.'
              : "Couldn't load data. Try again later.")}
      </Typography>
    </Box>
  );
}

function NoTradesIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
      <rect x="15" y="20" width="90" height="65" rx="4" fill="#DBEAFE" stroke="#1A1A1A" strokeWidth="2.5" />
      <rect x="15" y="20" width="90" height="18" rx="4" fill="#3B82F6" stroke="#1A1A1A" strokeWidth="2.5" />
      <line x1="28" y1="60" x2="92" y2="60" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="38" cy="60" r="3.5" fill="#FEF9EF" stroke="#1A1A1A" strokeWidth="2" />
      <circle cx="60" cy="60" r="3.5" fill="#FEF9EF" stroke="#1A1A1A" strokeWidth="2" />
      <circle cx="82" cy="60" r="3.5" fill="#FEF9EF" stroke="#1A1A1A" strokeWidth="2" />
      <polygon points="100,10 103,18 112,18 105,23 107,31 100,27 93,31 95,23 88,18 97,18" fill="#FEF3C7" stroke="#1A1A1A" strokeWidth="1.5" />
    </svg>
  );
}

function NoSignalsIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
      <circle cx="60" cy="50" r="35" fill="#EDE9FE" stroke="#1A1A1A" strokeWidth="2.5" />
      <circle cx="60" cy="50" r="22" fill="none" stroke="#1A1A1A" strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx="60" cy="50" r="10" fill="none" stroke="#1A1A1A" strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1="60" y1="50" x2="60" y2="18" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="60" cy="50" r="4" fill="#8B5CF6" stroke="#1A1A1A" strokeWidth="2" />
      <rect x="8" y="72" width="16" height="16" rx="2" fill="#DCFCE7" stroke="#1A1A1A" strokeWidth="1.5" />
      <circle cx="104" cy="22" r="8" fill="#FEE2E2" stroke="#1A1A1A" strokeWidth="1.5" />
    </svg>
  );
}

function ErrorIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
      <polygon points="60,15 100,80 20,80" fill="#FEF3C7" stroke="#1A1A1A" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="56" y="35" width="8" height="22" rx="2" fill="#1A1A1A" />
      <circle cx="60" cy="67" r="4.5" fill="#1A1A1A" />
      <line x1="10" y1="25" x2="22" y2="25" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="19" x2="16" y2="31" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
