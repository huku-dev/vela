/**
 * useOnboarding — source verification.
 *
 * Covers:
 * - Dead `resetOnboarding` export is gone (round-1 rollback no longer needed
 *   after the pre-Stripe completeOnboarding removal).
 * - completeOnboarding DB failure is logged, not silently swallowed.
 * - Hook return shape matches current callers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, './useOnboarding.ts'), 'utf-8');

describe('ONBOARD-HOOK-SRC: exports', () => {
  it('does NOT export resetOnboarding (removed as dead code)', () => {
    expect(src).not.toMatch(/resetOnboarding/);
  });

  it('returns exactly { isOnboarded, isChecking, completeOnboarding }', () => {
    const returnMatch = src.match(/return\s*\{([^}]+)\}/);
    expect(returnMatch).not.toBeNull();
    const returned = returnMatch![1];
    expect(returned).toContain('isOnboarded');
    expect(returned).toContain('isChecking');
    expect(returned).toContain('completeOnboarding');
    expect(returned).not.toContain('resetOnboarding');
  });
});

describe('ONBOARD-HOOK-SRC: failure logging', () => {
  it('completeOnboarding logs DB update failures via console.warn', () => {
    // Silent catch blocks were previously hiding real problems (a fresh
    // browser login would re-route through /welcome for a paid user).
    const completeStart = src.indexOf('const completeOnboarding');
    const completeEnd = src.indexOf('}, [supabaseClient]);', completeStart);
    const completeBody = src.slice(completeStart, completeEnd);
    expect(completeBody).toMatch(/catch \(err\)[\s\S]{0,200}console\.warn\(['"]\[useOnboarding\]/);
  });

  it('completeOnboarding does NOT use a naked silent catch', () => {
    // A naked `catch {}` in completeOnboarding would regress the fix.
    // The profile-sync effect intentionally swallows errors (missing DB
    // column on legacy accounts is expected, not a real failure), so we
    // scope this check to the completeOnboarding callback only.
    const completeStart = src.indexOf('const completeOnboarding');
    const completeEnd = src.indexOf('}, [supabaseClient]);', completeStart);
    const completeBody = src.slice(completeStart, completeEnd);
    expect(completeBody).not.toMatch(/catch\s*\{\s*(\/\/[^\n]*\s*)*\}/);
  });
});

describe('ONBOARD-HOOK-SRC: completeOnboarding behaviour', () => {
  it('sets localStorage synchronously before the DB write (so nav works immediately)', () => {
    const completeStart = src.indexOf('const completeOnboarding');
    const completeBody = src.slice(completeStart, completeStart + 800);
    const localStorageIdx = completeBody.indexOf('localStorage.setItem');
    const dbUpdateIdx = completeBody.indexOf('.update(');
    expect(localStorageIdx).toBeGreaterThan(-1);
    expect(dbUpdateIdx).toBeGreaterThan(localStorageIdx);
  });

  it('sets the in-memory flag (setIsOnboarded) before the DB write', () => {
    const completeStart = src.indexOf('const completeOnboarding');
    const completeBody = src.slice(completeStart, completeStart + 800);
    const setStateIdx = completeBody.indexOf('setIsOnboarded(true)');
    const dbUpdateIdx = completeBody.indexOf('.update(');
    expect(setStateIdx).toBeGreaterThan(-1);
    expect(dbUpdateIdx).toBeGreaterThan(setStateIdx);
  });
});
