/**
 * V1 Trading Blocks — Source-verification + Adversarial Tests
 *
 * Tests cover:
 * - Balance card (BalancePanel in Account.tsx)
 * - Pending proposals banner (PendingProposalsBanner.tsx)
 * - Nav badge (Layout.tsx)
 * - Execution status lifecycle (TradeProposalCard.tsx)
 * - Balance check before trade acceptance (TradeProposalCard.tsx)
 * - Treasury transparency (TreasuryInfo in Account.tsx)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

// ────────────────────────────────────────────────────────────
// Source file reads
// ────────────────────────────────────────────────────────────
const accountSrc = readFileSync(resolve(__dirname, '../pages/Account.tsx'), 'utf-8');
const proposalCardSrc = readFileSync(resolve(__dirname, './TradeProposalCard.tsx'), 'utf-8');
const bannerSrc = readFileSync(resolve(__dirname, './PendingProposalsBanner.tsx'), 'utf-8');
const layoutSrc = readFileSync(resolve(__dirname, './Layout.tsx'), 'utf-8');
const assetDetailSrc = readFileSync(resolve(__dirname, '../pages/AssetDetail.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════
// BALANCE-SRC: Source-verification — Balance Panel
// ════════════════════════════════════════════════════════════
describe('BALANCE-SRC: BalancePanel renders correctly', () => {
  it('shows balance from wallet.balance_usdc (not hardcoded)', () => {
    expect(accountSrc).toContain('wallet.balance_usdc');
    expect(accountSrc).toContain('balance.toLocaleString');
  });

  it('distinguishes testnet vs mainnet environment', () => {
    expect(accountSrc).toContain("wallet.environment === 'testnet'");
  });

  it('shows "Get test USDC" only on testnet', () => {
    expect(accountSrc).toContain('{isTestnet && (');
    expect(accountSrc).toContain('Get test USDC');
  });

  it('requires isTradingEnabled AND hasWallet before showing balance', () => {
    expect(accountSrc).toContain('!isTradingEnabled || !hasWallet || !wallet');
  });

  it('shows coming soon placeholders for card deposit and withdrawal', () => {
    expect(accountSrc).toContain('Deposit from card');
    expect(accountSrc).toContain('Withdraw to external wallet');
  });
});

// ════════════════════════════════════════════════════════════
// BALANCE-ADV: Adversarial — Balance Panel
// ════════════════════════════════════════════════════════════
describe('BALANCE-ADV: Balance Panel adversarial checks', () => {
  it('ADV: no hardcoded balance values in BalancePanel', () => {
    // Extract BalancePanel function body
    const panelStart = accountSrc.indexOf('function BalancePanel()');
    const panelEnd = accountSrc.indexOf('function TreasuryInfo()');
    const panelSrc = accountSrc.slice(panelStart, panelEnd);

    // Should not contain hardcoded dollar amounts
    expect(panelSrc).not.toMatch(/\$\d{2,}/);
    // Balance should come from wallet object
    expect(panelSrc).toContain('wallet.balance_usdc');
  });

  it('ADV: guard prevents balance display when wallet is null', () => {
    // The guard must return early before accessing wallet properties
    const panelStart = accountSrc.indexOf('function BalancePanel()');
    const guardIndex = accountSrc.indexOf('!isTradingEnabled || !hasWallet || !wallet', panelStart);
    const balanceAccess = accountSrc.indexOf('wallet.balance_usdc', panelStart);

    // Guard must appear before balance access
    expect(guardIndex).toBeLessThan(balanceAccess);
  });

  it('ADV: fund wallet link uses target="_blank" with noopener noreferrer', () => {
    const panelStart = accountSrc.indexOf('function BalancePanel()');
    const panelEnd = accountSrc.indexOf('function TreasuryInfo()');
    const panelSrc = accountSrc.slice(panelStart, panelEnd);

    // Every external link must have noopener noreferrer
    const hrefMatches = panelSrc.match(/href="https?:\/\//g) || [];
    const noopenerMatches = panelSrc.match(/rel="noopener noreferrer"/g) || [];
    expect(hrefMatches.length).toBeGreaterThan(0);
    expect(noopenerMatches.length).toBe(hrefMatches.length);
  });
});

// ════════════════════════════════════════════════════════════
// TREASURY-SRC: Source-verification — Treasury Info
// ════════════════════════════════════════════════════════════
describe('TREASURY-SRC: TreasuryInfo renders correctly', () => {
  it('reads treasury address from env var, not hardcoded', () => {
    expect(accountSrc).toContain('import.meta.env.VITE_SAFE_TREASURY_ADDRESS');
  });

  it('returns null when address is not set', () => {
    const treasuryStart = accountSrc.indexOf('function TreasuryInfo()');
    const treasuryBody = accountSrc.slice(treasuryStart, treasuryStart + 500);
    expect(treasuryBody).toContain('if (!address) return null');
  });

  it('links to Arbiscan with the correct address', () => {
    expect(accountSrc).toContain('https://arbiscan.io/address/${address}');
  });
});

// ════════════════════════════════════════════════════════════
// TREASURY-ADV: Adversarial — Treasury Info
// ════════════════════════════════════════════════════════════
describe('TREASURY-ADV: Treasury Info adversarial checks', () => {
  it('ADV: treasury address is never hardcoded in source', () => {
    // Should not contain a raw Ethereum address (0x followed by 40 hex chars)
    const treasuryStart = accountSrc.indexOf('function TreasuryInfo()');
    const treasuryEnd = accountSrc.indexOf('function SupportPanel()');
    const treasurySrc = accountSrc.slice(treasuryStart, treasuryEnd);

    // No hardcoded 0x addresses
    expect(treasurySrc).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it('ADV: external links use noopener noreferrer', () => {
    const treasuryStart = accountSrc.indexOf('function TreasuryInfo()');
    const treasuryEnd = accountSrc.indexOf('function SupportPanel()');
    const treasurySrc = accountSrc.slice(treasuryStart, treasuryEnd);

    const targetBlankCount = (treasurySrc.match(/target="_blank"/g) || []).length;
    const noopenerCount = (treasurySrc.match(/rel="noopener noreferrer"/g) || []).length;
    expect(targetBlankCount).toBe(noopenerCount);
    expect(targetBlankCount).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// PROPOSAL-SRC: Source-verification — Trade Proposal Card
// ════════════════════════════════════════════════════════════
describe('PROPOSAL-SRC: TradeProposalCard execution lifecycle', () => {
  it('handles all terminal statuses: executed, failed, declined, expired', () => {
    expect(proposalCardSrc).toContain("case 'executed':");
    expect(proposalCardSrc).toContain("case 'failed':");
    expect(proposalCardSrc).toContain("case 'declined':");
    expect(proposalCardSrc).toContain("case 'expired':");
  });

  it('handles in-flight statuses: approved, auto_approved, executing', () => {
    expect(proposalCardSrc).toContain("case 'approved':");
    expect(proposalCardSrc).toContain("case 'auto_approved':");
    expect(proposalCardSrc).toContain("case 'executing':");
  });

  it('shows LoadingSpinner for in-flight statuses', () => {
    expect(proposalCardSrc).toContain('isInFlight && <LoadingSpinner');
  });

  it('has a default/fallback case for unknown statuses', () => {
    expect(proposalCardSrc).toContain('default:');
    // Default should dim the card
    expect(proposalCardSrc).toMatch(/default:\s*\n\s*return\s*\{[\s\S]*?dimmed:\s*true/);
  });

  it('shows checkmark icon only for executed status', () => {
    expect(proposalCardSrc).toContain("proposal.status === 'executed'");
  });

  it('shows error icon only for failed status', () => {
    expect(proposalCardSrc).toContain("proposal.status === 'failed'");
  });
});

// ════════════════════════════════════════════════════════════
// PROPOSAL-ADV: Adversarial — Trade Proposal Card
// ════════════════════════════════════════════════════════════
describe('PROPOSAL-ADV: TradeProposalCard adversarial checks', () => {
  it('ADV: balance check is non-blocking (shows warning, allows "Accept anyway")', () => {
    // The balance warning should show a bypass option
    expect(proposalCardSrc).toContain('Accept anyway');
    // handleAcceptClick shows warning first, then allows proceeding
    expect(proposalCardSrc).toContain('setShowBalanceWarning(true)');
  });

  it('ADV: balance check only applies to non-trim proposals', () => {
    // insufficientBalance must check !isTrim
    expect(proposalCardSrc).toContain('!isTrim');
    expect(proposalCardSrc).toContain('walletBalance < proposal.proposed_size_usd');
  });

  it('ADV: balance check requires walletBalance to be defined (not just truthy)', () => {
    // Should check !== undefined, not just truthiness (0 balance is valid)
    expect(proposalCardSrc).toContain('walletBalance !== undefined');
  });

  it('ADV: action buttons are disabled while acting (prevents double-click)', () => {
    expect(proposalCardSrc).toContain('disabled={acting !== null}');
  });

  it('ADV: error state resets on new action attempt', () => {
    expect(proposalCardSrc).toContain('setError(null)');
    expect(proposalCardSrc).toContain('setShowBalanceWarning(false)');
  });

  it('ADV: non-pending statuses cannot trigger accept/decline actions', () => {
    // The non-pending branch returns early with a status card, no action buttons
    const nonPendingStart = proposalCardSrc.indexOf("if (proposal.status !== 'pending')");
    const nonPendingEnd = proposalCardSrc.indexOf('return (', nonPendingStart + 50);
    const returnEnd = proposalCardSrc.indexOf('  }', nonPendingEnd);
    const nonPendingBlock = proposalCardSrc.slice(nonPendingStart, returnEnd);

    // No onClick handlers for accept/decline in non-pending branch
    expect(nonPendingBlock).not.toContain('onAccept');
    expect(nonPendingBlock).not.toContain('onDecline');
    expect(nonPendingBlock).not.toContain('handleAction');
    expect(nonPendingBlock).not.toContain('handleAcceptClick');
  });

  it('ADV: expired proposals cannot be accepted (buttons hidden)', () => {
    // Action buttons are wrapped in {!expired && (...)}
    expect(proposalCardSrc).toContain('{!expired && (');
  });
});

// ════════════════════════════════════════════════════════════
// BANNER-SRC: Source-verification — Pending Proposals Banner
// ════════════════════════════════════════════════════════════
describe('BANNER-SRC: PendingProposalsBanner renders correctly', () => {
  it('filters only pending proposals', () => {
    expect(bannerSrc).toContain("p.status === 'pending'");
  });

  it('returns null when no pending proposals exist', () => {
    expect(bannerSrc).toContain('if (pending.length === 0) return null');
  });

  it('navigates to asset detail page', () => {
    expect(bannerSrc).toContain('/asset/${');
  });

  it('shows correct singular/plural label', () => {
    expect(bannerSrc).toContain('1 trade waiting for your approval');
    expect(bannerSrc).toContain('trades waiting for your approval');
  });
});

// ════════════════════════════════════════════════════════════
// BANNER-ADV: Adversarial — Pending Proposals Banner
// ════════════════════════════════════════════════════════════
describe('BANNER-ADV: PendingProposalsBanner adversarial checks', () => {
  it('ADV: non-pending statuses are excluded from count', () => {
    // Must use strict equality check on "pending" status
    expect(bannerSrc).toContain("p.status === 'pending'");
    // Must NOT match on substring or partial status names
    expect(bannerSrc).not.toContain('.includes');
    expect(bannerSrc).not.toContain('.startsWith');
  });

  it('ADV: handles single-asset and multi-asset proposals correctly', () => {
    // Uses unique asset set logic
    expect(bannerSrc).toContain('new Set(pending.map(p => p.asset_id))');
    // Falls back to first proposal asset when multiple assets
    expect(bannerSrc).toContain('pending[0].asset_id');
  });
});

// ════════════════════════════════════════════════════════════
// NAV-SRC: Source-verification — Nav Badge
// ════════════════════════════════════════════════════════════
describe('NAV-SRC: Layout nav badge for pending proposals', () => {
  it('counts only pending proposals for badge', () => {
    expect(layoutSrc).toContain("p.status === 'pending'");
  });

  it('only shows badge on Signals tab (path "/")', () => {
    expect(layoutSrc).toContain("item.path === '/' && pendingCount > 0");
  });

  it('caps badge at 9+', () => {
    expect(layoutSrc).toContain("pendingCount > 9 ? '9+' : pendingCount");
  });
});

// ════════════════════════════════════════════════════════════
// NAV-ADV: Adversarial — Nav Badge
// ════════════════════════════════════════════════════════════
describe('NAV-ADV: Nav badge adversarial checks', () => {
  it('ADV: badge count uses strict "pending" filter (not approved/executing)', () => {
    // The filter must be === 'pending', not a broader check
    const filterMatch = layoutSrc.match(/proposals\.filter\(p\s*=>\s*p\.status\s*===\s*'(\w+)'\)/);
    expect(filterMatch).not.toBeNull();
    expect(filterMatch![1]).toBe('pending');
  });

  it('ADV: badge does not appear on non-Signals tabs', () => {
    // The conditional must check item.path === '/'
    expect(layoutSrc).toContain("item.path === '/'");
  });
});

// ════════════════════════════════════════════════════════════
// ASSET-ADV: Adversarial — AssetDetail proposal display
// ════════════════════════════════════════════════════════════
describe('ASSET-ADV: AssetDetail proposal rendering adversarial checks', () => {
  it('ADV: passes walletBalance to TradeProposalCard', () => {
    expect(assetDetailSrc).toContain('walletBalance={wallet?.balance_usdc}');
  });

  it('ADV: in-flight proposals are scoped to current asset', () => {
    expect(assetDetailSrc).toContain('p.asset_id === assetId');
  });

  it('ADV: proposals only shown for authenticated users', () => {
    // Both pending and active proposals check isAuthenticated
    expect(assetDetailSrc).toMatch(/const pendingProposals = isAuthenticated/);
    expect(assetDetailSrc).toMatch(/const activeProposals = isAuthenticated/);
  });

  it('ADV: in-flight statuses are explicitly listed (not a wildcard)', () => {
    expect(assetDetailSrc).toContain("'approved', 'auto_approved', 'executing', 'executed', 'failed'");
  });
});
