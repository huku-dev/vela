// src/components/admin/DashboardView.test.tsx
//
// Behavioural tests for the tabbed admin dashboard, the "Hide values" toggle,
// the trader Activity filter, the gain/loss cards and the volume chart.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardView } from './DashboardView';
import { TraderCumulativePnlSection } from './AdminSections';
import { FIXTURE_DASHBOARD } from '../../lib/adminDashboardFixtures';
import type { DashboardResponse, TraderCumulativePnlRow } from '../../lib/adminDashboardClient';

/* eslint-disable @typescript-eslint/no-explicit-any */
const chartConfigs = vi.hoisted(() => [] as any[]);

vi.mock('chart.js', () => {
  class Chart {
    static register() {}
    constructor(_canvas: unknown, config: unknown) {
      chartConfigs.push(config);
    }
    destroy() {}
  }
  const stub = {};
  return {
    Chart,
    BarController: stub,
    BarElement: stub,
    CategoryScale: stub,
    Legend: stub,
    LinearScale: stub,
    Title: stub,
    Tooltip: stub,
  };
});

const MONEY = /\$\s?-?\d/;
const TAB_SECTIONS = {
  Business: [
    'Key Metrics',
    'Highlights',
    'Shipped This Week',
    'Velocity (PRs Merged, Last 7 Days)',
    'Revenue Breakdown (Stripe + Supabase)',
    'Subscription Risks',
    'API Costs (Last 7 Days)',
    'Signup Cohort Funnel',
    'Roadmap',
    'Notes',
  ],
  Trading: [
    'Trading Activity (Last 30 Days)',
    'Monthly Returns',
    'Per-Asset PnL Scoreboard (30d)',
    'Position Concentration by Trader',
    'Open Positions',
  ],
  Users: ['Cumulative Realized PnL by Trader (30d)', 'User Overview'],
} as const;
type TabName = keyof typeof TAB_SECTIONS;
const TAB_NAMES = Object.keys(TAB_SECTIONS) as TabName[];

/** The fixture pushed down every other narrative branch that prints money or names. */
function otherBranches(): DashboardResponse {
  const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
  data.userOverview = data.userOverview.map(u => ({ ...u, realizedPnl: Math.abs(u.realizedPnl) }));
  data.positionConcentration = data.positionConcentration.map(r => ({
    ...r,
    unrealizedPnl: Math.abs(r.unrealizedPnl),
  }));
  data.revenueBreakdown[0].pastDueRevenue = 20;
  data.monthlyReturns!.years[0].ytdFunding = -3.5;
  const asset = data.assetScoreboard30d![0];
  data.assetScoreboard30d = Array.from({ length: 12 }, (_, i) => ({ ...asset, symbol: `A${i}` }));
  data.curated.highlights = [{ direction: 'up', body: 'Bob Sample is up $54 this week.' }];
  data.curated.notes = 'Alice Example deposited $500.';
  data.curated.carryoverNextUp![0].description = 'Refund Carol Demo $20.';
  data.github.shippedTop[0].title = 'fix: Dana Test balance of $12';
  return data;
}

const openTab = (name: TabName) => fireEvent.click(screen.getByRole('tab', { name }));
const sectionTitles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[role="tabpanel"]:not([hidden]) .ad-section-title')).map(
    e => e.textContent
  );

/** Everything readable: DOM text and hover/label text, minus the blurred blocks. */
function readableText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.ad-redacted').forEach(e => e.remove());
  const attributes = Array.from(copy.querySelectorAll('[title], [aria-label], [alt]')).map(e =>
    ['title', 'aria-label', 'alt'].map(name => e.getAttribute(name) ?? '').join(' ')
  );
  return [copy.textContent ?? '', ...attributes].join(' ');
}

function userNames(data: DashboardResponse): string[] {
  const rows = [
    ...data.userOverview,
    ...data.positionConcentration,
    ...data.openPositions,
    ...(data.traderCumulativePnl30d ?? []),
    ...(data.subscriptionRisks?.pastDue ?? []),
    ...(data.subscriptionRisks?.cancelling ?? []),
    ...(data.subscriptionRisks?.cancelledLast30d ?? []),
  ];
  return [...new Set(rows.map(r => r.displayName))];
}

beforeEach(() => {
  chartConfigs.length = 0;
});

describe('DashboardView tabs', () => {
  it('opens on Business and shows only that tab', () => {
    const { container } = render(<DashboardView data={FIXTURE_DASHBOARD} />);
    expect(screen.getByRole('tab', { name: 'Business' })).toHaveAttribute('aria-selected', 'true');
    expect(sectionTitles(container)).toEqual([...TAB_SECTIONS.Business]);
  });

  it('keeps every section reachable, each under exactly one tab', () => {
    const { container } = render(<DashboardView data={FIXTURE_DASHBOARD} />);
    for (const name of TAB_NAMES) {
      openTab(name);
      expect(sectionTitles(container)).toEqual([...TAB_SECTIONS[name]]);
    }
    expect(TAB_NAMES.flatMap(n => [...TAB_SECTIONS[n]])).toHaveLength(17);
  });
});

describe('DashboardView tab state', () => {
  it('keeps filters when switching away and back', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Users');
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'free' } });

    openTab('Trading');
    expect(screen.getByLabelText('Activity')).not.toBeVisible();

    openTab('Users');
    expect(screen.getByLabelText('Activity')).toBeVisible();
    expect(screen.getByLabelText('Activity')).toHaveValue('all');
    expect(screen.getByLabelText('Tier')).toHaveValue('free');
  });

  it('builds charts on the first visit to Trading and not again on return', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    expect(chartConfigs).toHaveLength(0);
    openTab('Trading');
    const built = chartConfigs.length;
    expect(built).toBeGreaterThan(0);
    openTab('Users');
    openTab('Trading');
    expect(chartConfigs).toHaveLength(built);
  });
});

describe('FEATURE-ADV: Hide values', () => {
  for (const [label, data] of [
    ['base fixture', FIXTURE_DASHBOARD],
    ['other narrative branches', otherBranches()],
  ] as const) {
    it(`leaves no amount or user name readable on any tab (${label})`, () => {
      const { container } = render(<DashboardView data={data} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));

      for (const name of TAB_NAMES) {
        openTab(name);
        if (name === 'Trading') {
          const showAll = screen.queryByText(/Show all \d+ symbols/);
          expect(showAll !== null).toBe((data.assetScoreboard30d?.length ?? 0) > 10);
          if (showAll) {
            expect(readableText(container)).not.toMatch(MONEY);
            fireEvent.click(showAll);
          }
        }
        if (name === 'Users') {
          fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'all' } });
        }
        const text = readableText(container);
        expect(text, `${name} tab`).not.toMatch(MONEY);
        expect(text, `${name} tab`).not.toContain('(you)');
        for (const user of userNames(data)) {
          expect(text, `${name} tab shows ${user}`).not.toContain(user);
          expect(text, `${name} tab shows ${user}`).not.toContain(user.split(' ')[0]);
        }
      }
    });
  }

  it('is not passing vacuously: amounts and names show before hiding and return after', () => {
    const { container } = render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Users');
    expect(readableText(container)).toMatch(MONEY);
    expect(readableText(container)).toContain('Alice Example (you)');

    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(readableText(container)).toContain('•••••');
    expect(readableText(container)).toContain('User 1');

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }));
    expect(readableText(container)).toContain('Alice Example (you)');
    expect(readableText(container)).not.toContain('•••••');
  });

  it('blurs the free-text blocks, which stay in place', () => {
    const { container } = render(<DashboardView data={otherBranches()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(container.querySelector('.ad-values-hidden')).not.toBeNull();
    const redacted = Array.from(container.querySelectorAll('.ad-redacted'))
      .map(e => e.textContent)
      .join(' | ');
    for (const text of [
      'Bob Sample is up $54',
      'Alice Example deposited $500',
      'Refund Carol Demo $20',
      'Dana Test balance',
    ]) {
      expect(redacted).toContain(text);
    }
    const css = readFileSync(resolve(__dirname, '../../styles/admin-dashboard.css'), 'utf8');
    expect(css).toMatch(/\.ad-values-hidden \.ad-redacted\s*\{[^}]*filter:\s*blur\(/);
  });

  it('uses the alias in the dunning nudge popup', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    fireEvent.click(screen.getByRole('button', { name: /Send dunning nudge/ }));
    expect(alert.mock.calls[0][0]).toMatch(/User \d+/);
    expect(alert.mock.calls[0][0]).not.toContain('Bob');
    vi.restoreAllMocks();
  });

  it('masks the PnL chart axis and tooltip, and unmasks them again', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Trading');
    const latestPnl = () =>
      [...chartConfigs].reverse().find(c => c.options.plugins.title.text.includes('PnL'));
    expect(latestPnl().options.scales.y.ticks.callback(20)).toBe('$20');

    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(latestPnl().options.scales.y.ticks.callback(20)).toBe('•••••');
    expect(latestPnl().options.plugins.tooltip.callbacks.label({ parsed: { y: 20 } })).toBe(
      'Platform PnL: •••••'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }));
    expect(latestPnl().options.scales.y.ticks.callback(-5)).toBe('-$5');
  });
});

describe('Daily Trading Volume chart', () => {
  it('has one axis, with active traders in the tooltip', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Trading');
    const volume = chartConfigs.find(c => c.options.plugins.title.text === 'Daily Trading Volume');
    expect(volume.data.datasets.map((d: any) => d.label)).toEqual(['Trades Closed']);
    expect(Object.keys(volume.options.scales).sort()).toEqual(['x', 'y']);
    const footer = volume.options.plugins.tooltip.callbacks.footer;
    expect(footer([{ dataIndex: 4 }])).toBe(
      `Active Traders: ${FIXTURE_DASHBOARD.pnlSeries30d[4].traders}`
    );
    expect(footer([])).toBe('');
  });
});

describe('Trader table Activity filter', () => {
  const traderTable = () => screen.getByLabelText('Activity').closest('div')!.nextElementSibling!;
  const listedNames = () =>
    Array.from(traderTable().querySelectorAll('tbody tr td:first-child strong')).map(e =>
      (e.textContent ?? '').replace(' (you)', '')
    );
  const choose = (label: 'Activity' | 'Tier', value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('defaults to traders active in 30d and "All users" adds everyone else once', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Users');
    expect(listedNames().sort()).toEqual(['Alice Example', 'Bob Sample', 'Carol Demo']);
    expect(screen.getByText(/Showing 3 of 3 traders active in 30d/)).toBeInTheDocument();

    choose('Activity', 'all');
    expect(listedNames().sort()).toEqual(
      FIXTURE_DASHBOARD.userOverview.map(u => u.displayName).sort()
    );
    expect(screen.getByText('Showing 7 of 7 users')).toBeInTheDocument();

    choose('Activity', 'active30d');
    expect(listedNames()).toHaveLength(3);
  });

  it('combines with the Tier filter and shows no movement for inactive users', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Users');
    choose('Activity', 'all');
    choose('Tier', 'free');
    expect(listedNames().sort()).toEqual(['Eve Mock', 'Frank Placeholder', 'Grace Fixture']);
    const eve = within(traderTable() as HTMLElement)
      .getByText('Eve Mock')
      .closest('tr')!;
    const cells = Array.from(eve.querySelectorAll('td')).map(c => c.textContent);
    expect(cells.slice(4, 7)).toEqual(['$0', '$0', '$0']);
    expect(cells[8]).toBe('-');
  });
});

describe('Users who share a name, tier and balance', () => {
  it('adds the inactive one with their own details, not the active one again', () => {
    const base = {
      ...FIXTURE_DASHBOARD.userOverview[0],
      displayName: 'unknown',
      isSelf: false,
      tier: 'free' as const,
      subscriptionStatus: 'unknown',
      balance: 0,
    };
    const idle = { ...base, openPositions: 0, trades: 1 };
    const busy = { ...base, openPositions: 2, trades: 5 };
    const busyRow: TraderCumulativePnlRow = {
      displayName: 'unknown',
      isSelf: false,
      tier: 'free',
      subscriptionStatus: 'unknown',
      balance: 0,
      openPositions: 2,
      totalTrades: 5,
      totalPnl30d: -4,
      peak30d: 0,
      trough30d: -4,
      lastCloseIso: '2026-07-30T20:00:00Z',
      series: [],
    };
    render(<TraderCumulativePnlSection rows={[busyRow]} users={[idle, busy]} totalUsers={2} />);
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'all' } });
    const rows = Array.from(
      screen
        .getByLabelText('Activity')
        .closest('div')!
        .nextElementSibling!.querySelectorAll('tbody tr')
    ).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));
    expect(rows).toHaveLength(2);
    // Column 3 is open positions, column 8 is last close.
    expect(rows.find(cells => cells[8] === '-')![3]).toBe('0');
    expect(rows.find(cells => cells[8] !== '-')![3]).toBe('2');
  });
});

describe('Biggest gain and loss cards', () => {
  const trader = (displayName: string, totalPnl30d: number): TraderCumulativePnlRow => ({
    displayName,
    isSelf: false,
    tier: 'premium',
    subscriptionStatus: 'active',
    balance: 100,
    openPositions: 0,
    totalTrades: 3,
    totalPnl30d,
    peak30d: Math.max(0, totalPnl30d),
    trough30d: Math.min(0, totalPnl30d),
    lastCloseIso: '2026-07-30T20:00:00Z',
    series: [],
  });
  const card = (label: string) => screen.getByText(label).closest('.ad-mover-card') as HTMLElement;
  const renderRows = (rows: TraderCumulativePnlRow[]) =>
    render(<TraderCumulativePnlSection rows={rows} users={[]} totalUsers={rows.length} />);

  it('leaves the loss card empty when nobody lost', () => {
    renderRows([trader('Up A', 9.3), trader('Up B', 103)]);
    expect(card('Biggest 30d loss')).toHaveTextContent('No qualifying trader');
    expect(card('Biggest 30d gain')).toHaveTextContent('Up B');
  });

  it('leaves the gain card empty when nobody gained', () => {
    renderRows([trader('Down A', -9.3), trader('Down B', -103)]);
    expect(card('Biggest 30d gain')).toHaveTextContent('No qualifying trader');
    expect(card('Biggest 30d loss')).toHaveTextContent('Down B');
  });

  it('treats a result under half a cent as neither gain nor loss', () => {
    renderRows([trader('Flat A', 0.004), trader('Flat B', -0.004)]);
    expect(card('Biggest 30d gain')).toHaveTextContent('No qualifying trader');
    expect(card('Biggest 30d loss')).toHaveTextContent('No qualifying trader');
  });
});
