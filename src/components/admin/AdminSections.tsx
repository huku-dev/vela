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
  CarryoverItem,
  CohortRow,
  ConcentrationRow,
  DailyBucket,
  GithubActivity,
  HighlightItem,
  Kpis,
  OpenPositionRow,
  RevenueRow,
  UserRow,
} from '../../lib/adminDashboardClient';
import {
  BarCell,
  KpiCard,
  NarrativeLine,
  SectionTitle,
  SidePill,
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

export function ChartsSection({ pnlSeries }: { pnlSeries: DailyBucket[] }) {
  return (
    <>
      <SectionTitle>Trading Activity (Last 30 Days)</SectionTitle>
      <div className="ad-chart-row">
        <TradingVolumeChart data={pnlSeries} />
        <PnlChart data={pnlSeries} />
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
              <th className="ad-right">Unrealized PnL</th>
              <th>Signup</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
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
                <td className="ad-right">
                  <BarCell value={r.unrealizedPnl} maxAbs={maxUnrealized} />
                </td>
                <td className="ad-mono">{shortWeek(r.signup)}</td>
              </tr>
            ))}
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

export function OpenPositionsSection({ rows }: { rows: OpenPositionRow[] }) {
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
                <th className="ad-right">Size</th>
                <th className="ad-right">Entry</th>
                <th className="ad-right">Current</th>
                <th className="ad-right">PnL</th>
                <th className="ad-right">PnL %</th>
                <th className="ad-right">Hours Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
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
            <button
              className="ad-carryover-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? 'Show less'
                : `See ${items.length - CARRYOVER_COLLAPSED_LIMIT} more`}
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
