import type { SignalColor } from '../types';

const colorMap: Record<SignalColor, { bg: string; text: string; label: string }> = {
  green: { bg: 'var(--color-status-buy-bg)', text: 'var(--color-status-buy-text)', label: 'BUY' },
  red: { bg: 'var(--color-status-sell-bg)', text: 'var(--color-status-sell-text)', label: 'SHORT' },
  grey: { bg: 'var(--color-status-wait-bg)', text: 'var(--color-status-wait-text)', label: 'WAIT' },
};

interface SignalChipProps {
  color: SignalColor;
  size?: 'small' | 'medium';
  nearConfirmation?: boolean;
}

export default function SignalChip({ color, size = 'medium', nearConfirmation }: SignalChipProps) {
  const { bg, text, label } = colorMap[color];
  const isSmall = size === 'small';
  const isNearConfirm = color === 'grey' && nearConfirmation;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isSmall ? 3 : 4,
        backgroundColor: isNearConfirm ? 'var(--color-status-wait-near-bg)' : bg,
        color: isNearConfirm ? 'var(--color-status-wait-near-text)' : text,
        fontFamily: 'var(--type-label-sm-font)',
        fontWeight: 800,
        fontSize: isSmall ? '0.65rem' : '0.75rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        border: `var(--border-medium) solid ${isNearConfirm ? 'var(--color-status-wait-near-border)' : 'var(--color-border-default)'}`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'var(--shadow-xs)',
        height: isSmall ? 26 : 32,
        padding: '0 var(--space-2)',
      }}
    >
      {isNearConfirm && (
        <span
          style={{
            width: isSmall ? 5 : 6,
            height: isSmall ? 5 : 6,
            borderRadius: '50%',
            backgroundColor: 'var(--color-status-wait-near-dot)',
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
}
