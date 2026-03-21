import { useState, useEffect, useCallback, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { useAuthContext } from '../contexts/AuthContext';
import { track, AnalyticsEvent } from '../lib/analytics';
import type {
  TradeProposal,
  Position,
  UserPreferences,
  UserWallet,
  CircuitBreakerEvent,
  TradingMode,
} from '../types';

/** Wraps getToken with a timeout so it never hangs forever on mobile */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      val => {
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ── Types ──────────────────────────────────────────────

export interface TradingState {
  /** All trade proposals for the user */
  proposals: TradeProposal[];
  /** Open positions */
  positions: Position[];
  /** Closed positions (most recent) */
  closedPositions: Position[];
  /** User trading preferences */
  preferences: UserPreferences | null;
  /** User wallet info */
  wallet: UserWallet | null;
  /** Unresolved circuit breaker events */
  circuitBreakers: CircuitBreakerEvent[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether the user has trading enabled (mode is not view_only) */
  isTradingEnabled: boolean;
  /** Whether the user has a registered wallet */
  hasWallet: boolean;
  /** Accept a pending trade proposal */
  acceptProposal: (proposalId: string) => Promise<void>;
  /** Decline a pending trade proposal */
  declineProposal: (proposalId: string) => Promise<void>;
  /** Update trading preferences */
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  /** Enable trading (provisions wallet + sets mode) */
  enableTrading: (mode: TradingMode) => Promise<void>;
  /** Generate a Telegram deep link for one-tap bot connection */
  generateTelegramLink: () => Promise<string>;
  /** Refresh all trading data */
  refresh: () => Promise<void>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

/** Polling interval for position updates (30 seconds) */
const POLL_INTERVAL_MS = 30_000;

// ── Wallet cache ──
// Prevents "$0.00 balance" flash on Account page by seeding wallet state
// from the last known value. Background fetch still runs to keep it fresh.
const WALLET_CACHE_KEY = 'vela_wallet_cache';

function getCachedWallet(): UserWallet | null {
  try {
    const raw = localStorage.getItem(WALLET_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserWallet;
  } catch {
    return null;
  }
}

function cacheWallet(w: UserWallet | null): void {
  try {
    if (w) {
      localStorage.setItem(WALLET_CACHE_KEY, JSON.stringify(w));
    } else {
      localStorage.removeItem(WALLET_CACHE_KEY);
    }
  } catch {
    // noop
  }
}

export function clearWalletCache(): void {
  try {
    localStorage.removeItem(WALLET_CACHE_KEY);
  } catch {
    // noop
  }
}

/** Mock wallet for dev bypass so the Deposit/Withdraw UI is testable */
const DEV_MOCK_WALLET: UserWallet = {
  id: 'dev-wallet',
  user_id: 'dev-bypass-user',
  master_wallet_id: 'dev-mw',
  master_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  agent_wallet_id: 'dev-aw',
  agent_address: '0xAgentDevAddr',
  agent_registered: true,
  balance_usdc: 250.0,
  balance_last_synced_at: new Date().toISOString(),
  trial_trade_used: false,
  environment: 'mainnet' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Mock open positions for dev bypass — lets us visually QA position-aware features */
const DEV_MOCK_POSITIONS: Position[] = DEV_BYPASS
  ? [
      {
        id: 'dev-pos-1',
        user_id: 'dev-bypass-user',
        asset_id: 'btc',
        trade_execution_id: null,
        side: 'long' as const,
        entry_price: 71200,
        current_price: 74650,
        size: 0.0014,
        size_usd: 100,
        leverage: 1,
        unrealized_pnl: 0, // intentionally 0 to test fallback calc
        unrealized_pnl_pct: 0,
        stop_loss_price: 68500,
        take_profit_price: null,
        status: 'open' as const,
        closed_at: null,
        total_pnl: null,
        closed_pnl_pct: null,
        close_reason: null,
        trim_history: [],
        total_exchange_fees: null,
        total_builder_fees: null,
        total_vela_fees: null,
        cumulative_funding: null,
        original_size_usd: 100,
        created_at: '2026-03-10T14:00:00Z',
        updated_at: '2026-03-16T20:00:00Z',
      },
      {
        id: 'dev-pos-2',
        user_id: 'dev-bypass-user',
        asset_id: 'eth',
        trade_execution_id: null,
        side: 'long' as const,
        entry_price: 2280,
        current_price: 2346,
        size: 0.044,
        size_usd: 100,
        leverage: 1,
        unrealized_pnl: 2.89,
        unrealized_pnl_pct: 2.89,
        stop_loss_price: 2180,
        take_profit_price: null,
        status: 'open' as const,
        closed_at: null,
        total_pnl: null,
        closed_pnl_pct: null,
        close_reason: null,
        trim_history: [],
        total_exchange_fees: null,
        total_builder_fees: null,
        total_vela_fees: null,
        cumulative_funding: null,
        original_size_usd: 100,
        created_at: '2026-03-12T10:00:00Z',
        updated_at: '2026-03-16T20:00:00Z',
      },
    ]
  : [];

/** Mock closed positions for dev bypass */
const DEV_MOCK_CLOSED_POSITIONS: Position[] = DEV_BYPASS
  ? [
      {
        id: 'dev-closed-1',
        user_id: 'dev-bypass-user',
        asset_id: 'hype',
        trade_execution_id: null,
        side: 'long' as const,
        entry_price: 38.5,
        current_price: 40.77,
        size: 2.6,
        size_usd: 100,
        leverage: 1,
        unrealized_pnl: 0,
        unrealized_pnl_pct: 0,
        stop_loss_price: 36.0,
        take_profit_price: null,
        status: 'closed' as const,
        closed_at: '2026-03-15T18:00:00Z',
        total_pnl: 5.9,
        closed_pnl_pct: 5.9,
        close_reason: 'HYPE hit take-profit target after strong momentum',
        trim_history: [],
        total_exchange_fees: 0.12,
        total_builder_fees: 0.05,
        total_vela_fees: 0.5,
        cumulative_funding: -0.03,
        original_size_usd: 100,
        created_at: '2026-03-08T12:00:00Z',
        updated_at: '2026-03-15T18:00:00Z',
      },
    ]
  : [];

// ── Hook ──────────────────────────────────────────────

export function useTrading(): TradingState {
  const { isAuthenticated, supabaseClient, user, getToken } = useAuthContext();

  const [proposals, setProposals] = useState<TradeProposal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(getCachedWallet);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard against concurrent fetches (from polling + Realtime firing simultaneously)
  const fetchInFlightRef = useRef(false);

  // ── Fetch all trading data ──
  const fetchTradingData = useCallback(async () => {
    if (!supabaseClient || !isAuthenticated) {
      setLoading(false);
      return;
    }

    // Prevent concurrent fetches — if one is in flight, skip
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    try {
      const [proposalsRes, openPosRes, closedPosRes, prefsRes, walletRes, cbRes] =
        await Promise.all([
          supabaseClient
            .from('trade_proposals')
            .select('*')
            .in('status', [
              'pending',
              'approved',
              'auto_approved',
              'executing',
              'executed',
              'failed',
              'declined',
            ])
            .order('created_at', { ascending: false })
            .limit(20),
          supabaseClient
            .from('positions')
            .select('*')
            .eq('status', 'open')
            .order('created_at', { ascending: false }),
          supabaseClient
            .from('positions')
            .select('*')
            .eq('status', 'closed')
            .order('closed_at', { ascending: false })
            .limit(20),
          supabaseClient.from('user_preferences').select('*').single(),
          supabaseClient
            .from('user_wallets')
            .select('*')
            .eq('environment', import.meta.env.VITE_WALLET_ENVIRONMENT || 'mainnet')
            .limit(1),
          supabaseClient
            .from('circuit_breaker_events')
            .select('*')
            .eq('resolved', false)
            .order('created_at', { ascending: false }),
        ]);

      setProposals(proposalsRes.data ?? []);
      const openPositions = openPosRes.data ?? [];
      setPositions(openPositions.length > 0 ? openPositions : DEV_MOCK_POSITIONS);
      const closedPos = closedPosRes.data ?? [];
      setClosedPositions(closedPos.length > 0 ? closedPos : DEV_MOCK_CLOSED_POSITIONS);
      setPreferences(
        prefsRes.data ?? (DEV_BYPASS ? ({ mode: 'semi_auto' } as unknown as UserPreferences) : null)
      );
      const fetchedWallet = walletRes.data?.[0] ?? (DEV_BYPASS ? DEV_MOCK_WALLET : null);
      setWallet(fetchedWallet);
      cacheWallet(fetchedWallet);
      setCircuitBreakers(cbRes.data ?? []);
      setError(null);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { flow: 'trading-data' },
        extra: { step: 'fetchTradingData' },
      });
      console.error('[useTrading] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trading data');
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
    }
  }, [supabaseClient, isAuthenticated]);

  // Initial fetch + polling (every 30s for position updates)
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    fetchTradingData();
    intervalRef.current = setInterval(fetchTradingData, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isAuthenticated, fetchTradingData]);

  // ── Set up Supabase Realtime for live position updates ──
  useEffect(() => {
    if (!supabaseClient || !isAuthenticated || !user?.privyDid) return;

    const channel = supabaseClient
      .channel('trading-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'positions',
          filter: `user_id=eq.${user.privyDid}`,
        },
        () => {
          // Re-fetch on any position change (debounced by fetchInFlightRef)
          fetchTradingData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trade_proposals',
          filter: `user_id=eq.${user.privyDid}`,
        },
        () => {
          fetchTradingData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_wallets',
          filter: `user_id=eq.${user.privyDid}`,
        },
        () => {
          // Balance update from position-monitor (every 2 min) or refresh-balance
          fetchTradingData();
        }
      )
      .subscribe((status, err) => {
        if (err) {
          Sentry.captureException(err, {
            tags: { flow: 'realtime' },
            extra: { channel: 'trading-updates', status },
          });
          console.error('[useTrading] Realtime error:', status, err);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          Sentry.captureMessage(`Realtime subscription ${status}`, {
            level: 'warning',
            tags: { flow: 'realtime' },
          });
        }
      });

    return () => {
      channel.unsubscribe();
    };
    // Intentionally stable deps — only re-subscribe when auth state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseClient, isAuthenticated, user?.privyDid]);

  // ── Accept proposal (authenticated POST to trade-webhook) ──
  const acceptProposal = useCallback(
    async (proposalId: string) => {
      track(AnalyticsEvent.PROPOSAL_ACCEPTED, { proposal_id: proposalId });
      Sentry.addBreadcrumb({
        category: 'trade',
        message: `accept started: ${proposalId}`,
        level: 'info',
      });

      let token: string | null;
      try {
        token = await withTimeout(getToken(), 10_000, 'Authentication');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authentication failed';
        Sentry.captureMessage(`Trade accept auth failure: ${msg}`, {
          level: 'error',
          extra: { proposalId },
        });
        throw new Error(msg);
      }
      if (!token) {
        Sentry.captureMessage('Trade accept: getToken returned null', {
          level: 'error',
          extra: { proposalId },
        });
        throw new Error('Not authenticated. Please log in again.');
      }

      Sentry.addBreadcrumb({
        category: 'trade',
        message: 'token acquired, sending to webhook',
        level: 'info',
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ proposal_id: proposalId, action: 'accept' }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errMsg = data.error || `Trade failed (${res.status})`;
          Sentry.captureMessage(`Trade accept webhook error: ${errMsg}`, {
            level: 'error',
            extra: { proposalId, status: res.status },
          });
          throw new Error(errMsg);
        }

        Sentry.addBreadcrumb({
          category: 'trade',
          message: `accept succeeded: ${proposalId}`,
          level: 'info',
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          Sentry.captureMessage('Trade accept timed out (30s)', {
            level: 'error',
            extra: { proposalId },
          });
          throw new Error('Trade request timed out. Check Your Trades to see if it went through.');
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      // Refetch server state instead of optimistic update
      await fetchTradingData();
    },
    [getToken, fetchTradingData]
  );

  // ── Decline proposal (authenticated POST to trade-webhook) ──
  const declineProposal = useCallback(
    async (proposalId: string) => {
      track(AnalyticsEvent.PROPOSAL_DECLINED, { proposal_id: proposalId });
      let token: string | null;
      try {
        token = await withTimeout(getToken(), 10_000, 'Authentication');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authentication failed';
        Sentry.captureMessage(`Trade decline auth failure: ${msg}`, {
          level: 'error',
          extra: { proposalId },
        });
        throw new Error(msg);
      }
      if (!token) {
        Sentry.captureMessage('Trade decline: getToken returned null', {
          level: 'error',
          extra: { proposalId },
        });
        throw new Error('Not authenticated. Please log in again.');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ proposal_id: proposalId, action: 'decline' }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errMsg = data.error || 'Failed to decline proposal';
          Sentry.captureMessage(`Trade decline webhook error: ${errMsg}`, {
            level: 'error',
            extra: { proposalId, status: res.status },
          });
          throw new Error(errMsg);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          Sentry.captureMessage('Trade decline timed out (15s)', {
            level: 'warning',
            extra: { proposalId },
          });
          throw new Error('Request timed out. Please try again.');
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      await fetchTradingData();
    },
    [getToken, fetchTradingData]
  );

  // ── Update preferences (upsert — creates row on first use) ──
  const updatePreferences = useCallback(
    async (updates: Partial<UserPreferences>) => {
      if (!supabaseClient || !user?.privyDid) throw new Error('Not authenticated');

      const { data, error: upsertErr } = await supabaseClient
        .from('user_preferences')
        .upsert({ user_id: user.privyDid, ...updates }, { onConflict: 'user_id' })
        .select()
        .single();

      if (upsertErr) {
        // DB trigger returns a descriptive error for tier violations
        if (upsertErr.message?.includes('not available on the')) {
          console.warn('[useTrading] Mode rejected by tier:', upsertErr.message);
          throw new Error('This trading mode requires a paid plan. Upgrade to unlock.');
        }
        throw new Error(upsertErr.message);
      }

      setPreferences(data);
    },
    [supabaseClient, user?.privyDid]
  );

  // ── Generate Telegram deep link for one-tap connection ──
  const generateTelegramLink = useCallback(async (): Promise<string> => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error ?? 'Failed to generate Telegram link');
    }

    const { deepLink } = await resp.json();
    return deepLink as string;
  }, [getToken]);

  // ── Enable trading ──
  const enableTrading = useCallback(
    async (mode: TradingMode) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      // 1. Update mode in preferences
      await updatePreferences({ mode } as Partial<UserPreferences>);

      // 2. Provision wallet if needed (authenticated call)
      if (!wallet?.agent_registered) {
        Sentry.addBreadcrumb({
          category: 'wallet',
          message: 'Provisioning wallet',
          level: 'info',
        });

        const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-wallet`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errMsg = data.error || 'Failed to provision wallet';
          Sentry.captureMessage(`Wallet provisioning failed: ${errMsg}`, {
            level: 'error',
            extra: { status: res.status },
          });
          throw new Error(errMsg);
        }
      }

      await fetchTradingData();
    },
    [getToken, wallet?.agent_registered, updatePreferences, fetchTradingData]
  );

  return {
    proposals,
    positions,
    closedPositions,
    preferences,
    wallet,
    circuitBreakers,
    loading,
    error,
    isTradingEnabled: preferences?.mode !== 'view_only' && preferences?.mode != null,
    hasWallet: !!wallet?.master_address,
    acceptProposal,
    declineProposal,
    updatePreferences,
    enableTrading,
    generateTelegramLink,
    refresh: fetchTradingData,
  };
}

/**
 * Get pending proposals for a specific asset.
 * Useful in AssetDetail to show the proposal card.
 */
export function usePendingProposals(assetId: string | undefined) {
  const { proposals } = useTrading();

  if (!assetId) return [];

  return proposals.filter(p => p.asset_id === assetId && p.status === 'pending');
}
