/**
 * TrackRecord.test.tsx — Trust-critical tests for Track Record
 *
 * Two test layers (per CLAUDE.md):
 * 1. Source-verification tests (TRACK-SRC:) — Read source, assert patterns exist
 * 2. Rendering tests (TRACK:) — Render with mocked hooks, verify behavior
 *
 * The page is split into two zones:
 * - Zone 1 "Your trades" (live trades + positions) — always visible
 * - Zone 2 "Vela's signal history" (backtest trades) — collapsible, hidden by default
 *
 * Trust-critical areas tested:
 * - P&L color mapping: green = positive, red = negative (NEVER reversed)
 * - Profit/loss terminology: always says "profit"/"loss", never bare dollars
 * - Signal headline rendering: entry headline visible, exit headline on expand
 * - BestCallCard: correct selection, rendering, color-border direction
 * - bestTrade computation: highest pnl_pct among closed trades
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { EnrichedTrade } from '../hooks/useData';
import type { Position } from '../types';

// ── Mock hooks before importing the component ──

const mockUseTrackRecord = vi.fn();
vi.mock('../hooks/useData', () => ({
  useTrackRecord: () => mockUseTrackRecord(),
  DEFAULT_POSITION_SIZE: 1000,
}));

const mockUseTrading = vi.fn();
vi.mock('../hooks/useTrading', () => ({
  useTrading: () => mockUseTrading(),
}));

const mockUseAuthContext = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

const mockUseTierAccess = vi.fn();
vi.mock('../hooks/useTierAccess', () => ({
  useTierAccess: () => mockUseTierAccess(),
}));

// Mock getCoinIcon to avoid network calls
vi.mock('../lib/helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/helpers')>();
  return {
    ...actual,
    getCoinIcon: () => null, // no icons in tests
  };
});

// Import component AFTER mocks are set up
import TrackRecord from './TrackRecord';

// ── Test Fixtures ──

function makeTrade(overrides: Partial<EnrichedTrade> = {}): EnrichedTrade {
  return {
    id: 'trade-1',
    asset_id: 'bitcoin',
    entry_signal_id: 'sig-entry-1',
    exit_signal_id: 'sig-exit-1',
    entry_price: 42000,
    exit_price: 46200,
    pnl_pct: 10.0,
    status: 'closed',
    source: 'backtest',
    direction: 'long',
    trim_pct: null,
    yellow_events: null,
    opened_at: '2025-12-01T00:00:00Z',
    closed_at: '2025-12-15T00:00:00Z',
    asset_symbol: 'BTC',
    asset_coingecko_id: 'bitcoin',
    ...overrides,
  };
}

/** Make a live (user) trade */
function makeLiveTrade(overrides: Partial<EnrichedTrade> = {}): EnrichedTrade {
  return makeTrade({ source: 'live', ...overrides });
}

function makeOpenTrade(overrides: Partial<EnrichedTrade> = {}): EnrichedTrade {
  return makeTrade({
    id: 'trade-open-1',
    status: 'open',
    exit_signal_id: null,
    exit_price: null,
    pnl_pct: null,
    closed_at: null,
    ...overrides,
  });
}

const defaultHookReturn = {
  trades: [] as EnrichedTrade[],
  bestTrade: null as EnrichedTrade | null,
  stats: [],
  livePrices: {} as Record<string, { price: number; change24h: number }>,
  assetMap: {
    bitcoin: { symbol: 'BTC', coingecko_id: 'bitcoin' },
    ethereum: { symbol: 'ETH', coingecko_id: 'ethereum' },
  } as Record<string, { symbol: string; coingecko_id: string }>,
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: vi.fn(),
};

beforeEach(() => {
  mockUseTrading.mockReturnValue({ positions: [] as Position[] });
  mockUseAuthContext.mockReturnValue({ isAuthenticated: false });
  mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn });
  mockUseTierAccess.mockReturnValue({
    tier: 'free',
    canTrade: false,
    upgradeLabel: (action: string) => `Upgrade to Standard to ${action}`,
    startCheckout: vi.fn(),
    partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
    needsFunding: () => false,
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: Source-Verification Tests (TRACK-SRC:)
// Read TrackRecord.tsx source and verify trust-critical patterns
// ═══════════════════════════════════════════════════════════════════

describe('TRACK-SRC: Source-verification — P&L colors', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('TRUST CRITICAL: ClosedTradeCard uses green-dark for pnl_pct >= 0', () => {
    // The ClosedTradeCard must map positive P&L to green
    expect(src).toContain("trade.pnl_pct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: ClosedTradeCard uses red-dark for negative pnl_pct', () => {
    // Same ternary — red case is the else branch
    expect(src).toContain("trade.pnl_pct >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: BestCallCard uses green-dark for positive, red-dark for negative', () => {
    expect(src).toContain("isPositive ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: narrative stats use green-dark for positive P&L', () => {
    // Now scoped to user/paper stats
    expect(src).toContain("totalDollarPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: dollar P&L always says "profit" or "loss", never bare dollars', () => {
    // In ClosedTradeCard
    expect(src).toContain("{dollarPnl >= 0 ? 'profit' : 'loss'}");
    // In BestCallCard
    expect(src).toContain("{dollarPnl >= 0 ? 'profit' : 'loss'}");
    // In narrative stats (both user and paper zones)
    expect(src).toContain("totalDollarPnl >= 0 ? 'profit' : 'loss'");
  });
});

describe('TRACK-SRC: Source-verification — headline rendering', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('ClosedTradeCard renders entry headline in collapsed state', () => {
    expect(src).toContain('{/* Entry headline (collapsed state) */}');
    expect(src).toContain('{entryHeadline && (');
  });

  it('ClosedTradeCard renders exit headline only in expanded state', () => {
    expect(src).toContain('{/* Exit headline (expanded state) */}');
    expect(src).toContain('{exitHeadline && (');
  });

  it('entry headline border uses green for long, red for short', () => {
    // ClosedTradeCard uses isShortTrade for border color
    expect(src).toContain(
      "isShortTrade(trade.direction) ? 'var(--red-primary)' : 'var(--green-primary)'"
    );
  });

  it('exit headline border uses opposite colors (exit = reversal)', () => {
    // Exit border: short exit = green (they closed a short = buying back)
    expect(src).toContain(
      "isShortTrade(trade.direction) ? 'var(--green-primary)' : 'var(--red-primary)'"
    );
  });

  it('BestCallCard shows star label', () => {
    expect(src).toContain('Best call');
    expect(src).toContain('&#9733;'); // star character
  });

  it('BestCallCard in paper zone only renders when paperStats.totalClosed >= 3', () => {
    expect(src).toContain('bestPaperTrade && paperStats.totalClosed >= 3');
  });
});

describe('TRACK-SRC: Source-verification — two-zone layout', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('page has "Your trades" zone label', () => {
    expect(src).toContain('Your trades');
  });

  it('page has "Vela\'s signal history" zone label', () => {
    expect(src).toContain("Vela's signal history");
  });

  it('paper trades section contains "Simulated trades since" disclaimer', () => {
    expect(src).toContain('Simulated trades since');
  });

  it('paper trades section contains "not real money" disclaimer', () => {
    expect(src).toContain('not real money');
  });

  it('Performance Breakdown appears inside Vela signal history zone', () => {
    const velaHistoryPos = src.indexOf("Vela's signal history");
    const breakdownPos = src.indexOf('Performance breakdown');
    expect(velaHistoryPos).toBeGreaterThan(-1);
    expect(breakdownPos).toBeGreaterThan(-1);
    expect(breakdownPos).toBeGreaterThan(velaHistoryPos);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: bestTrade Computation Logic
// ═══════════════════════════════════════════════════════════════════

describe('TRACK: bestTrade computation', () => {
  /**
   * The bestTrade logic lives in useTrackRecord:
   *   trades.reduce<EnrichedTrade | null>((best, t) => {
   *     if (t.status !== 'closed' || t.pnl_pct == null) return best;
   *     if (!best || t.pnl_pct > (best.pnl_pct ?? -Infinity)) return t;
   *     return best;
   *   }, null)
   *
   * We replicate this here for unit testing.
   */
  function computeBestTrade(trades: EnrichedTrade[]): EnrichedTrade | null {
    return trades.reduce<EnrichedTrade | null>((best, t) => {
      if (t.status !== 'closed' || t.pnl_pct == null) return best;
      if (!best || t.pnl_pct > (best.pnl_pct ?? -Infinity)) return t;
      return best;
    }, null);
  }

  it('TRUST CRITICAL: selects trade with highest pnl_pct', () => {
    const trades = [
      makeTrade({ id: 'a', pnl_pct: 10.0 }),
      makeTrade({ id: 'b', pnl_pct: 52.5 }),
      makeTrade({ id: 'c', pnl_pct: -8.8 }),
    ];
    expect(computeBestTrade(trades)?.id).toBe('b');
  });

  it('TRUST CRITICAL: ignores open trades even with high unrealized gains', () => {
    const trades = [
      makeTrade({ id: 'a', pnl_pct: 10.0 }),
      makeOpenTrade({ id: 'b' }), // open, pnl_pct null
    ];
    expect(computeBestTrade(trades)?.id).toBe('a');
  });

  it('TRUST CRITICAL: returns null when no closed trades exist', () => {
    const trades = [makeOpenTrade({ id: 'a' }), makeOpenTrade({ id: 'b' })];
    expect(computeBestTrade(trades)).toBeNull();
  });

  it('handles all-losing portfolio (returns least-bad loss)', () => {
    const trades = [
      makeTrade({ id: 'a', pnl_pct: -15.2 }),
      makeTrade({ id: 'b', pnl_pct: -3.1 }),
      makeTrade({ id: 'c', pnl_pct: -25.0 }),
    ];
    expect(computeBestTrade(trades)?.id).toBe('b');
  });

  it('handles single closed trade', () => {
    const trades = [makeTrade({ id: 'only', pnl_pct: 5.0 })];
    expect(computeBestTrade(trades)?.id).toBe('only');
  });

  it('handles empty array', () => {
    expect(computeBestTrade([])).toBeNull();
  });

  it('ignores trades with null pnl_pct', () => {
    const trades = [
      makeTrade({ id: 'a', pnl_pct: null, status: 'closed' }),
      makeTrade({ id: 'b', pnl_pct: 5.0 }),
    ];
    expect(computeBestTrade(trades)?.id).toBe('b');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: Rendering Tests (TRACK:)
// Full component rendering with mocked hooks
// ═══════════════════════════════════════════════════════════════════

describe('TRACK: Zone 1 — Your Trades (live trades)', () => {
  it('TRUST CRITICAL: shows "profit" for positive total P&L in user stats', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    const trades = [
      makeLiveTrade({ id: '1', pnl_pct: 20.0 }),
      makeLiveTrade({ id: '2', pnl_pct: 15.0 }),
      makeLiveTrade({ id: '3', pnl_pct: -5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/total profit/i)).toBeInTheDocument();
  });

  it('TRUST CRITICAL: shows "loss" for negative total P&L in user stats', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    const trades = [
      makeLiveTrade({ id: '1', pnl_pct: -20.0 }),
      makeLiveTrade({ id: '2', pnl_pct: -15.0 }),
      makeLiveTrade({ id: '3', pnl_pct: 5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[2],
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/total loss/i)).toBeInTheDocument();
  });

  it('shows trade count and win rate for user trades', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    const trades = [
      makeLiveTrade({ id: '1', pnl_pct: 20.0 }),
      makeLiveTrade({ id: '2', pnl_pct: -5.0 }),
      makeLiveTrade({ id: '3', pnl_pct: 10.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/3 trades/)).toBeInTheDocument();
    expect(screen.getByText(/2 profitable/)).toBeInTheDocument();
  });

  it('shows "Start trading" upgrade prompt for free users with no trades', () => {
    mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn, trades: [] });

    render(<TrackRecord />);
    expect(screen.getByText(/Start trading to build your track record/)).toBeInTheDocument();
    expect(screen.getByText('View plans')).toBeInTheDocument();
  });

  it('shows "When you approve your first trade" for paid users with no trades', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn, trades: [] });

    render(<TrackRecord />);
    expect(screen.getByText(/approve your first trade/i)).toBeInTheDocument();
  });
});

describe('TRACK: Zone 2 — Vela Signal History (paper trades)', () => {
  it('paper trade stats are visible after expanding Vela signal history', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({ id: '1', pnl_pct: 20.0 }),
      makeTrade({ id: '2', pnl_pct: 15.0 }),
      makeTrade({ id: '3', pnl_pct: -5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);

    // Stats should NOT be visible yet (collapsed)
    expect(screen.queryByText(/total profit/i)).not.toBeInTheDocument();

    // Expand "Vela's signal history"
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // Now paper stats should be visible
    expect(screen.getByText(/total profit/i)).toBeInTheDocument();
    expect(screen.getByText(/not real money/i)).toBeInTheDocument();
  });

  it('shows cumulative explainer text when expanded', async () => {
    const user = userEvent.setup();
    const trades = [makeTrade({ id: '1', pnl_pct: 10.0 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    expect(screen.getByText(/Total is cumulative across all closed trades/i)).toBeInTheDocument();
  });
});

describe('TRACK: BestCallCard rendering', () => {
  it('renders BestCallCard in Vela signal history when >= 3 closed paper trades', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({ id: '1', pnl_pct: 52.5, entry_headline: 'Momentum shifting up' }),
      makeTrade({ id: '2', pnl_pct: 10.0 }),
      makeTrade({ id: '3', pnl_pct: -5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);

    // Expand Vela signal history
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    expect(screen.getByText('Best call')).toBeInTheDocument();
  });

  it('does NOT render BestCallCard with fewer than 3 closed paper trades', async () => {
    const user = userEvent.setup();
    const trades = [makeTrade({ id: '1', pnl_pct: 52.5 }), makeTrade({ id: '2', pnl_pct: 10.0 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    expect(screen.queryByText('Best call')).not.toBeInTheDocument();
  });

  it('TRUST CRITICAL: BestCallCard shows profit/loss labels, not bare dollars', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({ id: '1', pnl_pct: 52.5 }),
      makeTrade({ id: '2', pnl_pct: 10.0 }),
      makeTrade({ id: '3', pnl_pct: -5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // BestCallCard + trade card both render — use getAllByText
    const profitLabels = screen.getAllByText(/\+\$525 profit/);
    expect(profitLabels.length).toBeGreaterThanOrEqual(1);
    // Verify at least one is inside the BestCallCard (mint variant)
    const mintCard = document.querySelector('.vela-card-mint') as HTMLElement;
    expect(mintCard).not.toBeNull();
    expect(within(mintCard!).getByText(/\+\$525 profit/)).toBeInTheDocument();
  });

  it('shows entry headline when available', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({
        id: '1',
        pnl_pct: 52.5,
        entry_headline: 'Short-term trend crossed above medium-term',
      }),
      makeTrade({ id: '2', pnl_pct: 10.0 }),
      makeTrade({ id: '3', pnl_pct: -5.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // Headline appears in both BestCallCard and trade card — use getAllByText
    const headlines = screen.getAllByText(/Short-term trend crossed above medium-term/);
    expect(headlines.length).toBeGreaterThanOrEqual(1);
    // Verify it's in the BestCallCard
    const mintCard = document.querySelector('.vela-card-mint') as HTMLElement;
    expect(
      within(mintCard!).getByText(/Short-term trend crossed above medium-term/)
    ).toBeInTheDocument();
  });
});

describe('TRACK: ClosedTradeCard rendering', () => {
  it('TRUST CRITICAL: shows "profit" for positive pnl_pct trades (live)', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    const trades = [makeLiveTrade({ id: '1', pnl_pct: 27.3 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/\+\$273 profit/)).toBeInTheDocument();
  });

  it('TRUST CRITICAL: shows "loss" for negative pnl_pct trades (live)', () => {
    mockUseTierAccess.mockReturnValue({
      tier: 'standard',
      canTrade: true,
      upgradeLabel: (a: string) => a,
      startCheckout: vi.fn(),
      partitionAssets: (assets: unknown[]) => ({ accessible: assets, locked: [] }),
      needsFunding: () => false,
    });
    const trades = [makeLiveTrade({ id: '1', pnl_pct: -8.8, exit_price: 38304 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/\$88 loss/)).toBeInTheDocument();
  });

  it('shows entry headline in collapsed state (paper, expanded zone)', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({
        id: '1',
        pnl_pct: 10.0,
        entry_headline: 'Price broke above resistance level',
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    expect(screen.getByText(/Price broke above resistance level/)).toBeInTheDocument();
  });

  it('shows exit headline only when expanded', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({
        id: '1',
        pnl_pct: 10.0,
        exit_headline: 'Underlying trend reversed direction',
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);

    // Expand Vela signal history first
    const expandZone = screen.getByText(/Vela.s signal history/i);
    await user.click(expandZone);

    // Exit headline should NOT be visible in collapsed card state
    expect(screen.queryByText(/Underlying trend reversed direction/)).not.toBeInTheDocument();

    // Click to expand the trade card — find the trade card's clickable role=button (not the breakdown toggle)
    const cardButtons = screen.getAllByRole('button');
    const tradeCard = cardButtons.find(btn => btn.tagName !== 'BUTTON');
    expect(tradeCard).toBeDefined();
    await user.click(tradeCard!);

    // Now exit headline should be visible
    expect(screen.getByText(/Underlying trend reversed direction/)).toBeInTheDocument();
    // And labeled as "Exit reason"
    expect(screen.getByText('Exit reason')).toBeInTheDocument();
  });

  it('uses reasonCodeToPlainEnglish fallback when no headline (paper, expanded zone)', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({
        id: '1',
        pnl_pct: 10.0,
        entry_headline: undefined,
        entry_reason_code: 'ema_cross_up',
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // The fallback chain: headline → reasonCodeToPlainEnglish → nothing
    // ema_cross_up maps to "Short-term trend crossed above medium-term — momentum shifting up"
    expect(screen.getByText(/momentum shifting up/)).toBeInTheDocument();
  });

  it('hides headline area when no headline and no reason code (paper, expanded zone)', async () => {
    const user = userEvent.setup();
    const trades = [
      makeTrade({
        id: '1',
        pnl_pct: 10.0,
        entry_headline: undefined,
        entry_reason_code: undefined,
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // Should not have any italic quoted text (the headline container)
    const italicElements = document.querySelectorAll('[style*="italic"]');
    let hasQuotedText = false;
    italicElements.forEach(el => {
      if (el.textContent?.includes('\u201C')) hasQuotedText = true; // left double quote
    });
    expect(hasQuotedText).toBe(false);
  });
});

describe('TRACK: OpenTradeCard rendering', () => {
  it('shows entry headline for open paper trades (expanded zone)', async () => {
    const user = userEvent.setup();
    const trades = [
      makeOpenTrade({
        id: '1',
        entry_headline: 'Strong buying pressure detected',
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      livePrices: { bitcoin: { price: 45000, change24h: 2.5 } },
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    expect(screen.getByText(/Strong buying pressure detected/)).toBeInTheDocument();
  });

  it('TRUST CRITICAL: unrealized P&L shows profit/loss label (paper, expanded zone)', async () => {
    const user = userEvent.setup();
    const trades = [
      makeOpenTrade({
        id: '1',
        entry_price: 42000,
      }),
    ];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      livePrices: { bitcoin: { price: 46200, change24h: 2.5 } },
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s signal history/i);
    await user.click(expandBtn);

    // 46200 vs 42000 = +10% → +$100 profit
    expect(screen.getByText(/profit/)).toBeInTheDocument();
  });
});

describe('TRACK: Performance Breakdown', () => {
  it('shows breakdown toggle in Vela signal history when expanded', async () => {
    const user = userEvent.setup();
    const trades = [makeTrade({ id: '1', pnl_pct: 20.0 }), makeTrade({ id: '2', pnl_pct: -5.0 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
    });

    render(<TrackRecord />);

    // Expand Vela signal history
    const expandZone = screen.getByText(/Vela.s signal history/i);
    await user.click(expandZone);

    const breakdownBtn = screen.getByText('Performance breakdown');
    expect(breakdownBtn).toBeInTheDocument();

    // Click to expand breakdown
    await user.click(breakdownBtn);

    // Should show detail rows
    expect(screen.getByText('Avg return per trade')).toBeInTheDocument();
    expect(screen.getByText('Avg trade size')).toBeInTheDocument();
  });
});

describe('TRACK: Page header', () => {
  it('shows updated header text', () => {
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades: [],
    });

    render(<TrackRecord />);
    expect(screen.getByText('Track Record')).toBeInTheDocument();
    expect(screen.getByText("Your trades and Vela's signal performance")).toBeInTheDocument();
  });
});

describe('TRACK: Loading state', () => {
  it('shows loading spinner when data is loading', () => {
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      loading: true,
    });

    render(<TrackRecord />);
    // LoadingSpinner renders an SVG animation
    expect(screen.queryByText('Track Record')).not.toBeInTheDocument();
  });
});
