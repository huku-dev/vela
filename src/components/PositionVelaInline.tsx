// src/components/PositionVelaInline.tsx
//
// State-aware inline action row for the position card on the asset detail
// page. Sits below the entry+leverage row in BOTH collapsed and expanded
// position-card states.
//
// Visibility rules (locked, see docs/product-briefs/asset-detail-v2.md):
//   - Up >= 2% from entry         -> profit target row
//   - Up < 2% from entry          -> hidden
//   - Down with stop > 2% away    -> hidden (avoids implying inevitable loss)
//   - Down with stop <= 2% away   -> protective management row
//
// Voice rules (locked):
//   - "Vela is still managing your position." (NOT "Vela closes at...")
//   - "Vela trims part of the position..." for profit target
//   - No em dashes; periods, commas, colons only

import React from 'react';

interface PositionVelaInlineProps {
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number | null | undefined;
  pnlPct: number;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
}

const PROFIT_TRIGGER_PCT = 2;
const STOP_DISTANCE_TRIGGER_PCT = 2;

export default function PositionVelaInline({
  side,
  entryPrice,
  pnlPct,
  currentPrice,
  stopLossPrice,
  takeProfitPrice,
}: PositionVelaInlineProps) {
  const state = resolveState({
    side,
    entryPrice,
    pnlPct,
    currentPrice: currentPrice ?? null,
    stopLossPrice: stopLossPrice ?? null,
    takeProfitPrice: takeProfitPrice ?? null,
  });

  if (!state) return null;

  // Diamond color cues the user to the kind of state: green for the
  // profit-target row (Vela harvesting gains), amber for protective
  // management (stop is near). The same green-diamond-on-loss treatment
  // would visually conflict with the BUY signal palette.
  const dotColor = state.kind === 'profit'
    ? 'var(--color-signal-buy)'
    : 'var(--color-signal-wait)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--gray-200)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          background: dotColor,
          border: '1px solid var(--color-border-default)',
          transform: 'rotate(45deg)',
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ fontWeight: 700 }}>{state.subject}</strong>{' '}
        <span style={{ color: 'var(--color-text-secondary)' }}>{state.description}</span>
      </span>
    </div>
  );
}

interface ResolvedState {
  kind: 'profit' | 'protective';
  subject: string;
  description: string;
}

function resolveState({
  side,
  entryPrice,
  pnlPct,
  currentPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  side: 'long' | 'short';
  entryPrice: number;
  pnlPct: number;
  currentPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
}): ResolvedState | null {
  // Profit target case: price has moved >= 2% in the position's favor
  // AND we have an explicit target. Per spec ("at least 2% above entry")
  // the threshold is in PRICE terms, not P&L. Using pnlPct would let
  // leverage trip the trigger on smaller real moves.
  if (currentPrice != null && currentPrice > 0 && entryPrice > 0) {
    const favorablePct = side === 'long'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    if (favorablePct >= PROFIT_TRIGGER_PCT && takeProfitPrice && takeProfitPrice > 0) {
      return {
        kind: 'profit',
        subject: `Profit target ${formatPrice(takeProfitPrice)}.`,
        description:
          'Vela trims part of the position to lock in profit. The rest stays open if the move continues.',
      };
    }
  }

  // Protective management case: position down (P&L pct negative) AND
  // stop is within 2% of current price. For a long the stop sits BELOW
  // current price; for a short it sits ABOVE. Both directions render the
  // same shape, with the preposition adapted to the side.
  if (
    pnlPct < 0 &&
    currentPrice != null &&
    currentPrice > 0 &&
    stopLossPrice != null &&
    stopLossPrice > 0
  ) {
    const stopDistancePct = Math.abs(currentPrice - stopLossPrice) / currentPrice * 100;
    if (stopDistancePct <= STOP_DISTANCE_TRIGGER_PCT) {
      const aboveOrBelow = stopLossPrice > currentPrice ? 'above' : 'below';
      return {
        kind: 'protective',
        subject: 'Vela is still managing your position.',
        description: `Will close at ${formatPrice(stopLossPrice)} to cut losses, ${stopDistancePct.toFixed(1)}% ${aboveOrBelow} current price.`,
      };
    }
  }

  return null;
}

function formatPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}
