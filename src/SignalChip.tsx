import Chip from '@mui/material/Chip';
import type { SignalColor } from '../types';

const colorMap: Record<SignalColor, { bg: string; text: string; label: string }> = {
  green: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', label: 'Buy' },
  red: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', label: 'Exit' },
  grey: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', label: 'Wait' },
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
        fontWeight: 700,
        fontSize: size === 'small' ? '0.7rem' : '0.8rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: '8px',
        px: 0.5,
      }}
    />
  );
}
