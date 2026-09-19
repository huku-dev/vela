// src/components/admin/AdminSections.tsx
//
// One React component per dashboard section. Each is data-in / render-out; no
// fetching here. The page orchestrator (AdminDashboard.tsx) fetches once,
// slices the response, and passes props. Rearrange sections by reordering
// the calls in AdminDashboard.tsx.
//
// Curated content (Highlights, Carryover, Notes) is served from the
// dashboard_curated Postgres row. GitHub sections (Shipped, Velocity) come
// from a GitHub REST call in the edge fn (needs GITHUB_TOKEN env var).

import { useState } from 'react';
import type React from 'react';
import type {
  AssetScoreboardRow,
  CarryoverItem,
  CohortRow,
  ConcentrationRow,
  DailyBucket,
  GithubActivity,
  HighlightItem,
  HoldTimeScoreboardRow,
  Kpis,
  LlmCosts,
  MonthlyReturns,
  MonthlyReturnRow,
  MonthlyReturnsYear,
  OpenPositionRow,
  RevenueRow,
  SubscriptionRisk,
  SubscriptionRisks,
  TraderCumulativePnlRow,
  UserRow,
} from '../../lib/adminDashboardClient';
import {
  BarCell,
  KpiCard,
  NarrativeLine,
  SectionTitle,
  SidePill,
  Sparkline,
  TierPill,
} from './AdminPrimitives';
import { PnlChart, TradingVolumeChart } from './AdminCharts';

function money(n: number, showZero = true): string {
  if (!showZero && Math.abs(n) < 0.005) return '$0';
  const abs = Math.abs(n);
  const rounded = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2);
  return `$${rounded}`;
}

function priceLabel(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (price >= 10) return price.toFixed(3);
  return price.toFixed(4);
}

// ── KPIs ─────────────────────────────────────────────────────────────────

export function KpisSection({ kpis }: { kpis: Kpis }) {
  return (
    <>
      <SectionTitle>Key Metrics</SectionTitle>
      <div className="ad-kpi-grid">
        <KpiCard label="Total Users" value={kpis.totalUsers} detail="Excl. e2e test accounts" />
        <KpiCard
          label="Paying Subscribers"
          value={kpis.payingSubscribers}
          detail={kpis.payingBreakdown}
          valueTone="green"
        />
        <KpiCard
          label="MRR"
          value={`$${kpis.mrr.toFixed(0)}`}
          detail={kpis.payingBreakdown}
          valueTone="green"
        />
        <KpiCard
          label="Active Traders"
          value={kpis.activeTraders7d}
          detail="Traded in last 7 days"
          valueTone="purple"
        />
        <KpiCard
          label="Open Positions"
          value={kpis.openPositions}
          detail={`${kpis.openPositionUsers} users, ${kpis.openPositionAssets} assets`}
        />
        <KpiCard
          label="Platform AUM"
          value={`$${kpis.platformAum.toFixed(0)}`}
          detail="Total USDC across wallets"
        />
      </div>
    </>
  );
}

// ── Placeholder: Highlights / Shipped / Velocity / GSC (deferred to a later iteration) ─

export function DeferredPanel({ title, note }: { title: string; note: string }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="ad-empty-panel">{note}</div>
    </>
  );
}

// ── Revenue Breakdown ────────────────────────────────────────────────────

export function RevenueBreakdownSection({ rows, mrr }: { rows: RevenueRow[]; mrr: number }) {
  const active = rows.filter(r => r.tier !== 'free');
  const maxActive = Math.max(
    1,
    ...active.map(r => r.monthlyRevenue),
    ...active.map(r => r.pastDueRevenue)
  );
  const largest = active.slice().sort((a, b) => b.monthlyRevenue - a.monthlyRevenue)[0];
  const largestPct = mrr > 0 && largest ? Math.round((largest.monthlyRevenue / mrr) * 100) : 0;
  const totalSubs = rows.reduce((acc, r) => acc + r.subscribers, 0);
  const pastDueTotal = rows.reduce((acc, r) => acc + r.pastDueRevenue, 0);

  return (
    <>
      <SectionTitle>Revenue Breakdown (Stripe + Supabase)</SectionTitle>
      <NarrativeLine>
        {largest ? (
          <>
            <strong>
              {tierLabel(largest.tier)} {largest.billingCycle ?? ''}
            </strong>{' '}
            is the largest tier at{' '}
            <strong>
              ${largest.monthlyRevenue.toFixed(0)} ({largestPct}% of MRR)
            </strong>
            .
          </>
        ) : (
          <>No paying subscribers on file.</>
        )}
        {pastDueTotal > 0
          ? ` $${pastDueTotal.toFixed(0)} past due; MRR would be $${(mrr + pastDueTotal).toFixed(0)} if resolved.`
          : ' No past-due subscriptions.'}
      </NarrativeLine>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Billing</th>
            <th className="ad-right">Subscribers</th>
            <th className="ad-right">Monthly Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <TierPill tier={r.tier} />
              </td>
              <td>{r.billingCycle ?? '-'}</td>
              <td className="ad-right ad-mono">{r.subscribers}</td>
              <td className="ad-right">
                {r.pastDueRevenue > 0 && r.monthlyRevenue === 0 ? (
                  <BarCell value={r.pastDueRevenue} maxAbs={maxActive} phantom />
                ) : (
                  <BarCell value={r.monthlyRevenue} maxAbs={maxActive} />
                )}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td colSpan={2}>
              <strong>Total</strong>
            </td>
            <td className="ad-right ad-mono">
              <strong>{totalSubs}</strong>
            </td>
            <td className="ad-right ad-mono ad-green">
              <strong>${mrr.toFixed(0)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function tierLabel(tier: 'premium' | 'standard' | 'free'): string {
  return tier[0].toUpperCase() + tier.slice(1);
}

// ── Cohort Funnel ────────────────────────────────────────────────────────

export function CohortFunnelSection({ rows }: { rows: CohortRow[] }) {
  return (
    <>
      <SectionTitle>Signup Cohort Funnel</SectionTitle>
      <table>
        <thead>
          <tr>
            <th>Cohort Week</th>
            <th className="ad-right">Signups</th>
            <th className="ad-right">Paid</th>
            <th className="ad-right">Deposited</th>
            <th className="ad-right">Traded</th>
            <th className="ad-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const label = cohortLabel(r);
            return (
              <tr key={r.cohortWeek}>
                <td className="ad-mono">{shortWeek(r.cohortWeek)}</td>
                <td className="ad-right ad-mono">{r.signups}</td>
                <td className="ad-right ad-mono">{r.paid}</td>
                <td className="ad-right ad-mono">{r.deposited}</td>
                <td className="ad-right ad-mono">{r.traded}</td>
                <td className={`ad-right ad-mono ${label.cls}`}>{label.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/**
 * Cohort funnel row label. Ranks by the deepest stage the cohort reached.
 * Green: everyone signed up traded. Amber: partial conversion at any stage.
 * Red only when literally zero paid AND zero deposited AND zero traded.
 */
function cohortLabel(r: CohortRow): { text: string; cls: string } {
  if (r.signups === 0) return { text: '-', cls: '' };
  if (r.traded === r.signups) return { text: '100%', cls: 'ad-green' };
  if (r.traded > 0) {
    const pct = Math.round((r.traded / r.signups) * 100);
    return { text: `${pct}% traded`, cls: 'ad-amber' };
  }
  if (r.deposited > 0) {
    const pct = Math.round((r.deposited / r.signups) * 100);
    return { text: `${pct}% deposited, 0% traded`, cls: 'ad-amber' };
  }
  if (r.paid > 0) {
    const pct = Math.round((r.paid / r.signups) * 100);
    return { text: `${pct}% paid, 0% deposited`, cls: 'ad-amber' };
  }
  return { text: '0%', cls: 'ad-red' };
}

function shortWeek(iso: string): string {
  const d = new Date(iso);
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
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ── Trading Charts ───────────────────────────────────────────────────────

type ChartRange = '7d' | '30d' | '90d';

/**
 * Trading activity: volume + PnL bars.
 * Timeframe toggle (7d / 30d / 90d, default 30d) swaps the active series.
 * 180d intentionally omitted — daily bars become unreadable and the story
 * duplicates the Monthly Returns section below.
 */
export function ChartsSection({
  pnlSeries7d,
  pnlSeries30d,
  pnlSeries90d,
}: {
  pnlSeries7d?: DailyBucket[];
  pnlSeries30d: DailyBucket[];
  pnlSeries90d?: DailyBucket[];
}) {
  const [range, setRange] = useState<ChartRange>('30d');
  const active =
    range === '7d' && pnlSeries7d
      ? pnlSeries7d
      : range === '90d' && pnlSeries90d
        ? pnlSeries90d
        : pnlSeries30d;
  const label = range === '7d' ? 'Last 7 Days' : range === '90d' ? 'Last 90 Days' : 'Last 30 Days';
  return (
    <>
      <SectionTitle>Trading Activity ({label})</SectionTitle>
      <div className="ad-returns-toolbar">
        <div className="ad-segmented">
          <button
            type="button"
            className={range === '7d' ? 'active' : ''}
            onClick={() => setRange('7d')}
            disabled={!pnlSeries7d}
          >
            7d
          </button>
          <button
            type="button"
            className={range === '30d' ? 'active' : ''}
            onClick={() => setRange('30d')}
          >
            30d
          </button>
          <button
            type="button"
            className={range === '90d' ? 'active' : ''}
            onClick={() => setRange('90d')}
            disabled={!pnlSeries90d}
          >
            90d
          </button>
        </div>
        <span className="ad-returns-caption">Daily trades + PnL</span>
      </div>
      <div className="ad-chart-row">
        <TradingVolumeChart data={active} />
        <PnlChart data={active} />
      </div>
    </>
  );
}

// ── User Overview ────────────────────────────────────────────────────────

export function UserOverviewSection({ rows }: { rows: UserRow[] }) {
  const maxRealized = Math.max(1, ...rows.map(r => Math.abs(r.realizedPnl)));
  const maxUnrealized = Math.max(1, ...rows.map(r => Math.abs(r.unrealizedPnl)));
  const totalRealized = rows.reduce((acc, r) => acc + r.realizedPnl, 0);
  const sortedByLoss = rows.slice().sort((a, b) => a.realizedPnl - b.realizedPnl);
  const topTwo = sortedByLoss.slice(0, 2).filter(r => r.realizedPnl < 0);
  const topTwoSum = topTwo.reduce((acc, r) => acc + r.realizedPnl, 0);
  const topTwoPct = totalRealized !== 0 ? Math.round((topTwoSum / totalRealized) * 100) : 0;
  const inactiveUsers = rows.filter(r => r.balance === 0 && r.trades === 0).length;

  return (
    <>
      <SectionTitle>User Overview</SectionTitle>
      <NarrativeLine>
        {topTwo.length === 2 && totalRealized < 0 ? (
          <>
            {topTwo[0].displayName} and {topTwo[1].displayName} account for{' '}
            <strong>
              -${Math.abs(topTwoSum).toFixed(2)} of the -${Math.abs(totalRealized).toFixed(2)}
            </strong>{' '}
            total realized PnL ({topTwoPct}%).
          </>
        ) : (
          <>Realized PnL across users: ${totalRealized.toFixed(2)}.</>
        )}{' '}
        {inactiveUsers} of {rows.length} users have never funded a wallet or opened a trade.
      </NarrativeLine>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Tier</th>
              <th>Billing</th>
              <th>Mode</th>
              <th className="ad-right">Balance</th>
              <th className="ad-right">Open</th>
              <th className="ad-right">Trades</th>
              <th className="ad-right">Realized PnL</th>
              <th className="ad-right">Realized %</th>
              <th className="ad-right">Unrealized PnL</th>
              <th>Signup</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              // Optional field from backend PR #180; null when the user has
              // never closed a trade. Render "—" in both cases so a stale
              // backend or an inactive user shows the same neutral marker.
              const pct = r.realizedPnlPct;
              const pctTone =
                typeof pct === 'number'
                  ? pct > 0.005
                    ? 'ad-green'
                    : pct < -0.005
                      ? 'ad-red'
                      : ''
                  : '';
              const pctLabel =
                typeof pct === 'number'
                  ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                  : '—';
              return (
                <tr key={r.displayName + r.signup}>
                  <td>
                    <strong>
                      {r.displayName}
                      {r.isSelf ? ' (you)' : ''}
                    </strong>
                  </td>
                  <td>
                    <TierPill tier={r.tier} />
                  </td>
                  <td>{r.billingCycle ?? '-'}</td>
                  <td>{humanMode(r.tradingMode)}</td>
                  <td className="ad-right ad-mono">${r.balance.toFixed(0)}</td>
                  <td className="ad-right ad-mono">{r.openPositions}</td>
                  <td className="ad-right ad-mono">{r.trades}</td>
                  <td className="ad-right">
                    <BarCell value={r.realizedPnl} maxAbs={maxRealized} />
                  </td>
                  <td className={`ad-right ad-mono ${pctTone}`}>{pctLabel}</td>
                  <td className="ad-right">
                    <BarCell value={r.unrealizedPnl} maxAbs={maxUnrealized} />
                  </td>
                  <td className="ad-mono">{shortWeek(r.signup)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function humanMode(m: string): string {
  if (m === 'full_auto') return 'Full Auto';
  if (m === 'semi_auto') return 'Semi Auto';
  if (m === 'view_only') return 'View Only';
  return m;
}

// ── Position Concentration ───────────────────────────────────────────────

export function PositionConcentrationSection({ rows }: { rows: ConcentrationRow[] }) {
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.unrealizedPnl)));
  const totalNotional = rows.reduce((acc, r) => acc + r.notional, 0);
  const totalOpen = rows.reduce((acc, r) => acc + r.openPositions, 0);
  const totalUnrealized = rows.reduce((acc, r) => acc + r.unrealizedPnl, 0);
  const worst = rows.slice().sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0];
  return (
    <>
      <SectionTitle>Position Concentration by Trader</SectionTitle>
      {rows.length === 0 ? (
        <div className="ad-empty-panel">No open positions.</div>
      ) : (
        <>
          <NarrativeLine>
            {rows.length} users hold all {totalOpen} open positions (${totalNotional.toFixed(0)}{' '}
            notional).
            {worst && worst.unrealizedPnl < 0 ? (
              <>
                {' '}
                <strong>
                  {worst.displayName}&rsquo;s book is the largest drag at $
                  {worst.unrealizedPnl.toFixed(2)} unrealized.
                </strong>
              </>
            ) : (
              <>
                {' '}
                Total unrealized: {totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(2)}.
              </>
            )}
          </NarrativeLine>
          <table style={{ marginBottom: 8 }}>
            <thead>
              <tr>
                <th>User</th>
                <th className="ad-right">Open Positions</th>
                <th className="ad-right">Notional</th>
                <th className="ad-right">Unrealized PnL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.displayName}>
                  <td>
                    <strong>{r.displayName}</strong>
                  </td>
                  <td className="ad-right ad-mono">{r.openPositions}</td>
                  <td className="ad-right ad-mono">${r.notional.toFixed(0)}</td>
                  <td className="ad-right">
                    <BarCell value={r.unrealizedPnl} maxAbs={maxAbs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

// ── Open Positions ───────────────────────────────────────────────────────

type OpenPosSort = 'default' | 'size' | 'pnl';

export function OpenPositionsSection({ rows }: { rows: OpenPositionRow[] }) {
  // Backend returns rows sorted by size desc; "default" preserves that.
  // Click a column once → desc, click again → asc, click a different column
  // → reset to desc. Matches the pattern used by the Per-Asset Scoreboard.
  const [sortBy, setSortBy] = useState<OpenPosSort>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const onColumnClick = (col: 'size' | 'pnl') => {
    if (col === sortBy) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const sorted =
    sortBy === 'default'
      ? rows
      : rows
          .slice()
          .sort(
            (a, b) =>
              (sortDir === 'asc' ? 1 : -1) *
              (sortBy === 'size' ? a.sizeUsd - b.sizeUsd : a.pnl - b.pnl)
          );

  const arrowFor = (col: 'size' | 'pnl') =>
    sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  const headerClass = (col: 'size' | 'pnl') =>
    `ad-right ${sortBy === col ? 'ad-sort-active' : 'ad-sortable'}`;

  return (
    <>
      <SectionTitle>Open Positions</SectionTitle>
      {rows.length === 0 ? (
        <div className="ad-empty-panel">No open positions.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Asset</th>
                <th>Side</th>
                <th
                  className={headerClass('size')}
                  onClick={() => onColumnClick('size')}
                  style={{ cursor: 'pointer' }}
                >
                  Size{arrowFor('size')}
                </th>
                <th className="ad-right">Entry</th>
                <th className="ad-right">Current</th>
                <th
                  className={headerClass('pnl')}
                  onClick={() => onColumnClick('pnl')}
                  style={{ cursor: 'pointer' }}
                >
                  PnL{arrowFor('pnl')}
                </th>
                <th className="ad-right">PnL %</th>
                <th className="ad-right">Hours Open</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                // money() strips sign via Math.abs; add it back here so a losing
                // position renders "-$3.90 (red)" not "$3.90 (red)".
                const pnlTone = r.pnl > 0 ? 'ad-green' : r.pnl < 0 ? 'ad-red' : '';
                const pnlLabel =
                  Math.abs(r.pnl) < 0.005
                    ? '$0.00'
                    : `${r.pnl > 0 ? '+' : '-'}${money(Math.abs(r.pnl))}`;
                const pctTone = r.pnlPct > 0 ? 'ad-green' : r.pnlPct < 0 ? 'ad-red' : '';
                const pctLabel = `${r.pnlPct > 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%`;
                return (
                  <tr key={i}>
                    <td>
                      <strong>{r.displayName}</strong>
                    </td>
                    <td>{r.asset}</td>
                    <td>
                      <SidePill side={r.side} />
                    </td>
                    <td className="ad-right ad-mono">${r.sizeUsd.toFixed(0)}</td>
                    <td className="ad-right ad-mono">${priceLabel(r.entryPrice)}</td>
                    <td className="ad-right ad-mono">${priceLabel(r.currentPrice)}</td>
                    <td className={`ad-right ad-mono ${pnlTone}`}>{pnlLabel}</td>
                    <td className={`ad-right ad-mono ${pctTone}`}>{pctLabel}</td>
                    <td className="ad-right ad-mono">{r.hoursOpen}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Curated: Highlights / Carryover / Notes ─────────────────────────────

/**
 * Render **bold** and _italic_ / *italic* in the curated body strings. Curated
 * content is authored in SQL and edited by a single admin, so the surface is
 * trusted; still, we escape everything except the recognised tokens so a
 * stray < in the source doesn't render HTML.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={`b-${key++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<em key={`i-${key++}`}>{match[2]}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function HighlightsSection({ items }: { items: HighlightItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <SectionTitle>Highlights</SectionTitle>
      <ul className="ad-highlights-list">
        {items.map((h, i) => (
          <li key={i}>
            <span className={`ad-highlight-arrow ad-${h.direction}`}>
              {h.direction === 'up' ? '↑' : h.direction === 'down' ? '↓' : '→'}
            </span>
            <span className="ad-highlight-text">{renderInlineMarkdown(h.body)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CarryoverSection({
  nextUp,
  needsAttention,
}: {
  nextUp: CarryoverItem[];
  needsAttention: CarryoverItem[];
}) {
  if (nextUp.length === 0 && needsAttention.length === 0) return null;
  return (
    <>
      <SectionTitle>Roadmap</SectionTitle>
      <div className="ad-carryover-grid">
        <CarryoverCol title="Next Up" items={nextUp} />
        <CarryoverCol title="Needs Attention" items={needsAttention} showStale />
      </div>
    </>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  High: 'var(--color-signal-sell)',
  Medium: 'var(--color-signal-wait)',
  Low: 'var(--ad-gray-400)',
};

const STATUS_COLORS: Record<string, string> = {
  'In progress': 'var(--ad-blue)',
  Next: 'var(--ad-purple-dark)',
  Blocked: 'var(--color-signal-sell)',
  Backlog: 'var(--ad-gray-500)',
};

function formatShortDate(iso: string): string {
  const d = new Date(iso);
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
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const CARRYOVER_COLLAPSED_LIMIT = 5;

function CarryoverCol({
  title,
  items,
  showStale,
}: {
  title: string;
  items: CarryoverItem[];
  showStale?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = items.length > CARRYOVER_COLLAPSED_LIMIT;
  const visible = expanded || !needsToggle ? items : items.slice(0, CARRYOVER_COLLAPSED_LIMIT);

  return (
    <div className="ad-carryover-col">
      <div className="ad-carryover-head">
        <h3>{title}</h3>
        <span className="ad-carryover-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="ad-carryover-empty">Empty.</div>
      ) : (
        <>
          {visible.map((c, i) => (
            <div key={i} className="ad-carryover-item">
              <div className="ad-carryover-title">
                {c.notionUrl ? (
                  <a href={c.notionUrl} target="_blank" rel="noopener noreferrer">
                    {c.title}
                  </a>
                ) : (
                  c.title
                )}
              </div>
              {c.description && <div className="ad-carryover-desc">{c.description}</div>}
              <div className="ad-carryover-meta">
                <span
                  className="ad-carryover-pill"
                  style={{ color: STATUS_COLORS[c.status] ?? 'var(--ad-gray-500)' }}
                >
                  {c.status}
                </span>
                {c.priority && (
                  <span
                    className="ad-carryover-pill"
                    style={{ color: PRIORITY_COLORS[c.priority] ?? 'inherit' }}
                  >
                    {c.priority}
                  </span>
                )}
                {c.area && <span className="ad-carryover-pill">{c.area}</span>}
                {c.targetDate && (
                  <span className="ad-carryover-stale">
                    Target: {formatShortDate(c.targetDate)}
                  </span>
                )}
                {!c.targetDate && c.createdDate && (
                  <span className="ad-carryover-stale">
                    Created {formatShortDate(c.createdDate)}
                  </span>
                )}
                {showStale && c.daysStale > 0 && (
                  <span className="ad-carryover-stale">{c.daysStale}d stale</span>
                )}
              </div>
            </div>
          ))}
          {needsToggle && (
            <button className="ad-carryover-toggle" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : `See ${items.length - CARRYOVER_COLLAPSED_LIMIT} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function NotesSection({ notes }: { notes: string }) {
  if (!notes.trim()) return null;
  const paragraphs = notes.split(/\n{2,}/).filter(Boolean);
  return (
    <>
      <SectionTitle>Notes</SectionTitle>
      <div className="ad-notes-block">
        {paragraphs.map((p, i) => (
          <p key={i}>{renderInlineMarkdown(p)}</p>
        ))}
      </div>
    </>
  );
}

// ── GitHub: Shipped This Week + Velocity ────────────────────────────────

export function ShippedSection({ github }: { github: GithubActivity }) {
  return (
    <>
      <SectionTitle>Shipped This Week</SectionTitle>
      {github.errorMessage ? (
        <div className="ad-empty-panel">GitHub fetch failed: {github.errorMessage}</div>
      ) : github.shippedTop.length === 0 ? (
        <div className="ad-empty-panel">No PRs merged in the last 7 days.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>PR</th>
              <th>Title</th>
              <th style={{ width: 130 }}>Author</th>
              <th style={{ width: 100 }}>Merged</th>
            </tr>
          </thead>
          <tbody>
            {github.shippedTop.map(pr => (
              <tr key={pr.number}>
                <td className="ad-mono">
                  <a
                    href={`https://github.com/huku-dev/crypto-agent-backend/pull/${pr.number}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ad-purple"
                  >
                    #{pr.number}
                  </a>
                </td>
                <td>{pr.title}</td>
                <td className="ad-mono">{pr.author}</td>
                <td className="ad-mono">{pr.mergedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function VelocitySection({ github }: { github: GithubActivity }) {
  const velocity = github.velocity7d;
  const max = Math.max(1, ...velocity.map(b => b.count));
  return (
    <>
      <SectionTitle>Velocity (PRs Merged, Last 7 Days)</SectionTitle>
      {github.errorMessage ? (
        <div className="ad-empty-panel">GitHub fetch failed: {github.errorMessage}</div>
      ) : velocity.length === 0 ? (
        <div className="ad-empty-panel">No GitHub activity in the last 7 days.</div>
      ) : (
        <div className="ad-velocity">
          {velocity.map(b => {
            const width = Math.round((b.count / max) * 100);
            return (
              <div key={b.isoDate} className="ad-velocity-row">
                <span className="ad-velocity-day">{b.dayLabel}</span>
                <div className="ad-velocity-track">
                  <div
                    className={`ad-velocity-bar ${b.count === 0 ? 'ad-zero' : ''}`}
                    style={{ width: b.count === 0 ? 6 : `${Math.max(2, width)}%` }}
                  />
                </div>
                <span className="ad-velocity-count">{b.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── LLM API Cost Tracking ───────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDelta(delta: number | null): { text: string; tone: string } | null {
  if (delta === null) return null;
  const pct = Math.round(delta * 100);
  if (pct === 0) return { text: '0% vs prior 7d', tone: '' };
  const sign = pct > 0 ? '+' : '';
  return {
    text: `${sign}${pct}% vs prior 7d`,
    tone: pct > 0 ? 'ad-red' : 'ad-green',
  };
}

function formatDeltaInverse(delta: number | null): { text: string; tone: string } | null {
  if (delta === null) return null;
  const pct = Math.round(delta * 100);
  if (pct === 0) return { text: '0% vs prior 7d', tone: '' };
  const sign = pct > 0 ? '+' : '';
  return {
    text: `${sign}${pct}% vs prior 7d`,
    tone: pct > 0 ? 'ad-green' : 'ad-red',
  };
}

function formatRateDelta(delta: number): { text: string; tone: string } | null {
  const pp = Math.round(delta * 100);
  if (pp === 0) return { text: '0pp vs prior 7d', tone: '' };
  const sign = pp > 0 ? '+' : '';
  return {
    text: `${sign}${pp}pp vs prior 7d`,
    tone: pp > 0 ? 'ad-green' : 'ad-red',
  };
}

function CostKpiCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: { text: string; tone: string } | null;
}) {
  return (
    <div className="ad-kpi-card">
      <div className="ad-kpi-label">{label}</div>
      <div className="ad-kpi-value">{value}</div>
      {delta && <div className={`ad-kpi-detail ${delta.tone}`}>{delta.text}</div>}
    </div>
  );
}

export function LlmCostSection({ data }: { data: LlmCosts }) {
  const { kpis, providers, errorMessage } = data;
  const maxCost = Math.max(1, ...providers.map(p => p.cost));

  return (
    <>
      <SectionTitle>API Costs (Last 7 Days)</SectionTitle>
      {errorMessage ? (
        <div className="ad-empty-panel">LLM cost data unavailable: {errorMessage}</div>
      ) : (
        <>
          <div className="ad-kpi-grid">
            <CostKpiCard
              label="Total Spend"
              value={`$${kpis.totalSpend.toFixed(2)}`}
              delta={formatDelta(kpis.totalSpendDelta)}
            />
            <CostKpiCard
              label="Requests"
              value={formatTokens(kpis.requests)}
              delta={formatDeltaInverse(kpis.requestsDelta)}
            />
            <CostKpiCard
              label="Token Volume"
              value={formatTokens(kpis.tokenVolume)}
              delta={formatDeltaInverse(kpis.tokenVolumeDelta)}
            />
            <CostKpiCard
              label="Cache Hit Rate"
              value={`${Math.round(kpis.cacheHitRate * 100)}%`}
              delta={formatRateDelta(kpis.cacheHitRateDelta)}
            />
            <CostKpiCard
              label="Blended $/1M tokens"
              value={`$${kpis.blendedPer1M.toFixed(2)}`}
              delta={formatDelta(kpis.blendedPer1MDelta)}
            />
          </div>

          {providers.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="ad-right">Cost</th>
                  <th className="ad-right">Calls</th>
                  <th className="ad-right">Input Tokens</th>
                  <th className="ad-right">Output Tokens</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(p => (
                  <tr key={p.provider}>
                    <td style={{ textTransform: 'capitalize' }}>
                      <strong>{p.provider}</strong>
                    </td>
                    <td className="ad-right">
                      <BarCell value={p.cost} maxAbs={maxCost} />
                    </td>
                    <td className="ad-right ad-mono">{formatTokens(p.calls)}</td>
                    <td className="ad-right ad-mono">{formatTokens(p.inputTokens)}</td>
                    <td className="ad-right ad-mono">{formatTokens(p.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

// ── Trader Cumulative PnL (30d) ──────────────────────────────────────────
//
// Replaces the daily-PnL bar chart. Compact per-trader row with an inline
// sparkline of cumulative realized PnL. Movers strip on top surfaces the
// biggest gain, biggest loss, and one "notable" pick regardless of how many
// traders the table holds, so the section stays legible past 60 users.

type TraderFilter = 'active30d' | 'all';
type TraderSort = 'pnl' | 'peak' | 'trough' | 'balance' | 'name';

export function TraderCumulativePnlSection({
  rows,
  totalUsers,
}: {
  rows: TraderCumulativePnlRow[];
  totalUsers: number;
}) {
  const [tierFilter, setTierFilter] = useState<'all' | 'premium' | 'standard' | 'free'>('all');
  const [activityFilter, setActivityFilter] = useState<TraderFilter>('active30d');
  const [sort, setSort] = useState<TraderSort>('pnl');

  const visible = rows.filter(r => tierFilter === 'all' || r.tier === tierFilter);
  const sorted = visible.slice().sort((a, b) => {
    switch (sort) {
      case 'pnl':
        return a.totalPnl30d - b.totalPnl30d; // worst first
      case 'peak':
        return b.peak30d - a.peak30d;
      case 'trough':
        return a.trough30d - b.trough30d;
      case 'balance':
        return b.balance - a.balance;
      case 'name':
        return a.displayName.localeCompare(b.displayName);
    }
  });

  const platform30d = rows.reduce((acc, r) => acc + r.totalPnl30d, 0);
  const winner = rows.slice().sort((a, b) => b.totalPnl30d - a.totalPnl30d)[0] ?? null;
  const loser = rows.slice().sort((a, b) => a.totalPnl30d - b.totalPnl30d)[0] ?? null;
  // Notable slot: most recent close, but never a duplicate of winner or loser.
  // In small trader populations (2 or 3), all extremes may collide; when they
  // do, we render null and the card shows a placeholder rather than a repeat.
  const isDuplicate = (r: TraderCumulativePnlRow | null) =>
    r !== null && (r === winner || r === loser);
  const byRecency = rows
    .slice()
    .sort((a, b) => (b.lastCloseIso ?? '').localeCompare(a.lastCloseIso ?? ''));
  const notable = byRecency.find(r => !isDuplicate(r)) ?? null;

  return (
    <>
      <SectionTitle>Cumulative Realized PnL by Trader (30d)</SectionTitle>
      <NarrativeLine>
        Platform 30d realized PnL: <strong>{signedMoney(platform30d)}</strong> across{' '}
        <strong>{rows.length}</strong> active trader{rows.length === 1 ? '' : 's'}. Movers strip
        picks the extremes so the section stays legible as user count grows.
      </NarrativeLine>

      <div className="ad-movers-grid">
        <MoverCard label="Biggest 30d gain" row={winner} tone="pos" />
        <MoverCard label="Biggest 30d loss" row={loser} tone="neg" />
        <MoverCard label="Most recent close" row={notable} tone="neutral" />
      </div>

      <div className="ad-filter-bar">
        <label htmlFor="ad-trader-tier-filter">Tier</label>
        <select
          id="ad-trader-tier-filter"
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value as typeof tierFilter)}
        >
          <option value="all">All</option>
          <option value="premium">Premium</option>
          <option value="standard">Standard</option>
          <option value="free">Free</option>
        </select>
        <label htmlFor="ad-trader-activity-filter">Activity</label>
        <select
          id="ad-trader-activity-filter"
          value={activityFilter}
          onChange={e => setActivityFilter(e.target.value as TraderFilter)}
        >
          <option value="active30d">Traded in 30d</option>
          <option value="all">All users</option>
        </select>
        <span className="ad-filter-count">
          Showing {sorted.length} of {rows.length} traders active in 30d · {totalUsers} users total
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <SortHeader label="Trader" active={sort === 'name'} onClick={() => setSort('name')} />
              <th>Tier</th>
              <SortHeader
                label="Balance"
                active={sort === 'balance'}
                onClick={() => setSort('balance')}
                align="right"
              />
              <th className="ad-right">Open</th>
              <SortHeader
                label="30d PnL"
                active={sort === 'pnl'}
                onClick={() => setSort('pnl')}
                align="right"
              />
              <SortHeader
                label="30d high"
                active={sort === 'peak'}
                onClick={() => setSort('peak')}
                align="right"
              />
              <SortHeader
                label="30d low"
                active={sort === 'trough'}
                onClick={() => setSort('trough')}
                align="right"
              />
              <th>Cumulative PnL (30d)</th>
              <th className="ad-right">Last close</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              // Composite key: two traders sharing a display name would collide
              // and cause React to reuse row DOM across users. TraderCumulativePnlRow
              // has no stable id yet; upstream fix is to plumb privy_did into the
              // response. Composite of name + tier + subscriptionStatus + signed
              // balance is enough to disambiguate real users in practice.
              <tr key={`${r.displayName}::${r.tier}::${r.subscriptionStatus}::${r.balance}`}>
                <td>
                  <strong>
                    {r.displayName}
                    {r.isSelf ? ' (you)' : ''}
                  </strong>
                </td>
                <td>{tierOrRiskPill(r)}</td>
                <td className="ad-right ad-mono">${r.balance.toFixed(0)}</td>
                <td className="ad-right ad-mono">{r.openPositions}</td>
                <td className="ad-right">
                  <BarCell value={r.totalPnl30d} maxAbs={maxAbsPnl(rows)} />
                </td>
                <td className={`ad-right ad-mono ${r.peak30d > 0 ? 'ad-green' : ''}`}>
                  {signedMoney(r.peak30d)}
                </td>
                <td className={`ad-right ad-mono ${r.trough30d < 0 ? 'ad-red' : ''}`}>
                  {signedMoney(r.trough30d)}
                </td>
                <td>
                  <Sparkline values={r.series.map(p => p.cumPnl)} />
                </td>
                <td className="ad-right ad-mono">{shortDate(r.lastCloseIso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MoverCard({
  label,
  row,
  tone,
}: {
  label: string;
  row: TraderCumulativePnlRow | null;
  tone: 'pos' | 'neg' | 'neutral';
}) {
  if (!row) {
    return (
      <div className="ad-mover-card">
        <div className="ad-mover-label">{label}</div>
        <div className="ad-mover-detail" style={{ fontStyle: 'italic' }}>
          No qualifying trader
        </div>
      </div>
    );
  }
  const toneClass = tone === 'pos' ? 'ad-green' : tone === 'neg' ? 'ad-red' : '';
  return (
    <div className="ad-mover-card">
      <div className="ad-mover-label">{label}</div>
      <div className="ad-mover-row">
        <span className="ad-mover-name">{row.displayName}</span>
        {tierOrRiskPill(row)}
        <span className={`ad-mover-pnl ${toneClass}`}>{signedMoney(row.totalPnl30d)}</span>
      </div>
      <div className="ad-mover-detail">
        30d high {signedMoney(row.peak30d)} · 30d low {signedMoney(row.trough30d)} ·{' '}
        {row.openPositions} open
      </div>
    </div>
  );
}

function tierOrRiskPill(row: TraderCumulativePnlRow) {
  if (row.subscriptionStatus === 'past_due') {
    return <span className="ad-pill ad-pill-red">Past due</span>;
  }
  if (row.subscriptionStatus === 'cancelled') {
    return <span className="ad-pill ad-pill-muted">Cancelled</span>;
  }
  return <TierPill tier={row.tier} />;
}

function maxAbsPnl(rows: TraderCumulativePnlRow[]): number {
  return Math.max(1, ...rows.map(r => Math.abs(r.totalPnl30d)));
}

function signedMoney(n: number): string {
  if (Math.abs(n) < 0.005) return '$0';
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  return `${sign}$${abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  if (isToday) return 'Today';
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
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function SortHeader({
  label,
  active,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'right';
}) {
  return (
    <th
      className={`${align === 'right' ? 'ad-right' : ''} ${active ? 'ad-sort-active' : 'ad-sortable'}`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {label}
    </th>
  );
}

// ── Asset Scoreboard (30d) ────────────────────────────────────────────────
//
// Replaces the Search Visibility section. Every symbol that closed a trade in
// the last 30d, sorted by |PnL| desc so the biggest movers surface first
// regardless of sign. Sparkline shows the cumulative PnL trajectory so you
// can tell if a green cell is one lucky trade or a steady climb.

const ASSET_SCOREBOARD_TOP_N = 10;

// Column identifiers for sort state. 'default' means "keep backend order",
// which is |netPnl| desc — biggest movers on either side surface first.
type AssetSort =
  | 'default'
  | 'symbol'
  | 'closes'
  | 'winPct'
  | 'volume'
  | 'netPnl'
  | 'netPnlPct'
  | 'avgHold';
type SortDir = 'asc' | 'desc';

/**
 * Per-asset return-on-capital: netPnl / volume × 100.
 * Volume is sum of size_usd across the asset's closes; matches the
 * "% of notional" convention used elsewhere in the dashboard. Falls back
 * to 0 if a row somehow has zero volume (shouldn't happen).
 */
function netPnlPctFor(r: AssetScoreboardRow): number {
  return r.volume > 0 ? (r.netPnl / r.volume) * 100 : 0;
}

function compareAssets(a: AssetScoreboardRow, b: AssetScoreboardRow, by: AssetSort): number {
  switch (by) {
    case 'symbol':
      return a.symbol.localeCompare(b.symbol);
    case 'closes':
      return a.closes - b.closes;
    case 'winPct':
      return a.winPct - b.winPct;
    case 'volume':
      return a.volume - b.volume;
    case 'netPnl':
      return a.netPnl - b.netPnl;
    case 'netPnlPct':
      return netPnlPctFor(a) - netPnlPctFor(b);
    case 'avgHold':
      return a.avgHoldHours - b.avgHoldHours;
    default:
      return 0;
  }
}

export function AssetScoreboardSection({ rows }: { rows: AssetScoreboardRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<AssetSort>('default');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  if (rows.length === 0) {
    return (
      <>
        <SectionTitle>Per-Asset PnL Scoreboard (30d)</SectionTitle>
        <div className="ad-empty-panel">No closed positions in the last 30 days.</div>
      </>
    );
  }

  // Click semantics: first click on a column sorts DESC (largest first);
  // second click on the same column toggles to ASC. Clicking a different
  // column resets direction to DESC. Symbol is the exception: its natural
  // order is A-Z, so first click sorts ASC.
  const onColumnClick = (col: AssetSort) => {
    if (col === sortBy) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'symbol' ? 'asc' : 'desc');
    }
  };

  const sortedRows =
    sortBy === 'default'
      ? rows
      : rows.slice().sort((a, b) => (sortDir === 'asc' ? 1 : -1) * compareAssets(a, b, sortBy));

  const visible = showAll ? sortedRows : sortedRows.slice(0, ASSET_SCOREBOARD_TOP_N);
  const hiddenRows = Math.max(0, sortedRows.length - ASSET_SCOREBOARD_TOP_N);
  const hiddenCombined = sortedRows
    .slice(ASSET_SCOREBOARD_TOP_N)
    .reduce((acc, r) => acc + r.netPnl, 0);
  // "Worst" and "Best" are always computed against the full population by
  // netPnl, independent of the user's sort choice. Highlighting the largest
  // drag row must stay stable even when the user sorts by, say, avg hold.
  const worst = rows.slice().sort((a, b) => a.netPnl - b.netPnl)[0];
  const worstIsDrag = worst && worst.netPnl < 0 ? worst : null;
  const bestByPnl = rows.slice().sort((a, b) => b.netPnl - a.netPnl)[0];
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.netPnl)));

  return (
    <>
      <SectionTitle>Per-Asset PnL Scoreboard (30d)</SectionTitle>
      {worstIsDrag && bestByPnl && worstIsDrag.symbol !== bestByPnl.symbol && (
        <NarrativeLine>
          <strong>
            {worstIsDrag.symbol} is the largest drag: {signedMoney(worstIsDrag.netPnl)} across{' '}
            {worstIsDrag.closes} close{worstIsDrag.closes === 1 ? '' : 's'}
          </strong>{' '}
          ({worstIsDrag.winPct}% win rate). Best asset: <strong>{bestByPnl.symbol}</strong> at{' '}
          {signedMoney(bestByPnl.netPnl)}.
        </NarrativeLine>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <AssetSortHeader
                label="Symbol"
                col="symbol"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
              />
              <AssetSortHeader
                label="Closes"
                col="closes"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <AssetSortHeader
                label="Win%"
                col="winPct"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <AssetSortHeader
                label="Volume"
                col="volume"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <AssetSortHeader
                label="Net PnL"
                col="netPnl"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <AssetSortHeader
                label="Net %"
                col="netPnlPct"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <AssetSortHeader
                label="Avg hold"
                col="avgHold"
                sortBy={sortBy}
                sortDir={sortDir}
                onClick={onColumnClick}
                align="right"
              />
              <th>Cumulative PnL (30d)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const netPct = netPnlPctFor(r);
              const pctTone = netPct > 0.005 ? 'ad-green' : netPct < -0.005 ? 'ad-red' : '';
              return (
                <tr
                  key={r.symbol}
                  className={worstIsDrag && r === worstIsDrag ? 'ad-row-highlight' : undefined}
                >
                  <td>
                    <strong>{r.symbol}</strong>
                  </td>
                  <td className="ad-right ad-mono">{r.closes}</td>
                  <td className={`ad-right ad-mono ${winRateTone(r.winPct)}`}>{r.winPct}%</td>
                  <td className="ad-right ad-mono">${r.volume}</td>
                  <td className="ad-right">
                    <BarCell value={r.netPnl} maxAbs={maxAbs} />
                  </td>
                  <td className={`ad-right ad-mono ${pctTone}`}>
                    {netPct >= 0 ? '+' : ''}{netPct.toFixed(2)}%
                  </td>
                  <td className="ad-right ad-mono">{r.avgHoldHours.toFixed(1)}h</td>
                  <td>
                    <Sparkline values={r.series.map(p => p.cumPnl)} />
                  </td>
                </tr>
              );
            })}
            {!showAll && hiddenRows > 0 && (
              <tr>
                <td colSpan={8} className="ad-show-more-row" onClick={() => setShowAll(true)}>
                  Show all {sortedRows.length} symbols
                  <span className="ad-show-more-subtle">
                    ({hiddenRows} hidden, combined {signedMoney(hiddenCombined)})
                  </span>
                </td>
              </tr>
            )}
            {showAll && (
              <tr>
                <td colSpan={8} className="ad-show-more-row" onClick={() => setShowAll(false)}>
                  Collapse to top {ASSET_SCOREBOARD_TOP_N}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AssetSortHeader({
  label,
  col,
  sortBy,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  col: AssetSort;
  sortBy: AssetSort;
  sortDir: SortDir;
  onClick: (col: AssetSort) => void;
  align?: 'right';
}) {
  const isActive = sortBy === col;
  const arrow = isActive ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <th
      className={`${align === 'right' ? 'ad-right' : ''} ${isActive ? 'ad-sort-active' : 'ad-sortable'}`}
      onClick={() => onClick(col)}
      style={{ cursor: 'pointer' }}
    >
      {label}
      {arrow}
    </th>
  );
}

function winRateTone(pct: number): string {
  if (pct >= 80) return 'ad-green';
  if (pct <= 20) return 'ad-red';
  return '';
}

// ── Hold-Time Scoreboard ─────────────────────────────────────────────────
//
// Buckets last-30d closes by hold time (<1h, 1-4h, 4-12h, 12-24h, 1-2d,
// 2d+). Surfaces where PnL is being made vs lost as a function of how long
// positions are held. Backend emits all 6 buckets always, in fixed order,
// even when empty. All averages may be null (empty bucket, or single-side
// bucket with no win/loss data); render as em-dash, do NOT coerce to $0
// or 0.0h because that reads as a real measurement.

// Renders one average cell that may be null. Kept out of JSX to reduce
// nested ternaries and to keep the "null → dash, not zero" contract
// visible in one place.
function AvgCell({
  value,
  format,
  className,
}: {
  value: number | null;
  format: 'money' | 'hours' | 'sizeUsd';
  className?: string;
}) {
  const cls = `ad-right ad-mono${className ? ' ' + className : ''}`;
  if (value === null) return <td className={cls}>—</td>;
  if (format === 'money') return <td className={cls}>{signedMoney(value)}</td>;
  if (format === 'hours') return <td className={cls}>{value.toFixed(1)}h</td>;
  return <td className={cls}>${Math.round(value).toLocaleString('en-US')}</td>;
}

export function HoldTimeScoreboardSection({ rows }: { rows: HoldTimeScoreboardRow[] }) {
  const populated = rows.filter(r => r.closes > 0);

  if (populated.length === 0) {
    return (
      <>
        <SectionTitle>Hold-Time Scoreboard (30d)</SectionTitle>
        <div className="ad-empty-panel">No closed positions in the last 30 days.</div>
      </>
    );
  }

  // Row highlights: the largest drag row (only if genuinely negative) and
  // the best-expectancy row (only if genuinely positive). Computed against
  // populated buckets so an empty bucket never wins "best".
  const worstByPnl = populated.slice().sort((a, b) => a.netPnl - b.netPnl)[0];
  const worstIsDrag = worstByPnl && worstByPnl.netPnl < 0 ? worstByPnl : null;
  const bestByEv = populated
    .slice()
    .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity))[0];
  const bestIsWinner = bestByEv && (bestByEv.expectancy ?? 0) > 0 ? bestByEv : null;

  const maxAbs = Math.max(1, ...populated.map(r => Math.abs(r.netPnl)));
  const totalCloses = populated.reduce((s, r) => s + r.closes, 0);
  const totalPnl = populated.reduce((s, r) => s + r.netPnl, 0);

  return (
    <>
      <SectionTitle>Hold-Time Scoreboard (30d)</SectionTitle>
      {worstIsDrag && bestIsWinner && worstIsDrag.bucketKey !== bestIsWinner.bucketKey && (
        <NarrativeLine>
          <strong>
            {worstIsDrag.bucketLabel} loses {signedMoney(worstIsDrag.netPnl)} across{' '}
            {worstIsDrag.closes} close{worstIsDrag.closes === 1 ? '' : 's'}
          </strong>{' '}
          at {worstIsDrag.winPct}% wins. Best expectancy:{' '}
          <strong>{bestIsWinner.bucketLabel}</strong> at{' '}
          {signedMoney(bestIsWinner.expectancy ?? 0)}/close.
        </NarrativeLine>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Hold time</th>
              <th className="ad-right">Closes</th>
              <th className="ad-right">Net PnL</th>
              <th className="ad-right">Win%</th>
              <th className="ad-right">Avg win</th>
              <th className="ad-right">Avg loss</th>
              <th className="ad-right">Expectancy</th>
              <th className="ad-right">Avg hold</th>
              <th className="ad-right">Avg size</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isEmpty = r.closes === 0;
              const highlightCls = worstIsDrag && r === worstIsDrag
                ? 'ad-row-highlight'
                : bestIsWinner && r === bestIsWinner
                  ? 'ad-row-highlight-good'
                  : undefined;
              const rowCls = [
                isEmpty ? 'ad-row-empty' : '',
                highlightCls ?? '',
              ].filter(Boolean).join(' ') || undefined;
              return (
                <tr key={r.bucketKey} className={rowCls}>
                  <td>
                    <strong>{r.bucketLabel}</strong>
                  </td>
                  <td className="ad-right ad-mono">{isEmpty ? '—' : r.closes}</td>
                  <td className="ad-right">
                    {isEmpty ? <span className="ad-mono">—</span> : <BarCell value={r.netPnl} maxAbs={maxAbs} />}
                  </td>
                  <td className={`ad-right ad-mono ${isEmpty ? '' : winRateTone(r.winPct)}`}>
                    {isEmpty ? '—' : `${r.winPct}%`}
                  </td>
                  <AvgCell value={r.avgWin} format="money" className={r.avgWin !== null ? 'ad-green' : ''} />
                  <AvgCell value={r.avgLoss} format="money" className={r.avgLoss !== null ? 'ad-red' : ''} />
                  <AvgCell
                    value={r.expectancy}
                    format="money"
                    className={
                      r.expectancy === null
                        ? ''
                        : r.expectancy > 0
                          ? 'ad-green'
                          : r.expectancy < 0
                            ? 'ad-red'
                            : ''
                    }
                  />
                  <AvgCell value={r.avgHoldHours} format="hours" />
                  <AvgCell value={r.avgSizeUsd} format="sizeUsd" />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total (populated)</strong>
              </td>
              <td className="ad-right ad-mono">
                <strong>{totalCloses}</strong>
              </td>
              <td className="ad-right ad-mono">
                <strong>{signedMoney(totalPnl)}</strong>
              </td>
              <td colSpan={6}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// ── Subscription Risks ────────────────────────────────────────────────────
//
// Surfaces revenue at risk before churn goes silent. Three cards for
// past_due / cancelling / cancelled_last_30d. Dunning-nudge button is a
// stub for now; wiring to a send-payment-reminder edge fn is a follow-up.

export function SubscriptionRisksSection({ risks }: { risks: SubscriptionRisks }) {
  const total = risks.pastDue.length + risks.cancelling.length + risks.cancelledLast30d.length;
  const revenueAtRisk =
    risks.pastDue.reduce((acc, r) => acc + r.monthlyRevenue, 0) +
    risks.cancelling.reduce((acc, r) => acc + r.monthlyRevenue, 0);

  return (
    <>
      <SectionTitle>Subscription Risks</SectionTitle>
      {total === 0 ? (
        <div className="ad-empty-panel">
          No subscription risks. Nothing past due, nothing cancelling.
        </div>
      ) : (
        <>
          <NarrativeLine>
            <strong>${revenueAtRisk.toFixed(0)}/mo</strong> of recurring revenue is at risk (past
            due + cancelling). {risks.cancelledLast30d.length} cancellation
            {risks.cancelledLast30d.length === 1 ? '' : 's'} in the last 30 days.
          </NarrativeLine>
          <div className="ad-risks-grid">
            <RiskCard
              tone="critical"
              title="Past due"
              rows={risks.pastDue}
              ctaLabel="Send dunning nudge"
              onCtaClick={handleDunningNudgeStub}
              emptyLabel="None this week"
            />
            <RiskCard
              tone="warn"
              title="Cancelling at period end"
              rows={risks.cancelling}
              ctaLabel="Send retention nudge"
              onCtaClick={handleDunningNudgeStub}
              emptyLabel="None this week"
            />
            <RiskCard
              tone="info"
              title="Cancelled (last 30d)"
              rows={risks.cancelledLast30d}
              emptyLabel="No cancellations"
            />
          </div>
        </>
      )}
    </>
  );
}

function handleDunningNudgeStub(row: SubscriptionRisk) {
  // Stub: dunning nudge send is a follow-up PR. Log for now so admins can
  // confirm the button wires up without actually sending anything.
  console.log('[admin-dashboard] Dunning nudge stub triggered for:', row.displayName, row);
  window.alert(
    `Dunning nudge for ${row.displayName} is not wired up yet. Follow-up PR will add send-payment-reminder edge fn (email + Telegram fallback).`
  );
}

function RiskCard({
  tone,
  title,
  rows,
  ctaLabel,
  onCtaClick,
  emptyLabel,
}: {
  tone: 'critical' | 'warn' | 'info';
  title: string;
  rows: SubscriptionRisk[];
  ctaLabel?: string;
  onCtaClick?: (row: SubscriptionRisk) => void;
  emptyLabel: string;
}) {
  return (
    <div className={`ad-churn-card ad-churn-${tone}`}>
      <h3>{title}</h3>
      <div className="ad-churn-count">{rows.length}</div>
      {rows.length === 0 ? (
        <div className="ad-churn-empty">{emptyLabel}</div>
      ) : (
        <ul className="ad-churn-list">
          {rows.map(r => (
            <li key={r.displayName + r.signup}>
              <div>
                <div className="ad-churn-who">{r.displayName}</div>
                <div className="ad-churn-meta">{riskSubtitle(r)}</div>
              </div>
              <div className="ad-churn-meta ad-right">
                ${r.balance.toFixed(0)} bal
                {r.openPositions > 0 ? ` · ${r.openPositions} open` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && ctaLabel && onCtaClick && (
        <button type="button" className="ad-churn-action" onClick={() => onCtaClick(rows[0])}>
          {ctaLabel} →
        </button>
      )}
    </div>
  );
}

function riskSubtitle(row: SubscriptionRisk): string {
  const tierLabel = row.tier[0].toUpperCase() + row.tier.slice(1);
  const billing = row.billingCycle
    ? row.billingCycle[0].toUpperCase() + row.billingCycle.slice(1)
    : '';
  const price = row.monthlyRevenue > 0 ? ` · $${row.monthlyRevenue.toFixed(0)}/mo` : '';
  const last = row.lastActivityIso ? ` · last activity ${shortDate(row.lastActivityIso)}` : '';
  return `${tierLabel}${billing ? ' ' + billing : ''}${price}${last}`;
}

// ── Monthly Returns ──────────────────────────────────────────────────────
//
// Platform-level performance table matching the vault-return convention
// (row per year, columns YTD + Jan-Dec, colored cell per month).
// Toggle switches the top row between Net (default; fees + funding baked in)
// and Gross (raw price PnL). Reference table below always shows the full
// gross / fees / funding / net breakdown so the fee-drag and funding-rebate
// stories are visible regardless of the toggle state.

type ReturnsView = 'net' | 'gross';

const MONTH_NAMES = [
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

export function MonthlyReturnsSection({ data }: { data: MonthlyReturns }) {
  const [view, setView] = useState<ReturnsView>('net');

  if (!data.years || data.years.length === 0) {
    return (
      <>
        <SectionTitle>Monthly Returns</SectionTitle>
        <div className="ad-empty-panel">No closed positions on record.</div>
      </>
    );
  }

  // Latest year drives the narrative + reference table (typically the current
  // year). All years get a row in the top table.
  const latest = data.years[data.years.length - 1];
  const bestMonth = latest.months.slice().sort((a, b) => b.netPnl - a.netPnl)[0];
  const worstMonth = latest.months.slice().sort((a, b) => a.netPnl - b.netPnl)[0];

  return (
    <>
      <SectionTitle>Monthly Returns</SectionTitle>
      <NarrativeLine>
        <strong>
          {latest.year} YTD {view === 'net' ? 'net' : 'gross'}:{' '}
          {signedPct(latest.ytdNetPnl, latest.ytdNotionalTotal, view, latest.ytdGrossPnl)} on{' '}
          {formatUsd(latest.ytdNotionalTotal)} notional ({latest.ytdClosesTotal} closes,{' '}
          {signedMoney(view === 'net' ? latest.ytdNetPnl : latest.ytdGrossPnl)}{' '}
          {view === 'net' ? 'net' : 'gross'})
        </strong>
        {latest.ytdFees > 0 && (
          <>
            . Fees {signedMoney(-latest.ytdFees)} drag; funding{' '}
            {latest.ytdFunding >= 0 ? (
              <>
                <strong className="ad-green">+{formatUsd(latest.ytdFunding)}</strong> net received
              </>
            ) : (
              <>{signedMoney(latest.ytdFunding)} net paid</>
            )}
            .
          </>
        )}
        {bestMonth && worstMonth && bestMonth.month !== worstMonth.month && (
          <>
            {' '}
            Best:{' '}
            <strong>
              {MONTH_NAMES[bestMonth.month - 1]} {signedMoney(bestMonth.netPnl)}
            </strong>
            . Worst:{' '}
            <strong>
              {MONTH_NAMES[worstMonth.month - 1]} {signedMoney(worstMonth.netPnl)}
            </strong>
            .
          </>
        )}
      </NarrativeLine>

      <div className="ad-returns-toolbar">
        <div className="ad-segmented">
          <button
            type="button"
            className={view === 'net' ? 'active' : ''}
            onClick={() => setView('net')}
          >
            Net
            <span className="ad-segmented-hint">after fees + funding</span>
          </button>
          <button
            type="button"
            className={view === 'gross' ? 'active' : ''}
            onClick={() => setView('gross')}
          >
            Gross
            <span className="ad-segmented-hint">raw price PnL</span>
          </button>
        </div>
        <span className="ad-returns-caption">% of notional traded</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th className="ad-right ad-returns-ytd">YTD</th>
              {MONTH_NAMES.map(m => (
                <th key={m} className="ad-right">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.years.map(y => (
              <ReturnsYearRow key={y.year} year={y} view={view} />
            ))}
          </tbody>
        </table>
      </div>

      <MonthlyReturnsReference year={latest} />
    </>
  );
}

function ReturnsYearRow({ year, view }: { year: MonthlyReturnsYear; view: ReturnsView }) {
  const monthByIdx = new Map<number, MonthlyReturnRow>();
  for (const m of year.months) monthByIdx.set(m.month, m);

  const ytdPnl = view === 'net' ? year.ytdNetPnl : year.ytdGrossPnl;
  const ytdPctText =
    ytdPnl === 0 && year.ytdNotionalTotal === 0
      ? '—'
      : `${ytdPnl >= 0 ? '+' : ''}${((ytdPnl / Math.max(1, year.ytdNotionalTotal)) * 100).toFixed(2)}%`;

  return (
    <tr>
      <td>
        <strong>{year.year}</strong>
      </td>
      <td className={`ad-right ad-returns-ytd ${cellBgClass(ytdPnl)}`}>
        <div className={`ad-returns-pct ${cellFgClass(ytdPnl)}`}>{ytdPctText}</div>
        <div className="ad-returns-sub">{signedMoney(ytdPnl)}</div>
      </td>
      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
        const row = monthByIdx.get(m);
        if (!row) {
          return (
            <td key={m} className="ad-right ad-returns-empty">
              —
            </td>
          );
        }
        const pnl = view === 'net' ? row.netPnl : row.grossPnl;
        const pct = (pnl / Math.max(1, row.notional)) * 100;
        return (
          <td key={m} className={`ad-right ${cellBgClass(pnl)}`}>
            <div className={`ad-returns-pct ${cellFgClass(pnl)}`}>
              {pnl >= 0 ? '+' : ''}
              {pct.toFixed(2)}%
            </div>
            <div className="ad-returns-sub">{signedMoney(pnl)}</div>
          </td>
        );
      })}
    </tr>
  );
}

function MonthlyReturnsReference({ year }: { year: MonthlyReturnsYear }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        className="ad-section-note"
        style={{
          marginBottom: 8,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--ad-gray-500)',
          fontWeight: 600,
        }}
      >
        Reference · {year.year} breakdown (gross / fees / funding / net)
      </div>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th className="ad-right">Closes</th>
            <th className="ad-right">Notional</th>
            <th className="ad-right">Gross</th>
            <th className="ad-right">Fees</th>
            <th className="ad-right">Funding</th>
            <th className="ad-right">Net</th>
            <th className="ad-right">Net %</th>
          </tr>
        </thead>
        <tbody>
          {year.months.map(m => {
            const netPct = (m.netPnl / Math.max(1, m.notional)) * 100;
            return (
              <tr key={m.month}>
                <td>
                  {MONTH_NAMES[m.month - 1]} {year.year}
                </td>
                <td className="ad-right ad-mono">{m.closes}</td>
                <td className="ad-right ad-mono">{formatUsd(m.notional)}</td>
                <td className={`ad-right ad-mono ${cellFgClass(m.grossPnl)}`}>
                  {signedMoney(m.grossPnl)}
                </td>
                <td className={`ad-right ad-mono ${m.fees > 0.005 ? 'ad-red' : ''}`}>
                  {signedMoney(-m.fees)}
                </td>
                <td className={`ad-right ad-mono ${cellFgClass(m.funding)}`}>
                  {signedMoney(m.funding)}
                </td>
                <td className={`ad-right ad-mono ${cellFgClass(m.netPnl)}`}>
                  <strong>{signedMoney(m.netPnl)}</strong>
                </td>
                <td className={`ad-right ad-mono ${cellFgClass(netPct)}`}>
                  <strong>
                    {netPct >= 0 ? '+' : ''}
                    {netPct.toFixed(2)}%
                  </strong>
                </td>
              </tr>
            );
          })}
          <tr style={{ borderTop: '2px solid var(--ad-border)' }}>
            <td>
              <strong>YTD</strong>
            </td>
            <td className="ad-right ad-mono">
              <strong>{year.ytdClosesTotal}</strong>
            </td>
            <td className="ad-right ad-mono">
              <strong>{formatUsd(year.ytdNotionalTotal)}</strong>
            </td>
            <td className={`ad-right ad-mono ${cellFgClass(year.ytdGrossPnl)}`}>
              <strong>{signedMoney(year.ytdGrossPnl)}</strong>
            </td>
            <td className={`ad-right ad-mono ${year.ytdFees > 0.005 ? 'ad-red' : ''}`}>
              <strong>{signedMoney(-year.ytdFees)}</strong>
            </td>
            <td className={`ad-right ad-mono ${cellFgClass(year.ytdFunding)}`}>
              <strong>{signedMoney(year.ytdFunding)}</strong>
            </td>
            <td className={`ad-right ad-mono ${cellFgClass(year.ytdNetPnl)}`}>
              <strong>{signedMoney(year.ytdNetPnl)}</strong>
            </td>
            <td className={`ad-right ad-mono ${cellFgClass(year.ytdNetPnl)}`}>
              <strong>
                {year.ytdNetPnl >= 0 ? '+' : ''}
                {((year.ytdNetPnl / Math.max(1, year.ytdNotionalTotal)) * 100).toFixed(2)}%
              </strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function cellBgClass(pnl: number): string {
  if (Math.abs(pnl) < 0.005) return '';
  return pnl > 0 ? 'ad-returns-pos-bg' : 'ad-returns-neg-bg';
}

function cellFgClass(v: number): string {
  if (Math.abs(v) < 0.005) return '';
  return v > 0 ? 'ad-green' : 'ad-red';
}

function formatUsd(n: number): string {
  if (Math.abs(n) < 0.005) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (abs >= 100) return `$${abs.toFixed(0)}`;
  return `$${abs.toFixed(2)}`;
}

function signedPct(netPnl: number, notional: number, view: ReturnsView, grossPnl: number): string {
  const pnl = view === 'net' ? netPnl : grossPnl;
  if (notional <= 0) return '—';
  const pct = (pnl / notional) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}
