import Chip from '@mui/material/Chip';
import type { SignalColor } from '../types';

const colorMap: Record<SignalColor, { bg: string; text: string; label: string }> = {
  green: { bg: '#DCFCE7', text: '#15803D', label: 'BUY' },
  red: { bg: '#FEE2E2', text: '#DC2626', label: 'EXIT' },
  grey: { bg: '#DBEAFE', text: '#2563EB', label: 'WAIT' },
};

interface SignalChipProps {
  color: SignalColor;
  size?: 'small' | 'medium';
}

export default function SignalChip({ color, size = 'medium' }: SignalChipProps) {
  const { bg, text, label } = colorMap[color];
  return (
    <Chip
      label={label}
      size={size}
      sx={{
        backgroundColor: bg,
        color: text,
        fontWeight: 800,
        fontSize: size === 'small' ? '0.65rem' : '0.75rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        border: '2px solid #1A1A1A',
        borderRadius: '8px',
        boxShadow: '2px 2px 0px #1A1A1A',
        height: size === 'small' ? 26 : 32,
        px: 0.25,
      }}
    />
  );
}
