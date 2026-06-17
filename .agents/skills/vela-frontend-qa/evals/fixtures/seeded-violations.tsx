// TradeCard component with 4 intentionally seeded violations.
// Used as a test fixture for the vela-frontend-qa eval.
// DO NOT use in production.
//
// Seeded violations:
// 1. [Hardcoded color] backgroundColor: '#0FE68C' — must use var(--color-signal-buy)
// 2. [Signal color misuse] --color-signal-buy applied to a "Confirmed" badge (not a BUY signal)
// 3. [Raw MUI] <Button> instead of <VelaButton> from VelaComponents
// 4. [Missing ARIA] <button> with no aria-label, only visual icon text

import React from 'react';
import { Button } from '@mui/material';
import type { SignalType } from '../../../src/types';

interface TradeCardProps {
  signal: SignalType;
  onConfirm: () => void;
  onDismiss: () => void;
}

export const TradeCard: React.FC<TradeCardProps> = ({ signal, onConfirm, onDismiss }) => {
  return (
    // VIOLATION 1: hardcoded hex color
    <div
      style={{
        backgroundColor: '#0FE68C',
        padding: '16px',
        borderRadius: '8px',
      }}
    >
      <h3 style={{ color: 'var(--color-text-primary)', margin: 0 }}>
        {signal.asset}
      </h3>

      {/* VIOLATION 2: signal green used for a generic "Confirmed" badge, not a BUY signal */}
      <span style={{ color: 'var(--color-signal-buy)', fontWeight: 'bold' }}>
        Confirmed
      </span>

      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        {signal.summary}
      </p>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        {/* VIOLATION 3: raw MUI Button instead of VelaButton */}
        <Button onClick={onConfirm} variant="contained" color="primary">
          Execute Trade
        </Button>

        {/* VIOLATION 4: no aria-label on this dismiss button */}
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    </div>
  );
};
