interface VelaLogoProps {
  /** 'mark' = icon only, 'full' = icon + wordmark */
  variant?: 'mark' | 'full';
  /** Size in pixels (applies to the mark height) */
  size?: number;
  /** Color mode — 'light' renders ink strokes on transparent, 'dark' renders cream strokes */
  mode?: 'light' | 'dark';
  /** When true, expanding diamond rings pulse from the iris (signal detected, trade proposal, etc.) */
  pulse?: boolean;
}

/**
 * Vela brand logo — angular eye with green diamond iris.
 *
 * The mark is an angular, sharp-cornered eye shape (30° system)
 * with a rotated diamond iris filled in Signal Green. It evokes
 * watchfulness — "always watching the markets for you."
 *
 * Monochrome-first: works in all-black, green adds life.
 * Wordmark: lowercase "vela" in Space Grotesk 800.
 *
 * Signal pulse: set `pulse={true}` to trigger expanding diamond rings
 * from the iris. Uses `.vela-signal-pulse--active` from the design system.
 * Contexts: new signal detected, trade proposal ready, position alert, loading.
 */
export default function VelaLogo({
  variant = 'full',
  size = 36,
  mode = 'light',
  pulse = false,
}: VelaLogoProps) {
  const stroke = mode === 'light' ? '#0A0A0A' : '#FFFBF5';

  const mark = (
    <svg
      width={size}
      height={size * 0.5}
      viewBox="-58 -30 116 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Vela logo"
    >
      {/* Outer eye — sharp angular almond, miter joins */}
      <polygon
        points="-55,0 0,-28 55,0 0,28"
        stroke={stroke}
        strokeWidth="5"
        fill="none"
        strokeLinejoin="miter"
      />
      {/* Inner iris — rotated diamond, pure Signal Green fill */}
      <rect x="-9" y="-9" width="18" height="18" rx="2" transform="rotate(45)" fill="#0FE68C" />
    </svg>
  );

  const wrappedMark = (
    <span className={`vela-signal-pulse${pulse ? ' vela-signal-pulse--active' : ''}`}>{mark}</span>
  );

  if (variant === 'mark') return wrappedMark;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.25,
      }}
    >
      {wrappedMark}
      <span
        style={{
          fontFamily: '"Space Grotesk", sans-serif',
          fontWeight: 800,
          fontSize: size * 0.75,
          letterSpacing: '-0.03em',
          color: stroke,
          lineHeight: 1,
        }}
      >
        vela
      </span>
    </span>
  );
}
