// SignalBadge — clean component with no design token violations.
// Used as a false-positive test case for the vela-frontend-qa eval.

import React from 'react';
import { VelaButton } from '../../../src/components/VelaComponents';
import type { SignalType } from '../../../src/types';

interface SignalBadgeProps {
  signal: SignalType;
  onDismiss: () => void;
}

export const SignalBadge: React.FC<SignalBadgeProps> = ({ signal, onDismiss }) => {
  const signalColor =
    signal.direction === 'BUY'
      ? 'var(--color-signal-buy)'
      : signal.direction === 'SELL'
      ? 'var(--color-signal-sell)'
      : 'var(--color-signal-wait)';

  return (
    <article
      aria-label={`${signal.direction} signal for ${signal.asset}`}
      style={{
        backgroundColor: 'var(--color-surface-card)',
        borderLeft: `4px solid ${signalColor}`,
        padding: 'var(--spacing-md)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <span
        style={{
          color: signalColor,
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--font-weight-bold)',
        }}
      >
        {signal.direction}
      </span>

      <p
        style={{
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-base)',
          margin: 'var(--spacing-xs) 0 0',
        }}
      >
        {signal.asset}
      </p>

      <VelaButton
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label={`Dismiss ${signal.asset} signal`}
        style={{ marginTop: 'var(--spacing-sm)' }}
      >
        Dismiss
      </VelaButton>
    </article>
  );
};
