// src/components/admin/AdminSections.tsx
//
// One React component per dashboard section. Each is data-in / render-out; no
// fetching here. The page orchestrator (AdminDashboard.tsx) fetches once,
// slices the response, and passes props. Rearrange sections by reordering
// the calls in AdminDashboard.tsx.
//
// Curated sections (Highlights, Carryover, Notes) are hardcoded placeholders
// today. Wire to a `dashboard_curated` table in a later iteration.

import type {
  CohortRow,
  ConcentrationRow,
  DailyBucket,
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
                const pnlTone = r.pnl > 0 ? 'ad-green' : r.pnl < 0 ? 'ad-red' : '';
                const pnlLabel =
                  Math.abs(r.pnl) < 0.005 ? '$0.00' : `${r.pnl > 0 ? '+' : ''}${money(r.pnl)}`;
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
