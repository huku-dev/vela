// src/components/admin/AdminCharts.tsx
//
// Hand-rolled SVG charts. Two: TradingVolumeChart (bars + line) and PnlChart
// (up/down bars). No external chart lib — matches TrackRecord.tsx convention.
//
// Design tweaks: edit here. Data tweaks: edit the backend pnl-series compose.

import type { DailyBucket } from '../../lib/adminDashboardClient';

const PURPLE = '#8b5cf6';
const AMBER = '#d97706';
const GREEN = '#059669';
const RED = '#dc2626';
const GRID = 'rgba(0, 0, 0, 0.06)';
const TICK = '#475569';

interface ChartProps {
  data: DailyBucket[];
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 24, right: 40, bottom: 34, left: 44 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / magnitude;
  let round = 1;
  if (norm <= 1) round = 1;
  else if (norm <= 2) round = 2;
  else if (norm <= 5) round = 5;
  else round = 10;
  return round * magnitude;
}

/**
 * Daily trades (bars) + active traders per day (line).
 */
export function TradingVolumeChart({ data }: ChartProps) {
  const maxTrades = niceMax(Math.max(1, ...data.map(d => d.trades)));
  const maxTraders = Math.max(1, ...data.map(d => d.traders));
  const barW = PLOT_W / data.length;
  const gap = 3;

  const gridTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxTrades * t));
  const linePath = data
    .map((d, i) => {
      const x = PAD.left + i * barW + barW / 2;
      const y = PAD.top + PLOT_H - (d.traders / maxTraders) * PLOT_H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const xLabelEvery = Math.ceil(data.length / 10);

  return (
    <div className="ad-chart-wrap">
      <div className="ad-chart-title">Daily Trading Volume</div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid + Y axis */}
        {gridTicks.map(t => {
          const y = PAD.top + PLOT_H - (t / maxTrades) * PLOT_H;
          return (
            <g key={`g-${t}`}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill={TICK}>
                {t}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const x = PAD.left + i * barW + gap / 2;
          const h = (d.trades / maxTrades) * PLOT_H;
          const y = PAD.top + PLOT_H - h;
          return (
            <rect
              key={`b-${i}`}
              x={x}
              y={y}
              width={barW - gap}
              height={h}
              fill={PURPLE}
              opacity={0.6}
              rx={2}
            />
          );
        })}
        {/* Traders line */}
        <path d={linePath} fill="none" stroke={AMBER} strokeWidth={1.5} />
        {data.map((d, i) => {
          const x = PAD.left + i * barW + barW / 2;
          const y = PAD.top + PLOT_H - (d.traders / maxTraders) * PLOT_H;
          return <circle key={`p-${i}`} cx={x} cy={y} r={2} fill={AMBER} />;
        })}
        {/* Right Y axis (traders) */}
        {[0, maxTraders].map(t => {
          const y = PAD.top + PLOT_H - (t / maxTraders) * PLOT_H;
          return (
            <text key={`ry-${t}`} x={WIDTH - PAD.right + 6} y={y + 3} fontSize={9} fill={AMBER}>
              {t}
            </text>
          );
        })}
        {/* X labels */}
        {data.map((d, i) => {
          if (i % xLabelEvery !== 0 && i !== data.length - 1) return null;
          const x = PAD.left + i * barW + barW / 2;
          return (
            <text
              key={`x-${i}`}
              x={x}
              y={HEIGHT - PAD.bottom + 14}
              textAnchor="middle"
              fontSize={9}
              fill={TICK}
            >
              {d.date}
            </text>
          );
        })}
        {/* Legend */}
        <g transform={`translate(${PAD.left},${HEIGHT - 6})`}>
          <rect x={0} y={-8} width={8} height={8} fill={PURPLE} opacity={0.6} rx={1} />
          <text x={12} y={0} fontSize={9} fill={TICK}>
            Trades
          </text>
          <line x1={70} y1={-4} x2={82} y2={-4} stroke={AMBER} strokeWidth={1.5} />
          <text x={86} y={0} fontSize={9} fill={TICK}>
            Active traders
          </text>
        </g>
      </svg>
    </div>
  );
}

/**
 * Daily platform PnL. Positive → green up; negative → red down.
 */
export function PnlChart({ data }: ChartProps) {
  const maxAbs = niceMax(Math.max(1, ...data.map(d => Math.abs(d.pnl))));
  const barW = PLOT_W / data.length;
  const gap = 3;
  const zeroY = PAD.top + PLOT_H / 2;
  const halfH = PLOT_H / 2;
  const xLabelEvery = Math.ceil(data.length / 10);
  const gridTicks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];

  return (
    <div className="ad-chart-wrap">
      <div className="ad-chart-title">Daily Platform PnL (All Users)</div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto' }}>
        {gridTicks.map(t => {
          const y = zeroY - (t / maxAbs) * halfH;
          return (
            <g key={`g-${t}`}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill={TICK}>
                {t < 0 ? `-$${Math.abs(t).toFixed(0)}` : `$${t.toFixed(0)}`}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = PAD.left + i * barW + gap / 2;
          const h = (Math.abs(d.pnl) / maxAbs) * halfH;
          const y = d.pnl >= 0 ? zeroY - h : zeroY;
          const color = d.pnl >= 0 ? GREEN : RED;
          return (
            <rect
              key={`b-${i}`}
              x={x}
              y={y}
              width={barW - gap}
              height={h}
              fill={color}
              opacity={0.55}
              rx={2}
            />
          );
        })}
        {/* X labels */}
        {data.map((d, i) => {
          if (i % xLabelEvery !== 0 && i !== data.length - 1) return null;
          const x = PAD.left + i * barW + barW / 2;
          return (
            <text
              key={`x-${i}`}
              x={x}
              y={HEIGHT - PAD.bottom + 14}
              textAnchor="middle"
              fontSize={9}
              fill={TICK}
            >
              {d.date}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
