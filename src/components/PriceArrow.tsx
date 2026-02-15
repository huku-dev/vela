import Box from '@mui/material/Box';

interface PriceArrowProps {
  change24h: number | null | undefined;
}

/**
 * Neobrutalist up/down arrow indicator for 24h price change.
 * Thick stroke triangle with solid fill, no text — just the directional arrow.
 */
export default function PriceArrow({ change24h }: PriceArrowProps) {
  if (change24h == null) return null;

  const isUp = change24h >= 0;
  const color = isUp ? '#15803D' : '#DC2626';
  const bg = isUp ? '#DCFCE7' : '#FEE2E2';

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '4px',
        border: '1.5px solid #1A1A1A',
        backgroundColor: bg,
        flexShrink: 0,
      }}
    >
      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
        {isUp ? (
          <polygon points="4,0 8,6 0,6" fill={color} stroke="#1A1A1A" strokeWidth="0.7" />
        ) : (
          <polygon points="4,6 8,0 0,0" fill={color} stroke="#1A1A1A" strokeWidth="0.7" />
        )}
      </svg>
    </Box>
  );
}
