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

// ── Hook ──────────────────────────────────────────────

export function useTrading(): TradingState {
  const { isAuthenticated, supabaseClient, user } = useAuthContext();

  const [proposals, setProposals] = useState<TradeProposal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch all trading data ──
  const fetchTradingData = useCallback(async () => {
    if (!supabaseClient || !isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      const [proposalsRes, openPosRes, closedPosRes, prefsRes, walletRes, cbRes] =
        await Promise.all([
          supabaseClient
            .from('trade_proposals')
            .select('*')
            .in('status', ['pending', 'approved', 'auto_approved', 'executed'])
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
          supabaseClient
            .from('user_preferences')
            .select('*')
            .single(),
          supabaseClient
            .from('user_wallets')
            .select('*')
            .eq('environment', 'testnet')
            .limit(1),
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
    }
  }, [supabaseClient, isAuthenticated]);

  // Initial fetch + polling (every 30s for position updates)
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    fetchTradingData();
    intervalRef.current = setInterval(fetchTradingData, 30_000);

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
          // Re-fetch on any position change
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
  }, [supabaseClient, isAuthenticated, user?.privyDid, fetchTradingData]);

  // ── Accept proposal ──
  const acceptProposal = useCallback(
    async (proposalId: string) => {
      if (!supabaseClient) throw new Error('Not authenticated');

      // Call the trade-webhook endpoint as the frontend source
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend&proposal_id=${proposalId}&action=accept`,
        { method: 'GET' }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to accept proposal');
      }

      // Optimistic update
      setProposals(prev =>
        prev.map(p => (p.id === proposalId ? { ...p, status: 'approved' as const } : p))
      );

      // Refetch to get actual state
      setTimeout(fetchTradingData, 1000);
    },
    [supabaseClient, fetchTradingData]
  );

  // ── Decline proposal ──
  const declineProposal = useCallback(
    async (proposalId: string) => {
      if (!supabaseClient) throw new Error('Not authenticated');

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/trade-webhook?source=frontend&proposal_id=${proposalId}&action=decline`,
        { method: 'GET' }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to decline proposal');
      }

      // Optimistic update
      setProposals(prev =>
        prev.map(p => (p.id === proposalId ? { ...p, status: 'declined' as const } : p))
      );

      setTimeout(fetchTradingData, 1000);
    },
    [supabaseClient, fetchTradingData]
  );

  // ── Update preferences ──
  const updatePreferences = useCallback(
    async (updates: Partial<UserPreferences>) => {
      if (!supabaseClient) throw new Error('Not authenticated');

      const { error: updateErr } = await supabaseClient
        .from('user_preferences')
        .update(updates)
        .eq('user_id', user?.privyDid);

      if (updateErr) throw new Error(updateErr.message);

      setPreferences(prev => (prev ? { ...prev, ...updates } : null));
    },
    [supabaseClient, user?.privyDid]
  );

  // ── Enable trading ──
  const enableTrading = useCallback(
    async (mode: TradingMode) => {
      if (!supabaseClient) throw new Error('Not authenticated');

      // 1. Update mode in preferences
      await updatePreferences({ mode } as Partial<UserPreferences>);

      // 2. Provision wallet if needed (calls Edge Function)
      if (!wallet?.agent_registered) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to provision wallet');
        }
      }

      await fetchTradingData();
    },
    [supabaseClient, wallet?.agent_registered, updatePreferences, fetchTradingData]
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

  return proposals.filter(
    p => p.asset_id === assetId && p.status === 'pending'
  );
}
