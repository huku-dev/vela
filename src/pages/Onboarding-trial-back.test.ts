/**
 * Onboarding — trial step back-button source verification.
 *
 * From Lota's 2026-05-05 onboarding call (docs/user-research/lota-2026-05-05.md):
 * the "Try Premium free for 7 days" screen had no back affordance. Browser-back
 * for an already-authenticated user landed on an error rather than returning to
 * the plan-select screen. The fix adds an explicit in-app back button that
 * transitions the state machine trial -> plan.
 *
 * Source-grep tests pin the contract so we don't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, './Onboarding.tsx'), 'utf-8');

describe('ONBOARD-SRC: trial step back button', () => {
  it('OnboardingTrialOffer accepts an onBack prop', () => {
    // Prop declared on the component signature.
    expect(src).toMatch(/function OnboardingTrialOffer\(\{[\s\S]{0,200}onBack/);
    expect(src).toMatch(/onBack:\s*\(\)\s*=>\s*void/);
  });

  it('renders a back-button element with the canonical testid', () => {
    expect(src).toContain('data-testid="trial-back-button"');
  });

  it('back-button uses the canonical aria-label', () => {
    expect(src).toContain('aria-label="Go back to plans"');
  });

  it('parent routes onBack through window.history.back() (single code path with browser-back)', () => {
    // Routing the in-app button through history.back() means the popstate
    // listener fires for both paths, keeping browser history in sync and
    // sharing one transition.
    expect(src).toMatch(
      /<OnboardingTrialOffer[\s\S]{0,400}onBack=\{[\s\S]{0,80}window\.history\.back\(\)/
    );
  });

  it('back-button stays enabled even while busy (navigation escape hatch)', () => {
    // A user mid-Stripe-redirect that hangs must still be able to leave.
    // The trial CTA and Continue-on-Free link stay disabled; the back button
    // does not.
    const backButtonBlock = src.slice(
      src.indexOf('data-testid="trial-back-button"') - 400,
      src.indexOf('data-testid="trial-back-button"') + 600
    );
    expect(backButtonBlock).not.toMatch(/disabled=\{busy\}/);
  });
});

describe('ONBOARD-SRC: trial step browser-back is handled', () => {
  it('pushes a synthetic history entry on entry to the trial step', () => {
    // Without this, browser-back from trial exits /welcome (the original
    // Lota bug: lands on an error page). With it, popstate fires and we
    // transition trial -> plan in-app.
    expect(src).toMatch(
      /useEffect\([\s\S]{0,400}step !== ['"]trial['"]\s*\)[\s\S]{0,300}window\.history\.pushState/
    );
  });

  it('listens for popstate and returns to the plan step', () => {
    expect(src).toMatch(
      /addEventListener\(\s*['"]popstate['"][\s\S]{0,300}setStep\(['"]plan['"]\)/
    );
  });

  it('clears trial error and tracks the plan view on popstate', () => {
    // Same hygiene as the in-app back transition. Anchor on the handler
    // definition (which precedes addEventListener) so the slice covers it.
    const handlerStart = src.indexOf('const handlePopState');
    const handlerBlock = src.slice(handlerStart, handlerStart + 400);
    expect(handlerBlock).toMatch(/setTrialError\(null\)/);
    expect(handlerBlock).toMatch(/ONBOARDING_STEP_VIEWED[\s\S]{0,80}step:\s*['"]plan['"]/);
  });

  it('removes the popstate listener on cleanup', () => {
    expect(src).toMatch(/removeEventListener\(\s*['"]popstate['"]/);
  });
});
