import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TradeProposal, UserPreferences } from '../types';

const NOW = new Date('2026-04-29T12:00:00Z').getTime();

const mockUseTrading = vi.fn();
vi.mock('./useTrading', () => ({
  useTrading: () => mockUseTrading(),
}));

// Import AFTER mock so the module under test picks up the mocked useTrading
import { formatCountdown, usePendingProposalsCountdown } from './usePendingProposalsCountdown';

function mkProposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    id: 'prop-1',
    user_id: 'u1',
    asset_id: 'aapl',
    signal_id: 's1',
    side: 'long',
    proposed_size_usd: 1000,
    proposed_leverage: 1,
    entry_price_at_proposal: 200,
    status: 'pending',
    approval_source: null,
    approved_at: null,
    expires_at: new Date(NOW + 2 * 60 * 60_000).toISOString(),
    proposal_type: 'open',
    trim_pct: null,
    parent_position_id: null,
    position_type: 'main',
    use_spot: false,
    error_message: null,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function setTradingMock(opts: {
  proposals?: TradeProposal[];
  mode?: UserPreferences['mode'] | null;
}) {
  const preferences =
    opts.mode === undefined
      ? ({ mode: 'semi_auto' } as UserPreferences)
      : opts.mode === null
        ? null
        : ({ mode: opts.mode } as UserPreferences);

  mockUseTrading.mockReturnValue({
    proposals: opts.proposals ?? [],
    preferences,
  });
}

describe('formatCountdown', () => {
  it('formats > 60m as Xh YYm with zero-padded minutes', () => {
    expect(formatCountdown(2 * 60 * 60_000 + 41 * 60_000)).toBe('2h 41m');
    expect(formatCountdown(2 * 60 * 60_000 + 4 * 60_000)).toBe('2h 04m');
  });

  it('formats 11–60m as Mm', () => {
    expect(formatCountdown(47 * 60_000)).toBe('47m');
    expect(formatCountdown(59 * 60_000 + 30_000)).toBe('59m');
  });

  it('formats <= 10m with seconds, zero-padded', () => {
    expect(formatCountdown(10 * 60_000)).toBe('10m 00s');
    expect(formatCountdown(9 * 60_000 + 12_000)).toBe('9m 12s');
    expect(formatCountdown(5_000)).toBe('0m 05s');
  });

  it('returns "expired" for non-positive ms', () => {
    expect(formatCountdown(0)).toBe('expired');
    expect(formatCountdown(-1)).toBe('expired');
  });
});

describe('usePendingProposalsCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockUseTrading.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when preferences not loaded yet', () => {
    setTradingMock({ proposals: [mkProposal()], mode: null });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toBeNull();
  });

  it('returns null when no pending proposals', () => {
    setTradingMock({ proposals: [] });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toBeNull();
  });

  it('returns null for full_auto users (proposals auto-execute)', () => {
    setTradingMock({ proposals: [mkProposal()], mode: 'full_auto' });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toBeNull();
  });

  it('view_only: neutral urgency, no countdown', () => {
    setTradingMock({ proposals: [mkProposal()], mode: 'view_only' });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toEqual({
      count: 1,
      label: '1 signal pending review',
      countdownText: null,
      urgency: 'neutral',
    });
  });

  it('view_only with multiple proposals pluralises correctly', () => {
    setTradingMock({
      proposals: [mkProposal(), mkProposal({ id: 'p2' })],
      mode: 'view_only',
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.label).toBe('2 signals pending review');
  });

  it('semi_auto, single proposal, T > 60m: normal urgency, asset and direction in label', () => {
    setTradingMock({
      proposals: [
        mkProposal({
          asset_id: 'aapl',
          side: 'long',
          expires_at: new Date(NOW + 2 * 60 * 60_000 + 41 * 60_000).toISOString(),
        }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toEqual({
      count: 1,
      label: 'AAPL · LONG pending',
      countdownText: '2h 41m',
      urgency: 'normal',
    });
  });

  it('short proposals show SHORT (uppercase) in the label (bidirectional)', () => {
    setTradingMock({
      proposals: [
        mkProposal({
          asset_id: 'gold',
          side: 'short',
          expires_at: new Date(NOW + 90 * 60_000).toISOString(),
        }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.label).toBe('GOLD · SHORT pending');
  });

  it('semi_auto, T <= 60m: urgent', () => {
    setTradingMock({
      proposals: [mkProposal({ expires_at: new Date(NOW + 47 * 60_000).toISOString() })],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.urgency).toBe('urgent');
    expect(result.current?.countdownText).toBe('47m');
  });

  it('semi_auto, T <= 10m: critical, sec-by-sec countdown', () => {
    setTradingMock({
      proposals: [mkProposal({ expires_at: new Date(NOW + 9 * 60_000 + 12_000).toISOString() })],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.urgency).toBe('critical');
    expect(result.current?.countdownText).toBe('9m 12s');
  });

  it('multi-proposal label uses count, countdown targets soonest', () => {
    setTradingMock({
      proposals: [
        mkProposal({ id: 'a', expires_at: new Date(NOW + 2 * 60 * 60_000).toISOString() }),
        mkProposal({ id: 'b', expires_at: new Date(NOW + 64 * 60_000).toISOString() }),
        mkProposal({ id: 'c', expires_at: new Date(NOW + 30 * 60_000).toISOString() }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.count).toBe(3);
    expect(result.current?.label).toBe('3 trades pending');
    expect(result.current?.urgency).toBe('urgent');
    expect(result.current?.countdownText).toBe('30m');
  });

  it('ignores non-pending proposals (executed, expired, declined, etc.)', () => {
    setTradingMock({
      proposals: [
        mkProposal({ id: 'a', status: 'executed' }),
        mkProposal({ id: 'b', status: 'expired' }),
        mkProposal({ id: 'c', status: 'pending' }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.count).toBe(1);
  });

  it('filters proposals whose expires_at has passed even if status still says "pending"', () => {
    // Race window between expires_at passing and the realtime update
    // arriving from Supabase. Banner must NOT render an "expired" countdown
    // or stay stuck on the stale proposal.
    setTradingMock({
      proposals: [
        mkProposal({
          id: 'stale',
          status: 'pending',
          expires_at: new Date(NOW - 30_000).toISOString(), // expired 30s ago
        }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current).toBeNull();
  });

  it('multi-proposal: when soonest expires mid-flight, falls through to next', () => {
    setTradingMock({
      proposals: [
        mkProposal({
          id: 'expired',
          status: 'pending',
          expires_at: new Date(NOW - 5_000).toISOString(),
        }),
        mkProposal({
          id: 'next',
          asset_id: 'aapl',
          side: 'long',
          status: 'pending',
          expires_at: new Date(NOW + 45 * 60_000).toISOString(),
        }),
      ],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    // Stale proposal filtered out → count reflects only still-actionable
    expect(result.current?.count).toBe(1);
    expect(result.current?.label).toBe('AAPL · LONG pending');
    expect(result.current?.urgency).toBe('urgent');
    expect(result.current?.countdownText).toBe('45m');
  });

  it('boundary: T = 10m exactly is critical', () => {
    setTradingMock({
      proposals: [mkProposal({ expires_at: new Date(NOW + 10 * 60_000).toISOString() })],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.urgency).toBe('critical');
  });

  it('boundary: T = 60m exactly is urgent', () => {
    setTradingMock({
      proposals: [mkProposal({ expires_at: new Date(NOW + 60 * 60_000).toISOString() })],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.urgency).toBe('urgent');
  });

  it('boundary: T just over 60m is normal', () => {
    setTradingMock({
      proposals: [mkProposal({ expires_at: new Date(NOW + 60 * 60_000 + 5_000).toISOString() })],
    });
    const { result } = renderHook(() => usePendingProposalsCountdown());
    expect(result.current?.urgency).toBe('normal');
  });
});
