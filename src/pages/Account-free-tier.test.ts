/**
 * Account page — free-tier UI source verification.
 *
 * Free users can't trade. Two follow-ups from the 2026-05-05 onboarding call
 * (docs/user-research/lota-2026-05-05.md):
 *
 *   1. The "Connected wallet" row created the impression of a funded trading
 *      account that doesn't exist. Hidden on free tier.
 *
 *   2. The "Enable trading" button + "$0.00 balance" framing created the same
 *      ready-to-trade impression. Replaced for free users with a clean upgrade
 *      pitch card (heading + body + "View plans" button) that opens the tier
 *      comparison sheet. The $0.00 balance frame is NOT rendered for free.
 *
 * These tests pin the source contract so we don't silently revert either fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const accountSrc = readFileSync(resolve(__dirname, './Account.tsx'), 'utf-8');

describe('ACCOUNT-SRC: free-tier hides wallet address', () => {
  it('gates the Connected wallet SettingsItem behind currentTier !== "free"', () => {
    expect(accountSrc).toMatch(
      /currentTier !== ['"]free['"][\s\S]{0,400}label=["']Connected wallet["']/
    );
  });

  it('does not render WalletPanel unconditionally', () => {
    const walletPanelMatches = accountSrc.match(/<WalletPanel\s/g) ?? [];
    expect(walletPanelMatches.length).toBeLessThanOrEqual(1);
  });
});

describe('ACCOUNT-SRC: free-tier replaces wallet card with upgrade pitch', () => {
  it('BalanceCard receives the current tier as a prop', () => {
    expect(accountSrc).toMatch(/<BalanceCard[\s\S]{0,400}tier=\{currentTier\}/);
  });

  it('BalanceCard receives an onUpgradeClick that opens the tier sheet', () => {
    expect(accountSrc).toMatch(
      /<BalanceCard[\s\S]{0,400}onUpgradeClick=\{\(\) => setShowTierSheet\(true\)\}/
    );
  });

  it('renders an upgrade pitch heading for free users', () => {
    expect(accountSrc).toContain('Trading is on paid plans');
  });

  it('renders the canonical upgradeLabel-shaped body copy', () => {
    // Mirrors the "Upgrade your plan to ..." pattern from useTierAccess.upgradeLabel.
    expect(accountSrc).toContain('Upgrade your plan to enable trading');
  });

  it('uses the canonical "View plans" button copy', () => {
    // Matches TrackRecord.tsx empty-state CTA. Consistency with rest of app.
    expect(accountSrc).toMatch(/>\s*View plans\s*</);
  });

  it('does NOT introduce non-canonical "Subscribe" wording on free', () => {
    // The product uses "Upgrade" for tier changes. "Subscribe" is reserved for
    // the first-time plan-select screen in Onboarding.tsx.
    const balanceCardSrc = accountSrc.slice(
      accountSrc.indexOf('function BalanceCard'),
      accountSrc.indexOf('function BalanceCard') + 4000
    );
    expect(balanceCardSrc).not.toMatch(/Subscribe to/);
  });

  it('keeps the original "Enable trading" CTA for paid users', () => {
    expect(accountSrc).toContain('Enable trading');
  });

  it('uses an isFree early-return to cover both no-wallet and has-wallet free states', () => {
    // The free branch must short-circuit at the top of BalanceCard so a free
    // user with legacy wallet state still gets the upgrade pitch, not the
    // balance frame with $0.00.
    const balanceCardStart = accountSrc.indexOf('function BalanceCard');
    const noWalletBranchStart = accountSrc.indexOf(
      '!isTradingEnabled || !hasWallet',
      balanceCardStart
    );
    const isFreeReturn = accountSrc.indexOf('if (isFree)', balanceCardStart);
    expect(isFreeReturn).toBeGreaterThan(balanceCardStart);
    expect(isFreeReturn).toBeLessThan(noWalletBranchStart);
  });
});

describe('ACCOUNT-SRC: voice rules on new copy', () => {
  it('does not introduce em dashes in the new free-tier copy block', () => {
    const anchor = accountSrc.indexOf('Trading is on paid plans');
    const newCopySnippet = accountSrc.slice(anchor - 100, anchor + 600);
    expect(newCopySnippet).not.toMatch(/—/);
  });

  it('does not use "Try free" or "free trial" framing in the new CTA', () => {
    const anchor = accountSrc.indexOf('Trading is on paid plans');
    const newCopySnippet = accountSrc.slice(Math.max(0, anchor - 400), anchor + 600);
    expect(newCopySnippet).not.toMatch(/try free/i);
    expect(newCopySnippet).not.toMatch(/free trial/i);
  });
});
