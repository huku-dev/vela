// src/components/admin/TradingSections.tsx
//
// The Trading tab views that follow the period selector: headline figures,
// profit over time and where the profit came from. Every figure arrives
// computed from the backend (`trading.periods`), after fees and funding.

import { useState, type ReactNode } from 'react';
import type { TradingPeriod, TradingPeriodKey, TradingStats } from '../../lib/adminDashboardClient';
import { BelowBestChart, ProfitLineChart } from './AdminCharts';
import { BarCell, KpiCard, SectionTitle } from './AdminPrimitives';
import { useMask } from './hideValues';
import {
  money,
  moneyTone,
  PERIOD_OPTIONS,
  plainMoney,
  signedCents,
  type PeriodOption,
} from './tradingFormat';

export function PeriodSelector({
  value,
  onChange,
}: {
  value: TradingPeriodKey;
  onChange: (key: TradingPeriodKey) => void;
}) {
  return (
    <div className="ad-period-bar">
      <div className="ad-segmented" role="group" aria-label="Period">
        {PERIOD_OPTIONS.map(o => (
          <button
            key={o.key}
            type="button"
            className={value === o.key ? 'active' : ''}
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
          >
            {o.short}
          </button>
        ))}
      </div>
      <span className="ad-returns-caption">
        Sets the period for this tab, except Monthly Returns and live positions
      </span>
    </div>
  );
}

const winRate = (s: TradingStats): string =>
  s.trades > 0 ? `${Math.round((s.winners / s.trades) * 100)}%` : '-';

export function TradingPerformanceSection({
  data,
  period,
}: {
  data: TradingPeriod;
  period: PeriodOption;
}) {
  const mask = useMask();
  const { stats, previous } = data;

  const net = (v: number | null) => (v === null ? 'none' : mask(signedCents(v)));
  const average = (v: number | null) => (v === null ? 'none' : mask(plainMoney(v)));
  /** The comparison with the period before, or `fallback` when there is none. */
  const detail = (render: (p: TradingStats) => ReactNode, fallback: ReactNode) =>
    previous ? (
      <>
        Previous {period.days} days: {render(previous)}
      </>
    ) : (
      fallback
    );

  return (
    <>
      <SectionTitle>Trading Performance ({period.title})</SectionTitle>
      <div className="ad-kpi-grid">
        <KpiCard
          label="Profit After Costs"
          value={net(stats.netPnl)}
          valueTone={moneyTone(stats.netPnl)}
          detail={detail(p => net(p.netPnl), 'After fees and funding')}
        />
        <KpiCard
          label="Trades That Made Money"
          value={winRate(stats)}
          detail={detail(
            winRate,
            `${stats.winners.toLocaleString('en-US')} of ${stats.trades.toLocaleString('en-US')}`
          )}
        />
        <KpiCard
          label="Average Win / Loss"
          value={
            <>
              <span className="ad-green">{average(stats.avgWin)}</span> /{' '}
              <span className="ad-red">{average(stats.avgLoss)}</span>
            </>
          }
          detail={detail(
            p => (
              <>
                {average(p.avgWin)} / {average(p.avgLoss)}
              </>
            ),
            'Per closed trade'
          )}
        />
        {stats.netWithoutBest5 !== null && (
          <KpiCard
            label="Without The 5 Best Trades"
            value={net(stats.netWithoutBest5)}
            valueTone={moneyTone(stats.netWithoutBest5)}
            detail={detail(
              p => net(p.netWithoutBest5),
              <>
                Those 5 made {stats.best5NetPnl === null ? 'none' : mask(money(stats.best5NetPnl))}
              </>
            )}
          />
        )}
      </div>
    </>
  );
}

export function ProfitOverTimeSection({
  data,
  period,
}: {
  data: TradingPeriod;
  period: PeriodOption;
}) {
  const mask = useMask();
  const { points, pointUnit, worstDay } = data;
  const title = <SectionTitle>Profit Over Time ({period.title})</SectionTitle>;

  if (points.length === 0) {
    return (
      <>
        {title}
        <div className="ad-empty-panel">No closed positions in this period.</div>
      </>
    );
  }

  const weekly = pointUnit === 'week';
  return (
    <>
      {title}
      <div className="ad-chart-wrap">
        <div className="ad-chart-title">
          {period.days === null
            ? `Total since ${monthName(data.since, points[0].date)}`
            : `Total over the last ${period.days} days`}
        </div>
        <div className="ad-kpi-detail">
          {"Above the zero line we're in profit. Below it we're down."}
        </div>
        <ProfitLineChart points={points} weekly={weekly} />

        <div className="ad-chart-split">
          <div className="ad-chart-title">How far below our best point</div>
          <div className="ad-kpi-detail">
            Zero means a new high within the period. Deeper means further away.
          </div>
          <BelowBestChart points={points} weekly={weekly} />
        </div>

        <div className="ad-kpi-detail">
          One point per {pointUnit}.
          {worstDay && (
            <>
              {' '}
              The worst {weekly ? 'single day' : 'day'} was {worstDay.date},{' '}
              {mask(plainMoney(worstDay.belowBest))} below.
            </>
          )}
        </div>

        <details className="ad-chart-table">
          <summary>Show as table</summary>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{weekly ? 'Week of' : 'Day'}</th>
                  <th className="ad-right">After costs</th>
                  <th className="ad-right">Before costs</th>
                  <th className="ad-right">Below best</th>
                </tr>
              </thead>
              <tbody>
                {points.map(p => (
                  <tr key={p.date}>
                    <td>{p.date}</td>
                    <td className="ad-right ad-mono">{mask(signedCents(p.net))}</td>
                    <td className="ad-right ad-mono">{mask(signedCents(p.gross))}</td>
                    <td className="ad-right ad-mono">{mask(plainMoney(p.belowBest))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}

/**
 * "March" from the period's first day ("2026-03-01"). The year is added once
 * the chart's own labels carry one, which is when it covers more than a year.
 */
function monthName(since: string, firstLabel: string): string {
  const date = new Date(`${since}T00:00:00Z`);
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return firstLabel.split(' ').length > 2 ? `${month} ${date.getUTCFullYear()}` : month;
}

type Dimension = 'side' | 'market' | 'holdTime';

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'side', label: 'Side' },
  { key: 'market', label: 'Market' },
  { key: 'holdTime', label: 'How long held' },
];

export function ProfitSourcesSection({
  data,
  period,
}: {
  data: TradingPeriod;
  period: PeriodOption;
}) {
  const [dimension, setDimension] = useState<Dimension>('side');
  const rows = data.groups[dimension];
  const maxAbs = Math.max(0.01, ...rows.map(r => Math.abs(r.netPnl)));

  return (
    <>
      <SectionTitle>Where The Profit Came From ({period.title})</SectionTitle>
      <div className="ad-returns-toolbar">
        <div className="ad-segmented" role="group" aria-label="Break profit down by">
          {DIMENSIONS.map(d => (
            <button
              key={d.key}
              type="button"
              className={dimension === d.key ? 'active' : ''}
              aria-pressed={dimension === d.key}
              onClick={() => setDimension(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="ad-empty-panel">No closed positions in this period.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th className="ad-right">Trades</th>
                <th className="ad-right">Made money</th>
                <th className="ad-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.name}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td className="ad-right ad-mono">{r.trades}</td>
                  <td className="ad-right ad-mono">{Math.round((r.winners / r.trades) * 100)}%</td>
                  <td className="ad-right">
                    <BarCell value={r.netPnl} maxAbs={maxAbs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
