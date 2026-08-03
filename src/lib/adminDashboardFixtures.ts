// src/lib/adminDashboardFixtures.ts
//
// Synthetic dashboard payload used ONLY when /admin?fixtures=1 is opened in a
// DEV build. Never contains real user data. Every name, balance, and PnL
// figure below is fabricated. The AdminDashboard page enforces both:
//   - import.meta.env.DEV must be true (query param is a no-op in prod)
//   - auth gate still runs (fixtures path never bypasses the allowlist)
// so this file's presence in the bundle is not an exposure surface, but we
// keep the data synthetic as belt-and-braces in case a future refactor
// weakens either guard.

import type { DashboardResponse } from './adminDashboardClient';

export const FIXTURE_DASHBOARD: DashboardResponse = {
  generatedAt: '2026-01-01T00:00:00Z',
  kpis: {
    totalUsers: 7,
    payingSubscribers: 4,
    payingBreakdown: '2 Premium, 2 Standard',
    mrr: 75,
    activeTraders7d: 3,
    openPositions: 12,
    openPositionUsers: 3,
    openPositionAssets: 5,
    platformAum: 1000,
  },
  userOverview: [
    {
      displayName: 'Alice Example',
      isSelf: true,
      tier: 'premium',
      billingCycle: 'annual',
      subscriptionStatus: 'active',
      tradingMode: 'semi_auto',
      balance: 500,
      openPositions: 4,
      trades: 100,
      realizedPnl: -50,
      unrealizedPnl: -2,
      signup: '2026-01-05',
    },
    {
      displayName: 'Bob Sample',
      isSelf: false,
      tier: 'premium',
      billingCycle: 'monthly',
      subscriptionStatus: 'active',
      tradingMode: 'full_auto',
      balance: 300,
      openPositions: 5,
      trades: 80,
      realizedPnl: -30,
      unrealizedPnl: -5,
      signup: '2026-01-10',
    },
    {
      displayName: 'Carol Demo',
      isSelf: false,
      tier: 'standard',
      billingCycle: 'monthly',
      subscriptionStatus: 'active',
      tradingMode: 'full_auto',
      balance: 200,
      openPositions: 3,
      trades: 60,
      realizedPnl: -10,
      unrealizedPnl: 1,
      signup: '2026-01-15',
    },
    {
      displayName: 'Dana Test',
      isSelf: false,
      tier: 'standard',
      billingCycle: 'monthly',
      subscriptionStatus: 'active',
      tradingMode: 'semi_auto',
      balance: 0,
      openPositions: 0,
      trades: 5,
      realizedPnl: 2,
      unrealizedPnl: 0,
      signup: '2026-02-01',
    },
    {
      displayName: 'Eve Mock',
      isSelf: false,
      tier: 'free',
      billingCycle: null,
      subscriptionStatus: 'active',
      tradingMode: 'view_only',
      balance: 0,
      openPositions: 0,
      trades: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      signup: '2026-02-14',
    },
    {
      displayName: 'Frank Placeholder',
      isSelf: false,
      tier: 'free',
      billingCycle: null,
      subscriptionStatus: 'cancelled',
      tradingMode: '-',
      balance: 0,
      openPositions: 0,
      trades: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      signup: '2026-02-20',
    },
    {
      displayName: 'Grace Fixture',
      isSelf: false,
      tier: 'free',
      billingCycle: null,
      subscriptionStatus: 'active',
      tradingMode: '-',
      balance: 0,
      openPositions: 0,
      trades: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      signup: '2026-03-01',
    },
  ],
  positionConcentration: [
    { displayName: 'Bob Sample', openPositions: 5, notional: 500, unrealizedPnl: -5 },
    { displayName: 'Alice Example', openPositions: 4, notional: 300, unrealizedPnl: -2 },
    { displayName: 'Carol Demo', openPositions: 3, notional: 200, unrealizedPnl: 1 },
  ],
  openPositions: [
    {
      displayName: 'Bob Sample',
      asset: 'BTC',
      side: 'long',
      sizeUsd: 200,
      entryPrice: 60000,
      currentPrice: 59800,
      pnl: -1,
      pnlPct: -0.33,
      hoursOpen: 24,
    },
    {
      displayName: 'Alice Example',
      asset: 'ETH',
      side: 'long',
      sizeUsd: 150,
      entryPrice: 3000,
      currentPrice: 3010,
      pnl: 0.5,
      pnlPct: 0.33,
      hoursOpen: 12,
    },
    {
      displayName: 'Carol Demo',
      asset: 'SOL',
      side: 'short',
      sizeUsd: 100,
      entryPrice: 150,
      currentPrice: 148,
      pnl: 1.3,
      pnlPct: 1.33,
      hoursOpen: 6,
    },
  ],
  revenueBreakdown: [
    {
      tier: 'premium',
      billingCycle: 'monthly',
      subscribers: 1,
      monthlyRevenue: 20,
      pastDueRevenue: 0,
    },
    {
      tier: 'premium',
      billingCycle: 'annual',
      subscribers: 1,
      monthlyRevenue: 20,
      pastDueRevenue: 0,
    },
    {
      tier: 'standard',
      billingCycle: 'monthly',
      subscribers: 2,
      monthlyRevenue: 20,
      pastDueRevenue: 0,
    },
    { tier: 'free', billingCycle: null, subscribers: 3, monthlyRevenue: 0, pastDueRevenue: 0 },
  ],
  cohortFunnel: [
    { cohortWeek: '2026-01-05', signups: 1, paid: 1, deposited: 1, traded: 1 },
    { cohortWeek: '2026-01-12', signups: 2, paid: 2, deposited: 2, traded: 2 },
    { cohortWeek: '2026-02-02', signups: 2, paid: 1, deposited: 1, traded: 1 },
    { cohortWeek: '2026-03-02', signups: 2, paid: 0, deposited: 0, traded: 0 },
  ],
  pnlSeries30d: (() => {
    const days: DashboardResponse['pnlSeries30d'] = [];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    // Deterministic-ish synthetic sequence — 30 buckets, no reference to any
    // real date span in prod.
    for (let i = 0; i < 30; i++) {
      const day = i + 1;
      // Rotating small values so bars render at varied heights.
      const trades = (i * 3) % 15;
      const traders = Math.min(4, Math.max(0, trades > 0 ? Math.ceil(trades / 3) : 0));
      const pnl = Math.round((Math.sin(i / 3) * 15 + (i % 5 === 0 ? -8 : 4)) * 100) / 100;
      days.push({ date: `${months[0]} ${day}`, trades, traders, pnl });
    }
    return days;
  })(),
  curated: {
    highlights: [
      { direction: 'up', body: '**Fixture highlight A.** Synthetic prose for design iteration.' },
      { direction: 'down', body: '**Fixture highlight B.** More synthetic prose.' },
    ],
    carryoverInProgress: [
      { title: 'fixture-in-progress-item', owner: 'alice', note: 'Synthetic in-progress carryover.' },
    ],
    carryoverNeedsStatus: [
      { title: 'fixture-status-check-item', owner: 'bob', note: 'Synthetic status-check carryover.' },
    ],
    notes: '**Synthetic notes.** No real data. Design fixture only.',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  github: {
    shippedTop: [
      { number: 1, title: 'fixture: sample merged PR', author: 'alice', mergedAt: '2026-01-01T00:00:00Z', mergedLabel: 'Jan 1', risk: 'unknown' },
    ],
    velocity7d: (() => {
      const buckets: DashboardResponse['github']['velocity7d'] = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 0; i < 7; i++) {
        buckets.push({ isoDate: `2026-01-0${i + 1}`, dayLabel: `${dayNames[i]} Jan ${i + 1}`, count: (i * 2) % 5 });
      }
      return buckets;
    })(),
    fetchedAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
  },
};
