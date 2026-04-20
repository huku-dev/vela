/**
 * Home page post-checkout handling — source verification.
 *
 * Stripe success_url now lands on Home (/) instead of Account (/account).
 * Home fires markOnboarded() immediately on arrival, clears the persisted
 * tier preference, and hands off to the existing post-checkout interstitial
 * for the deposit prompt.
 *
 * Mounting Home.tsx requires the useDashboard data hook, useTrading,
 * useTierAccess, and router context — heavy for a single-line assertion.
 * Source verification pins the contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const homeSrc = readFileSync(resolve(__dirname, './Home.tsx'), 'utf-8');

describe('HOME-SRC: useOnboarding wiring', () => {
  it('imports useOnboarding', () => {
    expect(homeSrc).toMatch(/import \{ useOnboarding \}/);
  });

  it('destructures completeOnboarding as markOnboarded', () => {
    expect(homeSrc).toMatch(/completeOnboarding\s*:\s*markOnboarded/);
  });

  it('pulls refresh from useTierAccess (single source of truth)', () => {
    // Using a second `useSubscription()` on Home would create a disconnected
    // state tree — polling would never update the tier badge rendered via
    // useTierAccess(). Must share the same hook instance by lifting refresh
    // through useTierAccess.
    expect(homeSrc).not.toMatch(/import \{ useSubscription \}/);
    expect(homeSrc).toMatch(/refresh\s*:\s*refreshSubscription/);
    // And the refresh destructure must be part of the useTierAccess() call.
    // Multi-line destructure block: `const { ... refresh: refreshSubscription ... } = useTierAccess();`
    expect(homeSrc).toMatch(
      /const\s*\{[\s\S]*?refresh\s*:\s*refreshSubscription[\s\S]*?\}\s*=\s*useTierAccess\(\)/
    );
  });
});

describe('HOME-SRC: checkout-success effect', () => {
  it('reads ?checkout=success on mount', () => {
    expect(homeSrc).toMatch(/params\.get\(['"]checkout['"]\)\s*!==\s*['"]success['"]/);
  });

  it('calls markOnboarded() inside an awaited IIFE', () => {
    expect(homeSrc).toMatch(/await markOnboarded\(\)/);
  });

  it('catches markOnboarded errors and logs them', () => {
    expect(homeSrc).toMatch(/catch \(err\)[\s\S]{0,150}markOnboarded failed/);
  });

  it('clears vela_pending_tier from sessionStorage', () => {
    // Mirrors the belt-and-suspenders cleanup in Onboarding so the tier
    // doesn't leak into a future cancel-return restore.
    expect(homeSrc).toMatch(/sessionStorage\.removeItem\(['"]vela_pending_tier['"]\)/);
  });

  it('polls refreshSubscription so the tier badge flips paid once webhook lands', () => {
    // Without this the header may briefly show "Free" after a paid checkout
    // until the next app-level cache refresh. Poll cadence is 2s with a 30s
    // cap; the cap-setTimeout is scoped to the setInterval so this regex
    // is anchored to the right `30000` and can't false-match unrelated
    // 30000ms timers elsewhere in Home.
    expect(homeSrc).toMatch(/refreshSubscription\(\)/);
    expect(homeSrc).toMatch(/setInterval\([\s\S]{0,120}refreshSubscription\(\)[\s\S]{0,40}2000/);
    expect(homeSrc).toMatch(/setTimeout\([\s\S]{0,80}clearInterval\(timer\)[\s\S]{0,20},\s*30000\)/);
  });

  it('polling timer is cleared on unmount to avoid leaks', () => {
    expect(homeSrc).toMatch(/clearInterval\(timer\)/);
    expect(homeSrc).toMatch(/clearTimeout\(timeout\)/);
  });

  it('does not duplicate the post-checkout interstitial logic', () => {
    // Interstitial state + dismiss helper should still be the single source
    // of truth for URL cleanup and the deposit-prompt handoff.
    const interstitialBlocks = (homeSrc.match(/showInterstitial/g) ?? []).length;
    expect(interstitialBlocks).toBeGreaterThan(0);
  });
});

describe('HOME-SRC: interstitial handoff', () => {
  it('interstitial init reads the same ?checkout=success signal', () => {
    // Guards that if the query key ever changes, both the interstitial
    // trigger and the markOnboarded effect move together.
    expect(homeSrc).toMatch(
      /setShowInterstitial[\s\S]{0,400}params\.get\(['"]checkout['"]\)\s*!==\s*['"]success['"]/
    );
  });

  it('dismissInterstitial still cleans URL params', () => {
    expect(homeSrc).toMatch(/searchParams\.delete\(['"]checkout['"]\)/);
    expect(homeSrc).toMatch(/searchParams\.delete\(['"]tier['"]\)/);
  });
});

describe('HOME-ADV: adversarial invariants', () => {
  it('markOnboarded is NOT gated on tier (webhook-slow protection)', () => {
    // Wrap: find the markOnboarded effect body and verify it does not hide
    // behind a tier check.
    const effectAnchor = homeSrc.indexOf('await markOnboarded()');
    expect(effectAnchor).toBeGreaterThan(-1);
    // Scan 400 chars before the await for any currentTier / tier check
    // that would prevent the call on free-tier arrival.
    const before = homeSrc.slice(Math.max(0, effectAnchor - 400), effectAnchor);
    expect(before).not.toMatch(/tier\s*!==\s*['"]free['"]/);
    expect(before).not.toMatch(/currentTier\s*!==\s*['"]free['"]/);
  });

  it('does NOT trust a missing checkout param as success', () => {
    expect(homeSrc).toMatch(/params\.get\(['"]checkout['"]\)\s*!==\s*['"]success['"]\)\s*return/);
  });

  it('effect has an empty dependency array (mount-only, cannot re-fire)', () => {
    // Ensures markOnboarded doesn't get called repeatedly if Home re-renders.
    const effectAnchor = homeSrc.indexOf('await markOnboarded()');
    const after = homeSrc.slice(effectAnchor, effectAnchor + 1200);
    expect(after).toMatch(/\}, \[\]\);/);
    expect(after).toMatch(/exhaustive-deps/);
  });
});
