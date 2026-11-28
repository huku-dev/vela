// src/components/admin/AdminCharts.tsx
//
// Chart.js-backed charts for the admin dashboard. Matches the config in
// docs/dashboard.html on the backend repo (bars + area line for volume,
// signed bars for PnL, with native hover tooltips).
//
// Chart.js is imported here directly. Because AdminDashboard is lazy-loaded,
// non-admins never download it — the whole /admin route (including this file
// and chart.js) only ships when an admin navigates to the page.

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type ChartConfiguration,
  type Plugin,
} from 'chart.js';
import type { DailyBucket, ProfitPoint } from '../../lib/adminDashboardClient';
import { HIDDEN_VALUE, useValuesHidden } from './hideValues';
import { plainMoney, signedCents } from './tradingFormat';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Title
);

const PURPLE = '#8b5cf6';
const GREEN_DARK = '#059669';
const RED_DARK = '#dc2626';
const TICK_COLOR = '#475569';
const GRID_COLOR = 'rgba(0, 0, 0, 0.06)';
const TITLE_COLOR = '#0f172a';

interface ChartProps {
  data: DailyBucket[];
  /** What one bar covers. */
  unit?: 'day' | 'week' | 'month';
}

const UNIT_TITLE = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

/**
 * Daily trades closed (bars). Active traders for the day show on hover rather
 * than as a second line on a second axis.
 */
export function TradingVolumeChart({ data, unit = 'day' }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: data.map(d => d.date),
        datasets: [
          {
            label: 'Trades Closed',
            data: data.map(d => d.trades),
            backgroundColor: 'rgba(139, 92, 246, 0.6)',
            borderColor: PURPLE,
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Hovering anywhere in a day's column opens the tooltip, so short bars
        // are still easy to read.
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${UNIT_TITLE[unit]} Trading Volume`,
            color: TITLE_COLOR,
            font: { size: 13, weight: 600 },
          },
          legend: { labels: { color: TICK_COLOR, font: { size: 11 } } },
          tooltip: {
            backgroundColor: '#ffffff',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            titleColor: '#0f172a',
            bodyColor: '#374151',
            footerColor: '#374151',
            callbacks: {
              footer: items => {
                const day = items.length ? data[items[0].dataIndex] : undefined;
                return day ? `Active Traders: ${day.traders}` : '';
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: TICK_COLOR, font: { size: 10 }, maxRotation: 45 },
            grid: { color: GRID_COLOR },
          },
          y: {
            ticks: { color: TICK_COLOR },
            grid: { color: GRID_COLOR },
            title: { display: true, text: 'Trades', color: TICK_COLOR },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, unit]);

  return (
    <div className="ad-chart-wrap">
      <div style={{ position: 'relative', height: 300 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

/**
 * Daily platform PnL. Positive → green bar; negative → red bar.
 */
export function PnlChart({ data, unit = 'day' }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const hidden = useValuesHidden();

  // Layout effect: the unmasked chart is gone before the toggled page paints.
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: data.map(d => d.date),
        datasets: [
          {
            label: 'Platform PnL ($)',
            data: data.map(d => d.pnl),
            backgroundColor: data.map(d =>
              d.pnl >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)'
            ),
            borderColor: data.map(d => (d.pnl >= 0 ? GREEN_DARK : RED_DARK)),
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: `${UNIT_TITLE[unit]} Platform PnL (All Users)`,
            color: TITLE_COLOR,
            font: { size: 13, weight: 600 },
          },
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            titleColor: '#0f172a',
            bodyColor: '#374151',
            callbacks: {
              label: ctx => {
                if (hidden) return `Platform PnL: ${HIDDEN_VALUE}`;
                const v = ctx.parsed.y ?? 0;
                const sign = v > 0 ? '+' : v < 0 ? '-' : '';
                return `Platform PnL: ${sign}$${Math.abs(v).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: TICK_COLOR, font: { size: 10 }, maxRotation: 45 },
            grid: { color: GRID_COLOR },
          },
          y: {
            ticks: {
              color: TICK_COLOR,
              callback: v => {
                if (hidden) return HIDDEN_VALUE;
                return typeof v === 'number' && v < 0 ? `-$${Math.abs(v)}` : `$${v}`;
              },
            },
            grid: { color: GRID_COLOR },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, unit, hidden]);

  return (
    <div className="ad-chart-wrap">
      <div style={{ position: 'relative', height: 300 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

// ── Profit over time ────────────────────────────────────────────────────

const AFTER_COSTS = '#2456a6';
const BEFORE_COSTS = '#9a8f7d';
const BEFORE_COSTS_TEXT = '#756b5a';

const wholeDollars = (v: number): string =>
  `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

/** Green above zero, red below, with each side named when there is room. */
export const profitZones: Plugin<'line'> = {
  id: 'profitZones',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const { left, right, top, bottom } = chartArea;
    const zero = Math.min(Math.max(scales.y.getPixelForValue(0), top), bottom);
    ctx.save();
    ctx.fillStyle = 'rgba(5, 150, 105, 0.06)';
    ctx.fillRect(left, top, right - left, zero - top);
    ctx.fillStyle = 'rgba(220, 38, 38, 0.05)';
    ctx.fillRect(left, zero, right - left, bottom - zero);
    ctx.font = '11px sans-serif';
    if (zero - top > 24) {
      ctx.fillStyle = GREEN_DARK;
      ctx.fillText('In profit', left + 8, top + 16);
    }
    if (bottom - zero > 24) {
      ctx.fillStyle = RED_DARK;
      ctx.fillText('Down', left + 8, bottom - 8);
    }
    ctx.restore();
  },
};

/** The latest total written beside the end of each line. */
export function endLabels(hidden: boolean): Plugin<'line'> {
  return {
    id: 'endLabels',
    afterDatasetsDraw(chart) {
      const ends = chart.data.datasets.flatMap((set, i) => {
        const points = chart.getDatasetMeta(i).data;
        const last = points[points.length - 1];
        const value = set.data[set.data.length - 1];
        return last && typeof value === 'number'
          ? [{ x: last.x, y: last.y, value, colour: i === 0 ? AFTER_COSTS : BEFORE_COSTS_TEXT }]
          : [];
      });
      // Push the two labels apart when the lines finish close together.
      const labelY = ends.map(e => e.y);
      if (ends.length === 2 && Math.abs(labelY[0] - labelY[1]) < 15) {
        const mid = (labelY[0] + labelY[1]) / 2;
        const firstAbove = ends[0].value >= ends[1].value ? -8 : 8;
        labelY[0] = mid + firstAbove;
        labelY[1] = mid - firstAbove;
      }
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 12px sans-serif';
      ctx.textBaseline = 'middle';
      ends.forEach((e, i) => {
        ctx.fillStyle = e.colour;
        ctx.fillText(hidden ? HIDDEN_VALUE : wholeDollars(e.value), e.x + 8, labelY[i]);
      });
      ctx.restore();
    },
  };
}

interface ProfitChartProps {
  points: ProfitPoint[];
  weekly: boolean;
}

function lineOptions(
  weekly: boolean,
  hidden: boolean,
  tooltip: (value: number, label: string) => string
): NonNullable<ChartConfiguration<'line'>['options']> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    // Same right margin on both charts so their dates line up.
    layout: { padding: { right: 56 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#ffffff',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        titleColor: '#0f172a',
        bodyColor: '#374151',
        callbacks: {
          title: items => `${weekly ? 'Week of ' : ''}${items[0]?.label ?? ''}`,
          label: ctx => tooltip(ctx.parsed.y ?? 0, ctx.dataset.label ?? ''),
        },
      },
    },
    scales: {
      x: {
        ticks: { color: TICK_COLOR, font: { size: 10 }, maxRotation: 0, maxTicksLimit: 8 },
        grid: { display: false },
      },
      y: {
        // A fixed width keeps both plot areas the same size.
        afterFit: scale => {
          scale.width = 56;
        },
        ticks: {
          color: TICK_COLOR,
          maxTicksLimit: 6,
          callback: v => (hidden ? HIDDEN_VALUE : wholeDollars(Number(v))),
        },
        grid: { color: c => (c.tick.value === 0 ? '#9ca3af' : GRID_COLOR) },
      },
    },
  };
}

function useLineChart(config: () => ChartConfiguration<'line'>, deps: unknown[]) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Layout effect: an unmasked chart is gone before the toggled page paints.
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, config());
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return canvasRef;
}

/** Running total for the period, after and before trading costs. */
export function ProfitLineChart({ points, weekly }: ProfitChartProps) {
  const hidden = useValuesHidden();
  const canvasRef = useLineChart(() => {
    const line = (label: string, data: number[], colour: string, width: number) => ({
      label,
      data,
      borderColor: colour,
      backgroundColor: colour,
      borderWidth: width,
      pointRadius: data.map((_, i) => (i === data.length - 1 ? 4 : 0)),
    });
    const options = lineOptions(weekly, hidden, (value, label) =>
      hidden ? `${label}: ${HIDDEN_VALUE}` : `${label}: ${signedCents(value)}`
    );
    options.scales!.y = { ...options.scales!.y, suggestedMin: 0, suggestedMax: 0 };
    return {
      type: 'line',
      data: {
        labels: points.map(p => p.date),
        datasets: [
          line(
            'After trading costs',
            points.map(p => p.net),
            AFTER_COSTS,
            2.5
          ),
          line(
            'Before trading costs',
            points.map(p => p.gross),
            BEFORE_COSTS,
            2
          ),
        ],
      },
      options,
      plugins: [profitZones, endLabels(hidden)],
    };
  }, [points, weekly, hidden]);

  return (
    <>
      <div className="ad-chart-legend">
        <span>
          <i style={{ background: AFTER_COSTS }} />
          After trading costs
        </span>
        <span>
          <i style={{ background: BEFORE_COSTS }} />
          Before trading costs
        </span>
      </div>
      <div style={{ position: 'relative', height: 260 }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Total profit for the period, before and after trading costs"
        />
      </div>
    </>
  );
}

/** Distance of the running total below the best it reached in the period. */
export function BelowBestChart({ points, weekly }: ProfitChartProps) {
  const hidden = useValuesHidden();
  const canvasRef = useLineChart(() => {
    const options = lineOptions(weekly, hidden, value =>
      hidden ? `Below best: ${HIDDEN_VALUE}` : `Below best: ${plainMoney(value)}`
    );
    options.scales!.y = { ...options.scales!.y, max: 0, suggestedMin: -10 };
    return {
      type: 'line',
      data: {
        labels: points.map(p => p.date),
        datasets: [
          {
            label: 'Below best',
            data: points.map(p => p.belowBest),
            borderColor: RED_DARK,
            backgroundColor: 'rgba(220, 38, 38, 0.18)',
            borderWidth: 1,
            pointRadius: 0,
            fill: 'origin',
          },
        ],
      },
      options,
    };
  }, [points, weekly, hidden]);

  return (
    <div style={{ position: 'relative', height: 130 }}>
      <canvas ref={canvasRef} role="img" aria-label="How far below the best total in the period" />
    </div>
  );
}
