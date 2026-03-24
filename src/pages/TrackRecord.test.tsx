/**
 * TrackRecord.test.tsx — Trust-critical tests for Track Record
 *
 * Two test layers (per CLAUDE.md):
 * 1. Source-verification tests (TRACK-SRC:) — Read source, assert patterns exist
 * 2. Rendering tests (TRACK:) — Render with mocked hooks, verify behavior
 *
 * The page is split into two zones:
 * - Zone 1 "Your trades" (live trades + positions) — always visible
 * - Zone 2 "Vela's track record" (curated metrics + best trade) — collapsible, hidden by default
 *
 * Trust-critical areas tested:
 * - P&L color mapping: green = positive, red = negative (NEVER reversed)
 * - Profit/loss terminology: always says "profit"/"loss", never bare dollars
 * - Signal headline rendering: entry headline visible, exit headline on expand
 * - BestTradeCard: correct selection, rendering, color-border direction
 * - bestTrade computation: highest total position P&L among closed positions
 * - Curated metrics: hardcoded marketing metrics render correctly
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
    opened_at: '2026-01-15T00:00:00Z',
    closed_at: '2026-01-29T00:00:00Z',
    asset_symbol: 'BTC',
    asset_coingecko_id: 'bitcoin',
    ...overrides,
  };
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

/** Make a closed Position (from positions table, used by stats card) */
function makeClosedPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    user_id: 'user-1',
    asset_id: 'bitcoin',
    side: 'long',
    entry_price: 42000,
    current_price: 46200,
    size: 1,
    size_usd: 1000,
    leverage: 1,
    unrealized_pnl: 0,
    unrealized_pnl_pct: 0,
    stop_loss_price: null,
    take_profit_price: null,
    status: 'closed',
    closed_at: '2025-12-15T00:00:00Z',
    total_pnl: 100,
    closed_pnl_pct: 10,
    close_reason: null,
    trade_execution_id: null,
    trim_history: [],
    total_exchange_fees: null,
    total_builder_fees: null,
    total_vela_fees: null,
    cumulative_funding: null,
    original_size_usd: 1000,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2025-12-15T00:00:00Z',
    ...overrides,
  };
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
  mockUseTrading.mockReturnValue({
    positions: [] as Position[],
    closedPositions: [] as Position[],
    proposals: [],
    acceptProposal: vi.fn(),
    declineProposal: vi.fn(),
    wallet: null,
  });
  mockUseAuthContext.mockReturnValue({ isAuthenticated: false });
  mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn });
  mockUseTierAccess.mockReturnValue({
    tier: 'free',
    canTrade: false,
    upgradeLabel: (action: string) => `Upgrade your plan to ${action}`,
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

  it('TRUST CRITICAL: BestTradeCard uses green-dark for positive, red-dark for negative', () => {
    expect(src).toContain("isPositive ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: narrative stats use green-dark for positive P&L', () => {
    // Real position stats use totalPnl for color
    expect(src).toContain("realPositionStats.totalPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: dollar P&L always says "profit" or "loss", never bare dollars', () => {
    // In BestTradeCard
    expect(src).toContain("{dollarPnl >= 0 ? 'profit' : 'loss'}");
    // In real position stats
    expect(src).toContain("totalPnl >= 0 ? 'profit' : 'loss'");
  });
});

describe('TRACK-SRC: Source-verification — track record data', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('BestTradeCard shows star label', () => {
    expect(src).toContain('Best trade');
    expect(src).toContain('&#9733;'); // star character
  });
});

describe('TRACK-SRC: Source-verification — two-zone layout', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('page has "Your trades" zone label', () => {
    expect(src).toContain('Your trades');
  });

  it('page has "Vela\'s track record" zone label', () => {
    expect(src).toContain('Vela&rsquo;s track record');
  });

  it('track record section contains "not real money" disclaimer', () => {
    expect(src).toContain('not real money');
  });

  it('track record section uses live paperStats for metrics', () => {
    expect(src).toContain('paperStats.winRate');
    expect(src).toContain('paperStats.totalClosed');
    expect(src).toContain('paperStats.avgPnlPct');
    expect(src).toContain('avgHoldingPeriod');
  });

  it('BestTradeCard in track record only renders when paperStats.totalClosed >= 3', () => {
    expect(src).toContain('bestPaperGroup && bestPaperPnl && paperStats.totalClosed >= 3');
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
    // Stats card now uses real positions (from useTrading), not paper_trades
    mockUseTrading.mockReturnValue({
      positions: [],
      closedPositions: [
        makeClosedPosition({ id: 'p1', total_pnl: 200, closed_pnl_pct: 20 }),
        makeClosedPosition({ id: 'p2', total_pnl: 150, closed_pnl_pct: 15 }),
        makeClosedPosition({ id: 'p3', total_pnl: -50, closed_pnl_pct: -5 }),
      ],
      proposals: [],
      acceptProposal: vi.fn(),
      declineProposal: vi.fn(),
      wallet: null,
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
    mockUseTrading.mockReturnValue({
      positions: [],
      closedPositions: [
        makeClosedPosition({ id: 'p1', total_pnl: -200, closed_pnl_pct: -20 }),
        makeClosedPosition({ id: 'p2', total_pnl: -150, closed_pnl_pct: -15 }),
        makeClosedPosition({ id: 'p3', total_pnl: 50, closed_pnl_pct: 5 }),
      ],
      proposals: [],
      acceptProposal: vi.fn(),
      declineProposal: vi.fn(),
      wallet: null,
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
    mockUseTrading.mockReturnValue({
      positions: [],
      closedPositions: [
        makeClosedPosition({ id: 'p1', total_pnl: 200, closed_pnl_pct: 20 }),
        makeClosedPosition({ id: 'p2', total_pnl: -50, closed_pnl_pct: -5 }),
        makeClosedPosition({ id: 'p3', total_pnl: 100, closed_pnl_pct: 10 }),
      ],
      proposals: [],
      acceptProposal: vi.fn(),
      declineProposal: vi.fn(),
      wallet: null,
    });
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

    render(<TrackRecord />);
    expect(screen.getByText(/3 position/)).toBeInTheDocument();
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

describe('TRACK: Zone 2 — Vela Track Record (curated metrics)', () => {
  it('live metrics are visible after expanding track record', async () => {
    const user = userEvent.setup();
    // Provide 3 closed backtest trades so paperStats computes meaningful values
    const trades = [
      makeTrade({ id: '1', pnl_pct: 10.0 }),
      makeTrade({ id: '2', pnl_pct: 5.0 }),
      makeTrade({ id: '3', pnl_pct: -3.0 }),
    ];
    mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn, trades });

    render(<TrackRecord />);

    // Metrics should NOT be visible yet (collapsed)
    expect(screen.queryByText('Win rate')).not.toBeInTheDocument();

    // Expand "Vela's track record"
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    // Now live-computed metrics should be visible
    expect(screen.getByText('Win rate')).toBeInTheDocument();
    expect(screen.getByText('Total positions')).toBeInTheDocument();
    expect(screen.getByText('Avg return per trade')).toBeInTheDocument();
    expect(screen.getByText('Avg holding period')).toBeInTheDocument();
    // Values are computed from mock trades: 2 wins / 3 total = 66.7% win rate
    expect(screen.getByText('66.7%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows disclaimer about backtested performance when expanded', async () => {
    const user = userEvent.setup();
    mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    expect(screen.getByText(/not real money/i)).toBeInTheDocument();
    expect(screen.getByText(/Past performance does not guarantee/i)).toBeInTheDocument();
  });

  it('shows win rate preview in collapsed header', () => {
    mockUseTrackRecord.mockReturnValue({ ...defaultHookReturn });

    render(<TrackRecord />);

    // Win rate teaser visible even when collapsed (computed from paper trades)
    expect(screen.getByText(/\d+% win rate/)).toBeInTheDocument();
  });
});

describe('TRACK: BestTradeCard rendering', () => {
  it('renders BestTradeCard in Vela track record when >= 3 closed paper trades', async () => {
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

    // Expand Vela track record
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    expect(screen.getByText('Best trade')).toBeInTheDocument();
  });

  it('does NOT render BestTradeCard with fewer than 3 closed paper trades', async () => {
    const user = userEvent.setup();
    const trades = [makeTrade({ id: '1', pnl_pct: 52.5 }), makeTrade({ id: '2', pnl_pct: 10.0 })];
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades,
      bestTrade: trades[0],
    });

    render(<TrackRecord />);
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    expect(screen.queryByText('Best trade')).not.toBeInTheDocument();
  });

  it('TRUST CRITICAL: BestTradeCard shows profit/loss labels, not bare dollars', async () => {
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
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    // BestTradeCard renders inside a mint-variant card
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
    const expandBtn = screen.getByText(/Vela.s track record/i);
    await user.click(expandBtn);

    // Headline appears in BestTradeCard
    const mintCard = document.querySelector('.vela-card-mint') as HTMLElement;
    expect(
      within(mintCard!).getByText(/Short-term trend crossed above medium-term/)
    ).toBeInTheDocument();
  });
});

// NOTE: Paper trade card tests (ClosedTradeCard/OpenTradeCard) removed —
// paper trade sections are no longer shown to users. Real positions use
// LivePositionCard and ClosedPositionCard from the positions table.

describe('TRACK: Page header', () => {
  it('shows updated header text', () => {
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      trades: [],
    });

    render(<TrackRecord />);
    expect(screen.getByText('Trades')).toBeInTheDocument();
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
    expect(screen.queryByText('Trades')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: BB2 (Quick Opportunity) Tests
// BB2 trades are standalone positions with $300 sizing
// ═══════════════════════════════════════════════════════════════════

describe('TRACK-SRC: BB2 source verification', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('TRUST CRITICAL: bb2_short maps to "Short" in directionLabel', () => {
    expect(src).toContain("d === 'short' || d === 'bb_short' || d === 'bb2_short'");
  });

  it('TRUST CRITICAL: BB2 position size is 30% of standard', () => {
    expect(src).toContain('BB2_POSITION_MULT = 0.3');
    expect(src).toContain('BB2_POSITION_SIZE = DEFAULT_POSITION_SIZE * BB2_POSITION_MULT');
  });

  it('FastTradeBadge component exists for BB2 trades', () => {
    expect(src).toContain('FastTradeBadge');
    expect(src).toContain('Fast trade');
  });

  it('never shows "BB2" text to users in JSX string literals', () => {
    // BB2 should only appear in variable names, type checks, and comments — never in
    // user-facing JSX string content (quoted strings rendered to the DOM).
    // Check that no JSX string literal like "BB2" or 'BB2' appears in rendered text:
    const jsxStringPattern = /['"]BB2['"]/;
    expect(jsxStringPattern.test(src)).toBe(false);
  });

  it('BB2 position size is commented as $300', () => {
    expect(src).toContain('// $300');
  });
});

// NOTE: BB2 rendering tests removed — Zone 2 no longer renders individual paper trade cards.
// BB2 source verification tests above still validate the constants and direction mapping.
