import { useMemo } from 'react';
import { useSubscription } from './useSubscription';
import { getTierConfig } from '../lib/tier-definitions';
import type { SubscriptionTier, TierConfig, Asset } from '../types';

export interface TierAccess {
  /** Current user's subscription tier */
  tier: SubscriptionTier;
  /** Full config for the current tier */
  tierConfig: TierConfig;
  /** Whether user is on a paid (active) subscription */
  isPaid: boolean;
  /** Max number of assets the user can access (0 = unlimited) */
  maxAssets: number;
  /** Whether the user can trade (semi-auto or full-auto) */
  canTrade: boolean;
  /** Whether auto-execution is available */
  canAutoTrade: boolean;
  /**
   * Check whether a specific asset is accessible at the user's tier.
   * Uses asset list order: free users get the first N assets.
   */
  canAccessAsset: (assetId: string, allAssets: Asset[]) => boolean;
  /**
   * Filter an asset list to only the ones this tier can access.
   * Returns { accessible, locked } for rendering both unlocked and locked cards.
   */
  partitionAssets: <T extends { asset: Asset }>(
    items: T[]
  ) => { accessible: T[]; locked: T[] };
  /** Open the tier comparison sheet for a specific feature */
  upgradeLabel: (feature: string) => string;
  /** Start Stripe checkout for a tier */
  startCheckout: (
    tier: 'standard' | 'premium',
    billingCycle: 'monthly' | 'annual'
  ) => Promise<void>;
  /** Open Stripe customer portal */
  openPortal: () => Promise<void>;
  /** Whether the subscription is still loading */
  isLoading: boolean;
  /** Whether wallet is unfunded (balance $0) and user is on a paid tier */
  needsFunding: (walletBalance: number | undefined) => boolean;
}

export function useTierAccess(): TierAccess {
  const {
    tier,
    isPaid,
    isLoading,
    startCheckout,
    openPortal,
  } = useSubscription();

  const tierConfig = useMemo(() => getTierConfig(tier), [tier]);

  const maxAssets = tierConfig.max_assets; // 0 = unlimited

  const canTrade = tierConfig.features.semi_auto || tierConfig.features.auto_mode;
  const canAutoTrade = tierConfig.features.auto_mode;

  const canAccessAsset = useMemo(
    () => (assetId: string, allAssets: Asset[]): boolean => {
      if (maxAssets === 0) return true; // unlimited
      const idx = allAssets.findIndex(a => a.id === assetId);
      if (idx === -1) return false;
      return idx < maxAssets;
    },
    [maxAssets]
  );

  const partitionAssets = useMemo(
    () =>
      <T extends { asset: Asset }>(items: T[]): { accessible: T[]; locked: T[] } => {
        if (maxAssets === 0) return { accessible: items, locked: [] };
        return {
          accessible: items.slice(0, maxAssets),
          locked: items.slice(maxAssets),
        };
      },
    [maxAssets]
  );

  const upgradeLabel = useMemo(
    () => (feature: string): string => {
      if (tier === 'free') {
        return `Upgrade to Standard to ${feature}`;
      }
      if (tier === 'standard') {
        return `Upgrade to Premium to ${feature}`;
      }
      return ''; // Premium — already has everything
    },
    [tier]
  );

  const needsFunding = useMemo(
    () => (walletBalance: number | undefined): boolean => {
      if (!isPaid) return false;
      return walletBalance === undefined || walletBalance === 0;
    },
    [isPaid]
  );

  return {
    tier,
    tierConfig,
    isPaid,
    maxAssets,
    canTrade,
    canAutoTrade,
    canAccessAsset,
    partitionAssets,
    upgradeLabel,
    startCheckout,
    openPortal,
    isLoading,
    needsFunding,
  };
}
