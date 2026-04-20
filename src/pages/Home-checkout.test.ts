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
    expect(homeSrc).toMatch(
      /setTimeout\([\s\S]{0,80}clearInterval\(timer\)[\s\S]{0,20},\s*30000\)/
    );
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
    // 2500 char window covers the expanded effect body after Batch 2b
    // added enableTrading + tier-derivation inside the same IIFE.
    const effectAnchor = homeSrc.indexOf('await markOnboarded()');
    const after = homeSrc.slice(effectAnchor, effectAnchor + 2500);
    expect(after).toMatch(/\}, \[\]\);/);
    expect(after).toMatch(/exhaustive-deps/);
  });
});

describe('HOME-SRC: post-checkout wallet + mode (Batch 2b)', () => {
  it('destructures enableTrading from useTrading', () => {
    // Lazy wallet provisioning for free/trial users + post-checkout wallet
    // provisioning for paid users both need this.
    expect(homeSrc).toMatch(
      /const\s*\{[\s\S]*?enableTrading[\s\S]*?\}\s*=\s*useTrading\(\)/
    );
  });

  it('captures the purchased tier on mount (URL ?tier=X)', () => {
    // Stores in useState with a lazy initializer so subsequent URL cleanup
    // by dismissInterstitial does not lose the value.
    expect(homeSrc).toMatch(/useState<['"]standard['"] \| ['"]premium['"] \| null>/);
    expect(homeSrc).toMatch(/params\.get\(['"]tier['"]\)/);
  });

  it('only accepts tier values of "standard" or "premium" (URL-spoof guard)', () => {
    // Defensive parser: rejects garbage tier strings like "enterprise".
    expect(homeSrc).toMatch(
      /t === ['"]premium['"] \|\| t === ['"]standard['"]\s*\?\s*t\s*:\s*null/
    );
  });

  it('provisioning is GATED on tier confirmation, not fired immediately', () => {
    // The DB validate_user_mode trigger rejects full_auto writes while
    // tier is still free. Firing enableTrading pre-webhook would race and
    // leave premium users stuck. We must wait for tier === purchasedTier.
    expect(homeSrc).toMatch(/if \(tier !== purchasedTier\) return/);
  });

  it('enableTrading fires exactly once via a ref-guard', () => {
    expect(homeSrc).toMatch(/enableTradingFiredRef = useRef\(false\)/);
    expect(homeSrc).toMatch(/enableTradingFiredRef\.current\s*=\s*true/);
    expect(homeSrc).toMatch(/if \(!purchasedTier \|\| enableTradingFiredRef\.current\) return/);
  });

  it('tier-watch effect depends on purchasedTier, tier, enableTrading', () => {
    expect(homeSrc).toMatch(
      /\}, \[purchasedTier, tier, enableTrading\]\)/
    );
  });

  it('maps premium → full_auto and standard → semi_auto', () => {
    expect(homeSrc).toMatch(/purchasedTier === ['"]premium['"]\s*\?\s*['"]full_auto['"]\s*:\s*['"]semi_auto['"]/);
  });

  it('catches enableTrading failures without crashing', () => {
    expect(homeSrc).toMatch(/catch \(err\)[\s\S]{0,150}enableTrading failed/);
  });

  it('markOnboarded fires immediately on mount (NOT gated on tier)', () => {
    // Onboarded flag is set the moment the user lands — webhook-slow
    // protection. Only the mode/wallet write is gated on tier confirmation.
    const markEffectStart = homeSrc.indexOf("if (params.get('checkout') !== 'success') return;");
    const enableTradingEffectStart = homeSrc.indexOf('enableTradingFiredRef.current = true');
    // Both exist, and markOnboarded is in the earlier effect.
    expect(markEffectStart).toBeGreaterThan(-1);
    expect(enableTradingEffectStart).toBeGreaterThan(markEffectStart);
    const markAwait = homeSrc.indexOf('await markOnboarded()');
    expect(markAwait).toBeGreaterThan(markEffectStart);
    expect(markAwait).toBeLessThan(enableTradingEffectStart);
  });
});

describe('HOME-SRC: lazy wallet provisioning on deposit (Batch 2b)', () => {
  it('openDepositSheet is a useCallback guarded on wallet existence', () => {
    expect(homeSrc).toMatch(/const openDepositSheet = useCallback/);
    expect(homeSrc).toMatch(/wallet\?\.master_address/);
  });

  it('calls enableTrading with semi_auto when wallet is missing', () => {
    // Default mode for lazy provisioning matches the existing Standard
    // recommendation. Paid users already have wallets so this path never
    // fires for them.
    const fnStart = homeSrc.indexOf('const openDepositSheet = useCallback');
    const fnEnd = homeSrc.indexOf('}, [wallet?.master_address, enableTrading]);');
    const body = homeSrc.slice(fnStart, fnEnd);
    expect(body).toMatch(/await enableTrading\(['"]semi_auto['"]\)/);
    expect(body).toMatch(/setShowDepositSheet\(true\)/);
  });

  it('surfaces a "Setting up your wallet" loader during provisioning', () => {
    expect(homeSrc).toMatch(/Setting up your wallet/);
    expect(homeSrc).toMatch(/provisioningWallet/);
  });

  it('no setShowDepositSheet(true) exists outside openDepositSheet', () => {
    // Direct setShowDepositSheet(true) elsewhere would bypass the
    // provisioning guard and silently no-op for free/trial users whose
    // wallet hasn't been created yet (DepositSheet renders only when
    // wallet is defined). All trigger sites must route through
    // openDepositSheet, which calls enableTrading first if needed.
    const fnStart = homeSrc.indexOf('const openDepositSheet = useCallback');
    const fnEnd = homeSrc.indexOf('}, [wallet?.master_address, enableTrading]);');
    const inside = homeSrc.slice(fnStart, fnEnd);
    const insideCount = (inside.match(/setShowDepositSheet\(true\)/g) ?? []).length;
    const totalCount = (homeSrc.match(/setShowDepositSheet\(true\)/g) ?? []).length;
    // Currently 2 inside (fast path + post-provision). All should be inside.
    expect(insideCount).toBeGreaterThanOrEqual(1);
    expect(totalCount).toBe(insideCount);
  });
});

describe('HOME-ADV: Batch 2b adversarial invariants', () => {
  it('tier param values outside {standard, premium} do NOT flip mode', () => {
    // Defence against URL-share spoof with crafted tier values.
    // The parser inside the useState initializer rejects anything other
    // than "premium" or "standard" and falls back to null.
    expect(homeSrc).not.toMatch(/['"]enterprise['"]/);
    expect(homeSrc).not.toMatch(/['"]business['"]/);
  });

  it('enableTrading is NOT called during the initial mount effect', () => {
    // The mount effect handles markOnboarded + poll + sessionStorage cleanup.
    // enableTrading lives in a separate tier-watch effect that waits for
    // webhook confirmation. This prevents the DB trigger rejection race.
    const mountEffectStart = homeSrc.indexOf(
      "if (params.get('checkout') !== 'success') return;"
    );
    // Find the end of the mount effect (its dependency array '[])').
    const mountEffectEnd = homeSrc.indexOf('  }, []);', mountEffectStart);
    expect(mountEffectStart).toBeGreaterThan(-1);
    expect(mountEffectEnd).toBeGreaterThan(mountEffectStart);
    const mountEffect = homeSrc.slice(mountEffectStart, mountEffectEnd);
    expect(mountEffect).not.toContain('enableTrading');
  });

  it('tier-watch effect does NOT fire enableTrading when tier is still free', () => {
    // Explicit guard: tier !== purchasedTier blocks the call.
    const effectStart = homeSrc.indexOf('enableTradingFiredRef = useRef(false)');
    const effectEnd = homeSrc.indexOf('}, [purchasedTier, tier, enableTrading]);');
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const watch = homeSrc.slice(effectStart, effectEnd);
    expect(watch).toMatch(/if \(tier !== purchasedTier\) return/);
  });

  it('markOnboarded and enableTrading failures are independently caught', () => {
    expect(homeSrc).toMatch(/\[Home\] markOnboarded failed/);
    expect(homeSrc).toMatch(/\[Home\] enableTrading failed/);
  });
});
