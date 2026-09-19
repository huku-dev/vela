/**
 * Tests for TierComparisonSheet routing — post-2026-09-17 sarah.uku incident.
 *
 * Covers the primary defense against duplicate Stripe subscriptions:
 * paid users clicking "Change plan" must be routed to the customer portal
 * (plan switch, card update handled by Stripe) rather than to
 * create-checkout-session (which would create a second Stripe sub on the
 * same customer).
 *
 * The backend guard in create-checkout-session is the defense-in-depth
 * backstop; this routing is what prevents the backend guard from ever
 * needing to fire under normal use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Analytics stub ────────────────────────────────────────────────

vi.mock('../lib/analytics', () => ({
  track: vi.fn(),
  AnalyticsEvent: {
    TIER_COMPARISON_OPENED: 'tier_comparison_opened',
    CHECKOUT_STARTED: 'checkout_started',
    PORTAL_OPENED: 'portal_opened',
  },
}));

// ── useSubscription stub ──────────────────────────────────────────
//
// Each test overrides the mock's return via useSubscriptionMock.mockReturnValue.
// Only the three fields the sheet reads are asserted: isLoading (gating),
// hasLiveSubscription (routing), openPortal (destination). subscription is
// destructured then discarded so we don't need to return it.

const useSubscriptionMock = vi.fn();
vi.mock('../hooks/useSubscription', () => ({
  useSubscription: () => useSubscriptionMock(),
  // Re-export the helper the sheet imports separately; the sheet doesn't
  // call it directly (uses the boolean from the hook return) but the
  // module resolution still needs the symbol to exist.
  hasLiveSubscription: vi.fn(),
}));

// ── Tier definitions stub ─────────────────────────────────────────
//
// Real TIER_DEFINITIONS is imported from lib/tier-definitions; using the
// real data here keeps the test faithful to prod shape.

import TierComparisonSheet from './TierComparisonSheet';

describe('TierComparisonSheet routing', () => {
  const onCloseSpy = vi.fn();
  const onStartCheckoutSpy = vi.fn().mockResolvedValue(undefined);
  const openPortalSpy = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    onStartCheckoutSpy.mockResolvedValue(undefined);
    openPortalSpy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes FREE user click to onStartCheckout (never openPortal)', async () => {
    useSubscriptionMock.mockReturnValue({
      subscription: null,
      isLoading: false,
      hasLiveSubscription: false,
      openPortal: openPortalSpy,
    });

    render(
      <TierComparisonSheet
        currentTier="free"
        onClose={onCloseSpy}
        onStartCheckout={onStartCheckoutSpy}
      />,
    );

    // Free user sees both "Upgrade to Standard" (recommended) and
    // "Upgrade to Premium" as separate CTAs; pick the Premium one to be
    // unambiguous.
    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to premium/i,
    });
    fireEvent.click(upgradeButton);

    await waitFor(() => {
      expect(onStartCheckoutSpy).toHaveBeenCalledTimes(1);
    });
    expect(openPortalSpy).not.toHaveBeenCalled();
  });

  it('routes PAID user click to openPortal (never onStartCheckout)', async () => {
    // The duplicate-sub incident. Before this fix, a Standard user clicking
    // "Upgrade to Premium" hit create-checkout-session, which created a
    // second Stripe sub on the same customer. Now they go to the portal
    // which mutates their existing sub.
    useSubscriptionMock.mockReturnValue({
      subscription: {
        tier: 'standard',
        status: 'active',
      },
      isLoading: false,
      hasLiveSubscription: true,
      openPortal: openPortalSpy,
    });

    render(
      <TierComparisonSheet
        currentTier="standard"
        onClose={onCloseSpy}
        onStartCheckout={onStartCheckoutSpy}
      />,
    );

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to premium/i,
    });
    fireEvent.click(upgradeButton);

    await waitFor(() => {
      expect(openPortalSpy).toHaveBeenCalledTimes(1);
    });
    expect(onStartCheckoutSpy).not.toHaveBeenCalled();
  });

  it('routes TRIALING user click to openPortal (broader than isPaid)', async () => {
    // hasLiveSubscription is broader than isPaid — accepts trialing/past_due
    // too. Sheet must honor the same predicate so a trialing user clicking
    // a different tier still routes through portal. Testing with
    // currentTier=standard so Premium renders expanded (Premium is the
    // recommended tier when standing on Standard).
    useSubscriptionMock.mockReturnValue({
      subscription: {
        tier: 'standard',
        status: 'trialing',
      },
      isLoading: false,
      hasLiveSubscription: true,
      openPortal: openPortalSpy,
    });

    render(
      <TierComparisonSheet
        currentTier="standard"
        onClose={onCloseSpy}
        onStartCheckout={onStartCheckoutSpy}
      />,
    );

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to premium/i,
    });
    fireEvent.click(upgradeButton);

    await waitFor(() => {
      expect(openPortalSpy).toHaveBeenCalledTimes(1);
    });
    expect(onStartCheckoutSpy).not.toHaveBeenCalled();
  });

  it('routes PAST_DUE user click to openPortal (they need to fix card)', async () => {
    useSubscriptionMock.mockReturnValue({
      subscription: {
        tier: 'standard',
        status: 'past_due',
      },
      isLoading: false,
      hasLiveSubscription: true,
      openPortal: openPortalSpy,
    });

    render(
      <TierComparisonSheet
        currentTier="standard"
        onClose={onCloseSpy}
        onStartCheckout={onStartCheckoutSpy}
      />,
    );

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to premium/i,
    });
    fireEvent.click(upgradeButton);

    await waitFor(() => {
      expect(openPortalSpy).toHaveBeenCalledTimes(1);
    });
    expect(onStartCheckoutSpy).not.toHaveBeenCalled();
  });

  it('no-ops when isSubscriptionLoading (cold-cache path)', async () => {
    // On cold cache the hook returns isLoading=true with subscription=null.
    // Sheet must NOT proceed with either destination — routing without
    // known state would risk routing a paid user through checkout and
    // creating a duplicate sub before the fetch resolves. Button is also
    // visually disabled per the disabled prop.
    useSubscriptionMock.mockReturnValue({
      subscription: null,
      isLoading: true,
      hasLiveSubscription: false,
      openPortal: openPortalSpy,
    });

    render(
      <TierComparisonSheet
        currentTier="free"
        onClose={onCloseSpy}
        onStartCheckout={onStartCheckoutSpy}
      />,
    );

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to premium/i,
    });
    // Button should be disabled (both the disabled attribute and the
    // cursor:wait / opacity 0.7 styles)
    expect(upgradeButton).toBeDisabled();

    // If somehow clicked anyway (JS invocation), handleCta no-ops
    fireEvent.click(upgradeButton);
    await new Promise((r) => setTimeout(r, 10));
    expect(onStartCheckoutSpy).not.toHaveBeenCalled();
    expect(openPortalSpy).not.toHaveBeenCalled();
  });
});
