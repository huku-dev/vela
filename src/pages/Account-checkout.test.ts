/**
 * Account page post-checkout handling — source verification.
 *
 * The Stripe success_url now routes to Home (/) instead of Account. Account
 * no longer fires markOnboarded() or starts subscription polling; those
 * responsibilities moved to Home.tsx. See Home-checkout.test.ts.
 *
 * This file pins the Account contract post-migration so we don't silently
 * re-introduce duplicate markOnboarded() calls or resurrect the legacy
 * cancel-handling path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const accountSrc = readFileSync(resolve(__dirname, './Account.tsx'), 'utf-8');

describe('ACCOUNT-SRC: Account no longer handles checkout success', () => {
  it('does NOT import useOnboarding (success-side work moved to Home)', () => {
    expect(accountSrc).not.toMatch(/import \{ useOnboarding \}/);
  });

  it('does NOT call markOnboarded', () => {
    expect(accountSrc).not.toContain('markOnboarded');
  });

  it('does NOT set a welcome toast on arrival', () => {
    // Previously set "Welcome to Premium!" on arrival — that now lives in
    // Home's post-checkout interstitial.
    expect(accountSrc).not.toMatch(/setCheckoutToast\(`Welcome to/);
  });

  it('does NOT poll subscription in a 30s timer', () => {
    // Polling moved to Home; Account just strips stale query params.
    expect(accountSrc).not.toMatch(/setInterval\([\s\S]{0,200}refreshSubscription/);
    expect(accountSrc).not.toMatch(/30000\)/);
  });
});

describe('ACCOUNT-SRC: stale ?checkout=success cleanup', () => {
  it('strips checkout and tier params if user lands on /account with stale values', () => {
    // Users navigating to /account with a leftover ?checkout=success (e.g.
    // back-button after success landing on Home) should get a clean URL.
    expect(accountSrc).toMatch(/searchParams\.delete\(['"]checkout['"]\)/);
    expect(accountSrc).toMatch(/searchParams\.delete\(['"]tier['"]\)/);
  });

  it('clears the pending gate if user lands with stale ?checkout=success', () => {
    expect(accountSrc).toMatch(/setCheckoutPending\(false\)/);
  });
});

describe('ACCOUNT-SRC: legacy cancel path is removed', () => {
  it('no longer handles ?checkout=cancel (backend now routes cancel to /welcome)', () => {
    expect(accountSrc).not.toMatch(/result === ['"]cancel['"]/);
  });
});

describe('ACCOUNT-SRC: pending gate clears on paid tier', () => {
  it('clears pending gate when currentTier flips from free to paid', () => {
    // The pending gate still exists for its original purpose (hide stale
    // free-tier UI while the webhook updates after a checkout). It just
    // no longer fires markOnboarded itself.
    expect(accountSrc).toMatch(/currentTier !== ['"]free['"]/);
    expect(accountSrc).toMatch(/setCheckoutPending\(false\)/);
  });
});

describe('ACCOUNT-ADV: adversarial invariants', () => {
  it('Account does NOT re-fire markOnboarded under any condition', () => {
    // Double-firing (Home + Account) would be harmless but wasteful.
    // The contract is: only Home handles onboarding completion.
    expect(accountSrc).not.toMatch(/markOnboarded\s*\(\)/);
  });
});
