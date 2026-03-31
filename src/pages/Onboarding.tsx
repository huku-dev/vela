import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';
import { useOnboarding } from '../hooks/useOnboarding';
import { useSubscription } from '../hooks/useSubscription';
import { track, AnalyticsEvent } from '../lib/analytics';
import VelaLogo from '../components/VelaLogo';
import type { TradingMode } from '../types';
import { TIER_DEFINITIONS } from '../lib/tier-definitions';

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
    subline:
      'AI-powered intelligence that monitors markets 24/7, keeps you informed and sets up profitable trades.',
  },
  {
    mockupVariant: 'brief',
    bgClass: 'vela-card-mint',
    headline: 'Cut through the noise',
    subline:
      'No complex charts or technical jargon. Vela explains what moved, why it matters, and what to watch next.',
  },
  {
    mockupVariant: 'approval',
    bgClass: 'vela-card-lavender',
    headline: 'Stay in control of every trade',
    subline:
      'Vela finds opportunities and proposes trades. You review the reasoning, then approve or decline.',
  },
  {
    mockupVariant: 'signal',
    bgClass: 'vela-card-peach',
    headline: 'Profit whether markets rise or fall',
    subline:
      'Go long when conditions are strong, go short when they weaken. Vela trades both directions for you.',
  },
];

// ── Trading mode config ────────────────────────────────────

const MODE_OPTIONS: {
  mode: TradingMode;
  label: string;
  description: string;
  price: string;
  recommended?: boolean;
}[] = [
  {
    mode: 'view_only',
    label: 'View only',
    description: 'See signals and analysis. Includes 1 free trade to try it out.',
    price: 'Free',
  },
  {
    mode: 'semi_auto',
    label: 'Semi-auto',
    description:
      'Vela proposes trades based on signals. You approve each one before it executes. A good balance of control and convenience.',
    price: '$10/mo',
    recommended: true,
  },
  {
    mode: 'full_auto',
    label: 'Full auto',
    description:
      'Vela executes trades automatically the moment it spots an opportunity. Best way to capture optimal prices.',
    price: '$20/mo',
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
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
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
      <div style={{ padding: 'var(--space-8) var(--space-5) 0' }}>
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
  const selectedOption = MODE_OPTIONS.find(o => o.mode === selectedMode);

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
          How should Vela trade for you?
        </h2>
        <p className="vela-body-sm vela-text-secondary" style={{ marginBottom: 'var(--space-5)' }}>
          You can change this anytime.
        </p>

        {/* Ultra-compact mode options: label + price on one line */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {MODE_OPTIONS.map(({ mode, label, price, recommended }) => {
            const isSelected = selectedMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setSelectedMode(mode)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  backgroundColor: isSelected ? 'var(--gray-100)' : 'transparent',
                  border: isSelected ? '2px solid var(--black)' : '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  width: '100%',
                  boxShadow: isSelected ? '2px 2px 0 var(--black)' : 'none',
                  transition: 'all 120ms ease-out',
                }}
              >
                {/* Radio circle */}
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? 'var(--black)' : 'var(--gray-300)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: 'var(--black)',
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <span className="vela-body-sm" style={{ fontWeight: 600 }}>
                    {label}
                  </span>
                  {recommended && (
                    <span
                      style={{
                        marginLeft: 'var(--space-2)',
                        fontSize: 10,
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
                </div>
                <span className="vela-body-sm" style={{ fontWeight: 600, flexShrink: 0 }}>
                  {price}
                </span>
              </button>
            );
          })}
        </div>

        {/* Detail panel for selected mode */}
        {selectedOption && (
          <div
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-4)',
              backgroundColor: 'var(--gray-50)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <p className="vela-body-sm" style={{ fontWeight: 600, margin: 0, marginBottom: 4 }}>
              {selectedOption.label}
            </p>
            <p className="vela-body-sm vela-text-muted" style={{ margin: 0, lineHeight: 1.5 }}>
              {selectedOption.description}
            </p>
          </div>
        )}
      </div>

      {/* Bottom CTA area */}
      <div style={{ maxWidth: 440, margin: '0 auto', width: '100%', paddingTop: 'var(--space-4)' }}>
        <button
          className="vela-btn vela-btn-primary"
          onClick={() => onContinue(selectedMode)}
          style={{ width: '100%' }}
        >
          {selectedMode === 'view_only' ? 'Continue' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// WalletSetup removed — wallet is provisioned in handleModeSelected,
// users go to plan selection then Stripe instead of seeing a wallet screen.

// ── Plan selection (step 4 — after mode selection, before Stripe) ──

function OnboardingPlanSelection({
  recommendedTier,
  onCheckout,
  onSkipToFree,
  checkoutError,
}: {
  recommendedTier: 'standard' | 'premium';
  onCheckout: (tier: 'standard' | 'premium', billingCycle: 'monthly' | 'annual') => Promise<void>;
  onSkipToFree: () => void;
  checkoutError?: string | null;
}) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [checkingOut, setCheckingOut] = useState(false);

  const handleCheckout = async (tier: 'standard' | 'premium') => {
    setCheckingOut(true);
    try {
      await onCheckout(tier, billingCycle);
    } finally {
      setCheckingOut(false);
    }
  };

  const tiers = TIER_DEFINITIONS.filter(t => t.tier !== 'free');

  const getPrice = (tier: typeof tiers[number]): string => {
    if (billingCycle === 'annual') {
      return `$${Math.ceil(tier.annual_price_usd / 12)}`;
    }
    return `$${tier.monthly_price_usd}`;
  };

  const getBillingNote = (tier: typeof tiers[number]): string => {
    if (billingCycle === 'annual') {
      return `$${tier.annual_price_usd}/yr (save 17%)`;
    }
    return '/mo';
  };

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
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <VelaLogo size={40} />
      </div>

      <div style={{ flex: 1, maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <h2
          className="vela-heading-lg"
          style={{ marginBottom: 'var(--space-2)', fontSize: '1.4rem' }}
        >
          Choose your plan
        </h2>
        <p
          className="vela-body-sm vela-text-secondary"
          style={{ marginBottom: 'var(--space-5)' }}
        >
          Cancel anytime from your account settings.
        </p>

        {/* Billing cycle toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 'var(--space-5)',
          }}
        >
          {(['monthly', 'annual'] as const).map(cycle => (
            <button
              key={cycle}
              onClick={() => setBillingCycle(cycle)}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'Inter, system-ui, sans-serif',
                border: '1.5px solid var(--gray-200)',
                borderLeft: cycle === 'annual' ? 'none' : undefined,
                borderRadius:
                  cycle === 'monthly'
                    ? 'var(--radius-sm) 0 0 var(--radius-sm)'
                    : '0 var(--radius-sm) var(--radius-sm) 0',
                background: billingCycle === cycle ? 'var(--black)' : 'var(--color-bg-surface)',
                color: billingCycle === cycle ? '#fff' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all 100ms',
              }}
            >
              {cycle === 'monthly' ? 'Monthly' : 'Annual (save 17%)'}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {tiers.map(tier => {
            const isRecommended = tier.tier === recommendedTier;
            return (
              <div
                key={tier.tier}
                style={{
                  border: isRecommended
                    ? '2px solid var(--black)'
                    : '1.5px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-4)',
                  boxShadow: isRecommended ? '3px 3px 0 var(--black)' : 'none',
                  background: 'var(--color-bg-surface)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 16 }}>
                    {tier.display_name}
                    {isRecommended && (
                      <span
                        style={{
                          marginLeft: 'var(--space-2)',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'var(--green-dark)',
                          backgroundColor: 'var(--color-status-buy-bg)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        Selected
                      </span>
                    )}
                  </span>
                </div>

                <div style={{ marginBottom: 'var(--space-2)' }}>
                  <span
                    style={{
                      fontFamily: "'Instrument Sans', 'Inter', system-ui, sans-serif",
                      fontWeight: 700,
                      fontSize: 24,
                    }}
                  >
                    {getPrice(tier)}
                  </span>
                  <span
                    style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 2 }}
                  >
                    {billingCycle === 'annual' ? '/mo' : '/mo'}
                  </span>
                </div>

                {billingCycle === 'annual' && (
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    {getBillingNote(tier)}
                  </p>
                )}

                <p
                  className="vela-body-sm"
                  style={{
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.4,
                    marginBottom: 'var(--space-3)',
                    fontSize: 12,
                  }}
                >
                  {tier.max_assets === 0 ? 'Unlimited' : tier.max_assets} asset
                  {tier.max_assets !== 1 ? 's' : ''}
                  {' · '}
                  {tier.tier === 'premium' ? 'Full auto' : 'Semi-auto'}
                  {' · '}
                  {tier.max_leverage}x leverage
                  {' · '}
                  {tier.trade_fee_pct === 0
                    ? 'No trade fee'
                    : `${tier.trade_fee_pct}% trade fee`}
                </p>

                <button
                  onClick={() => handleCheckout(tier.tier as 'standard' | 'premium')}
                  disabled={checkingOut}
                  className={`vela-btn ${isRecommended ? 'vela-btn-primary' : 'vela-btn-outline'}`}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    padding: 'var(--space-2) var(--space-4)',
                    cursor: checkingOut ? 'wait' : 'pointer',
                  }}
                >
                  {checkingOut ? 'Redirecting...' : `Subscribe to ${tier.display_name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Checkout error */}
        {checkoutError && (
          <div
            style={{
              marginTop: 'var(--space-3)',
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
      </div>

      {/* Skip to free */}
      <div
        style={{ maxWidth: 440, margin: '0 auto', width: '100%', paddingTop: 'var(--space-3)' }}
      >
        <button
          onClick={onSkipToFree}
          className="vela-btn vela-btn-ghost"
          style={{ width: '100%', fontSize: 13 }}
        >
          Continue on free plan
        </button>
      </div>
    </div>
  );
}

// ── Main onboarding orchestrator ───────────────────────────

type OnboardingStep = 'splash' | 'trading_mode' | 'plan';

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuthContext();
  const { updatePreferences, enableTrading } = useTrading();
  const { isOnboarded, isChecking, completeOnboarding, resetOnboarding } = useOnboarding();
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

  // When user authenticates (after Privy login), advance to next step —
  // but only after the onboarding check completes. A returning user who is
  // authenticated AND already onboarded will be redirected to '/' by the
  // isOnboarded effect above, so we must not race past splash before that
  // redirect can fire.
  useEffect(() => {
    if (isAuthenticated && !isChecking && !isOnboarded && step === 'splash') {
      setStep('trading_mode');
    }
  }, [isAuthenticated, isChecking, isOnboarded, step]);

  const handleGetStarted = () => {
    if (isAuthenticated) {
      // Already logged in (e.g. returning user who hasn't completed onboarding)
      setStep('trading_mode');
    } else {
      login();
    }
  };

  const handleModeSelected = async (mode: TradingMode) => {
    track(AnalyticsEvent.TRADING_MODE_SELECTED, { mode });

    // Always provision wallet + save preferences (regardless of tier).
    // enableTrading calls updatePreferences + provision-wallet.
    try {
      if (mode !== 'view_only') {
        await enableTrading(mode);
      } else {
        await updatePreferences({ mode } as Record<string, unknown>);
      }
    } catch {
      // Best-effort — don't block onboarding if this fails.
      // The Account page "Enable trading" button is a fallback path.
      console.warn('[Onboarding] Failed to save trading mode / provision wallet');
    }

    if (mode === 'semi_auto') {
      setPendingCheckout('standard');
      setStep('plan');
    } else if (mode === 'full_auto') {
      setPendingCheckout('premium');
      setStep('plan');
    } else {
      // Free mode — skip plan selection, go straight to dashboard
      await completeOnboarding();
      navigate('/', { replace: true });
    }
  };

  const handlePlanCheckout = async (
    tier: 'standard' | 'premium',
    billingCycle: 'monthly' | 'annual'
  ) => {
    // Mark as onboarded BEFORE the Stripe redirect so the user
    // can return to /account after checkout (OnboardingGate would block
    // them otherwise). If checkout fails, we roll back.
    checkoutInProgressRef.current = true;
    setCheckoutError(null);

    await completeOnboarding();

    try {
      await startCheckout(tier, billingCycle);
      // startCheckout sets window.location.href → hard redirect to Stripe
    } catch (err) {
      // Checkout failed — roll back onboarding so the user stays in the
      // flow instead of landing on the dashboard in a limbo state.
      resetOnboarding();
      checkoutInProgressRef.current = false;
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      console.error('[Onboarding] Checkout redirect failed:', msg);
      setCheckoutError(
        `Couldn\u2019t start checkout: ${msg}. You can try again or continue on the free plan.`
      );
    }
  };

  const handleSkipToFree = async () => {
    // User decided to skip paid plan — continue on free tier
    setPendingCheckout(null);
    await completeOnboarding();
    navigate('/', { replace: true });
  };

  if (step === 'splash') {
    return <WelcomeSplash onGetStarted={handleGetStarted} onLogin={login} />;
  }

  if (step === 'trading_mode') {
    return <TradingModeSetup onContinue={handleModeSelected} />;
  }

  return (
    <OnboardingPlanSelection
      recommendedTier={pendingCheckout ?? 'standard'}
      onCheckout={handlePlanCheckout}
      onSkipToFree={handleSkipToFree}
      checkoutError={checkoutError}
    />
  );
}
