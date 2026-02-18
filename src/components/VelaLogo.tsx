interface VelaLogoProps {
  /** 'mark' = icon only, 'full' = icon + wordmark */
  variant?: 'mark' | 'full';
  /** Size in pixels (applies to the mark height) */
  size?: number;
}

/**
 * Vela brand logo — neobrutalist sail/V mark.
 *
 * The mark is a stylized sail shape (vela = sail) formed by two
 * converging strokes, evoking both a "V" and a billowing sail.
 * Thick black outlines + green accent follow the design system.
 */
export default function VelaLogo({ variant = 'full', size = 32 }: VelaLogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Vela logo"
    >
      {/* Background circle */}
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="10"
        fill="#1A1A1A"
        stroke="#1A1A1A"
        strokeWidth="2"
      />
      {/* Sail / V shape — two converging lines forming a sail */}
      {/* Left stroke of the V / sail's leading edge */}
      <path
        d="M12 8L20 32"
        stroke="#22C55E"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right stroke of the V / sail's trailing edge */}
      <path
        d="M28 8L20 32"
        stroke="#FFFFFF"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Small accent dot — like a star / navigation point */}
      <circle cx="28" cy="8" r="2.5" fill="#22C55E" />
    </svg>
  );

  if (variant === 'mark') return mark;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.3,
      }}
    >
      {mark}
      <span
        style={{
          fontFamily: '"Space Grotesk", sans-serif',
          fontWeight: 800,
          fontSize: size * 0.85,
          letterSpacing: '-0.03em',
          color: '#1A1A1A',
          lineHeight: 1,
        }}
      >
        Vela
      </span>
    </span>
  );
}
