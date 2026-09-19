/**
 * Consumption-reduction poll intervals — source verification.
 *
 * These two intervals were raised from 30 seconds to 5 minutes on
 * 2026-09-19 after a load audit found them contributing to Nano/Micro
 * tier compute saturation (see 2026-09-19 consumption audit + retro).
 * Both are safety-net fallbacks behind live Realtime channels, not the
 * primary refresh path.
 *
 * This file pins the values so a silent revert (or a mid-diff tweak
 * during a refactor) either direction gets caught. Not an adversarial
 * behavior test, just a floor guarantee.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const useTradingSrc = readFileSync(resolve(__dirname, './useTrading.ts'), 'utf-8');
const accountSrc = readFileSync(resolve(__dirname, '../pages/Account.tsx'), 'utf-8');

describe('POLL-SRC: fallback poll intervals stay at 5 minutes', () => {
  it('useTrading POLL_INTERVAL_MS is 5 minutes', () => {
    expect(useTradingSrc).toMatch(/const POLL_INTERVAL_MS\s*=\s*5\s*\*\s*60_000\s*;/);
  });

  it('useTrading does NOT set the poll to 30 seconds', () => {
    expect(useTradingSrc).not.toMatch(/const POLL_INTERVAL_MS\s*=\s*30_000/);
  });

  it('Account recent-activity poll runs every 5 minutes, not every 30 seconds', () => {
    expect(accountSrc).toMatch(/setInterval\([^,]+,\s*5\s*\*\s*60_000\s*\)/);
    expect(accountSrc).not.toMatch(/setInterval\([^,]+,\s*30_000\s*\)/);
  });
});
