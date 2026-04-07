import type { SignalColor } from '../types';

const colorMap: Record<SignalColor, { text: string; border: string; label: string }> = {
  green: {
    text: 'var(--color-status-buy-text)',
    border: 'var(--color-status-buy-border)',
    label: 'Buy',
  },
  red: {
    text: 'var(--color-status-sell-text)',
    border: 'var(--color-status-sell-border)',
    label: 'Sell',
  },
  grey: {
    text: 'var(--color-status-wait-text)',
    border: 'var(--color-status-wait-border)',
    label: 'Wait',
  },
};

interface SignalChipProps {
  color: SignalColor;
  size?: 'small' | 'medium';
  nearConfirmation?: boolean;
}

export default function SignalChip({ color, size = 'medium', nearConfirmation }: SignalChipProps) {
  const { text, border, label } = colorMap[color];
  const isSmall = size === 'small';
  const isNearConfirm = color === 'grey' && nearConfirmation;

  const chipBorder = isNearConfirm ? 'var(--color-status-wait-near-border)' : border;
  const chipDot = isNearConfirm ? 'var(--color-status-wait-near-dot)' : border;
  const chipText = isNearConfirm ? 'var(--color-status-wait-near-text)' : text;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? 4 : 5,
        backgroundColor: 'transparent',
        color: chipText,
        fontFamily: 'var(--type-label-sm-font)',
        fontWeight: 700,
        fontSize: isSmall ? '0.6rem' : '0.7rem',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        border: `1.5px solid ${chipBorder}`,
        borderRadius: '9999px',
        height: isSmall ? 22 : 26,
        padding: isSmall ? '0 8px' : '0 10px',
      }}
    >
      <span
        style={{
          width: isSmall ? 5 : 6,
          height: isSmall ? 5 : 6,
          borderRadius: '50%',
          backgroundColor: chipDot,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
