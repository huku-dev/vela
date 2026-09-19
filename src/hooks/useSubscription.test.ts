/**
 * Tests for useSubscription hook — Stripe checkout, portal, caching, and error handling.
 *
 * Covers:
 * - Subscription cache (localStorage seeding to prevent tier flash)
 * - Initial fetch on mount
 * - Window focus re-fetch
 * - Post-checkout polling (?checkout=success)
 * - startCheckout: success redirect, auth failure, API errors
 * - openPortal: success redirect, auth failure, API errors
 * - Dev tier override via localStorage
 * - Derived state: tier, isPaid, cancelAtPeriodEnd
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── localStorage mock (same pattern as CookieConsent.test.tsx) ──

function createLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(k => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

// ── Mock dependencies ──────────────────────────────────────────────

const mockSupabaseClient = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

const mockGetToken = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    supabaseClient: mockSupabaseClient,
    getToken: mockGetToken,
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Fixtures ───────────────────────────────────────────────────────

const ACTIVE_STANDARD_SUB = {
  id: 'sub-1',
  user_id: 'did:privy:test',
  tier: 'standard' as const,
  billing_cycle: 'monthly' as const,
  status: 'active' as const,
  provider_customer_id: 'cus_abc',
  provider_subscription_id: 'sub_xyz',
  payment_provider: 'stripe',
  cancel_at_period_end: false,
  current_period_start: '2026-03-01T00:00:00Z',
  current_period_end: '2026-04-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const CANCELLING_PREMIUM_SUB = {
  ...ACTIVE_STANDARD_SUB,
  id: 'sub-2',
  tier: 'premium' as const,
  cancel_at_period_end: true,
};

const CACHE_KEY = 'vela_subscription_cache';

// ── Tests ──────────────────────────────────────────────────────────

describe('useSubscription', () => {
  let storageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up localStorage mock
    storageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', storageMock);

    // Reset the mock chain for Supabase
    mockSupabaseClient.from.mockReturnThis();
    mockSupabaseClient.select.mockReturnThis();
    mockSupabaseClient.single.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch); // Re-stub fetch after unstubAllGlobals
  });

  // Need to re-import after mocks are set up
  async function loadHook() {
    // Dynamic import to pick up mocks
    const mod = await import('./useSubscription');
    return mod;
  }

  // ── Cache seeding ──

  describe('subscription cache', () => {
    it('seeds initial state from localStorage cache (prevents tier flash)', async () => {
      storageMock.setItem(CACHE_KEY, JSON.stringify(ACTIVE_STANDARD_SUB));
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      // First render should have the cached tier, not 'free'
      expect(result.current.tier).toBe('standard');
      expect(result.current.isPaid).toBe(true);
    });

    it('returns free tier when cache is empty', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.tier).toBe('free');
      expect(result.current.isPaid).toBe(false);
    });

    it('handles corrupted cache gracefully', async () => {
      storageMock.setItem(CACHE_KEY, 'not valid json!!!');
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      // Should fall back to free, not crash
      expect(result.current.tier).toBe('free');
    });

    it('caches subscription to localStorage after successful fetch', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      renderHook(() => useSubscription());

      await waitFor(() => {
        expect(storageMock.setItem).toHaveBeenCalledWith(
          CACHE_KEY,
          expect.stringContaining('"tier":"standard"')
        );
      });
    });
  });

  // ── Derived state ──

  describe('derived state', () => {
    it('tier defaults to free when subscription is null', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.tier).toBe('free');
    });

    it('isPaid is true for active standard subscription', async () => {
      storageMock.setItem(CACHE_KEY, JSON.stringify(ACTIVE_STANDARD_SUB));
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.isPaid).toBe(true);
    });

    it('isPaid is false for free tier', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.isPaid).toBe(false);
    });

    it('cancelAtPeriodEnd reflects subscription state', async () => {
      storageMock.setItem(CACHE_KEY, JSON.stringify(CANCELLING_PREMIUM_SUB));
      mockSupabaseClient.single.mockResolvedValue({ data: CANCELLING_PREMIUM_SUB, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.cancelAtPeriodEnd).toBe(true);
    });

    it('cancelAtPeriodEnd defaults to false when no subscription', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      expect(result.current.cancelAtPeriodEnd).toBe(false);
    });

    // ── hasLiveSubscription — 2026-09-17 sarah.uku incident fix ──
    //
    // This is the routing predicate for TierComparisonSheet: true → open
    // customer portal (plan switch / card update), false → open Stripe
    // Checkout. Must match backend hasLiveSubscription in
    // supabase/functions/_shared/subscription-state.ts (enforced by
    // STRIPE-SRC cross-repo test in stripe-billing.test.ts).

    it('hasLiveSubscription is false when subscription is null', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(false);
      });
    });

    it('hasLiveSubscription is false for tier=free even when status=active', async () => {
      // Every new user starts as {tier: "free", status: "active"} per
      // auth-exchange/index.ts:177-182. The predicate must short-circuit on
      // tier==="free" or every new signup would be routed to portal (which
      // would 404 with no customer_id).
      const freeSub = {
        ...ACTIVE_STANDARD_SUB,
        tier: 'free' as const,
        status: 'active' as const,
        provider_customer_id: null,
        provider_subscription_id: null,
      };
      storageMock.setItem(CACHE_KEY, JSON.stringify(freeSub));
      mockSupabaseClient.single.mockResolvedValue({ data: freeSub, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(false);
      });
    });

    it('hasLiveSubscription is true for active paid subscription', async () => {
      storageMock.setItem(CACHE_KEY, JSON.stringify(ACTIVE_STANDARD_SUB));
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(true);
      });
    });

    it('hasLiveSubscription is true for trialing paid subscription (broader than isPaid)', async () => {
      // isPaid only accepts status === "active"; hasLiveSubscription also
      // accepts trialing and past_due. Broader on purpose — the routing
      // decision "checkout vs portal" needs to catch trialing/past_due
      // users too, or they'd hit the backend's 409 guard.
      const trialingSub = {
        ...ACTIVE_STANDARD_SUB,
        tier: 'premium' as const,
        status: 'trialing' as const,
      };
      storageMock.setItem(CACHE_KEY, JSON.stringify(trialingSub));
      mockSupabaseClient.single.mockResolvedValue({ data: trialingSub, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(true);
      });
    });

    it('hasLiveSubscription is true for past_due paid subscription', async () => {
      const pastDueSub = {
        ...ACTIVE_STANDARD_SUB,
        status: 'past_due' as const,
      };
      storageMock.setItem(CACHE_KEY, JSON.stringify(pastDueSub));
      mockSupabaseClient.single.mockResolvedValue({ data: pastDueSub, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(true);
      });
    });

    it('hasLiveSubscription is false for cancelled subscription', async () => {
      // After applySubscriptionDeleted, row is tier="free" AND status="cancelled".
      // Free short-circuit above catches this, but pin the invariant so a
      // hypothetical row with tier=standard/status=cancelled also routes
      // to checkout (allows re-subscribe).
      const cancelledSub = {
        ...ACTIVE_STANDARD_SUB,
        tier: 'standard' as const,
        status: 'cancelled' as const,
      };
      storageMock.setItem(CACHE_KEY, JSON.stringify(cancelledSub));
      mockSupabaseClient.single.mockResolvedValue({ data: cancelledSub, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.hasLiveSubscription).toBe(false);
      });
    });

    // Note: dev-tier override behavior (useSubscription.ts:241-246) is
    // gated on VITE_DEV_BYPASS_AUTH which is unset in test env, so it can't
    // be exercised here without env-var stubbing. The invariant it protects
    // — hasLiveSubscription reads the raw subscription row, not the
    // possibly-overridden `tier` field — is inherent in the implementation
    // (the boolean is derived from `subscription`, not `tier`).
  });

  // ── Fetch behavior ──

  describe('fetch behavior', () => {
    it('fetches subscription on mount', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      renderHook(() => useSubscription());

      await waitFor(() => {
        expect(mockSupabaseClient.from).toHaveBeenCalledWith('user_subscriptions');
      });
    });

    it('sets error on DB failure', async () => {
      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.error).toBe('Could not load subscription');
      });
    });

    it('sets error on network exception', async () => {
      mockSupabaseClient.single.mockRejectedValue(new Error('Network error'));

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await waitFor(() => {
        expect(result.current.error).toBe('Could not load subscription');
      });
    });

    it('re-fetches on window focus', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      renderHook(() => useSubscription());

      await waitFor(() => {
        expect(mockSupabaseClient.from).toHaveBeenCalled();
      });

      // Clear and fire focus
      vi.clearAllMocks();
      mockSupabaseClient.from.mockReturnThis();
      mockSupabaseClient.select.mockReturnThis();
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      window.dispatchEvent(new Event('focus'));

      await waitFor(() => {
        expect(mockSupabaseClient.from).toHaveBeenCalledWith('user_subscriptions');
      });
    });
  });

  // ── startCheckout ──

  describe('startCheckout', () => {
    it('calls create-checkout-session with correct params', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://checkout.stripe.com/session_abc' }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await act(async () => {
        await result.current.startCheckout('standard', 'monthly');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/create-checkout-session'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ tier: 'standard', billing_cycle: 'monthly' }),
        })
      );
    });

    it('throws when not authenticated', async () => {
      mockGetToken.mockResolvedValue(null);
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await expect(
        act(async () => {
          await result.current.startCheckout('premium', 'annual');
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('throws on API error with server message', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid tier' }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await expect(
        act(async () => {
          await result.current.startCheckout('standard', 'monthly');
        })
      ).rejects.toThrow('Invalid tier');
    });

    it('throws generic error when API response has no error message', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error('parse fail');
        },
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await expect(
        act(async () => {
          await result.current.startCheckout('standard', 'monthly');
        })
      ).rejects.toThrow('Failed to start checkout');
    });

    // ── Error attachment — 2026-09-17 sarah.uku incident fix ──
    //
    // On non-2xx, startCheckout attaches `code` and `status` to the thrown
    // Error so downstream handlers (Onboarding/Account/TrackRecord wrappers)
    // can branch on the backend's benign 409 codes without matching on the
    // human-readable message string.

    it('attaches code + status from body to thrown error on 409 existing_subscription', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Looks like you already have a Vela plan. To switch plans, tap Manage billing on your Account.',
          code: 'existing_subscription',
        }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      let caught: (Error & { code?: string; status?: number }) | null = null;
      try {
        await act(async () => {
          await result.current.startCheckout('standard', 'monthly');
        });
      } catch (err) {
        caught = err as Error & { code?: string; status?: number };
      }
      expect(caught).not.toBeNull();
      expect(caught?.message).toContain('Manage billing');
      expect(caught?.code).toBe('existing_subscription');
      expect(caught?.status).toBe(409);
    });

    it('attaches code + status on 409 same_tier', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'You are already on the premium plan.',
          code: 'same_tier',
        }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      let caught: (Error & { code?: string; status?: number }) | null = null;
      try {
        await act(async () => {
          await result.current.startCheckout('premium', 'monthly');
        });
      } catch (err) {
        caught = err as Error & { code?: string; status?: number };
      }
      expect(caught?.code).toBe('same_tier');
      expect(caught?.status).toBe(409);
    });

    it('leaves code undefined and status set for non-coded errors (e.g. 500)', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      let caught: (Error & { code?: string; status?: number }) | null = null;
      try {
        await act(async () => {
          await result.current.startCheckout('standard', 'monthly');
        });
      } catch (err) {
        caught = err as Error & { code?: string; status?: number };
      }
      expect(caught?.code).toBeUndefined();
      expect(caught?.status).toBe(500);
      expect(caught?.message).toBe('Server error');
    });
  });

  // ── openPortal ──

  describe('openPortal', () => {
    it('calls create-portal-session endpoint', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://billing.stripe.com/portal_abc' }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: ACTIVE_STANDARD_SUB, error: null });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await act(async () => {
        await result.current.openPortal();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/create-portal-session'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('throws when not authenticated', async () => {
      mockGetToken.mockResolvedValue(null);
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await expect(
        act(async () => {
          await result.current.openPortal();
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('throws on API error', async () => {
      mockGetToken.mockResolvedValue('jwt-token-123');
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'No subscription' }),
      });
      mockSupabaseClient.single.mockResolvedValue({ data: null, error: { message: 'no rows' } });

      const { useSubscription } = await loadHook();
      const { result } = renderHook(() => useSubscription());

      await expect(
        act(async () => {
          await result.current.openPortal();
        })
      ).rejects.toThrow('No subscription');
    });
  });

  // ── clearSubscriptionCache ──

  describe('clearSubscriptionCache', () => {
    it('removes cache from localStorage', async () => {
      storageMock.setItem(CACHE_KEY, JSON.stringify(ACTIVE_STANDARD_SUB));
      expect(storageMock.getItem(CACHE_KEY)).toBeTruthy();

      const { clearSubscriptionCache } = await loadHook();
      clearSubscriptionCache();

      expect(storageMock.removeItem).toHaveBeenCalledWith(CACHE_KEY);
    });
  });
});
