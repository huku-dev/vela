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
  pnlSeries7d: (() => {
    const days: DashboardResponse['pnlSeries30d'] = [];
    for (let i = 0; i < 7; i++) {
      const day = i + 1;
      const trades = ((i * 2) % 8) + 2;
      const traders = Math.min(3, Math.ceil(trades / 3));
      const pnl = Math.round((Math.cos(i / 2) * 6 - 2) * 100) / 100;
      days.push({ date: `Jan ${day}`, trades, traders, pnl });
    }
    return days;
  })(),
  pnlSeries90d: (() => {
    const days: DashboardResponse['pnlSeries30d'] = [];
    const months = ['Nov', 'Dec', 'Jan'];
    for (let i = 0; i < 90; i++) {
      const monthIdx = Math.floor(i / 30);
      const day = (i % 30) + 1;
      const trades = (i * 3) % 15;
      const traders = Math.min(4, Math.max(0, trades > 0 ? Math.ceil(trades / 3) : 0));
      const pnl = Math.round((Math.sin(i / 4) * 12 + (i % 7 === 0 ? -6 : 3)) * 100) / 100;
      days.push({ date: `${months[monthIdx]} ${day}`, trades, traders, pnl });
    }
    return days;
  })(),
  curated: {
    highlights: [
      { direction: 'up', body: '**Fixture highlight A.** Synthetic prose for design iteration.' },
      { direction: 'down', body: '**Fixture highlight B.** More synthetic prose.' },
    ],
    carryoverNextUp: [
      {
        title: 'fixture-next-up-item',
        description: 'A synthetic description for design iteration purposes.',
        priority: 'High' as const,
        area: 'Signals',
        status: 'Next',
        daysStale: 3,
        targetDate: '2026-02-15',
        createdDate: '2026-01-01',
        notionUrl: null,
      },
    ],
    carryoverNeedsAttention: [
      {
        title: 'fixture-needs-attention-item',
        description: 'Another synthetic description showing what a stale task looks like.',
        priority: 'Medium' as const,
        area: 'Infra',
        status: 'In progress',
        daysStale: 21,
        targetDate: null,
        createdDate: '2025-12-15',
        notionUrl: null,
      },
    ],
    notes: '**Synthetic notes.** No real data. Design fixture only.',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  github: {
    shippedTop: [
      {
        number: 1,
        title: 'fixture: sample merged PR',
        author: 'alice',
        mergedAt: '2026-01-01T00:00:00Z',
        mergedLabel: 'Jan 1',
        risk: 'unknown',
      },
    ],
    velocity7d: (() => {
      const buckets: DashboardResponse['github']['velocity7d'] = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 0; i < 7; i++) {
        buckets.push({
          isoDate: `2026-01-0${i + 1}`,
          dayLabel: `${dayNames[i]} Jan ${i + 1}`,
          count: (i * 2) % 5,
        });
      }
      return buckets;
    })(),
    fetchedAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
  },
  traderCumulativePnl30d: (() => {
    const trend = [
      {
        name: 'Alice Example',
        tier: 'premium' as const,
        status: 'active',
        bal: 500,
        open: 4,
        trades: 100,
        daily: [
          0, 0.5, 1.2, 2.1, 3.0, 5.5, 6.1, 6.9, 7.5, 8.0, 8.8, 9.0, 9.2, 9.5, 4.0, 3.5, 3.4, 3.3,
          3.5, 3.7, 4.0, 4.1, 3.9, 3.8, 3.6, 3.5, 3.7, 3.9, 4.1, 4.3,
        ],
      },
      {
        name: 'Bob Sample',
        tier: 'premium' as const,
        status: 'past_due',
        bal: 300,
        open: 5,
        trades: 80,
        daily: [
          0, -0.5, -1.0, -0.7, -0.4, 0.2, 0.8, 1.5, 2.0, 2.5, 2.7, 3.0, 2.5, -12.0, -12.5, -12.3,
          -12.0, -11.8, -11.5, -11.0, -10.7, -10.5, -10.3, -10.1, -9.9, -9.7, -9.5, -9.3, -9.1,
          -8.9,
        ],
      },
      {
        name: 'Carol Demo',
        tier: 'standard' as const,
        status: 'active',
        bal: 200,
        open: 3,
        trades: 60,
        daily: [
          0, 0.1, 0.3, 0.5, 0.4, 0.6, 0.8, 1.0, 1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.3, 2.4, 2.5, 2.7,
          2.9, 3.1, 3.3, 3.5, 3.7, 3.8, 3.9, 4.0, 4.1, 4.2, 4.3, 4.4,
        ],
      },
    ];
    return trend.map(t => {
      const series = t.daily.map((v, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        cumPnl: v,
      }));
      return {
        displayName: t.name,
        isSelf: t.name === 'Alice Example',
        tier: t.tier,
        subscriptionStatus: t.status,
        balance: t.bal,
        openPositions: t.open,
        totalTrades: t.trades,
        totalPnl30d: t.daily[t.daily.length - 1],
        peak30d: Math.max(...t.daily),
        trough30d: Math.min(...t.daily),
        lastCloseIso: '2026-07-30T20:00:00Z',
        series,
      };
    });
  })(),
  assetScoreboard30d: [
    {
      symbol: 'DELL',
      closes: 9,
      wins: 6,
      winPct: 67,
      volume: 698,
      netPnl: -39.91,
      avgHoldHours: 8.8,
      series: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        cumPnl: i < 5 ? i * 0.2 : i < 15 ? -20 : -39.91,
      })),
    },
    {
      symbol: 'OIL',
      closes: 3,
      wins: 3,
      winPct: 100,
      volume: 644,
      netPnl: 14.06,
      avgHoldHours: 38.3,
      series: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        cumPnl: i * 0.47,
      })),
    },
    {
      symbol: 'AMZN',
      closes: 5,
      wins: 1,
      winPct: 20,
      volume: 483,
      netPnl: -14.12,
      avgHoldHours: 95.0,
      series: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        cumPnl: -i * 0.47,
      })),
    },
  ],
  subscriptionRisks: {
    pastDue: [
      {
        displayName: 'Bob Sample',
        tier: 'premium' as const,
        billingCycle: 'monthly' as const,
        monthlyRevenue: 20,
        balance: 300,
        openPositions: 5,
        lastActivityIso: '2026-07-30T00:00:00Z',
        status: 'past_due' as const,
        signup: '2026-01-10',
        notionalMove: null,
      },
    ],
    cancelling: [],
    cancelledLast30d: [
      {
        displayName: 'Erin Trial',
        tier: 'free' as const,
        billingCycle: null,
        monthlyRevenue: 0,
        balance: 0,
        openPositions: 0,
        lastActivityIso: null,
        status: 'cancelled' as const,
        signup: '2026-01-20',
        notionalMove: null,
      },
    ],
  },
  llmCosts: {
    kpis: {
      totalSpend: 4.27,
      totalSpendDelta: -0.12,
      requests: 8430,
      requestsDelta: 0.05,
      tokenVolume: 42_500_000,
      tokenVolumeDelta: 0.08,
      cacheHitRate: 0.34,
      cacheHitRateDelta: 0.02,
      blendedPer1M: 0.1,
      blendedPer1MDelta: -0.18,
    },
    providers: [
      {
        provider: 'deepseek',
        cost: 2.85,
        calls: 3200,
        inputTokens: 18_000_000,
        outputTokens: 4_500_000,
      },
      {
        provider: 'anthropic',
        cost: 1.42,
        calls: 210,
        inputTokens: 1_200_000,
        outputTokens: 350_000,
      },
      { provider: 'groq', cost: 0, calls: 4100, inputTokens: 15_000_000, outputTokens: 3_200_000 },
      { provider: 'nvidia', cost: 0, calls: 920, inputTokens: 800_000, outputTokens: 250_000 },
    ],
    errorMessage: null,
  },
  monthlyReturns: {
    years: [
      {
        year: 2026,
        months: [
          {
            year: 2026,
            month: 3,
            closes: 64,
            notional: 6402,
            grossPnl: -38.53,
            fees: 5.66,
            funding: 0.91,
            netPnl: -43.28,
          },
          {
            year: 2026,
            month: 4,
            closes: 210,
            notional: 23986,
            grossPnl: -34.63,
            fees: 17.54,
            funding: 3.9,
            netPnl: -48.27,
          },
          {
            year: 2026,
            month: 5,
            closes: 168,
            notional: 12821,
            grossPnl: 21.95,
            fees: 8.45,
            funding: -1.62,
            netPnl: 11.88,
          },
          {
            year: 2026,
            month: 6,
            closes: 130,
            notional: 10044,
            grossPnl: -59.01,
            fees: 4.16,
            funding: -0.36,
            netPnl: -63.53,
          },
          {
            year: 2026,
            month: 7,
            closes: 154,
            notional: 7790,
            grossPnl: 1.33,
            fees: 3.74,
            funding: 0.26,
            netPnl: -2.15,
          },
          {
            year: 2026,
            month: 8,
            closes: 53,
            notional: 3686,
            grossPnl: -63.79,
            fees: 1.74,
            funding: -0.51,
            netPnl: -66.03,
          },
        ],
        ytdClosesTotal: 779,
        ytdNotionalTotal: 64729,
        ytdGrossPnl: -172.68,
        ytdFees: 41.29,
        ytdFunding: 2.58,
        ytdNetPnl: -211.39,
      },
    ],
  },
};
