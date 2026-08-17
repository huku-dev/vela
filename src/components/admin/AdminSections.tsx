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
  Kpis,
  LlmCosts,
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
      {delta && (
        <div className={`ad-kpi-detail ${delta.tone}`}>{delta.text}</div>
      )}
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
// traders the table holds — so the section stays legible past 60 users.

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
  const newest = rows
    .slice()
    .sort((a, b) => (b.lastCloseIso ?? '').localeCompare(a.lastCloseIso ?? ''))[0];
  const notable = newest && newest !== winner && newest !== loser ? newest : rows[Math.min(2, rows.length - 1)] ?? null;

  return (
    <>
      <SectionTitle>Cumulative Realized PnL by Trader (30d)</SectionTitle>
      <NarrativeLine>
        Platform 30d realized PnL: <strong>{signedMoney(platform30d)}</strong> across{' '}
        <strong>{rows.length}</strong> active trader{rows.length === 1 ? '' : 's'}. Movers strip picks the extremes
        so the section stays legible as user count grows.
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
                label="Peak"
                active={sort === 'peak'}
                onClick={() => setSort('peak')}
                align="right"
              />
              <SortHeader
                label="Trough"
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
              <tr key={r.displayName}>
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
                <td
                  className={`ad-right ad-mono ${r.peak30d > 0 ? 'ad-green' : ''}`}
                >
                  {signedMoney(r.peak30d)}
                </td>
                <td
                  className={`ad-right ad-mono ${r.trough30d < 0 ? 'ad-red' : ''}`}
                >
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
        Peak {signedMoney(row.peak30d)} · Trough {signedMoney(row.trough30d)} · {row.openPositions}{' '}
        open
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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

export function AssetScoreboardSection({ rows }: { rows: AssetScoreboardRow[] }) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) {
    return (
      <>
        <SectionTitle>Per-Asset PnL Scoreboard (30d)</SectionTitle>
        <div className="ad-empty-panel">No closed positions in the last 30 days.</div>
      </>
    );
  }

  const visible = showAll ? rows : rows.slice(0, ASSET_SCOREBOARD_TOP_N);
  const hiddenRows = Math.max(0, rows.length - ASSET_SCOREBOARD_TOP_N);
  const hiddenCombined = rows.slice(ASSET_SCOREBOARD_TOP_N).reduce((acc, r) => acc + r.netPnl, 0);
  const worst = rows[0];
  const bestByPnl = rows.slice().sort((a, b) => b.netPnl - a.netPnl)[0];
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.netPnl)));

  return (
    <>
      <SectionTitle>Per-Asset PnL Scoreboard (30d)</SectionTitle>
      {worst && bestByPnl && worst.symbol !== bestByPnl.symbol && (
        <NarrativeLine>
          <strong>
            {worst.symbol} is the largest drag: {signedMoney(worst.netPnl)} across {worst.closes}{' '}
            close{worst.closes === 1 ? '' : 's'}
          </strong>{' '}
          ({worst.winPct}% win rate). Best asset: <strong>{bestByPnl.symbol}</strong> at{' '}
          {signedMoney(bestByPnl.netPnl)}.
        </NarrativeLine>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="ad-right">Closes</th>
              <th className="ad-right">Win%</th>
              <th className="ad-right">Volume</th>
              <th className="ad-right">Net PnL</th>
              <th className="ad-right">Avg hold</th>
              <th>Cumulative PnL (30d)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.symbol} className={r === worst ? 'ad-row-highlight' : undefined}>
                <td>
                  <strong>{r.symbol}</strong>
                </td>
                <td className="ad-right ad-mono">{r.closes}</td>
                <td className={`ad-right ad-mono ${winRateTone(r.winPct)}`}>{r.winPct}%</td>
                <td className="ad-right ad-mono">${r.volume}</td>
                <td className="ad-right">
                  <BarCell value={r.netPnl} maxAbs={maxAbs} />
                </td>
                <td className="ad-right ad-mono">{r.avgHoldHours.toFixed(1)}h</td>
                <td>
                  <Sparkline values={r.series.map(p => p.cumPnl)} />
                </td>
              </tr>
            ))}
            {!showAll && hiddenRows > 0 && (
              <tr>
                <td colSpan={7} className="ad-show-more-row" onClick={() => setShowAll(true)}>
                  Show all {rows.length} symbols
                  <span className="ad-show-more-subtle">
                    ({hiddenRows} hidden, combined {signedMoney(hiddenCombined)})
                  </span>
                </td>
              </tr>
            )}
            {showAll && (
              <tr>
                <td colSpan={7} className="ad-show-more-row" onClick={() => setShowAll(false)}>
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

function winRateTone(pct: number): string {
  if (pct >= 80) return 'ad-green';
  if (pct <= 20) return 'ad-red';
  return '';
}

// ── Subscription Risks ────────────────────────────────────────────────────
//
// Surfaces revenue at risk before churn goes silent. Three cards for
// past_due / cancelling / cancelled_last_30d. Dunning-nudge button is a
// stub for now — wiring to a send-payment-reminder edge fn is a follow-up.

export function SubscriptionRisksSection({ risks }: { risks: SubscriptionRisks }) {
  const total =
    risks.pastDue.length + risks.cancelling.length + risks.cancelledLast30d.length;
  const revenueAtRisk =
    risks.pastDue.reduce((acc, r) => acc + r.monthlyRevenue, 0) +
    risks.cancelling.reduce((acc, r) => acc + r.monthlyRevenue, 0);

  return (
    <>
      <SectionTitle>Subscription Risks</SectionTitle>
      {total === 0 ? (
        <div className="ad-empty-panel">No subscription risks. Nothing past due, nothing cancelling.</div>
      ) : (
        <>
          <NarrativeLine>
            <strong>${revenueAtRisk.toFixed(0)}/mo</strong> of recurring revenue is at risk (past due +
            cancelling). {risks.cancelledLast30d.length} cancellation
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
                <div className="ad-churn-meta">
                  {riskSubtitle(r)}
                </div>
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
        <button
          type="button"
          className="ad-churn-action"
          onClick={() => onCtaClick(rows[0])}
        >
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
