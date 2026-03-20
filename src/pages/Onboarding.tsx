import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';
import { useOnboarding } from '../hooks/useOnboarding';
import { useSubscription } from '../hooks/useSubscription';
import VelaLogo from '../components/VelaLogo';
import type { TradingMode } from '../types';

// ── Splash panel data ──────────────────────────────────────

// Original copy preserved for reference:
// Panel 1: "AI that finds the best opportunities — in both directions" / "Vela watches the markets 24/7 so you don't have to"
// Panel 2: "Understand what's moving and why, in plain English" / "Quick briefs cut through the noise so you can act with confidence"
// Panel 3: "You approve every trade. Vela brings you the right moments." / "Safe, secure, and transparent — every step of the way"

interface SplashPanel {
  mockupVariant: 'brand' | 'brief' | 'signal' | 'approval';
  bgClass: string;
  headline: string;
  subline: string;
}

const PANELS: SplashPanel[] = [
  {
    mockupVariant: 'brand',
    bgClass: 'vela-card-lavender',
    headline: 'Vela watches the markets. You make the moves.',
    subline: 'AI-powered intelligence that monitors markets 24/7, keeps you informed and sets up profitable trades.',
  },
  {
    mockupVariant: 'brief',
    bgClass: 'vela-card-mint',
    headline: 'Cut through the noise',
    subline: 'No complex charts or technical jargon. Vela explains what moved, why it matters, and what to watch next.',
  },
  {
    mockupVariant: 'approval',
    bgClass: 'vela-card-lavender',
    headline: 'Stay in control of every trade',
    subline: 'Vela finds opportunities and proposes trades. You review the reasoning, then approve or decline.',
  },
  {
    mockupVariant: 'signal',
    bgClass: 'vela-card-peach',
    headline: 'Profit whether markets rise or fall',
    subline: 'Go long when conditions are strong, go short when they weaken. Vela trades both directions for you.',
  },
];

// ── Trading mode config ────────────────────────────────────

const MODE_OPTIONS: {
  mode: TradingMode;
  label: string;
  description: string;
  tier: string;
  recommended?: boolean;
}[] = [
  {
    mode: 'view_only',
    label: 'View only',
    description: 'See signals and analysis. Includes 1 free trade to try it out.',
    tier: 'Free · included with your account',
  },
  {
    mode: 'semi_auto',
    label: 'Semi-auto',
    description:
      'Vela proposes trades, you approve each one before it executes. A good balance of control and convenience.',
    tier: 'Standard plan required · $10/mo',
    recommended: true,
  },
  {
    mode: 'full_auto',
    label: 'Full auto',
    description:
      'Vela executes trades the moment it spots an opportunity. Best way to capture optimal prices.',
    tier: 'Premium plan required · $20/mo',
  },
];

// ── Mockup components (marketing-site quality) ─────────────

function MockupWindow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--white)',
        border: '2px solid var(--color-border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        boxShadow: '2px 2px 0 var(--gray-200)',
      }}
    >
      {/* Title bar with 3 dots */}
      <div
        style={{
          display: 'flex',
          gap: 5,
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--gray-100)',
          borderBottom: '1px solid var(--gray-200)',
        }}
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--gray-300)',
            }}
          />
        ))}
      </div>
      {/* Body */}
      <div
        style={{
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BriefMockup() {
  return (
    <>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '0.6rem',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            background: 'var(--lavender-100)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          📰 Daily Brief
        </span>
        <span style={{ fontSize: '0.6rem', color: 'var(--gray-400)' }}>Mar 19, 2026</span>
      </div>

      {/* Headline */}
      <p
        style={{
          margin: 0,
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        Gold surges to new highs as investors move to safety
      </p>

      {/* Placeholder bullets */}
      {[100, 100, 65].map((w, i) => (
        <div
          key={i}
          style={{
            height: 5,
            width: `${w}%`,
            background: 'var(--gray-200)',
            borderRadius: 3,
          }}
        />
      ))}
    </>
  );
}

function SignalMockup() {
  const trades = [
    {
      asset: 'BTC',
      color: '#F7931A',
      symbol: '\u20BF',
      direction: 'LONG' as const,
      entry: '$94,200',
      current: '$105,900',
      pnl: '+12.4%',
      positive: true,
    },
    {
      asset: 'Gold',
      color: '#d4a017',
      symbol: 'Au',
      direction: 'SHORT' as const,
      entry: '$3,150',
      current: '$2,828',
      pnl: '+10.2%',
      positive: true,
    },
    {
      asset: 'SPX',
      color: '#1a56db',
      symbol: 'S',
      direction: 'LONG' as const,
      entry: '$5,420',
      current: '$5,580',
      pnl: '+2.9%',
      positive: true,
    },
  ];

  const directionStyles: Record<string, { bg: string; color: string; border: string }> = {
    LONG: { bg: 'var(--green-light)', color: 'var(--green-dark)', border: 'var(--green-primary)' },
    SHORT: { bg: 'var(--red-light)', color: 'var(--red-dark)', border: 'var(--red-primary)' },
  };

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '0.6rem',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            background: 'var(--peach-100)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Your Trades
        </span>
        <span style={{ fontSize: '0.55rem', color: 'var(--gray-400)' }}>P&L</span>
      </div>

      {/* Trade rows */}
      {trades.map((trade, i) => (
        <div key={trade.asset}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '3px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Asset icon */}
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  // Asset brand colors
                  backgroundColor: trade.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--white)',
                }}
              >
                {trade.symbol}
              </div>
              <div>
                <span
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'block',
                    lineHeight: 1.2,
                  }}
                >
                  {trade.asset}
                </span>
                {/* Direction chip inline */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                  <span
                    style={{
                      fontSize: '0.45rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '1px 5px',
                      borderRadius: 4,
                      border: `1.5px solid ${directionStyles[trade.direction].border}`,
                      background: directionStyles[trade.direction].bg,
                      color: directionStyles[trade.direction].color,
                    }}
                  >
                    {trade.direction}
                  </span>
                  <span style={{ fontSize: '0.5rem', color: 'var(--gray-400)' }}>
                    {trade.entry} → {trade.current}
                  </span>
                </div>
              </div>
            </div>
            {/* PnL */}
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: trade.positive ? 'var(--green-dark)' : 'var(--red-dark)',
              }}
            >
              {trade.pnl}
            </span>
          </div>
          {i < trades.length - 1 && (
            <div style={{ height: 1, background: 'var(--gray-200)', margin: '2px 0' }} />
          )}
        </div>
      ))}
    </>
  );
}

function ApprovalMockup() {
  return (
    <>
      {/* Badge */}
      <span
        style={{
          fontSize: '0.6rem',
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'var(--peach-100)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          alignSelf: 'flex-start',
        }}
      >
        Trade Proposal
      </span>

      {/* Asset + direction */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              // Asset brand color
              backgroundColor: '#F7931A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--white)',
            }}
          >
            {'\u20BF'}
          </div>
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            BTC &middot; $96,450
          </span>
        </div>
        <span
          style={{
            fontSize: '0.55rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--green-primary)',
            background: 'var(--green-light)',
            color: 'var(--green-dark)',
          }}
        >
          Long
        </span>
      </div>

      {/* Trade details */}
      {[
        { label: 'Position size', value: '$500.00' },
        { label: 'Entry price', value: '$96,450' },
        { label: 'Stop-loss', value: '$94,200' },
      ].map(row => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.6rem',
            padding: '1px 0',
          }}
        >
          <span style={{ color: 'var(--gray-500)' }}>{row.label}</span>
          <span style={{ fontWeight: 600 }}>{row.value}</span>
        </div>
      ))}

      {/* Rationale */}
      <p
        style={{
          margin: 0,
          fontSize: '0.55rem',
          color: 'var(--gray-500)',
          fontStyle: 'italic',
          lineHeight: 1.3,
          padding: '2px 0',
        }}
      >
        Vela&apos;s signals show a move higher is likely
      </p>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-1)' }}>
        <div
          style={{
            flex: 1,
            padding: '5px 0',
            textAlign: 'center',
            fontSize: '0.6rem',
            fontWeight: 600,
            border: '1.5px solid var(--gray-300)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--gray-500)',
          }}
        >
          Decline
        </div>
        <div
          style={{
            flex: 1,
            padding: '5px 0',
            textAlign: 'center',
            fontSize: '0.6rem',
            fontWeight: 600,
            background: 'var(--green-primary)',
            color: 'var(--white)',
            borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--green-primary)',
          }}
        >
          Approve
        </div>
      </div>
    </>
  );
}

function BrandMockup() {
  const assets = [
    { name: 'BTC', color: '#F7931A', symbol: '\u20BF', signal: 'BUY' as const },
    { name: 'S&P 500', color: '#1a56db', symbol: 'S', signal: 'WAIT' as const },
    { name: 'Gold', color: '#d4a017', symbol: 'Au', signal: 'BUY' as const },
  ];

  const signalStyles: Record<string, { bg: string; color: string; border: string }> = {
    BUY: { bg: 'var(--green-light)', color: 'var(--green-dark)', border: 'var(--green-primary)' },
    WAIT: { bg: 'var(--gray-100)', color: 'var(--gray-500)', border: 'var(--gray-300)' },
  };

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <VelaLogo variant="mark" size={16} />
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '-0.01em',
          }}
        >
          vela
        </span>
        <span style={{ fontSize: '0.55rem', color: 'var(--gray-400)', marginLeft: 'auto' }}>
          Live
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--green-primary)',
            flexShrink: 0,
          }}
        />
      </div>

      {/* Asset rows with signal chips */}
      {assets.map((asset, i) => (
        <div key={asset.name}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-1) 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  // Asset brand colors
                  backgroundColor: asset.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--white)',
                }}
              >
                {asset.symbol}
              </div>
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {asset.name}
              </span>
            </div>
            <span
              style={{
                fontSize: '0.55rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: `2px solid ${signalStyles[asset.signal].border}`,
                background: signalStyles[asset.signal].bg,
                color: signalStyles[asset.signal].color,
              }}
            >
              {asset.signal}
            </span>
          </div>
          {i < assets.length - 1 && (
            <div style={{ height: 1, background: 'var(--gray-200)', margin: '2px 0' }} />
          )}
        </div>
      ))}

      {/* Indicator bars */}
      <div style={{ marginTop: 'var(--space-1)' }}>
        {[
          { label: 'Trend', pct: 85, color: 'var(--green-primary)' },
          { label: 'Momentum', pct: 70, color: 'var(--green-primary)' },
          { label: 'Volume', pct: 55, color: 'var(--amber-primary)' },
        ].map(bar => (
          <div
            key={bar.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 3,
            }}
          >
            <span
              style={{
                width: 56,
                fontSize: '0.55rem',
                color: 'var(--gray-500)',
                flexShrink: 0,
              }}
            >
              {bar.label}
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                background: 'var(--gray-100)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${bar.pct}%`,
                  height: '100%',
                  background: bar.color,
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PanelMockup({ variant }: { variant: SplashPanel['mockupVariant'] }) {
  return (
    <MockupWindow>
      {variant === 'brand' && <BrandMockup />}
      {variant === 'brief' && <BriefMockup />}
      {variant === 'signal' && <SignalMockup />}
      {variant === 'approval' && <ApprovalMockup />}
    </MockupWindow>
  );
}

// ── Step components ────────────────────────────────────────

function WelcomeSplash({
  onGetStarted,
  onLogin,
}: {
  onGetStarted: () => void;
  onLogin: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const userInteractedRef = useRef(false);
  const autoCycleDoneRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(idx);
  }, []);

  // Auto-cycle: advance every 2s, one full pass, stop on user interaction
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const markInteracted = () => {
      userInteractedRef.current = true;
    };
    el.addEventListener('touchstart', markInteracted, { passive: true });
    el.addEventListener('mousedown', markInteracted);

    let currentIdx = 0;
    const timer = setInterval(() => {
      if (userInteractedRef.current || autoCycleDoneRef.current) {
        clearInterval(timer);
        return;
      }
      currentIdx += 1;
      if (currentIdx >= PANELS.length) {
        autoCycleDoneRef.current = true;
        clearInterval(timer);
        return;
      }
      el.scrollTo({ left: el.clientWidth * currentIdx, behavior: 'smooth' });
    }, 3000);

    return () => {
      clearInterval(timer);
      el.removeEventListener('touchstart', markInteracted);
      el.removeEventListener('mousedown', markInteracted);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        backgroundColor: 'var(--color-bg-page)',
      }}
    >
      {/* Logo header */}
      <div style={{ padding: 'var(--space-6) var(--space-5) 0' }}>
        <VelaLogo size={40} />
      </div>

      {/* Swipeable panels */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          flex: 1,
          scrollbarWidth: 'none',
        }}
      >
        {PANELS.map((panel, i) => (
          <div
            key={i}
            style={{
              flex: '0 0 100%',
              scrollSnapAlign: 'start',
              padding: '0 var(--space-5)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              paddingTop: 'var(--space-6)',
              gap: 'var(--space-8)',
            }}
          >
            {/* Product mockup — fixed height so copy stays aligned across panels */}
            <div
              className={`vela-card ${panel.bgClass}`}
              style={{
                width: '100%',
                maxWidth: 300,
                height: 290,
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                overflow: 'hidden',
              }}
            >
              <PanelMockup variant={panel.mockupVariant} />
            </div>

            {/* Copy */}
            <div style={{ textAlign: 'center', maxWidth: 300 }}>
              <h2
                className="vela-heading-lg"
                style={{
                  marginBottom: 'var(--space-2)',
                  lineHeight: 1.25,
                  letterSpacing: '-0.01em',
                }}
              >
                {panel.headline}
              </h2>
              <p className="vela-body-base vela-text-secondary">{panel.subline}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom: dots + CTA */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-5) var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        {/* Dot indicators (tappable) */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {PANELS.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                userInteractedRef.current = true;
                scrollRef.current?.scrollTo({
                  left: scrollRef.current.clientWidth * i,
                  behavior: 'smooth',
                });
              }}
              style={{
                width: i === activeIndex ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === activeIndex ? 'var(--vela-ink)' : 'var(--gray-300)',
                transition: 'all 200ms ease-out',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
              aria-label={`Go to panel ${i + 1}`}
            />
          ))}
        </div>

        {/* Primary CTA */}
        <button
          className="vela-btn vela-btn-primary"
          onClick={onGetStarted}
          style={{ width: '100%', maxWidth: 320 }}
        >
          Get started
        </button>

        {/* Secondary login link */}
        <p className="vela-body-sm vela-text-secondary" style={{ margin: 0, textAlign: 'center' }}>
          Already have an account?{' '}
          <button
            onClick={onLogin}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              color: 'var(--color-text-secondary)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Log in
          </button>
        </p>

        {/* Terms */}
        <p
          className="vela-text-muted"
          style={{ textAlign: 'center', maxWidth: 300, margin: 0, fontSize: 11 }}
        >
          By continuing, you agree to our{' '}
          <a
            href="/terms"
            style={{ color: 'var(--color-text-muted)', textDecoration: 'underline' }}
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href="/privacy"
            style={{ color: 'var(--color-text-muted)', textDecoration: 'underline' }}
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}

function TradingModeSetup({ onContinue }: { onContinue: (mode: TradingMode) => void }) {
  const [selectedMode, setSelectedMode] = useState<TradingMode>('semi_auto');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        backgroundColor: 'var(--color-bg-page)',
        padding: 'var(--space-6) var(--space-4) var(--space-6)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <VelaLogo size={40} />
      </div>

      <div style={{ flex: 1, maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
          How do you want to trade?
        </h2>
        <p className="vela-body-sm vela-text-secondary" style={{ marginBottom: 'var(--space-5)' }}>
          Vela watches the crypto markets 24/7 and flags the best moments to buy or sell. Choose how
          you want to act on signals:
        </p>

        {/* Mode options */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {MODE_OPTIONS.map(({ mode, label, description, tier, recommended }) => {
            const isSelected = selectedMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setSelectedMode(mode)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  backgroundColor: isSelected ? 'var(--gray-100)' : 'transparent',
                  border: isSelected ? '2px solid var(--black)' : '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  width: '100%',
                  boxShadow: isSelected ? '3px 3px 0 var(--black)' : 'none',
                  transition: 'all 150ms ease-out',
                }}
              >
                {/* Radio circle */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? 'var(--black)' : 'var(--gray-300)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: 'var(--black)',
                      }}
                    />
                  )}
                </div>
                <div>
                  <p className="vela-body-sm" style={{ fontWeight: 600, margin: 0 }}>
                    {label}
                    {recommended && (
                      <span
                        style={{
                          marginLeft: 'var(--space-2)',
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--green-dark)',
                          backgroundColor: 'var(--color-status-buy-bg)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        Recommended
                      </span>
                    )}
                  </p>
                  <p
                    className="vela-text-muted"
                    style={{ margin: 0, marginTop: 2, fontSize: 13, lineHeight: 1.4 }}
                  >
                    {description}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      marginTop: 'var(--space-2)',
                      fontWeight: 600,
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {tier}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom CTA area */}
      <div style={{ maxWidth: 440, margin: '0 auto', width: '100%', paddingTop: 'var(--space-4)' }}>
        <button
          className="vela-btn vela-btn-primary"
          onClick={() => onContinue(selectedMode)}
          style={{ width: '100%' }}
        >
          {selectedMode === 'view_only' ? 'Continue' : 'Select plan'}
        </button>
        <p
          style={{
            margin: 0,
            marginTop: 'var(--space-3)',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--gray-400)',
          }}
        >
          You can change this anytime in your account settings.
        </p>
      </div>
    </div>
  );
}

function WalletSetup({
  onComplete,
  checkoutError,
}: {
  onComplete: () => void;
  checkoutError?: string | null;
}) {
  const walletEnv = import.meta.env.VITE_WALLET_ENVIRONMENT;
  if (!walletEnv) {
    console.error('[WalletSetup] VITE_WALLET_ENVIRONMENT is not set');
  }
  const isTestnet = walletEnv === 'testnet';

  const handleFundNow = () => {
    if (isTestnet) {
      window.open('https://app.hyperliquid-testnet.xyz/drip', '_blank');
    }
    // On mainnet, user deposits via Account page — just advance onboarding
    onComplete();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        backgroundColor: 'var(--color-bg-page)',
        padding: 'var(--space-6) var(--space-4) var(--space-8)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <VelaLogo size={40} />
      </div>

      <div style={{ flex: 1, maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
          Your trading wallet is ready
        </h2>
        <p
          className="vela-body-base vela-text-secondary"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          When Vela spots a trade opportunity, funds are drawn from this wallet to invest in
          signalled assets. You can add funds now or do it later from your account settings.
        </p>

        {/* Simple wallet visual */}
        <div
          className="vela-card"
          style={{
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            textAlign: 'center',
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            style={{ margin: '0 auto var(--space-3)', display: 'block' }}
          >
            <rect
              x="4"
              y="12"
              width="32"
              height="22"
              rx="4"
              stroke="var(--black)"
              strokeWidth="2.5"
              fill="var(--gray-50)"
            />
            <circle
              cx="28"
              cy="23"
              r="3"
              fill="var(--green-primary)"
              stroke="var(--black)"
              strokeWidth="1.5"
            />
            <path
              d="M8 12V8a4 4 0 014-4h16a4 4 0 014 4v4"
              stroke="var(--black)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="vela-body-base" style={{ fontWeight: 600, margin: 0 }}>
            Wallet created
          </p>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ margin: 0, marginTop: 'var(--space-1)' }}
          >
            Secured by Vela. Ready to fund when you are.
          </p>

          {/* Balance display */}
          <div
            style={{
              marginTop: 'var(--space-4)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--gray-200)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--space-1)',
              }}
            >
              Balance
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 700,
                fontFamily: "'Instrument Sans', 'Inter', system-ui, sans-serif",
                color: 'var(--color-text-muted)',
                letterSpacing: '-0.02em',
              }}
            >
              $0.00
            </p>
          </div>
        </div>
      </div>

      {/* Checkout error feedback */}
      {checkoutError && (
        <div
          style={{
            maxWidth: 440,
            margin: '0 auto var(--space-3)',
            width: '100%',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--red-light, #FFF0F0)',
            border: '2px solid var(--red-primary)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, color: 'var(--red-primary)' }}>
            {checkoutError}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <button
          className="vela-btn vela-btn-primary"
          onClick={handleFundNow}
          style={{ width: '100%', marginBottom: 'var(--space-3)' }}
        >
          {isTestnet ? 'Get test USDC' : 'Fund wallet'}
        </button>
        <button className="vela-btn vela-btn-ghost" onClick={onComplete} style={{ width: '100%' }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ── Main onboarding orchestrator ───────────────────────────

type OnboardingStep = 'splash' | 'trading_mode' | 'wallet';

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuthContext();
  const { updatePreferences } = useTrading();
  const { isOnboarded, completeOnboarding, resetOnboarding } = useOnboarding();
  const { startCheckout } = useSubscription();

  // Track whether we're in the middle of a Stripe checkout redirect.
  // Without this guard, completeOnboarding() sets isOnboarded=true which
  // triggers the useEffect below to navigate('/') — preempting the
  // Stripe redirect and sending the user to the dashboard instead.
  const checkoutInProgressRef = useRef(false);

  // If already onboarded (e.g. direct /welcome visit), redirect to dashboard
  // — but NOT if a Stripe checkout redirect is in progress.
  useEffect(() => {
    if (isOnboarded && !checkoutInProgressRef.current) {
      navigate('/', { replace: true });
    }
  }, [isOnboarded, navigate]);

  // Determine starting step based on auth state
  const [step, setStep] = useState<OnboardingStep>('splash');
  const [pendingCheckout, setPendingCheckout] = useState<'standard' | 'premium' | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // When user authenticates (after Privy login), advance to next step
  useEffect(() => {
    if (isAuthenticated && step === 'splash') {
      setStep('trading_mode');
    }
  }, [isAuthenticated, step]);

  const handleGetStarted = () => {
    if (isAuthenticated) {
      // Already logged in (e.g. returning user who hasn't completed onboarding)
      setStep('trading_mode');
    } else {
      login();
    }
  };

  const handleModeSelected = async (mode: TradingMode) => {
    try {
      await updatePreferences({ mode } as Record<string, unknown>);
    } catch {
      // Best-effort — don't block onboarding if this fails
      console.warn('[Onboarding] Failed to save trading mode preference');
    }

    // Track if user selected a paid mode so we can trigger checkout after onboarding
    if (mode === 'semi_auto') {
      setPendingCheckout('standard');
    } else if (mode === 'full_auto') {
      setPendingCheckout('premium');
    } else {
      setPendingCheckout(null);
    }

    setCheckoutError(null);
    setStep('wallet');
  };

  const handleComplete = async () => {
    if (pendingCheckout) {
      // User selected a paid mode — redirect to Stripe checkout.
      // We must mark as onboarded BEFORE the Stripe redirect so the user
      // can return to /account after checkout (OnboardingGate would block
      // them otherwise). If checkout fails, we roll back with resetOnboarding().
      checkoutInProgressRef.current = true;
      setCheckoutError(null);

      await completeOnboarding();

      try {
        await startCheckout(pendingCheckout, 'monthly');
        // startCheckout sets window.location.href → hard redirect to Stripe
      } catch (err) {
        // Checkout failed — roll back onboarding so the user stays in the
        // flow instead of landing on the dashboard in a limbo state.
        resetOnboarding();
        checkoutInProgressRef.current = false;
        const msg = err instanceof Error ? err.message : 'Checkout failed';
        console.error('[Onboarding] Checkout redirect failed:', msg);
        setCheckoutError(
          `Couldn\u2019t start checkout: ${msg}. You can try again or skip for now.`
        );
      }
    } else {
      await completeOnboarding();
      navigate('/', { replace: true });
    }
  };

  if (step === 'splash') {
    return <WelcomeSplash onGetStarted={handleGetStarted} onLogin={login} />;
  }

  if (step === 'trading_mode') {
    return <TradingModeSetup onContinue={handleModeSelected} />;
  }

  return <WalletSetup onComplete={handleComplete} checkoutError={checkoutError} />;
}
