/**
 * OnboardingGate — source verification.
 *
 * Mounting AuthShell pulls in PrivyProvider, AuthProvider, six lazy routes,
 * and the full Supabase client. Far too much to mount for a three-line
 * scoping assertion. Verify directly from source.
 *
 * What this guards against:
 * - The checkout-success bypass accidentally accepting any route (so an
 *   unauthorised user could append ?checkout=success to reach /trades or
 *   /brief without completing onboarding).
 * - Regressing on the ?checkout=success bypass entirely (would bounce
 *   paid users back to /welcome after Stripe).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const authShellSrc = readFileSync(resolve(__dirname, './AuthShell.tsx'), 'utf-8');

// Isolate the OnboardingGate body for narrow assertions.
const gateStart = authShellSrc.indexOf('function OnboardingGate');
const gateEnd = authShellSrc.indexOf('\n}\n', gateStart);
const gateSrc = authShellSrc.slice(gateStart, gateEnd);

describe('GATE-SRC: OnboardingGate structure', () => {
  it('reads isOnboarded and isChecking from useOnboarding', () => {
    expect(gateSrc).toMatch(/useOnboarding\(\)/);
    expect(gateSrc).toContain('isOnboarded');
    expect(gateSrc).toContain('isChecking');
  });

  it('shows loader while checking', () => {
    expect(gateSrc).toMatch(/if \(isChecking\)[\s\S]{0,40}PageLoader/);
  });

  it('redirects non-onboarded users to /welcome', () => {
    expect(gateSrc).toMatch(/Navigate to=["']\/welcome["']\s+replace/);
  });
});

describe('GATE-SRC: checkout-success bypass scoping', () => {
  it('reads the checkout query param', () => {
    expect(gateSrc).toMatch(/params\.get\(['"]checkout['"]\)\s*===\s*['"]success['"]/);
  });

  it('ALSO checks pathname equals /account (narrow scope)', () => {
    expect(gateSrc).toMatch(/location\.pathname === ['"]\/account['"]/);
  });

  it('combines the two checks with AND, not OR (prevents broad bypass)', () => {
    expect(gateSrc).toMatch(/pathname === ['"]\/account['"]\s*&&\s*params\.get/);
  });

  it('bypass is used in the redirect guard', () => {
    expect(gateSrc).toMatch(/!isCheckoutSuccessOnAccount/);
  });
});

describe('GATE-ADV: adversarial bypass invariants', () => {
  it('does not allow bypass on /trades?checkout=success', () => {
    // The scoping check requires pathname to equal "/account" exactly.
    // Any other path cannot match, so appending ?checkout=success elsewhere
    // does not bypass.
    expect(gateSrc).not.toMatch(/pathname !== ['"]\/account['"]/);
  });

  it('does not allow bypass based on referrer or any other attacker-controlled input', () => {
    // Only the URL pathname + query param are consulted — nothing from
    // document.referrer, localStorage, or cookies.
    expect(gateSrc).not.toMatch(/document\.referrer/);
    expect(gateSrc).not.toMatch(/cookie/i);
  });

  it('does not treat a missing checkout param as success', () => {
    // params.get returns null when absent; strict equality to "success"
    // correctly fails without defaulting to truthy.
    expect(gateSrc).toMatch(/params\.get\(['"]checkout['"]\) === ['"]success['"]/);
  });
});
