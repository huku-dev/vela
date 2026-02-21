import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { createAuthenticatedClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const EXCHANGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-exchange`;

interface AuthUser {
  privyDid: string;
  profileId?: string;
  email?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  supabaseClient: SupabaseClient | null;
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
  const { ready, authenticated, login, logout, getAccessToken, user: privyUser } =
    usePrivy();
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
      });

      return data.access_token;
    } catch (err) {
      console.error('[useAuth] Token exchange error:', err);
      return null;
    }
  }, [getAccessToken, privyUser?.email?.address]);

  // Trigger token exchange when user authenticates
  useEffect(() => {
    if (ready && authenticated) {
      exchangeToken();
    }
  }, [ready, authenticated, exchangeToken]);

  // Create authenticated Supabase client (memoized while authenticated)
  const supabaseClient = useMemo(() => {
    if (!authenticated) return null;
    return createAuthenticatedClient(exchangeToken);
  }, [authenticated, exchangeToken]);

  return {
    isAuthenticated: ready && authenticated,
    isLoading: !ready,
    user,
    supabaseClient,
    login,
    logout,
  };
}
