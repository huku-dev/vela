/**
 * Home page — free-tier locked card wiring (source verification).
 *
 * Per the 2026-05-05 onboarding call: free users should see signal direction,
 * price, and 24h change on locked cards. Only the trade action and detailed
 * brief are gated behind paid. This test pins the call site so we don't
 * silently drop the signal/priceData wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const homeSrc = readFileSync(resolve(__dirname, './Home.tsx'), 'utf-8');

describe('HOME-SRC: LockedSignalCard receives signal direction + price', () => {
  it('passes the asset signal to LockedSignalCard', () => {
    expect(homeSrc).toMatch(/<LockedSignalCard[\s\S]{0,400}signal=\{item\.signal\}/);
  });

  it('passes the asset priceData to LockedSignalCard', () => {
    expect(homeSrc).toMatch(/<LockedSignalCard[\s\S]{0,400}priceData=\{item\.priceData\}/);
  });

  it('still opens the tier comparison sheet on upgrade click', () => {
    expect(homeSrc).toMatch(
      /<LockedSignalCard[\s\S]{0,400}onUpgradeClick=\{\(\) => setShowTierSheet\(true\)\}/
    );
  });

  it('uses per-asset upgrade label copy (matches the aria-label personalization)', () => {
    // Per-asset framing matches the existing aria-label in LockedSignalCard
    // ("Upgrade to unlock {asset.name} signals"). Generic copy was a regression.
    expect(homeSrc).toMatch(
      /upgradeLabel\(`see \$\{item\.asset\.symbol\} trades and full briefs`\)/
    );
  });

  it('does NOT pass a briefHeadline prop (removed as dead)', () => {
    expect(homeSrc).not.toMatch(/<LockedSignalCard[\s\S]{0,400}briefHeadline=/);
  });
});
