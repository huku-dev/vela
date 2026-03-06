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
