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
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js';
import type { DailyBucket } from '../../lib/adminDashboardClient';
import { HIDDEN_VALUE, useValuesHidden } from './hideValues';

Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend, Title);

const PURPLE = '#8b5cf6';
const GREEN_DARK = '#059669';
const RED_DARK = '#dc2626';
const TICK_COLOR = '#475569';
const GRID_COLOR = 'rgba(0, 0, 0, 0.06)';
const TITLE_COLOR = '#0f172a';

interface ChartProps {
  data: DailyBucket[];
}

/**
 * Daily trades closed (bars). Active traders for the day show on hover rather
 * than as a second line on a second axis.
 */
export function TradingVolumeChart({ data }: ChartProps) {
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
            text: 'Daily Trading Volume',
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
  }, [data]);

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
export function PnlChart({ data }: ChartProps) {
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
            text: 'Daily Platform PnL (All Users)',
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
  }, [data, hidden]);

  return (
    <div className="ad-chart-wrap">
      <div style={{ position: 'relative', height: 300 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
