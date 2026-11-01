// src/components/admin/AdminSections.test.tsx
//
// Behavioural tests for the admin dashboard's AssetScoreboardSection, scoped
// to the delisted-row treatment added 2026-11-01 (backend PR #385 shipped the
// `enabled: boolean` field; this frontend change picks it up).
//
// Core truthiness rule under test: a row renders as DELISTED only when
// `enabled === false`. `undefined` (pre-#385 cached response, in-flight
// rollout gap) and `true` both render as ACTIVE. A loose `!r.enabled`
// check would wrongly mark EVERY row as delisted during the rollout gap;
// this file is the mechanical defense against that regression.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AssetScoreboardSection } from './AdminSections';
import type { AssetScoreboardRow } from '../../lib/adminDashboardClient';

function makeRow(symbol: string, overrides: Partial<AssetScoreboardRow> = {}): AssetScoreboardRow {
  return {
    symbol,
    closes: 5,
    wins: 3,
    winPct: 60,
    volume: 500,
    netPnl: 10,
    avgHoldHours: 12,
    series: [
      { date: '2026-10-01', cumPnl: 0 },
      { date: '2026-10-15', cumPnl: 5 },
      { date: '2026-10-30', cumPnl: 10 },
    ],
    ...overrides,
  };
}

function rowBySymbol(symbol: string): HTMLTableRowElement {
  // Each row's first cell contains <strong>{symbol}</strong>. Find that strong
  // tag, then walk up to the <tr>. getByText('EXACT') is too noisy if symbols
  // share substrings, so we match exactly inside a <strong>.
  const strong = screen.getByText(symbol, { selector: 'strong' });
  const tr = strong.closest('tr');
  if (!tr) throw new Error(`No <tr> found for symbol ${symbol}`);
  return tr as HTMLTableRowElement;
}

describe('AssetScoreboardSection, delisted treatment', () => {
  it('renders the delisted badge AND adds ad-row-delisted class when enabled === false', () => {
    const rows: AssetScoreboardRow[] = [
      makeRow('HOOD', { enabled: false }),
      makeRow('BTC', { enabled: true }),
    ];
    render(<AssetScoreboardSection rows={rows} />);

    const hoodRow = rowBySymbol('HOOD');
    expect(hoodRow).toHaveClass('ad-row-delisted');
    // The badge is scoped INSIDE the HOOD row, not the BTC row.
    expect(within(hoodRow).getByText('delisted')).toBeInTheDocument();

    const btcRow = rowBySymbol('BTC');
    expect(btcRow).not.toHaveClass('ad-row-delisted');
    expect(within(btcRow).queryByText('delisted')).toBeNull();
  });

  it('renders as ACTIVE when enabled is undefined (rollout gap safety)', () => {
    // THIS test is the mechanical guard against a `!r.enabled` regression.
    // During the backend→frontend rollout gap, a cached response may lack
    // the field entirely, so those rows must stay active, not flip to delisted.
    const rows: AssetScoreboardRow[] = [makeRow('BTC')]; // no `enabled` key
    render(<AssetScoreboardSection rows={rows} />);

    const btcRow = rowBySymbol('BTC');
    expect(btcRow).not.toHaveClass('ad-row-delisted');
    expect(within(btcRow).queryByText('delisted')).toBeNull();
  });

  it('renders as ACTIVE when enabled === true', () => {
    const rows: AssetScoreboardRow[] = [makeRow('BTC', { enabled: true })];
    render(<AssetScoreboardSection rows={rows} />);

    const btcRow = rowBySymbol('BTC');
    expect(btcRow).not.toHaveClass('ad-row-delisted');
    expect(within(btcRow).queryByText('delisted')).toBeNull();
  });

  it('does not break row density (every data column still renders) for a delisted row', () => {
    const rows: AssetScoreboardRow[] = [
      makeRow('HOOD', {
        enabled: false,
        closes: 8,
        wins: 8,
        winPct: 100,
        volume: 268,
        netPnl: 1.53,
        avgHoldHours: 27.3,
      }),
    ];
    render(<AssetScoreboardSection rows={rows} />);

    const hoodRow = rowBySymbol('HOOD');
    // 8 <td>s total: Symbol, Closes, Win%, Volume, Net PnL (BarCell),
    // Net %, Avg hold, Cumulative sparkline. A missing cell would collapse
    // the row and visually desync it from active rows.
    expect(hoodRow.querySelectorAll('td')).toHaveLength(8);
    expect(within(hoodRow).getByText('8')).toBeInTheDocument();
    expect(within(hoodRow).getByText('100%')).toBeInTheDocument();
    expect(within(hoodRow).getByText('$268')).toBeInTheDocument();
    expect(within(hoodRow).getByText('27.3h')).toBeInTheDocument();
  });

  it('separates the symbol from the badge with whitespace (screen reader + copy/paste)', () => {
    // Guard against a regression that removes the inter-element space and
    // produces `DELLdelisted` when a user copies the cell or a screen reader
    // reads it as one word.
    const rows: AssetScoreboardRow[] = [makeRow('DELL', { enabled: false })];
    render(<AssetScoreboardSection rows={rows} />);

    const dellRow = rowBySymbol('DELL');
    const firstCellText = (dellRow.querySelector('td')?.textContent ?? '').trim();
    expect(firstCellText).toBe('DELL delisted');
  });

  it('coexists with the worst-drag highlight class on a single row', () => {
    // A delisted row can also be the largest drag. Both classes should apply.
    const rows: AssetScoreboardRow[] = [
      makeRow('HOOD', { enabled: false, netPnl: -500 }), // worst
      makeRow('BTC', { enabled: true, netPnl: 10 }),
    ];
    render(<AssetScoreboardSection rows={rows} />);

    const hoodRow = rowBySymbol('HOOD');
    expect(hoodRow).toHaveClass('ad-row-highlight');
    expect(hoodRow).toHaveClass('ad-row-delisted');
  });
});
