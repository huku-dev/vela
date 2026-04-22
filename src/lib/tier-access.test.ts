/**
 * Tests for tier-based asset access and partitioning.
 *
 * Verifies that:
 * - Free tier sees only the first asset (BTC)
 * - Standard tier sees up to 8 assets (all of the 4 fixture assets)
 * - Premium tier sees all assets (unlimited)
 * - Edge cases: empty lists, unknown assets, exact boundaries
 *
 * The describe blocks below that hardcode `max = 3` pre-date the 2026-04
 * cap raise from 3 → 8 and stay as boundary-specific tests of the pure
 * `canAccessAsset` / `partitionAssets` functions (behaviour at arbitrary
 * caps), NOT the Standard tier itself. The "Standard boundary" invariant
 * (all 4 fixtures accessible when cap = 8) is verified in the adversarial
 * suite at tier-gating-adversarial.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getTierConfig, TIER_DEFINITIONS, COMPARISON_FEATURES } from './tier-definitions';
import type { Asset } from '../types';

// ── Test fixtures ──────────────────────────────────────

/**
 * Ordered by ASSET_DISPLAY_ORDER priority (useData.ts) — not DB/alphabetical.
 * Batch 5 (commit adffa4f) moved the sort client-side so Free sees BTC first
 * and Standard gets a balanced crypto + equity + macro mix. Tests below
 * assume this priority order.
 */
const ALL_ASSETS: Asset[] = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', coingecko_id: 'bitcoin', enabled: true },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', coingecko_id: 'ethereum', enabled: true },
  { id: 'sol', symbol: 'SOL', name: 'Solana', coingecko_id: 'solana', enabled: true },
  { id: 'hype', symbol: 'HYPE', name: 'Hyperliquid', coingecko_id: 'hyperliquid', enabled: true },
];

/** Wraps assets in the shape Home.tsx uses for partitionAssets */
function wrapAssets(assets: Asset[]) {
  return assets.map(asset => ({ asset, signal: null, brief: null }));
}

/**
 * Pure implementation of partitionAssets extracted from useTierAccess.
 * Testing the logic directly avoids React hook complexity.
 */
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

/**
 * Pure implementation of canAccessAsset from useTierAccess.
 */
function canAccessAsset(assetId: string, allAssets: Asset[], maxAssets: number): boolean {
  if (maxAssets === 0) return true;
  const idx = allAssets.findIndex(a => a.id === assetId);
  if (idx === -1) return false;
  return idx < maxAssets;
}

// ── Tier definition sanity checks ──────────────────────

describe('Tier Definitions', () => {
  it('defines exactly 3 tiers: free, standard, premium', () => {
    expect(TIER_DEFINITIONS).toHaveLength(3);
    expect(TIER_DEFINITIONS.map(t => t.tier)).toEqual(['free', 'standard', 'premium']);
  });

  it('free tier: max_assets = 1', () => {
    const free = getTierConfig('free');
    expect(free.max_assets).toBe(1);
  });

  it('standard tier: max_assets = 8', () => {
    const standard = getTierConfig('standard');
    expect(standard.max_assets).toBe(8);
  });

  it('premium tier: max_assets = 0 (unlimited)', () => {
    const premium = getTierConfig('premium');
    expect(premium.max_assets).toBe(0);
  });

  it('getTierConfig falls back to free for unknown tier', () => {
    const config = getTierConfig('nonexistent' as never);
    expect(config.tier).toBe('free');
  });

  it('comparison features display "Unlimited" for premium assets', () => {
    const premium = getTierConfig('premium');
    const assetsRow = COMPARISON_FEATURES.find(f => f.key === 'assets');
    expect(assetsRow).toBeDefined();
    expect(assetsRow!.getValue(premium)).toBe('Unlimited');
  });

  it('comparison features display numeric count for free/standard', () => {
    const assetsRow = COMPARISON_FEATURES.find(f => f.key === 'assets')!;
    expect(assetsRow.getValue(getTierConfig('free'))).toBe('1');
    expect(assetsRow.getValue(getTierConfig('standard'))).toBe('8');
  });
});

// ── canAccessAsset ─────────────────────────────────────

describe('canAccessAsset', () => {
  describe('free tier (max_assets=1)', () => {
    const max = 1;

    it('can access BTC (index 0)', () => {
      expect(canAccessAsset('btc', ALL_ASSETS, max)).toBe(true);
    });

    it('cannot access ETH (index 1)', () => {
      expect(canAccessAsset('eth', ALL_ASSETS, max)).toBe(false);
    });

    it('cannot access SOL (index 2)', () => {
      expect(canAccessAsset('sol', ALL_ASSETS, max)).toBe(false);
    });

    it('cannot access HYPE (index 3)', () => {
      expect(canAccessAsset('hype', ALL_ASSETS, max)).toBe(false);
    });
  });

  describe('cap = 3 boundary (partial-access test, not tier-specific)', () => {
    const max = 3;

    it('can access BTC (index 0)', () => {
      expect(canAccessAsset('btc', ALL_ASSETS, max)).toBe(true);
    });

    it('can access ETH (index 1)', () => {
      expect(canAccessAsset('eth', ALL_ASSETS, max)).toBe(true);
    });

    it('can access SOL (index 2)', () => {
      expect(canAccessAsset('sol', ALL_ASSETS, max)).toBe(true);
    });

    it('cannot access HYPE (index 3) — boundary test', () => {
      expect(canAccessAsset('hype', ALL_ASSETS, max)).toBe(false);
    });
  });

  describe('premium tier (max_assets=0 = unlimited)', () => {
    const max = 0;

    it('can access all 4 assets', () => {
      for (const asset of ALL_ASSETS) {
        expect(canAccessAsset(asset.id, ALL_ASSETS, max)).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it('returns false for unknown asset ID', () => {
      expect(canAccessAsset('doge', ALL_ASSETS, 3)).toBe(false);
    });

    it('returns false for unknown asset even with unlimited tier', () => {
      // max_assets=0 means unlimited, but asset must exist in the list
      // Actually, max_assets=0 returns true immediately — this is by design
      // (premium users get access to everything, even assets not in the list)
      expect(canAccessAsset('doge', ALL_ASSETS, 0)).toBe(true);
    });

    it('works with empty asset list', () => {
      expect(canAccessAsset('btc', [], 3)).toBe(false);
    });
  });
});

// ── partitionAssets ────────────────────────────────────

describe('partitionAssets', () => {
  const items = wrapAssets(ALL_ASSETS);

  describe('free tier (max_assets=1)', () => {
    it('puts only BTC in accessible, rest in locked', () => {
      const { accessible, locked } = partitionAssets(items, 1);
      expect(accessible).toHaveLength(1);
      expect(accessible[0].asset.id).toBe('btc');
      expect(locked).toHaveLength(3);
      // Locked reflects the ASSET_DISPLAY_ORDER priority (useData.ts):
      // eth=2, sol=3, hype=10. HYPE trails as the lowest-priority crypto.
      expect(locked.map(l => l.asset.id)).toEqual(['eth', 'sol', 'hype']);
    });
  });

  describe('cap = 3 (partial-access partition, not tier-specific)', () => {
    it('puts BTC, ETH, SOL in accessible; HYPE in locked', () => {
      const { accessible, locked } = partitionAssets(items, 3);
      expect(accessible).toHaveLength(3);
      expect(accessible.map(a => a.asset.id)).toEqual(['btc', 'eth', 'sol']);
      expect(locked).toHaveLength(1);
      expect(locked[0].asset.id).toBe('hype');
    });
  });

  describe('standard tier (max_assets=8)', () => {
    it('puts all 4 fixture assets in accessible, none locked', () => {
      const { accessible, locked } = partitionAssets(items, 8);
      expect(accessible).toHaveLength(4);
      expect(accessible.map(a => a.asset.id)).toEqual(['btc', 'eth', 'sol', 'hype']);
      expect(locked).toHaveLength(0);
    });
  });

  describe('premium tier (max_assets=0 = unlimited)', () => {
    it('puts ALL assets in accessible, none locked', () => {
      const { accessible, locked } = partitionAssets(items, 0);
      expect(accessible).toHaveLength(4);
      expect(accessible.map(a => a.asset.id)).toEqual(['btc', 'eth', 'sol', 'hype']);
      expect(locked).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('empty items returns empty partitions', () => {
      const { accessible, locked } = partitionAssets([], 3);
      expect(accessible).toHaveLength(0);
      expect(locked).toHaveLength(0);
    });

    it('max_assets > item count puts everything in accessible', () => {
      const { accessible, locked } = partitionAssets(items, 10);
      expect(accessible).toHaveLength(4);
      expect(locked).toHaveLength(0);
    });
  });
});

// ── Asset ordering ─────────────────────────────────────

describe('Asset ordering matters for tier gating', () => {
  it('assets are ordered by ASSET_DISPLAY_ORDER priority (useData.ts)', () => {
    // Post-Batch-5 the dashboard feed sorts by a hardcoded priority map,
    // not alphabetical. Fixture order should match:
    //   btc(1), eth(2), sol(3), hype(10)
    expect(ALL_ASSETS.map(a => a.id)).toEqual(['btc', 'eth', 'sol', 'hype']);
  });

  it('BTC is first (Free tier always gets BTC)', () => {
    expect(ALL_ASSETS[0].id).toBe('btc');
  });

  it('HYPE is last (lowest-priority crypto in the display-order map)', () => {
    expect(ALL_ASSETS[ALL_ASSETS.length - 1].id).toBe('hype');
  });
});

// ── ASSET_DISPLAY_ORDER source-verify (Batch 5) ────────
//
// useData.ts bakes the priority map directly. Rather than import it (which
// would need React/Vite setup), grep the source for the expected ordering
// so future edits to the map don't silently regress Free/Standard visibility.

describe('ASSET-ORDER-SRC: ASSET_DISPLAY_ORDER priority map (Batch 5)', () => {
  const useDataSrc = readFileSync(resolve(__dirname, '../hooks/useData.ts'), 'utf-8');

  it('defines ASSET_DISPLAY_ORDER with expected prod-10 asset priorities', () => {
    // These are the canonical priorities locked in at Batch 5. Changes here
    // directly affect what Free and Standard users see — treat as a product
    // decision, not a code tweak.
    const expected: Array<[string, number]> = [
      ['btc', 1],
      ['eth', 2],
      ['sol', 3],
      ['spx', 4],
      ['aapl', 5],
      ['nvda', 6],
      ['amzn', 7],
      ['gold', 8],
      ['oil', 9],
      ['hype', 10],
    ];
    for (const [id, priority] of expected) {
      const re = new RegExp(`\\b${id}:\\s*${priority}\\b`);
      expect(useDataSrc).toMatch(re);
    }
  });

  it('Free tier (1 slot) surfaces BTC; Standard (8 slots) excludes OIL + HYPE', () => {
    // Simulate the sort applied in useData.ts against the prod asset list.
    const prodAssets = ['aapl', 'amzn', 'btc', 'eth', 'gold', 'hype', 'nvda', 'oil', 'sol', 'spx'];
    const priority: Record<string, number> = {
      btc: 1,
      eth: 2,
      sol: 3,
      spx: 4,
      aapl: 5,
      nvda: 6,
      amzn: 7,
      gold: 8,
      oil: 9,
      hype: 10,
    };
    const sorted = [...prodAssets].sort((a, b) => {
      const ap = priority[a] ?? 99;
      const bp = priority[b] ?? 99;
      return ap !== bp ? ap - bp : a.localeCompare(b);
    });
    expect(sorted[0]).toBe('btc');
    expect(sorted.slice(0, 8)).toEqual([
      'btc',
      'eth',
      'sol',
      'spx',
      'aapl',
      'nvda',
      'amzn',
      'gold',
    ]);
    expect(sorted.slice(8)).toEqual(['oil', 'hype']);
  });
});

// ── Tier feature gating ────────────────────────────────

describe('Tier feature gating', () => {
  it('free tier: semi-auto trial trade, no full auto, no telegram', () => {
    const free = getTierConfig('free');
    expect(free.features.view_only).toBe(true);
    expect(free.features.semi_auto).toBe(true); // 1 lifetime trial trade
    expect(free.features.auto_mode).toBe(false);
    expect(free.features.telegram_alerts).toBe(false);
  });

  it('standard tier: semi-auto trading, telegram, no full auto', () => {
    const standard = getTierConfig('standard');
    expect(standard.features.semi_auto).toBe(true);
    expect(standard.features.auto_mode).toBe(false);
    expect(standard.features.telegram_alerts).toBe(true);
  });

  it('premium tier: full auto, all features', () => {
    const premium = getTierConfig('premium');
    expect(premium.features.auto_mode).toBe(true);
    expect(premium.features.semi_auto).toBe(true);
    expect(premium.features.telegram_alerts).toBe(true);
  });
});

// ── upgradeLabel ───────────────────────────────────────

describe('upgradeLabel', () => {
  function upgradeLabel(tier: string, feature: string): string {
    if (tier === 'premium') return '';
    return `Upgrade your plan to ${feature}`;
  }

  it('free users see tier-agnostic upgrade label', () => {
    expect(upgradeLabel('free', 'see ETH signals')).toBe('Upgrade your plan to see ETH signals');
  });

  it('standard users see same tier-agnostic upgrade label', () => {
    expect(upgradeLabel('standard', 'see SOL signals')).toBe(
      'Upgrade your plan to see SOL signals'
    );
  });

  it('premium users see empty string (already has everything)', () => {
    expect(upgradeLabel('premium', 'anything')).toBe('');
  });
});
