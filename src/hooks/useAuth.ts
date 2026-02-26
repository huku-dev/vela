import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase, createAuthenticatedClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const EXCHANGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-exchange`;

// ── Dev bypass: skip Privy auth for local QA testing ──
// Set VITE_DEV_BYPASS_AUTH=true in .env.local to enable.
// Uses the public Supabase client (reads signals/briefs/assets).
// Trading actions won't work (no real JWT), but UI QA is fully functional.
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

if (DEV_BYPASS && typeof window !== 'undefined') {
  localStorage.setItem('vela_onboarded', 'true');
  console.info('[useAuth] DEV BYPASS active — using mock auth state');
}

interface AuthUser {
  privyDid: string;
  profileId?: string;
  email?: string;
  walletAddress?: string;
  deactivatedAt?: string;
  deletionScheduledAt?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  supabaseClient: SupabaseClient | null;
  /** Get a valid Supabase JWT (cached, auto-refreshes). Use for edge function calls. */
  getToken: () => Promise<string | null>;
  login: () => void;
  logout: () => Promise<void>;
}

/**
 * Manages Privy auth + Supabase token exchange.
 *
 * Flow: Privy login → get Privy access token → POST to auth-exchange
 * → receive Supabase JWT → create authenticated Supabase client.
 *
 * The exchanged token is cached client-side (1h TTL, 5-min buffer).
 */
export function useAuth(): AuthState {
  const { ready, authenticated, login, logout, getAccessToken, user: privyUser } = usePrivy();
  const [user, setUser] = useState<AuthUser | null>(null);
  const tokenCacheRef = useRef<{ token: string; expiresAt: number } | null>(null);

  // Exchange Privy token for Supabase token
  const exchangeToken = useCallback(async (): Promise<string | null> => {
    // Return cached token if still valid (with 5-min buffer)
    if (tokenCacheRef.current && tokenCacheRef.current.expiresAt > Date.now() + 300_000) {
      return tokenCacheRef.current.token;
    }

    const privyToken = await getAccessToken();
    if (!privyToken) return null;

    try {
      const res = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${privyToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        console.error('[useAuth] Token exchange failed:', res.status);
        return null;
      }

      const data = await res.json();

      tokenCacheRef.current = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      setUser({
        privyDid: data.user.privy_did,
        profileId: data.user.profile_id,
        email: privyUser?.email?.address ?? undefined,
        deactivatedAt: data.user.deactivated_at ?? undefined,
        deletionScheduledAt: data.user.deletion_scheduled_at ?? undefined,
      });

      return data.access_token;
    } catch (err) {
      console.error('[useAuth] Token exchange error:', err);
      return null;
    }
  }, [getAccessToken, privyUser?.email?.address]);

  // Trigger token exchange when user authenticates
  useEffect(() => {
    if (DEV_BYPASS) return;
    if (ready && authenticated) {
      exchangeToken();
    }
  }, [ready, authenticated, exchangeToken]);

  // Sync wallet address reactively (Privy creates embedded wallets async after login)
  useEffect(() => {
    if (DEV_BYPASS) return;
    if (authenticated && privyUser?.wallet?.address) {
      setUser(prev => (prev ? { ...prev, walletAddress: privyUser.wallet?.address } : null));
    }
  }, [authenticated, privyUser?.wallet?.address]);

  // Create authenticated Supabase client (memoized while authenticated)
  const supabaseClient = useMemo(() => {
    if (!authenticated) return null;
    return createAuthenticatedClient(exchangeToken);
  }, [authenticated, exchangeToken]);

  // Wrap logout to clear onboarding flag — user sees onboarding screens, not dashboard
  const handleLogout = useCallback(async () => {
    localStorage.removeItem('vela_onboarded');
    tokenCacheRef.current = null;
    setUser(null);
    await logout();
  }, [logout]);

  // Dev bypass: return mock auth state using public Supabase client
  if (DEV_BYPASS) {
    return {
      isAuthenticated: true,
      isLoading: false,
      user: { privyDid: 'dev-bypass-user', email: 'dev@vela.local' },
      supabaseClient: supabase,
      getToken: async () => null,
      login: () => {},
      logout: async () => {},
    };
  }

  return {
    isAuthenticated: ready && authenticated,
    isLoading: !ready,
    user,
    supabaseClient,
    getToken: exchangeToken,
    login,
    logout: handleLogout,
  };
}
