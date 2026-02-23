import type { SignalColor } from '../types';

const colorMap: Record<SignalColor, { bg: string; text: string; label: string }> = {
  green: { bg: 'var(--color-status-buy-bg)', text: 'var(--color-status-buy-text)', label: 'BUY' },
  red: { bg: 'var(--color-status-sell-bg)', text: 'var(--color-status-sell-text)', label: 'EXIT' },
  grey: { bg: 'var(--color-status-wait-bg)', text: 'var(--color-status-wait-text)', label: 'WAIT' },
};

interface SignalChipProps {
  color: SignalColor;
  size?: 'small' | 'medium';
}

export default function SignalChip({ color, size = 'medium' }: SignalChipProps) {
  const { bg, text, label } = colorMap[color];
  const isSmall = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        color: text,
        fontFamily: 'var(--type-label-sm-font)',
        fontWeight: 800,
        fontSize: isSmall ? '0.65rem' : '0.75rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        border: 'var(--border-medium) solid var(--color-border-default)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'var(--shadow-xs)',
        height: isSmall ? 26 : 32,
        padding: '0 var(--space-2)',
      }}
    >
      {label}
    </span>
  );
}
