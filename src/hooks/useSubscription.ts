import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import type { UserSubscription, SubscriptionTier } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export interface SubscriptionState {
  subscription: UserSubscription | null;
  tier: SubscriptionTier;
  isLoading: boolean;
  error: string | null;
  /** True when the subscription is active and on a paid tier */
  isPaid: boolean;
  /** True when the subscription will cancel at period end */
  cancelAtPeriodEnd: boolean;
  /** Redirect to the provider's hosted checkout for a tier upgrade */
  startCheckout: (
    tier: 'standard' | 'premium',
    billingCycle: 'monthly' | 'annual'
  ) => Promise<void>;
  /** Redirect to the provider's customer portal for subscription management */
  openPortal: () => Promise<void>;
  /** Refresh subscription data from the database */
  refresh: () => Promise<void>;
}

export function useSubscription(): SubscriptionState {
  const { isAuthenticated, supabaseClient, getToken } = useAuthContext();

  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!isAuthenticated || !supabaseClient) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: dbErr } = await supabaseClient
        .from('user_subscriptions')
        .select('*')
        .single();

      if (dbErr) {
        setError('Could not load subscription');
        return;
      }

      setSubscription(data as UserSubscription);
    } catch (err) {
      console.error('[useSubscription] Fetch error:', err);
      setError('Could not load subscription');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, supabaseClient]);

  // Initial fetch
  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // Re-fetch on window focus — catches changes made in the customer portal
  useEffect(() => {
    const handleFocus = () => {
      fetchSubscription();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchSubscription]);

  // Re-fetch when returning from a successful checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      // Give the webhook a moment to process before we poll
      const timer = setTimeout(() => fetchSubscription(), 1500);
      return () => clearTimeout(timer);
    }
  }, [fetchSubscription]);

  const startCheckout = useCallback(
    async (tier: 'standard' | 'premium', billingCycle: 'monthly' | 'annual') => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier, billing_cycle: billingCycle }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to start checkout');
      }

      const { url } = await res.json();
      window.location.href = url;
    },
    [getToken]
  );

  const openPortal = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-portal-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to open portal');
    }

    const { url } = await res.json();
    window.location.href = url;
  }, [getToken]);

  const tier: SubscriptionTier = subscription?.tier ?? 'free';
  const isPaid = tier !== 'free' && subscription?.status === 'active';
  const cancelAtPeriodEnd = subscription?.cancel_at_period_end ?? false;

  return {
    subscription,
    tier,
    isLoading,
    error,
    isPaid,
    cancelAtPeriodEnd,
    startCheckout,
    openPortal,
    refresh: fetchSubscription,
  };
}
