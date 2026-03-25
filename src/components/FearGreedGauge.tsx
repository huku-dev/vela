interface FearGreedGaugeProps {
  value: number; // 0-100
  label?: string; // ignored — derived from value for consistency
}

/** Standard Fear & Greed Index label from value */
function getFearGreedLabel(v: number): string {
  if (v <= 24) return 'Extreme Fear';
  if (v <= 44) return 'Fear';
  if (v <= 55) return 'Neutral';
  if (v <= 74) return 'Greed';
  return 'Extreme Greed';
}

/** Map value to a semantic colour matching the gauge arc segments */
function getMoodColor(v: number): string {
  if (v <= 24) return '#EF4444'; // red — extreme fear
  if (v <= 44) return '#F59E0B'; // amber — fear
  if (v <= 55) return '#EAB308'; // yellow — neutral
  if (v <= 74) return '#22C55E'; // green — greed
  return '#16A34A'; // darker green — extreme greed
}

/**
 * Neobrutalist semicircular gauge for Fear & Greed Index.
 * Left (0) = extreme fear (red), middle = neutral (yellow), right (100) = extreme greed (green).
 */
export default function FearGreedGauge({ value }: FearGreedGaugeProps) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const label = getFearGreedLabel(clampedValue);
  // Map 0-100 to 180-0 degrees (left to right on semicircle)
  const needleAngle = 180 - (clampedValue / 100) * 180;

  // Scaled up by 1.4x - center moved from (50,50) to (70,70), radius from 32 to 44.8
  const needleX = 70 + 44.8 * Math.cos((needleAngle * Math.PI) / 180);
  const needleY = 70 - 44.8 * Math.sin((needleAngle * Math.PI) / 180);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-1)',
      }}
    >
      <svg width="140" height="80" viewBox="0 0 140 80">
        {/* Arc segments - scaled 1.4x, thicker strokes */}
        <path
          d="M 14 70 A 56 56 0 0 1 42 25.2"
          stroke="#EF4444"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 42 25.2 A 56 56 0 0 1 70 14"
          stroke="#F59E0B"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 70 14 A 56 56 0 0 1 98 25.2"
          stroke="#EAB308"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 98 25.2 A 56 56 0 0 1 126 70"
          stroke="#22C55E"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />

        {/* Needle - bolder */}
        <line
          x1="70"
          y1="70"
          x2={needleX}
          y2={needleY}
          stroke="#1A1A1A"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Center dot - larger */}
        <circle cx="70" cy="70" r="5" fill="#1A1A1A" />
      </svg>
      <span
        className="vela-mono"
        style={{
          fontWeight: 'var(--weight-bold)',
          fontSize: '0.9rem',
          color: getMoodColor(clampedValue),
          lineHeight: 1,
        }}
      >
        {clampedValue}
      </span>
      <span
        className="vela-label-sm"
        style={{
          color: getMoodColor(clampedValue),
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}
