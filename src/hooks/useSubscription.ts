import { useState, useEffect, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { useAuthContext } from '../contexts/AuthContext';
import { track, AnalyticsEvent } from '../lib/analytics';
import type { UserSubscription, SubscriptionTier } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

// ── Subscription cache ──
// Prevents the "free tier flash" on page navigation by seeding initial state
// from the last known subscription. The background fetch still runs to keep it
// fresh, but the UI renders the correct tier immediately.
const CACHE_KEY = 'vela_subscription_cache';

function getCachedSubscription(): UserSubscription | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSubscription;
  } catch {
    return null;
  }
}

function cacheSubscription(sub: UserSubscription | null): void {
  try {
    if (sub) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(sub));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // localStorage may be unavailable — silently ignore
  }
}

export function clearSubscriptionCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // noop
  }
}

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

  // Seed from cache so the first render uses the last known tier (no flash)
  const [subscription, setSubscription] = useState<UserSubscription | null>(getCachedSubscription);
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

      const sub = data as UserSubscription;
      setSubscription(sub);
      cacheSubscription(sub);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { flow: 'subscription' },
        extra: { step: 'fetchSubscription' },
      });
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
      track(AnalyticsEvent.CHECKOUT_COMPLETED);
      // Meta Pixel: Subscribe conversion
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Subscribe');
      }
      // Give the webhook a moment to process before we poll
      const timer = setTimeout(() => fetchSubscription(), 1500);
      return () => clearTimeout(timer);
    }
  }, [fetchSubscription]);

  const startCheckout = useCallback(
    async (tier: 'standard' | 'premium', billingCycle: 'monthly' | 'annual') => {
      track(AnalyticsEvent.CHECKOUT_STARTED, { tier, billing_cycle: billingCycle });
      // Meta Pixel: InitiateCheckout
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'InitiateCheckout');
      }
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
        const errMsg = body.error ?? 'Failed to start checkout';
        Sentry.captureMessage(`Checkout session failed: ${errMsg}`, {
          level: 'error',
          tags: { flow: 'subscription' },
          extra: { tier, billingCycle, status: res.status },
        });
        throw new Error(errMsg);
      }

      const { url } = await res.json();
      window.location.href = url;
    },
    [getToken]
  );

  const openPortal = useCallback(async () => {
    track(AnalyticsEvent.PORTAL_OPENED);
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
      const errMsg = body.error ?? 'Failed to open portal';
      Sentry.captureMessage(`Portal session failed: ${errMsg}`, {
        level: 'error',
        tags: { flow: 'subscription' },
        extra: { status: res.status },
      });
      throw new Error(errMsg);
    }

    const { url } = await res.json();
    window.location.href = url;
  }, [getToken]);

  // Dev bypass: allow overriding tier via localStorage for QA testing.
  // Set via: localStorage.setItem('vela_dev_tier', 'standard') or 'premium'
  // Or use the tier toggle on the Account page.
  const devTierOverride =
    DEV_BYPASS && typeof window !== 'undefined'
      ? (localStorage.getItem('vela_dev_tier') as SubscriptionTier | null)
      : null;

  const tier: SubscriptionTier = devTierOverride ?? subscription?.tier ?? 'free';
  const isPaid = tier !== 'free' && (devTierOverride ? true : subscription?.status === 'active');
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
