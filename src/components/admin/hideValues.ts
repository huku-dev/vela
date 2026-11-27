// src/components/admin/hideValues.ts
//
// "Hide values" for screenshots: money renders as a mask, user names become
// aliases, and free-text blocks are blurred (`ad-redacted` in the CSS).
// Display only. The real figures are still in the fetched response.

import { createContext, useContext } from 'react';
import type { DashboardResponse } from '../../lib/adminDashboardClient';

export const HIDDEN_VALUE = '•••••';

export const HideValuesContext = createContext(false);

export function useValuesHidden(): boolean {
  return useContext(HideValuesContext);
}

/** Wraps an already formatted money string so it is masked while values are hidden. */
export function useMask(): (formatted: string) => string {
  const hidden = useValuesHidden();
  return formatted => (hidden ? HIDDEN_VALUE : formatted);
}

/**
 * Replaces every user's display name with "User N", the same alias in every
 * section, numbered in User Overview order. `isSelf` is cleared so the "(you)"
 * suffix does not identify a row.
 */
export function aliasUserNames(data: DashboardResponse): DashboardResponse {
  const aliases = new Map<string, string>();
  const aliasFor = (name: string): string => {
    const existing = aliases.get(name);
    if (existing) return existing;
    const next = `User ${aliases.size + 1}`;
    aliases.set(name, next);
    return next;
  };
  const rename = <T extends { displayName: string }>(rows: T[]): T[] =>
    rows.map(r => ({ ...r, displayName: aliasFor(r.displayName) }));
  const renameSelf = <T extends { displayName: string; isSelf: boolean }>(rows: T[]): T[] =>
    rename(rows).map(r => ({ ...r, isSelf: false }));

  const userOverview = renameSelf(data.userOverview);

  return {
    ...data,
    userOverview,
    positionConcentration: rename(data.positionConcentration),
    openPositions: rename(data.openPositions),
    traderCumulativePnl30d: data.traderCumulativePnl30d && renameSelf(data.traderCumulativePnl30d),
    subscriptionRisks: data.subscriptionRisks && {
      pastDue: rename(data.subscriptionRisks.pastDue),
      cancelling: rename(data.subscriptionRisks.cancelling),
      cancelledLast30d: rename(data.subscriptionRisks.cancelledLast30d),
    },
  };
}
