// src/components/admin/DashboardView.tsx
//
// The loaded dashboard: Business / Trading / Users tabs plus the "Hide values"
// toggle. Data-in / render-out, so it can be tested without auth or fetching.
// Rearrange sections by reordering the calls below.

import { useMemo, useState, type ReactNode } from 'react';
import type { DashboardResponse } from '../../lib/adminDashboardClient';
import {
  AssetScoreboardSection,
  CarryoverSection,
  ChartsSection,
  CohortFunnelSection,
  HighlightsSection,
  KpisSection,
  LlmCostSection,
  MonthlyReturnsSection,
  NotesSection,
  OpenPositionsSection,
  PositionConcentrationSection,
  RevenueBreakdownSection,
  ShippedSection,
  SubscriptionRisksSection,
  TraderCumulativePnlSection,
  UserOverviewSection,
  VelocitySection,
} from './AdminSections';
import { aliasUserNames, HideValuesContext } from './hideValues';

type DashboardTab = 'business' | 'trading' | 'users';

const TABS: { id: DashboardTab; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'trading', label: 'Trading' },
  { id: 'users', label: 'Users' },
];

export function DashboardView({ data }: { data: DashboardResponse }) {
  const [tab, setTab] = useState<DashboardTab>('business');
  // A tab is built the first time it is opened (so charts are created while on
  // screen) and then stays mounted, so filters, sorts and chart ranges survive
  // switching away and back.
  const [opened, setOpened] = useState<ReadonlySet<DashboardTab>>(() => new Set([tab]));
  const [hidden, setHidden] = useState(false);
  const shown = useMemo(() => (hidden ? aliasUserNames(data) : data), [data, hidden]);

  const openTab = (id: DashboardTab) => {
    setTab(id);
    setOpened(prev => new Set(prev).add(id));
  };

  const panels: Record<DashboardTab, ReactNode> = {
    business: (
      <>
        <KpisSection kpis={shown.kpis} />

        <HighlightsSection items={shown.curated.highlights} updatedAt={shown.curated.updatedAt} />
        <ShippedSection github={shown.github} />
        <VelocitySection github={shown.github} />

        <RevenueBreakdownSection rows={shown.revenueBreakdown} mrr={shown.kpis.mrr} />
        {shown.subscriptionRisks && <SubscriptionRisksSection risks={shown.subscriptionRisks} />}
        {shown.llmCosts && <LlmCostSection data={shown.llmCosts} />}
        <CohortFunnelSection rows={shown.cohortFunnel} />

        <CarryoverSection
          nextUp={shown.curated.carryoverNextUp ?? shown.curated.carryoverInProgress ?? []}
          needsAttention={
            shown.curated.carryoverNeedsAttention ?? shown.curated.carryoverNeedsStatus ?? []
          }
        />
        <NotesSection notes={shown.curated.notes} />
      </>
    ),
    trading: (
      <>
        <ChartsSection
          pnlSeries7d={shown.pnlSeries7d}
          pnlSeries30d={shown.pnlSeries30d}
          pnlSeries90d={shown.pnlSeries90d}
        />
        {/* Monthly returns table: platform-level summary of return on capital
          traded, month by month with year-over-year rows. */}
        {shown.monthlyReturns && <MonthlyReturnsSection data={shown.monthlyReturns} />}
        {shown.assetScoreboard30d && <AssetScoreboardSection rows={shown.assetScoreboard30d} />}
        <PositionConcentrationSection rows={shown.positionConcentration} />
        <OpenPositionsSection rows={shown.openPositions} />
      </>
    ),
    users: (
      <>
        {shown.traderCumulativePnl30d && (
          <TraderCumulativePnlSection
            rows={shown.traderCumulativePnl30d}
            users={shown.userOverview}
            totalUsers={shown.kpis.totalUsers}
          />
        )}
        <UserOverviewSection rows={shown.userOverview} />
      </>
    ),
  };

  return (
    <HideValuesContext.Provider value={hidden}>
      <div className={hidden ? 'ad-values-hidden' : undefined}>
        <div className="ad-tab-bar">
          <div className="ad-tabs" role="tablist">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`ad-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`ad-tab-panel-${t.id}`}
                onClick={() => openTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ad-hide-toggle"
            aria-pressed={hidden}
            onClick={() => setHidden(v => !v)}
          >
            {hidden ? 'Show values' : 'Hide values'}
          </button>
        </div>

        {TABS.map(t => (
          <div
            key={t.id}
            role="tabpanel"
            id={`ad-tab-panel-${t.id}`}
            aria-labelledby={`ad-tab-${t.id}`}
            hidden={tab !== t.id}
          >
            {opened.has(t.id) && panels[t.id]}
          </div>
        ))}
      </div>
    </HideValuesContext.Provider>
  );
}
