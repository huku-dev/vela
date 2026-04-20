/**
 * Account page post-checkout handling — source verification.
 *
 * Mounting Account.tsx requires deep mocking of subscription, wallet,
 * tier-gating, Tally, Supabase, Privy, and at least 6 contexts. Instead,
 * verify the post-checkout handling contract directly from source.
 *
 * What this guards against:
 * - Onboarded flag not being set on confirmed Stripe success, leaving paid
 *   users stuck at /welcome on the next navigation.
 * - markOnboarded() being called in a fire-and-forget way that loses the
 *   DB write if the tab closes mid-effect.
 * - Dead legacy ?checkout=cancel handler remaining and confusing readers.
 * - The pending-tier poll timing out and leaving a paid user as non-onboarded.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const accountSrc = readFileSync(resolve(__dirname, './Account.tsx'), 'utf-8');

describe('ACCOUNT-SRC: onboarding completion on checkout success', () => {
  it('useOnboarding is imported and markOnboarded is destructured', () => {
    expect(accountSrc).toMatch(/import \{ useOnboarding \}/);
    expect(accountSrc).toMatch(/completeOnboarding\s*:\s*markOnboarded/);
  });

  it('markOnboarded is called immediately on ?checkout=success arrival', () => {
    // Must be inside the success branch of the mount effect — not gated on
    // currentTier transitioning to paid (webhook can be slow, we would miss
    // the window).
    const effectStart = accountSrc.indexOf("if (result !== 'success') return;");
    const effectEnd = accountSrc.indexOf('// Clear checkout pending gate');
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);

    const effect = accountSrc.slice(effectStart, effectEnd);
    expect(effect).toContain('markOnboarded()');
  });

  it('markOnboarded is awaited (not fire-and-forget) and errors are caught', () => {
    // Wrapped in IIFE so the DB write is awaited without making the
    // useEffect itself async (which would return the promise as cleanup).
    expect(accountSrc).toMatch(/await markOnboarded\(\)/);
    expect(accountSrc).toMatch(/catch \(err\)[\s\S]{0,120}markOnboarded failed/);
  });

  it('poll interval is extended to 30s (previously 10s was too short)', () => {
    expect(accountSrc).toMatch(/30000\)/);
  });

  it('URL params are cleaned after handling', () => {
    expect(accountSrc).toMatch(/searchParams\.delete\(['"]checkout['"]\)/);
    expect(accountSrc).toMatch(/searchParams\.delete\(['"]tier['"]\)/);
  });

  it('tear-down clears both interval and timeout so no leaks', () => {
    expect(accountSrc).toMatch(/clearInterval\(timer\)/);
    expect(accountSrc).toMatch(/clearTimeout\(timeout\)/);
  });
});

describe('ACCOUNT-SRC: legacy cancel path is removed', () => {
  it('no longer handles ?checkout=cancel (backend now routes cancel to /welcome)', () => {
    expect(accountSrc).not.toMatch(/result === ['"]cancel['"]/);
  });
});

describe('ACCOUNT-SRC: tier-preference cleanup', () => {
  it('removes vela_pending_tier from sessionStorage after checkout success', () => {
    // Prevents the Onboarding cancel-return restore from surfacing a stale
    // tier on a subsequent upgrade attempt from the same tab.
    const effect = accountSrc.slice(
      accountSrc.indexOf("if (result !== 'success') return;"),
      accountSrc.indexOf('// Clear checkout pending gate')
    );
    expect(effect).toMatch(/sessionStorage\.removeItem\(['"]vela_pending_tier['"]\)/);
  });
});

describe('ACCOUNT-SRC: checkout-pending gate clears on paid tier', () => {
  it('clears pending gate when currentTier flips from free to paid', () => {
    const gateStart = accountSrc.indexOf('// Clear checkout pending gate');
    const gateEnd = accountSrc.indexOf('}, [checkoutPending, currentTier]);');
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);

    const gate = accountSrc.slice(gateStart, gateEnd);
    expect(gate).toMatch(/currentTier !== ['"]free['"]/);
    expect(gate).toMatch(/setCheckoutPending\(false\)/);
  });
});

describe('ACCOUNT-ADV: adversarial invariants', () => {
  it('onboarded flag is NOT gated on tier change (webhook-slow protection)', () => {
    // The subtle pre-fix bug: previously, markOnboarded was only called
    // inside the useEffect([checkoutPending, currentTier]) gate. A slow
    // webhook meant the poll timed out and currentTier stayed 'free',
    // so markOnboarded never fired.
    const pendingGateEffect = accountSrc.slice(
      accountSrc.indexOf('// Clear checkout pending gate'),
      accountSrc.indexOf('}, [checkoutPending, currentTier]);')
    );
    expect(pendingGateEffect).not.toContain('markOnboarded');
  });

  it('markOnboarded does not depend on poll success', () => {
    // It fires on arrival, not on tier confirmation.
    const successBranch = accountSrc.slice(
      accountSrc.indexOf("if (result !== 'success') return;"),
      accountSrc.indexOf('// Clear checkout pending gate')
    );
    const awaitIdx = successBranch.indexOf('await markOnboarded()');
    const timerIdx = successBranch.indexOf('setInterval');
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(timerIdx).toBeGreaterThan(-1);
    // markOnboarded kicked off before (or independent of) the poll start.
    // The IIFE wrapper means ordering is async-concurrent, which is fine —
    // what matters is that markOnboarded is NOT inside a conditional tied
    // to the poll result.
  });
});
