// src/components/admin/DashboardView.test.tsx
//
// Behavioural tests for the tabbed admin dashboard, the "Hide values" toggle,
// the trader Activity filter, the gain/loss cards and the volume chart.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardView } from './DashboardView';
import { endLabels } from './AdminCharts';
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
    Filler: stub,
    Legend: stub,
    LinearScale: stub,
    LineController: stub,
    LineElement: stub,
    PointElement: stub,
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
    'Trading Performance (Last 30 Days)',
    'Profit Over Time (Last 30 Days)',
    'Where The Profit Came From (Last 30 Days)',
    'Trading Activity (Last 30 Days)',
    'Monthly Returns',
    'Per-Asset PnL Scoreboard (Last 30 Days)',
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
  const asset = data.trading!.periods.d30.assets[0];
  data.trading!.periods.d30.assets = Array.from({ length: 12 }, (_, i) => ({
    ...asset,
    symbol: `A${i}`,
  }));
  data.trading!.closedPositions = 10_001;
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
    expect(TAB_NAMES.flatMap(n => [...TAB_SECTIONS[n]])).toHaveLength(20);
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
          expect(showAll !== null).toBe(data.trading!.periods.d30.assets.length > 10);
          if (showAll) {
            expect(readableText(container)).not.toMatch(MONEY);
            fireEvent.click(showAll);
          }
          // Every period and breakdown, including the table behind each chart.
          for (const period of ['7d', '90d', 'All', '30d']) {
            fireEvent.click(screen.getByRole('button', { name: period }));
            for (const by of ['Market', 'How long held', 'Side']) {
              fireEvent.click(screen.getByRole('button', { name: by }));
              expect(readableText(container), `${period} ${by}`).not.toMatch(MONEY);
            }
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
      [...chartConfigs].reverse().find(c => c.options.plugins.title?.text.includes('PnL'));
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
    const volume = chartConfigs.find(c => c.options.plugins.title?.text === 'Daily Trading Volume');
    expect(volume.data.datasets.map((d: any) => d.label)).toEqual(['Trades Closed']);
    expect(Object.keys(volume.options.scales).sort()).toEqual(['x', 'y']);
    const footer = volume.options.plugins.tooltip.callbacks.footer;
    expect(footer([{ dataIndex: 4 }])).toBe(
      `Active Traders: ${FIXTURE_DASHBOARD.trading!.periods.d30.activity[4].traders}`
    );
    expect(footer([])).toBe('');
  });
});

describe('Trading tab period selector', () => {
  const open = (data: DashboardResponse = FIXTURE_DASHBOARD) => {
    const view = render(<DashboardView data={data} />);
    openTab('Trading');
    return view;
  };
  const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const tile = (label: string) => screen.getByText(label).closest('.ad-kpi-card') as HTMLElement;
  const latest = (label: string) =>
    [...chartConfigs].reverse().find(c => c.data.datasets[0].label === label);

  it('starts on 30 days and moves every period section together', () => {
    const { container } = open();
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Profit After Costs')).toHaveTextContent('+$23.00');
    expect(screen.getByText('SMP2')).toBeInTheDocument();

    pick('7d');
    expect(sectionTitles(container)).toEqual(
      TAB_SECTIONS.Trading.map(t => t.replace('Last 30 Days', 'Last 7 Days'))
    );
    expect(tile('Profit After Costs')).toHaveTextContent('+$11.50');
    expect(tile('Profit After Costs')).toHaveTextContent('Previous 7 days: -$11.50');
    expect(screen.getByText('SMP1')).toBeInTheDocument();
    expect(screen.queryByText('SMP2')).toBeNull();
    expect(latest('After trading costs').data.labels).toHaveLength(7);
    expect(latest('Trades Closed').data.labels).toHaveLength(7);
    expect(screen.getByText('Total over the last 7 days')).toBeInTheDocument();
  });

  it('shows all time with weekly charts and no comparison', () => {
    open();
    pick('All');
    expect(tile('Profit After Costs')).toHaveTextContent('After fees and funding');
    expect(tile('Trades That Made Money')).toHaveTextContent('88 of 160');
    expect(tile('Without The 5 Best Trades')).toHaveTextContent('Those 5 made $58.80');
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(screen.getByText('Total since March')).toBeInTheDocument();
    expect(screen.getByText(/One point per week\. The worst single day was Jan 3/)).toBeVisible();
    expect(latest('Trades Closed').options.plugins.title.text).toBe('Weekly Trading Volume');
  });

  it('keeps the minus sign when even the five best trades lost money', () => {
    const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
    // The line shows where there is no previous period to compare with.
    data.trading!.periods.all.stats.best5NetPnl = -15;
    open(data);
    pick('All');
    expect(tile('Without The 5 Best Trades')).toHaveTextContent('Those 5 made -$15.00');
    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(tile('Without The 5 Best Trades')).toHaveTextContent('Those 5 made •••••');
  });

  it('names the month of the first trade, not of the week it falls in', () => {
    const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
    // A first trade on Sunday 1 March sits in the week starting 23 February.
    data.trading!.periods.all.since = '2026-03-01';
    data.trading!.periods.all.points[0].date = 'Feb 23';
    open(data);
    pick('All');
    expect(screen.getByText('Total since March')).toBeInTheDocument();
  });

  it('adds the year once all time covers more than one', () => {
    const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
    data.trading!.periods.all.points[0].date = 'Feb 23 2026';
    open(data);
    pick('All');
    expect(screen.getByText('Total since March 2026')).toBeInTheDocument();
  });

  it('keeps the chosen period when switching tabs', () => {
    open();
    pick('90d');
    openTab('Users');
    openTab('Trading');
    expect(screen.getByRole('button', { name: '90d' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('breaks profit down by side, market and hold time', () => {
    open();
    const table = () =>
      within(
        screen.getByRole('group', { name: 'Break profit down by' }).parentElement!
          .nextElementSibling as HTMLElement
      );
    expect(table().getByText('Long')).toBeInTheDocument();
    pick('Market');
    expect(table().getByText('Crypto')).toBeInTheDocument();
    expect(table().queryByText('Long')).toBeNull();
    pick('How long held');
    expect(table().getByText('Under 8 hours')).toBeInTheDocument();
  });

  it('says "none" for a missing average and drops the 5-best tile when there is nothing to drop', () => {
    const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
    Object.assign(data.trading!.periods.d30.stats, {
      avgLoss: null,
      netWithoutBest5: null,
      best5NetPnl: null,
    });
    open(data);
    expect(tile('Average Win / Loss')).toHaveTextContent('$2.50 / none');
    expect(screen.queryByText('Without The 5 Best Trades')).toBeNull();
  });

  it('handles a period with no closed trades', () => {
    const data: DashboardResponse = structuredClone(FIXTURE_DASHBOARD);
    Object.assign(data.trading!.periods.d30, {
      stats: {
        trades: 0,
        winners: 0,
        netPnl: 0,
        avgWin: null,
        avgLoss: null,
        netWithoutBest5: null,
        best5NetPnl: null,
      },
      points: [],
      worstDay: null,
      groups: { side: [], market: [], holdTime: [] },
      assets: [],
    });
    const { container } = open(data);
    expect(tile('Trades That Made Money')).toHaveTextContent('-');
    expect(container.textContent).not.toContain('NaN');
    expect(screen.getAllByText('No closed positions in this period.')).toHaveLength(3);
  });

  it('warns only past 10,000 closed positions', () => {
    open();
    expect(screen.queryByText(/Over 10,000/)).toBeNull();
  });
});

describe('FEATURE-ADV: profit charts', () => {
  const chartFor = (label: string) =>
    [...chartConfigs].reverse().find(c => c.data.datasets[0].label === label);

  it('plots after and before costs, and masks axis and tooltip while hidden', () => {
    render(<DashboardView data={FIXTURE_DASHBOARD} />);
    openTab('Trading');
    const points = FIXTURE_DASHBOARD.trading!.periods.d30.points;
    const profit = () => chartFor('After trading costs');
    expect(profit().data.datasets.map((d: any) => d.data)).toEqual([
      points.map(p => p.net),
      points.map(p => p.gross),
    ]);
    expect(chartFor('Below best').data.datasets[0].data).toEqual(points.map(p => p.belowBest));
    const tip = (chart: any) =>
      chart.options.plugins.tooltip.callbacks.label({
        parsed: { y: -12 },
        dataset: chart.data.datasets[0],
      });
    expect(tip(profit())).toBe('After trading costs: -$12.00');

    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    for (const chart of [profit(), chartFor('Below best')]) {
      expect(chart.options.scales.y.ticks.callback(50)).toBe('•••••');
      expect(tip(chart)).not.toMatch(MONEY);
    }
  });

  it('writes the end values on the canvas, masked while hidden', () => {
    const drawn = (hidden: boolean) => {
      const text: string[] = [];
      const chart = {
        ctx: {
          save() {},
          restore() {},
          fillText: (value: string) => text.push(value),
        },
        data: { datasets: [{ data: [1, 56.4] }, { data: [2, 117] }] },
        getDatasetMeta: (i: number) => ({
          data: [
            { x: 0, y: 0 },
            { x: 10, y: 20 + i },
          ],
        }),
      };
      (endLabels(hidden).afterDatasetsDraw as any)(chart);
      return text;
    };
    expect(drawn(false)).toEqual(['$56', '$117']);
    expect(drawn(true)).toEqual(['•••••', '•••••']);
  });
});

describe('Trading tab without period figures', () => {
  const legacy = [
    'Trading Activity (Last 30 Days)',
    'Monthly Returns',
    'Per-Asset PnL Scoreboard (30d)',
    'Position Concentration by Trader',
    'Open Positions',
  ];

  it('looks as before when an older backend sends none', () => {
    const data = { ...FIXTURE_DASHBOARD, trading: undefined, tradingError: undefined };
    const { container } = render(<DashboardView data={data} />);
    openTab('Trading');
    expect(sectionTitles(container)).toEqual(legacy);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
  });

  it('shows the error and keeps the rest when the calculation fails', () => {
    const data = { ...FIXTURE_DASHBOARD, trading: null, tradingError: 'Could not calculate.' };
    const { container } = render(<DashboardView data={data} />);
    openTab('Trading');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not calculate.');
    expect(sectionTitles(container)).toEqual(legacy);
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
