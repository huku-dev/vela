// src/components/admin/AdminPrimitives.tsx
//
// Tiny reusable pieces: pill, kpi card, narrative line, bar cell. Every
// dashboard section composes from these. Edit here if the visual language
// changes; edit sections if content or layout changes.

import type { ReactNode } from 'react';

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="ad-section-title">{children}</div>;
}

export function KpiCard({
  label,
  value,
  detail,
  valueTone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  valueTone?: 'green' | 'red' | 'amber' | 'purple';
}) {
  const toneClass = valueTone ? `ad-${valueTone}` : '';
  return (
    <div className="ad-kpi-card">
      <div className="ad-kpi-label">{label}</div>
      <div className={`ad-kpi-value ${toneClass}`}>{value}</div>
      {detail !== undefined && <div className="ad-kpi-detail">{detail}</div>}
    </div>
  );
}

export function NarrativeLine({ children }: { children: ReactNode }) {
  return <p className="ad-narrative-line">{children}</p>;
}

/**
 * Currency amount with an inline contribution bar. Zero renders a tiny grey
 * tick; nonzero fills the track in red or green.
 */
export function BarCell({
  value,
  maxAbs,
  currency = true,
  phantom = false,
}: {
  value: number;
  maxAbs: number;
  currency?: boolean;
  phantom?: boolean;
}) {
  const isZero = Math.abs(value) < 0.005;
  const raw = maxAbs > 0 ? Math.round((Math.abs(value) / maxAbs) * 100) : 0;
  const width = isZero ? 0 : Math.max(3, raw);
  const tone = value < 0 ? 'ad-red' : 'ad-green';
  const label = formatMoney(value, currency);
  return (
    <div className="ad-pnl-cell">
      <span
        className={`ad-mono ${isZero ? '' : tone}`}
        style={isZero ? { color: 'var(--ad-gray-500)' } : undefined}
      >
        {label}
      </span>
      <span className="ad-bar-track">
        {phantom ? (
          <span className="ad-bar-fill ad-phantom" style={{ width: `${width}%` }} />
        ) : isZero ? (
          <span className="ad-bar-fill ad-zero" />
        ) : (
          <span className={`ad-bar-fill ${tone}`} style={{ width: `${width}%` }} />
        )}
      </span>
    </div>
  );
}

function formatMoney(v: number, currency: boolean): string {
  if (Math.abs(v) < 0.005) return currency ? '$0' : '0';
  const sign = v < 0 ? '-' : '+';
  const abs = Math.abs(v);
  const rounded = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2);
  return currency ? `${sign}$${rounded}` : `${sign}${rounded}`;
}

export function TierPill({ tier }: { tier: 'premium' | 'standard' | 'free' }) {
  const cls =
    tier === 'premium' ? 'ad-pill-amber' : tier === 'standard' ? 'ad-pill-purple' : 'ad-pill-muted';
  const label = tier[0].toUpperCase() + tier.slice(1);
  return <span className={`ad-pill ${cls}`}>{label}</span>;
}

export function SidePill({ side }: { side: 'long' | 'short' }) {
  const cls = side === 'long' ? 'ad-pill-green' : 'ad-pill-red';
  return (
    <span className={`ad-pill ${cls}`}>
      {side[0].toUpperCase()}
      {side.slice(1)}
    </span>
  );
}

/**
 * Compact SVG line chart for a running series (cumulative PnL by day, etc).
 * Auto-scales to the series' own min/max with a small padding. Tone is picked
 * from the final value's sign; a dashed zero baseline anchors interpretation.
 * Renders inline in a table cell, not for standalone charts.
 */
export function Sparkline({
  values,
  width = 84,
  height = 22,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length === 0) {
    return <span className="ad-spark ad-spark-empty" style={{ width, height }} aria-hidden />;
  }

  const last = values[values.length - 1];
  const tone = last > 0.005 ? 'ad-green' : last < -0.005 ? 'ad-red' : 'ad-gray';

  // Include zero in the y-range so the baseline is meaningful. Pad 10% top/bottom.
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = Math.max(0.01, rawMax - rawMin);
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;
  const yFor = (v: number) => {
    const t = (v - min) / (max - min);
    return height - t * height;
  };
  const zeroY = yFor(0);

  // Single-point series: SVG path with only M and no L renders nothing. Draw
  // a circle marker at the point instead so the row does not appear blank.
  if (values.length === 1) {
    const cx = width / 2;
    const cy = yFor(values[0]);
    return (
      <svg
        className={`ad-spark ad-spark-${tone}`}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          className="ad-spark-zero"
          x1={0}
          y1={zeroY}
          x2={width}
          y2={zeroY}
          strokeDasharray="1 2"
        />
        <circle cx={cx} cy={cy} r={2} className="ad-spark-marker" />
      </svg>
    );
  }

  const step = width / (values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      className={`ad-spark ad-spark-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        className="ad-spark-zero"
        x1={0}
        y1={zeroY}
        x2={width}
        y2={zeroY}
        strokeDasharray="1 2"
      />
      <path d={path} />
    </svg>
  );
}
