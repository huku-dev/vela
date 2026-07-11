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
      /<BalanceCard[\s\S]{0,700}onUpgradeClick=\{\(\) => setShowTierSheet\(true\)\}/
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

describe('ACCOUNT-SRC: free-tier residual-balance withdrawal path', () => {
  // Downgraded users with a positive wallet balance must be able to retrieve
  // their funds without resubscribing. Backend already accepts free-tier
  // withdrawals (tier_config.max_daily_withdrawal_usd > 0); this suite pins
  // the frontend contract that gives users the entry point.
  const balanceCardStart = accountSrc.indexOf('function BalanceCard');
  const balanceCardEnd = accountSrc.indexOf('\n}\n', balanceCardStart);
  const balanceCardSrc = accountSrc.slice(balanceCardStart, balanceCardEnd);

  // Residual-balance branch = from banner to the top of the next branch
  // (paid, no wallet). Bounding this precisely avoids false hits from the
  // paid-tier code that follows in the same function body.
  const residualStart = balanceCardSrc.indexOf('Your paid plan ended');
  const paidNoWalletStart = balanceCardSrc.indexOf(
    '!isTradingEnabled || !hasWallet',
    residualStart
  );
  const residualSrc = balanceCardSrc.slice(residualStart, paidNoWalletStart);

  it('branches on hasResidualBalance inside the isFree path', () => {
    expect(balanceCardSrc).toMatch(/hasResidualBalance/);
  });

  it('detects residual balance from either balance_usdc or available_balance', () => {
    expect(balanceCardSrc).toMatch(
      /hasWallet[\s\S]{0,120}(totalValue > 0|availableForWithdraw > 0)/
    );
  });

  it('renders the "Your paid plan ended" banner in the residual-balance branch', () => {
    expect(balanceCardSrc).toContain('Your paid plan ended');
  });

  it('renders the approved banner body copy', () => {
    expect(balanceCardSrc).toContain(
      'Withdraw below or upgrade your plan to resume trading.'
    );
  });

  it('wires Withdraw button to onWithdrawClick in the residual-balance branch', () => {
    expect(residualSrc).toMatch(/onClick=\{\(\) => onWithdrawClick\?\.\(\)/);
  });

  it('does NOT render a Deposit button in the residual-balance branch', () => {
    // Depositing remains gated by tier. Users retrieving stranded funds
    // should not accidentally push more capital into a locked wallet.
    expect(residualSrc).not.toMatch(/onDepositClick/);
    expect(residualSrc).not.toMatch(/>\s*Deposit\s*</);
  });

  it('disables Withdraw when Available is below the $3 tier minimum', () => {
    expect(balanceCardSrc).toMatch(/canWithdraw\s*=\s*availableForWithdraw >= 3/);
    expect(balanceCardSrc).toMatch(/disabled=\{!canWithdraw\}/);
  });

  it('surfaces the $3 minimum notice when balance is between $0 and $3', () => {
    expect(balanceCardSrc).toContain('$3 minimum withdrawal (covers $2 in fees).');
  });

  it('renders both Available and In trades rows, matching the paid card', () => {
    expect(residualSrc).toContain('Available');
    expect(residualSrc).toContain('In trades');
  });

  it('does not introduce em dashes in the residual-balance copy block', () => {
    expect(residualSrc).not.toMatch(/—/);
  });
});

describe('ACCOUNT-SRC: false-fire guards on the residual-balance banner', () => {
  // The "Your paid plan ended" banner must only fire when the user actually
  // has a paid-plan history. Two failure modes to guard against:
  //   1. A never-paid user with trial-trade residual funds (real product path).
  //   2. A currently-paying user on a cold subscription cache where `tier`
  //      transiently defaults to 'free' before the fetch resolves.
  it('BalanceCard accepts a wasPreviouslyPaid prop', () => {
    expect(accountSrc).toMatch(/wasPreviouslyPaid\?:\s*boolean/);
  });

  it('BalanceCard accepts a subscriptionLoading prop', () => {
    expect(accountSrc).toMatch(/subscriptionLoading\?:\s*boolean/);
  });

  it('call site derives wasPreviouslyPaid from subscription.provider_subscription_id', () => {
    expect(accountSrc).toMatch(
      /wasPreviouslyPaid=\{subscription\?\.provider_subscription_id\s*!=\s*null\}/
    );
  });

  it('call site passes isLoading from useSubscription as subscriptionLoading', () => {
    expect(accountSrc).toMatch(/subscriptionLoading=\{subscriptionLoading\}/);
    expect(accountSrc).toMatch(/isLoading:\s*subscriptionLoading/);
  });

  it('useSubscription defaults isLoading to true when the cache is cold', () => {
    // Cold cache = no seeded subscription. Without this, first paint sees
    // isLoading=false + tier='free', and the residual card flashes wrongly
    // for a currently-paying user on a fresh session.
    const src = readFileSync(
      resolve(__dirname, '../hooks/useSubscription.ts'),
      'utf-8'
    );
    expect(src).toMatch(
      /useState\(\(\) => getCachedSubscription\(\) === null\)/
    );
  });

  it('BalanceCard renders a loading skeleton when subscriptionLoading and isFree', () => {
    const balanceCardStart = accountSrc.indexOf('function BalanceCard');
    const balanceCardSrc = accountSrc.slice(balanceCardStart, balanceCardStart + 5000);
    expect(balanceCardSrc).toMatch(/isFree && subscriptionLoading/);
    expect(balanceCardSrc).toMatch(/Loading balance/);
  });

  it('residual banner title branches on wasPreviouslyPaid', () => {
    const balanceCardStart = accountSrc.indexOf('function BalanceCard');
    const balanceCardEnd = accountSrc.indexOf('\n}\n', balanceCardStart);
    const balanceCardSrc = accountSrc.slice(balanceCardStart, balanceCardEnd);
    // Never-paid user gets tier-agnostic "Withdraw your balance"
    expect(balanceCardSrc).toContain("'Withdraw your balance'");
    // Downgraded user keeps the "Your paid plan ended" phrasing
    expect(balanceCardSrc).toContain("'Your paid plan ended'");
    // Both must be tied to wasPreviouslyPaid
    expect(balanceCardSrc).toMatch(/wasPreviouslyPaid\s*\?\s*'Your paid plan ended'/);
  });

  it('never-paid banner body uses "start trading" not "resume trading"', () => {
    const balanceCardStart = accountSrc.indexOf('function BalanceCard');
    const balanceCardEnd = accountSrc.indexOf('\n}\n', balanceCardStart);
    const balanceCardSrc = accountSrc.slice(balanceCardStart, balanceCardEnd);
    expect(balanceCardSrc).toContain('to start trading.');
    expect(balanceCardSrc).toContain('to resume trading.');
  });
});

describe('ACCOUNT-SRC: residual-balance edge cases (float noise + fully-in-trades)', () => {
  const balanceCardStart = accountSrc.indexOf('function BalanceCard');
  const balanceCardEnd = accountSrc.indexOf('\n}\n', balanceCardStart);
  const balanceCardSrc = accountSrc.slice(balanceCardStart, balanceCardEnd);

  it('clamps inTrades to zero to defuse balance/available sync race', () => {
    // available_balance and balance_usdc are written by independent syncs
    // (position-monitor + refresh-balance); if available lands after total
    // shrinks, `inTrades = total - available` can go negative and render
    // as "-$4.20 in trades" — nonsensical and scary on financial UI.
    expect(balanceCardSrc).toMatch(
      /inTrades\s*=\s*Math\.max\(0,\s*totalValue - availableForWithdraw\)/
    );
  });

  it('surfaces the fully-in-trades reason when Withdraw is disabled', () => {
    // Available === $0 but total > $0 means all funds are tied up in open
    // positions. Prior implementation hid the sub-$3 notice at exactly zero,
    // leaving the disabled Withdraw button with no explanation.
    expect(balanceCardSrc).toContain('Your balance is in open trades.');
  });

  it('shows the sub-$3 minimum notice when available is between $0 and $3', () => {
    expect(balanceCardSrc).toContain('$3 minimum withdrawal (covers $2 in fees).');
  });

  it('branches the notice on availableForWithdraw === 0 vs > 0', () => {
    // Two distinct copies for two distinct disabled states; the guard must
    // be inside the render, not on the outer conditional.
    expect(balanceCardSrc).toMatch(
      /availableForWithdraw === 0 && inTrades > 0/
    );
  });
});
