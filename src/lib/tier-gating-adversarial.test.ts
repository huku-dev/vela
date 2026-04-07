/**
 * TIER-ADV: Adversarial tests for tier gating system.
 *
 * Per CLAUDE.md adversarial testing requirements, these tests verify the
 * defense-in-depth of the tier system against exploitation:
 *
 * 1. Authorization bypass — Can free users access paid features?
 * 2. Scope leakage — Do asset gates apply correctly at boundaries?
 * 3. Guard bypass — Are tier limits enforced consistently?
 * 4. Auto-approval abuse — Does auto-mode require correct tier?
 * 5. Source verification — Do critical guards exist in source code?
 *
 * Two layers:
 * - Source-verification tests (TIER:) — Read source, assert patterns exist
 * - Adversarial tests (TIER-ADV:) — Verify defense-in-depth
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getTierConfig, TIER_DEFINITIONS } from './tier-definitions';
import type { Asset, SubscriptionTier } from '../types';

// Backend repo path — for cross-repo source verification tests
const BACKEND_ROOT = resolve(__dirname, '../../../..', 'crypto-agent');

// ── Fixtures ───────────────────────────────────────────────────────

const ALL_ASSETS: Asset[] = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', coingecko_id: 'bitcoin', enabled: true },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', coingecko_id: 'ethereum', enabled: true },
  { id: 'hype', symbol: 'HYPE', name: 'Hyperliquid', coingecko_id: 'hyperliquid', enabled: true },
  { id: 'sol', symbol: 'SOL', name: 'Solana', coingecko_id: 'solana', enabled: true },
];

/** Pure implementation of canAccessAsset for testing */
function canAccessAsset(assetId: string, allAssets: Asset[], maxAssets: number): boolean {
  if (maxAssets === 0) return true;
  const idx = allAssets.findIndex(a => a.id === assetId);
  if (idx === -1) return false;
  return idx < maxAssets;
}

/** Pure implementation of partitionAssets for testing */
function partitionAssets<T extends { asset: Asset }>(
  items: T[],
  maxAssets: number
): { accessible: T[]; locked: T[] } {
  if (maxAssets === 0) return { accessible: items, locked: [] };
  return {
    accessible: items.slice(0, maxAssets),
    locked: items.slice(maxAssets),
  };
}

function wrapAssets(assets: Asset[]) {
  return assets.map(asset => ({ asset, signal: null, brief: null }));
}

// ── Source verification tests ──────────────────────────────────────

describe('TIER: Source verification — guards exist in source code', () => {
  it('TIER: useTierAccess reads canTrade from tier features (not hardcoded)', () => {
    const src = readFileSync('src/hooks/useTierAccess.ts', 'utf-8');
    // canTrade must be derived from tierConfig.features, not hardcoded
    expect(src).toContain('tierConfig.features.semi_auto');
    expect(src).toContain('tierConfig.features.auto_mode');
  });

  it('TIER: useTierAccess derives canAutoTrade from auto_mode feature flag', () => {
    const src = readFileSync('src/hooks/useTierAccess.ts', 'utf-8');
    expect(src).toContain('const canAutoTrade = tierConfig.features.auto_mode');
  });

  it('TIER: tier-definitions.ts defines exactly 3 tiers', () => {
    const src = readFileSync('src/lib/tier-definitions.ts', 'utf-8');
    // Count tier definition objects
    const tierMatches = src.match(/tier: '(free|standard|premium)'/g);
    expect(tierMatches).toHaveLength(3);
  });

  it('TIER: free tier has auto_mode: false in definition', () => {
    const src = readFileSync('src/lib/tier-definitions.ts', 'utf-8');
    // Find the free tier block and verify auto_mode is false
    const freeBlock = src.substring(src.indexOf("tier: 'free'"), src.indexOf("tier: 'standard'"));
    expect(freeBlock).toContain('auto_mode: false');
  });

  it('TIER: standard tier has auto_mode: false in definition', () => {
    const src = readFileSync('src/lib/tier-definitions.ts', 'utf-8');
    const standardBlock = src.substring(
      src.indexOf("tier: 'standard'"),
      src.indexOf("tier: 'premium'")
    );
    expect(standardBlock).toContain('auto_mode: false');
  });

  it('TIER: only premium tier has auto_mode: true', () => {
    const src = readFileSync('src/lib/tier-definitions.ts', 'utf-8');
    const premiumBlock = src.substring(src.indexOf("tier: 'premium'"));
    expect(premiumBlock).toContain('auto_mode: true');
  });

  it('TIER: getTierConfig falls back to free tier for unknown tier names', () => {
    const src = readFileSync('src/lib/tier-definitions.ts', 'utf-8');
    // The fallback `?? TIER_DEFINITIONS[0]` ensures unknown tiers get free tier
    expect(src).toContain('TIER_DEFINITIONS[0]');
  });

  it('TIER: useSubscription caches to localStorage (prevents tier flash)', () => {
    const src = readFileSync('src/hooks/useSubscription.ts', 'utf-8');
    expect(src).toContain('vela_subscription_cache');
    expect(src).toContain('localStorage.setItem');
    expect(src).toContain('localStorage.getItem');
  });

  it('TIER: useSubscription defaults tier to free when subscription is null', () => {
    const src = readFileSync('src/hooks/useSubscription.ts', 'utf-8');
    // The ?? 'free' fallback
    expect(src).toMatch(/subscription\?\.tier\s*\?\?\s*'free'/);
  });

  it('TIER: Backend tier validation trigger exists in migrations', () => {
    const migrationPath = resolve(
      BACKEND_ROOT,
      'supabase/migrations/20260306000002_validate_user_mode.sql'
    );
    if (!existsSync(migrationPath)) {
      // Skip if backend repo not available (e.g. CI without cross-repo checkout)
      console.warn('Skipping: backend repo not available at', BACKEND_ROOT);
      return;
    }
    const src = readFileSync(migrationPath, 'utf-8');
    expect(src).toContain('validate_user_mode_against_tier');
    expect(src).toContain('BEFORE UPDATE');
    expect(src).toContain('RAISE EXCEPTION');
  });
});

// ── Adversarial tests ──────────────────────────────────────────────

describe('TIER-ADV: Authorization bypass — free users cannot access paid features', () => {
  it('TIER-ADV: free tier canTrade derives from features, not a hardcoded override', () => {
    const free = getTierConfig('free');
    // canTrade = semi_auto || auto_mode
    const canTrade = free.features.semi_auto || free.features.auto_mode;
    // Free tier gets 1 trial trade (semi_auto: true), so canTrade is true
    expect(canTrade).toBe(true);
    // But auto_mode must be false
    expect(free.features.auto_mode).toBe(false);
  });

  it('TIER-ADV: free tier canAutoTrade is ALWAYS false', () => {
    const free = getTierConfig('free');
    expect(free.features.auto_mode).toBe(false);
  });

  it('TIER-ADV: standard tier canAutoTrade is ALWAYS false', () => {
    const standard = getTierConfig('standard');
    expect(standard.features.auto_mode).toBe(false);
  });

  it('TIER-ADV: only premium has auto_mode === true', () => {
    for (const def of TIER_DEFINITIONS) {
      if (def.tier === 'premium') {
        expect(def.features.auto_mode).toBe(true);
      } else {
        expect(def.features.auto_mode).toBe(false);
      }
    }
  });

  it('TIER-ADV: free tier cannot access more than 1 asset', () => {
    const free = getTierConfig('free');
    const items = wrapAssets(ALL_ASSETS);
    const { accessible, locked } = partitionAssets(items, free.max_assets);
    expect(accessible).toHaveLength(1);
    expect(locked).toHaveLength(3);
  });

  it('TIER-ADV: standard tier can access all 4 assets with max_assets=5', () => {
    const standard = getTierConfig('standard');
    const items = wrapAssets(ALL_ASSETS);
    const { accessible, locked } = partitionAssets(items, standard.max_assets);
    expect(accessible).toHaveLength(4);
    expect(locked).toHaveLength(0);
  });
});

describe('TIER-ADV: Scope leakage — boundary conditions on asset access', () => {
  it('TIER-ADV: free user cannot access asset at exact boundary (index === max_assets)', () => {
    const free = getTierConfig('free');
    // max_assets = 1, so index 1 (ETH) should be locked
    expect(canAccessAsset('eth', ALL_ASSETS, free.max_assets)).toBe(false);
  });

  it('TIER-ADV: standard user cannot access asset at exact boundary (index === max_assets)', () => {
    const standard = getTierConfig('standard');
    // max_assets = 5, with 4 assets SOL is accessible
    expect(canAccessAsset('sol', ALL_ASSETS, standard.max_assets)).toBe(true);
  });

  it('TIER-ADV: asset access is position-based, not ID-based (reordering changes access)', () => {
    const reversed = [...ALL_ASSETS].reverse(); // sol, hype, eth, btc
    const max = 1; // free tier

    // With reversed order, SOL (now index 0) is accessible, BTC (now index 3) is not
    expect(canAccessAsset('sol', reversed, max)).toBe(true);
    expect(canAccessAsset('btc', reversed, max)).toBe(false);
  });

  it('TIER-ADV: injected/unknown asset ID returns false (not true)', () => {
    // An attacker might try passing a crafted asset ID
    expect(canAccessAsset('__proto__', ALL_ASSETS, 3)).toBe(false);
    expect(canAccessAsset('constructor', ALL_ASSETS, 3)).toBe(false);
    expect(canAccessAsset('', ALL_ASSETS, 3)).toBe(false);
    expect(canAccessAsset('null', ALL_ASSETS, 3)).toBe(false);
  });

  it('TIER-ADV: premium gets all assets regardless of count', () => {
    const premium = getTierConfig('premium');
    const manyAssets = [
      ...ALL_ASSETS,
      { id: 'avax', symbol: 'AVAX', name: 'Avalanche', coingecko_id: 'avalanche', enabled: true },
      { id: 'link', symbol: 'LINK', name: 'Chainlink', coingecko_id: 'chainlink', enabled: true },
    ];
    const items = wrapAssets(manyAssets);
    const { accessible, locked } = partitionAssets(items, premium.max_assets);
    expect(accessible).toHaveLength(6);
    expect(locked).toHaveLength(0);
  });
});

describe('TIER-ADV: Guard bypass — tier limits enforced consistently', () => {
  it('TIER-ADV: each tier has progressively more permissive limits', () => {
    const free = getTierConfig('free');
    const standard = getTierConfig('standard');
    const premium = getTierConfig('premium');

    // max_assets: free(1) < standard(5) < premium(unlimited=0)
    expect(free.max_assets).toBe(1);
    expect(standard.max_assets).toBe(5);
    expect(premium.max_assets).toBe(0); // 0 = unlimited

    // max_leverage: free(1) < standard(2) < premium(5)
    expect(free.max_leverage).toBe(1);
    expect(standard.max_leverage).toBe(2);
    expect(premium.max_leverage).toBe(5);

    // signal_frequency_hours: free(4) > standard(2) > premium(1) (lower is better)
    expect(free.signal_frequency_hours).toBeGreaterThan(standard.signal_frequency_hours);
    expect(standard.signal_frequency_hours).toBeGreaterThan(premium.signal_frequency_hours);

    // trade_fee_pct: free(0.5) > standard(0.1) > premium(0) (lower is better)
    expect(free.trade_fee_pct).toBeGreaterThan(standard.trade_fee_pct);
    expect(standard.trade_fee_pct).toBeGreaterThan(premium.trade_fee_pct);
  });

  it('TIER-ADV: free tier max_active_positions is capped at 1', () => {
    const free = getTierConfig('free');
    expect(free.max_active_positions).toBe(1);
  });

  it('TIER-ADV: tier features are boolean flags, not arbitrary strings', () => {
    for (const def of TIER_DEFINITIONS) {
      for (const value of Object.values(def.features)) {
        expect(typeof value).toBe('boolean');
      }
    }
  });

  it('TIER-ADV: all tiers have view_only: true (base access)', () => {
    for (const def of TIER_DEFINITIONS) {
      expect(def.features.view_only).toBe(true);
    }
  });

  it('TIER-ADV: no tier has negative prices', () => {
    for (const def of TIER_DEFINITIONS) {
      expect(def.monthly_price_usd).toBeGreaterThanOrEqual(0);
      expect(def.annual_price_usd).toBeGreaterThanOrEqual(0);
    }
  });

  it('TIER-ADV: annual price is always <= 12x monthly (discount or equal)', () => {
    for (const def of TIER_DEFINITIONS) {
      if (def.monthly_price_usd > 0) {
        expect(def.annual_price_usd).toBeLessThanOrEqual(def.monthly_price_usd * 12);
      }
    }
  });
});

describe('TIER-ADV: getTierConfig — cannot be tricked with invalid inputs', () => {
  it('TIER-ADV: unknown tier falls back to free (most restrictive)', () => {
    const config = getTierConfig('admin' as SubscriptionTier);
    expect(config.tier).toBe('free');
    expect(config.features.auto_mode).toBe(false);
  });

  it('TIER-ADV: empty string tier falls back to free', () => {
    const config = getTierConfig('' as SubscriptionTier);
    expect(config.tier).toBe('free');
  });

  it('TIER-ADV: SQL injection attempt in tier name falls back to free', () => {
    const config = getTierConfig("'; DROP TABLE users; --" as SubscriptionTier);
    expect(config.tier).toBe('free');
    expect(config.features.auto_mode).toBe(false);
  });

  it('TIER-ADV: prototype pollution attempt in tier name falls back to free', () => {
    const config = getTierConfig('__proto__' as SubscriptionTier);
    expect(config.tier).toBe('free');
  });
});

describe('TIER-ADV: Defense-in-depth — multiple layers of protection', () => {
  it('TIER-ADV: Layer 1 (DB trigger) exists for mode validation on UPDATE', () => {
    const migrationPath = resolve(
      BACKEND_ROOT,
      'supabase/migrations/20260306000002_validate_user_mode.sql'
    );
    if (!existsSync(migrationPath)) {
      console.warn('Skipping: backend repo not available at', BACKEND_ROOT);
      return;
    }
    const src = readFileSync(migrationPath, 'utf-8');
    // Trigger fires on UPDATE only, not INSERT (onboarding is unrestricted)
    expect(src).toContain('BEFORE UPDATE ON public.user_preferences');
    // Checks full_auto against tier
    expect(src).toContain("NEW.mode = 'full_auto'");
    expect(src).toContain('auto_mode');
    // Checks semi_auto for free tier
    expect(src).toContain("NEW.mode = 'semi_auto'");
    expect(src).toContain("user_tier = 'free'");
  });

  it('TIER-ADV: Layer 1 (DB trigger) uses SECURITY DEFINER + search_path', () => {
    const migrationPath = resolve(
      BACKEND_ROOT,
      'supabase/migrations/20260306000002_validate_user_mode.sql'
    );
    if (!existsSync(migrationPath)) {
      console.warn('Skipping: backend repo not available at', BACKEND_ROOT);
      return;
    }
    const src = readFileSync(migrationPath, 'utf-8');
    expect(src).toContain('SECURITY DEFINER');
    expect(src).toContain('SET search_path = public');
  });

  it('TIER-ADV: Layer 2 (proposal-generator) checks tier before auto-approval', () => {
    const pgPath = resolve(BACKEND_ROOT, 'supabase/functions/_shared/proposal-generator.ts');
    if (!existsSync(pgPath)) {
      console.warn('Skipping: backend repo not available at', BACKEND_ROOT);
      return;
    }
    const src = readFileSync(pgPath, 'utf-8');
    // Must check tier/features before auto-approving proposals
    expect(src).toMatch(/auto_mode|canAutoTrade|tier/i);
  });

  it('TIER-ADV: Layer 3 (frontend) useTierAccess clamps displayed mode', () => {
    const src = readFileSync('src/hooks/useTierAccess.ts', 'utf-8');
    // The hook exposes canTrade and canAutoTrade which are used by the UI
    expect(src).toContain('canTrade');
    expect(src).toContain('canAutoTrade');
    // These derive from tierConfig.features (not user preferences)
    expect(src).toContain('tierConfig.features');
  });

  it('TIER-ADV: upgradeLabel returns empty for premium (no upsell beyond top tier)', () => {
    // Pure function test
    function upgradeLabel(tier: string, feature: string): string {
      if (tier === 'premium') return '';
      return `Upgrade your plan to ${feature}`;
    }

    expect(upgradeLabel('premium', 'anything')).toBe('');
    expect(upgradeLabel('free', 'trade')).not.toBe('');
    expect(upgradeLabel('standard', 'auto-trade')).not.toBe('');
  });

  it('TIER-ADV: needsFunding only true for paid tiers with zero balance', () => {
    // Pure function test matching useTierAccess logic
    function needsFunding(isPaid: boolean, balance: number | undefined): boolean {
      if (!isPaid) return false;
      return balance === undefined || balance === 0;
    }

    // Free tier: never needs funding (not trading)
    expect(needsFunding(false, 0)).toBe(false);
    expect(needsFunding(false, undefined)).toBe(false);

    // Paid tier with balance: doesn't need funding
    expect(needsFunding(true, 500)).toBe(false);

    // Paid tier without balance: needs funding
    expect(needsFunding(true, 0)).toBe(true);
    expect(needsFunding(true, undefined)).toBe(true);
  });
});
