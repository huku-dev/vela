/**
 * TrackRecord.test.tsx — Trust-critical tests for Track Record
 *
 * Two test layers (per CLAUDE.md):
 * 1. Source-verification tests (TRACK-SRC:) — Read source, assert patterns exist
 * 2. Rendering tests (TRACK:) — Render with mocked hooks, verify behavior
 *
 * The page now shows a single "Your trades" zone backed by the user's real positions.
 * The collapsible "Vela's track record" zone (with paperStats and BestTradeCard)
 * was removed pending the home-page redesign because the underlying aggregation
 * was misleading (mixed BB2/EMA position sizes, unweighted percentage mean).
 *
 * Trust-critical areas tested:
 * - P&L color mapping: green = positive, red = negative (NEVER reversed)
 * - Profit/loss terminology: always says "profit"/"loss", never bare dollars
 * - Win rate denominator: positions, not arbitrary
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
// ═══════════════════════════════════════════════════════════════════

describe('TRACK-SRC: Source-verification — P&L colors', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('TRUST CRITICAL: stats row uses green-dark for positive P&L', () => {
    expect(src).toContain("filteredStats.totalPnl >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'");
  });

  it('TRUST CRITICAL: position cards say "profit" or "loss" alongside dollar values', () => {
    expect(src).toContain("'profit' : 'loss'");
  });
});

describe('TRACK-SRC: Source-verification — page structure', () => {
  const src = readFileSync(resolve(__dirname, './TrackRecord.tsx'), 'utf-8');

  it('page has "Your trades" label', () => {
    expect(src).toContain('Your trades');
  });

  it('does NOT render the removed "Vela\'s track record" zone', () => {
    expect(src).not.toContain('Vela&rsquo;s track record');
    expect(src).not.toContain('paperStats');
    expect(src).not.toContain('BestTradeCard');
    expect(src).not.toContain('showVelaHistory');
  });

});

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: Rendering Tests (TRACK:)
// ═══════════════════════════════════════════════════════════════════

describe('TRACK: Your Trades zone (live trades)', () => {
  it('TRUST CRITICAL: shows "+$" prefix for positive total P&L in user stats', () => {
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
    expect(screen.getByText(/\+\$300/)).toBeInTheDocument();
  });

  it('TRUST CRITICAL: shows negative P&L with "-$" prefix in user stats', () => {
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
    expect(screen.getByText(/-\$300/)).toBeInTheDocument();
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
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('shows "Start trading" upgrade prompt for free users with no trades', () => {
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

    render(<TrackRecord />);
    expect(screen.getByText(/approve your first trade/i)).toBeInTheDocument();
  });
});

describe('TRACK: Page header', () => {
  it('shows page title', () => {
    render(<TrackRecord />);
    expect(screen.getByText('Trades')).toBeInTheDocument();
  });
});

describe('TRACK: Loading state', () => {
  it('shows loading spinner when data is loading', () => {
    mockUseTrackRecord.mockReturnValue({
      ...defaultHookReturn,
      loading: true,
    });

    render(<TrackRecord />);
    expect(screen.queryByText('Trades')).not.toBeInTheDocument();
  });
});
