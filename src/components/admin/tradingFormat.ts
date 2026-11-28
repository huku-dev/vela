// src/components/admin/tradingFormat.ts
//
// Period choices and money formats shared by the Trading tab's views and
// charts. The periods themselves are computed by the backend.

import type { TradingPeriodKey } from '../../lib/adminDashboardClient';

export interface PeriodOption {
  key: TradingPeriodKey;
  short: string;
  title: string;
  days: number | null; // null = all time
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'd7', short: '7d', title: 'Last 7 Days', days: 7 },
  { key: 'd30', short: '30d', title: 'Last 30 Days', days: 30 },
  { key: 'd90', short: '90d', title: 'Last 90 Days', days: 90 },
  { key: 'all', short: 'All', title: 'All Time', days: null },
];

export const periodOption = (key: TradingPeriodKey): PeriodOption =>
  PERIOD_OPTIONS.find(o => o.key === key)!;

/** Size of an amount, to the cent: "$12.30". */
export function plainMoney(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Like plainMoney, but a loss keeps its minus sign: "$12.30", "-$4.00". */
export function money(n: number): string {
  return `${n <= -0.005 ? '-' : ''}${plainMoney(n)}`;
}

/** "+$12.30", "-$4.00", or "$0.00" under half a cent. */
export function signedCents(n: number): string {
  if (Math.abs(n) < 0.005) return '$0.00';
  return `${n < 0 ? '-' : '+'}${plainMoney(n)}`;
}

export function moneyTone(n: number): 'green' | 'red' | undefined {
  if (Math.abs(n) < 0.005) return undefined;
  return n < 0 ? 'red' : 'green';
}
