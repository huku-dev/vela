/**
 * Onboarding bail flow — source verification.
 *
 * Mounting Onboarding.tsx requires Privy + Supabase + router + analytics
 * mocking that would be heavier than the tests themselves. Instead, verify
 * the invariants that matter by inspecting the compiled source.
 *
 * What this guards against:
 * - Someone re-adding the pre-Stripe completeOnboarding() call that caused
 *   users to fall silently into Free when Stripe was cancelled.
 * - Cancel-return path losing the user's selected tier.
 * - Popstate handler creating duplicate history entries.
 * - Bail sheet flashing for already-onboarded users.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const onboardingSrc = readFileSync(resolve(__dirname, './Onboarding.tsx'), 'utf-8');

// Isolate the main component body for narrower assertions.
const mainComponentStart = onboardingSrc.indexOf('export default function Onboarding()');
const onboardingMain = onboardingSrc.slice(mainComponentStart);

describe('ONBOARD-SRC: pre-Stripe onboarding flag is NOT set', () => {
  it('handlePlanCheckout does not call completeOnboarding before startCheckout', () => {
    const handlerStart = onboardingMain.indexOf('const handlePlanCheckout');
    const handlerEnd = onboardingMain.indexOf('const handleSkipToFree');
    const handler = onboardingMain.slice(handlerStart, handlerEnd);

    // Must call startCheckout but must NOT call completeOnboarding inside.
    expect(handler).toContain('startCheckout(');
    // Strip single-line comments so the explanatory "Do NOT call
    // completeOnboarding() here" comment does not trip this assertion.
    const handlerCode = handler.replace(/\/\/.*$/gm, '');
    expect(handlerCode).not.toMatch(/completeOnboarding\s*\(/);
  });

  it('rollback via resetOnboarding is removed (nothing to reset any more)', () => {
    // resetOnboarding was only needed for rollback after the pre-Stripe
    // completeOnboarding call; that call is gone, so neither call nor
    // destructure should appear.
    expect(onboardingMain).not.toMatch(/resetOnboarding/);
  });

  it('checkoutInProgressRef is removed (no longer needed after flag fix)', () => {
    expect(onboardingMain).not.toContain('checkoutInProgressRef');
  });
});

describe('ONBOARD-SRC: cancel return path', () => {
  it('detects the ?checkout=cancelled URL param', () => {
    expect(onboardingMain).toMatch(/get\(['"]checkout['"]\)\s*===\s*['"]cancelled['"]/);
  });

  it('guards bail-sheet initial state with !isOnboarded to prevent flash', () => {
    // The returnedFromCancel expression combines the query-param check with
    // !isOnboarded so already-onboarded users don't see a flash of the sheet
    // before the redirect-to-/ effect fires.
    expect(onboardingMain).toMatch(/returnedFromCancel\s*=[\s\S]{0,200}!isOnboarded/);
  });

  it('initial step jumps to plan on cancel return', () => {
    expect(onboardingMain).toMatch(/returnedFromCancel\s*\?\s*['"]plan['"]/);
  });

  it('renders BailSheet when showBailSheet is true', () => {
    expect(onboardingMain).toContain('showBailSheet && <BailSheet');
  });

  it('clears the URL query param on sheet dismissal', () => {
    expect(onboardingMain).toMatch(/url\.searchParams\.delete\(['"]checkout['"]\)/);
    expect(onboardingMain).toMatch(/window\.history\.replaceState/);
  });
});

describe('ONBOARD-SRC: selected tier persistence', () => {
  it('writes the selected tier to sessionStorage before Stripe redirect', () => {
    expect(onboardingMain).toMatch(
      /sessionStorage\.setItem\(['"]vela_pending_tier['"]\s*,\s*tier\)/
    );
  });

  it('restores the tier from sessionStorage on cancel return', () => {
    expect(onboardingMain).toMatch(/sessionStorage\.getItem\(['"]vela_pending_tier['"]\)/);
  });

  it('clears the persisted tier on mount via a useEffect (consume-once)', () => {
    // Prevents the stored tier from leaking across users on the same tab
    // (sessionStorage survives login changes) or from resurfacing during a
    // later unrelated cancel flow. Must live in an effect — not the render
    // body — so React StrictMode and re-renders don't cause unexpected
    // mutations.
    expect(onboardingMain).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,200}if \(returnedFromCancel\)[\s\S]{0,100}sessionStorage\.removeItem\(['"]vela_pending_tier['"]\)/
    );
  });

  it('pendingCheckout is initialized lazily from sessionStorage on cancel-return', () => {
    // Lazy initializer (function form) ensures the read happens exactly
    // once, on mount, capturing the value before the cleanup effect fires.
    expect(onboardingMain).toMatch(
      /useState<['"]standard['"] \| ['"]premium['"] \| null>\(\(\) =>[\s\S]{0,200}sessionStorage\.getItem\(['"]vela_pending_tier['"]\)/
    );
  });

  it('clears the persisted tier on skip-to-free', () => {
    const skipStart = onboardingMain.indexOf('const handleSkipToFree');
    const skipHandler = onboardingMain.slice(skipStart, skipStart + 400);
    expect(skipHandler).toMatch(/sessionStorage\.removeItem\(['"]vela_pending_tier['"]\)/);
  });

  it('clears the persisted tier on bail-sheet dismissal', () => {
    const dismissStart = onboardingMain.indexOf('const handleBailSheetDismiss');
    expect(dismissStart).toBeGreaterThan(-1);
    const dismissHandler = onboardingMain.slice(dismissStart, dismissStart + 800);
    expect(dismissHandler).toMatch(/sessionStorage\.removeItem\(['"]vela_pending_tier['"]\)/);
  });
});

describe('ONBOARD-SRC: simplified flow (Batch 2b, 2026-04-20)', () => {
  it('OnboardingStep type has only splash and plan', () => {
    // trading_mode step was removed; execution mode is derived from plan
    // choice on Stripe success instead (Home.tsx post-checkout effect).
    expect(onboardingSrc).toMatch(/type OnboardingStep = ['"]splash['"]\s*\|\s*['"]plan['"]/);
    expect(onboardingSrc).not.toMatch(/['"]trading_mode['"]/);
  });

  it('TradingModeSetup component is fully removed', () => {
    expect(onboardingSrc).not.toMatch(/function TradingModeSetup/);
    expect(onboardingSrc).not.toMatch(/<TradingModeSetup/);
    expect(onboardingSrc).not.toMatch(/handleModeSelected/);
    expect(onboardingSrc).not.toMatch(/MODE_OPTIONS/);
  });

  it('Onboarding no longer imports useTrading (wallet work moved to Home)', () => {
    expect(onboardingSrc).not.toMatch(/import \{ useTrading \}/);
    expect(onboardingMain).not.toContain('enableTrading');
    expect(onboardingMain).not.toContain('updatePreferences');
  });

  it('auth-advance effect goes splash \u2192 plan (not splash \u2192 trading_mode)', () => {
    expect(onboardingMain).toMatch(/setStep\(['"]plan['"]\)/);
    expect(onboardingMain).not.toMatch(/setStep\(['"]trading_mode['"]\)/);
  });

  it('handleGetStarted advances to plan for authenticated users', () => {
    const handlerStart = onboardingMain.indexOf('const handleGetStarted');
    const handler = onboardingMain.slice(handlerStart, handlerStart + 300);
    expect(handler).toMatch(/setStep\(['"]plan['"]\)/);
  });

  it('handleSkipToFree still marks onboarded and navigates home', () => {
    const skipStart = onboardingMain.indexOf('const handleSkipToFree');
    const skipHandler = onboardingMain.slice(skipStart, skipStart + 400);
    expect(skipHandler).toContain('completeOnboarding()');
    expect(skipHandler).toContain("navigate('/'");
  });

  it('no popstate / in-app back handling (flow has a single step after auth)', () => {
    // With TradingModeSetup gone there is no in-app previous step to walk
    // back to, so we rely on browser's default back behaviour.
    expect(onboardingMain).not.toContain('popstate');
    expect(onboardingMain).not.toContain('skipInitialHistoryPush');
    expect(onboardingMain).not.toContain('onboardingStep');
  });
});

describe('ONBOARD-ADV: adversarial invariants', () => {
  it('never calls completeOnboarding between setCheckoutError and startCheckout', () => {
    // Catches accidental re-introduction of the original bug.
    const checkoutStart = onboardingMain.indexOf('const handlePlanCheckout');
    const checkoutEnd = onboardingMain.indexOf('const handleSkipToFree');
    const body = onboardingMain.slice(checkoutStart, checkoutEnd);

    const setErrorIdx = body.indexOf('setCheckoutError(null)');
    const startIdx = body.indexOf('startCheckout(');
    expect(setErrorIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(setErrorIdx);

    const between = body
      .slice(setErrorIdx, startIdx)
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(between).not.toMatch(/completeOnboarding\s*\(/);
  });

  it('cancel-return query-param check uses strict equality to "cancelled"', () => {
    // Prevent a typo like ?checkout=cancel bringing up the bail sheet.
    expect(onboardingMain).toMatch(/get\(['"]checkout['"]\)\s*===\s*['"]cancelled['"]/);
    // And specifically NOT the old singular "cancel" keyword.
    // Anchor the scan to the returnedFromCancel expression through the
    // next stable marker (the step useState declaration) so this can't
    // silently expand to scan the whole component if the layout changes.
    const startIdx = onboardingMain.indexOf('const returnedFromCancel');
    const endIdx = onboardingMain.indexOf('const [step, setStep]');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const initCheckBlock = onboardingMain.slice(startIdx, endIdx);
    expect(initCheckBlock).not.toMatch(/=== ['"]cancel['"]/);
  });
});
