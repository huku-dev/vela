import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import type {
  TradeProposal,
  Position,
  UserPreferences,
  UserWallet,
  CircuitBreakerEvent,
  TradingMode,
} from '../types';

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
  /** Refresh all trading data */
  refresh: () => Promise<void>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Polling interval for position updates (30 seconds) */
const POLL_INTERVAL_MS = 30_000;

// ── Hook ──────────────────────────────────────────────

export function useTrading(): TradingState {
  const { isAuthenticated, supabaseClient, user, getToken } = useAuthContext();

  const [proposals, setProposals] = useState<TradeProposal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
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
            .in('status', ['pending', 'approved', 'auto_approved', 'executing', 'executed'])
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
          supabaseClient.from('user_wallets').select('*').eq('environment', 'testnet').limit(1),
          supabaseClient
            .from('circuit_breaker_events')
            .select('*')
            .eq('resolved', false)
            .order('created_at', { ascending: false }),
        ]);

      setProposals(proposalsRes.data ?? []);
      setPositions(openPosRes.data ?? []);
      setClosedPositions(closedPosRes.data ?? []);
      setPreferences(prefsRes.data ?? null);
      setWallet(walletRes.data?.[0] ?? null);
      setCircuitBreakers(cbRes.data ?? []);
      setError(null);
    } catch (err) {
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
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
    // Intentionally stable deps — only re-subscribe when auth state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseClient, isAuthenticated, user?.privyDid]);

  // ── Accept proposal (authenticated POST to trade-webhook) ──
  const acceptProposal = useCallback(
    async (proposalId: string) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ proposal_id: proposalId, action: 'accept' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to accept proposal');
      }

      // Refetch server state instead of optimistic update
      await fetchTradingData();
    },
    [getToken, fetchTradingData]
  );

  // ── Decline proposal (authenticated POST to trade-webhook) ──
  const declineProposal = useCallback(
    async (proposalId: string) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ proposal_id: proposalId, action: 'decline' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to decline proposal');
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

      if (upsertErr) throw new Error(upsertErr.message);

      setPreferences(data);
    },
    [supabaseClient, user?.privyDid]
  );

  // ── Enable trading ──
  const enableTrading = useCallback(
    async (mode: TradingMode) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      // 1. Update mode in preferences
      await updatePreferences({ mode } as Partial<UserPreferences>);

      // 2. Provision wallet if needed (authenticated call)
      if (!wallet?.agent_registered) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-wallet`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to provision wallet');
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
    hasWallet: wallet?.agent_registered === true,
    acceptProposal,
    declineProposal,
    updatePreferences,
    enableTrading,
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
