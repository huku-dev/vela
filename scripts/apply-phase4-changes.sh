#!/bin/bash
# Apply all Phase 4 multi-asset frontend changes atomically.
# Run this, then verify with: npm run type-check && npm run test -- --run
# Then commit everything.

set -e
cd "$(dirname "$0")/.."

echo "Applying Phase 4 changes..."

# 1. types.ts — Add AssetClass, update Asset interface
python3 -c "
import re
with open('src/types.ts', 'r') as f:
    content = f.read()

old = '''export interface Asset {
  id: string;
  symbol: string;
  name: string;
  coingecko_id: string;
  enabled: boolean;
}'''

new = '''export type AssetClass = 'crypto' | 'equities' | 'commodities' | 'indices';

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  coingecko_id: string | null;
  asset_class?: AssetClass;
  hl_symbol?: string | null;
  icon_url?: string | null;
  enabled: boolean;
}'''

content = content.replace(old, new)
with open('src/types.ts', 'w') as f:
    f.write(content)
print('  types.ts updated')
"

# 2. tier-definitions.ts — Standard max_assets 3 -> 5
sed -i '' 's/max_assets: 3,/max_assets: 5,/' src/lib/tier-definitions.ts
echo "  tier-definitions.ts updated"

# 3. SignalCard.tsx — icon fallback
sed -i '' "s/const iconUrl = getCoinIcon(asset.coingecko_id);/const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);/" src/components/SignalCard.tsx
echo "  SignalCard.tsx updated"

# 4. LockedSignalCard.tsx — icon fallback
sed -i '' "s/const iconUrl = getCoinIcon(asset.coingecko_id);/const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);/" src/components/LockedSignalCard.tsx
echo "  LockedSignalCard.tsx updated"

# 5. AssetDetail.tsx — icon fallback + iconUrl prop fix
sed -i '' "s/const iconUrl = getCoinIcon(asset.coingecko_id);/const iconUrl = asset.icon_url ?? (asset.coingecko_id ? getCoinIcon(asset.coingecko_id) : null);/g" src/pages/AssetDetail.tsx
sed -i '' "s/iconUrl={iconUrl}/iconUrl={iconUrl ?? undefined}/g" src/pages/AssetDetail.tsx
echo "  AssetDetail.tsx updated"

# 6. EngagementCard.tsx — nullable coingeckoId
sed -i '' 's/coingeckoId: string;/coingeckoId: string | null;/' src/components/EngagementCard.tsx
python3 -c "
with open('src/components/EngagementCard.tsx', 'r') as f:
    content = f.read()

old = '''    // Pre-load asset icon
    const iconUrl = getCoinIcon(coingeckoId);
    const iconImg = await new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = iconUrl;
    });'''

new = '''    // Pre-load asset icon
    const iconUrl = coingeckoId ? getCoinIcon(coingeckoId) : null;
    const iconImg: HTMLImageElement | null = iconUrl
      ? await new Promise<HTMLImageElement | null>(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = iconUrl;
        })
      : null;'''

content = content.replace(old, new)
with open('src/components/EngagementCard.tsx', 'w') as f:
    f.write(content)
print('  EngagementCard.tsx updated')
"

# 7. useData.ts — nullable coingecko_id handling
python3 -c "
with open('src/hooks/useData.ts', 'r') as f:
    content = f.read()

old = '''      const coingeckoIds = assets.map((a: Asset) => a.coingecko_id);
      // Build CoinGecko ID → Hyperliquid symbol map for dual-source pricing
      const symbolMap: Record<string, string> = {};
      for (const a of assets) {
        symbolMap[a.coingecko_id] = a.symbol;
      }
      const livePrices = await fetchLivePrices(coingeckoIds, symbolMap);

      const dashboard: AssetDashboard[] = assets.map((asset: Asset) => {
        const signal = signals.find((s: Signal) => s.asset_id === asset.id) || null;
        const livePrice = livePrices[asset.coingecko_id];'''

new = '''      const coingeckoIds = assets
        .map((a: Asset) => a.coingecko_id)
        .filter((id): id is string => id != null);
      // Build CoinGecko ID → Hyperliquid symbol map for dual-source pricing
      const symbolMap: Record<string, string> = {};
      for (const a of assets) {
        if (a.coingecko_id) symbolMap[a.coingecko_id] = a.symbol;
      }
      const livePrices = await fetchLivePrices(coingeckoIds, symbolMap);

      const dashboard: AssetDashboard[] = assets.map((asset: Asset) => {
        const signal = signals.find((s: Signal) => s.asset_id === asset.id) || null;
        const livePrice = asset.coingecko_id ? livePrices[asset.coingecko_id] : undefined;'''

content = content.replace(old, new)
with open('src/hooks/useData.ts', 'w') as f:
    f.write(content)
print('  useData.ts updated')
"

# 8. tier-gating-adversarial.test.ts — update assertions for max_assets=5
python3 -c "
with open('src/lib/tier-gating-adversarial.test.ts', 'r') as f:
    content = f.read()

# Fix 1: standard tier test
content = content.replace(
    \"it('TIER-ADV: standard tier cannot access more than 3 assets', () => {\\n    const standard = getTierConfig('standard');\\n    const items = wrapAssets(ALL_ASSETS);\\n    const { accessible, locked } = partitionAssets(items, standard.max_assets);\\n    expect(accessible).toHaveLength(3);\\n    expect(locked).toHaveLength(1);\\n  });\",
    \"it('TIER-ADV: standard tier can access all 4 assets with max_assets=5', () => {\\n    const standard = getTierConfig('standard');\\n    const items = wrapAssets(ALL_ASSETS);\\n    const { accessible, locked } = partitionAssets(items, standard.max_assets);\\n    expect(accessible).toHaveLength(4);\\n    expect(locked).toHaveLength(0);\\n  });\"
)

# Fix 2: boundary test
content = content.replace(
    \"// max_assets = 3, so index 3 (SOL) should be locked\\n    expect(canAccessAsset('sol', ALL_ASSETS, standard.max_assets)).toBe(false);\",
    \"// max_assets = 5, with 4 assets SOL is accessible\\n    expect(canAccessAsset('sol', ALL_ASSETS, standard.max_assets)).toBe(true);\"
)

# Fix 3: progressive limits
content = content.replace(
    \"// max_assets: free(1) < standard(3) < premium(unlimited=0)\\n    expect(free.max_assets).toBe(1);\\n    expect(standard.max_assets).toBe(3);\",
    \"// max_assets: free(1) < standard(5) < premium(unlimited=0)\\n    expect(free.max_assets).toBe(1);\\n    expect(standard.max_assets).toBe(5);\"
)

with open('src/lib/tier-gating-adversarial.test.ts', 'w') as f:
    f.write(content)
print('  tier-gating-adversarial.test.ts updated')
"

echo ""
echo "All Phase 4 changes applied. Now verify:"
echo "  1. npm run type-check"
echo "  2. npm run test -- --run"
echo "  3. git add -A && git commit"
