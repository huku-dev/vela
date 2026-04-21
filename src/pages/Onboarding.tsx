import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import { useSubscription } from '../hooks/useSubscription';
import { track, AnalyticsEvent } from '../lib/analytics';
import VelaLogo from '../components/VelaLogo';
import { BailSheet } from '../components/BailSheet';
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

// TradingModeSetup was removed in 2026-04 (Batch 2b). The standalone mode
// selection step created confusion (Sarah's onboarding call) and overlapped
// with the plan page's features. Mode is now derived from plan choice on
// Stripe success (Home.tsx post-checkout effect): Standard → semi_auto,
// Premium → full_auto. Wallet provisioning moved to that same effect for
// paid users; free/trial users provision lazily at first deposit or trade.

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
    }, 5000);

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

// ── Plan selection (step 4 — after mode selection, before Stripe) ──

// Standard plan features, shown as the full checklist.
// Premium features are rendered additively beneath an "Everything in
// Standard, plus:" header so the upsell is explicit.
const STANDARD_FEATURES: Array<{ title: string; detail?: string }> = [
  {
    title: 'Buy, sell & wait signals on 8 assets',
    detail: 'Across crypto, equities, and commodities.',
  },
  {
    title: 'Manual trade approval',
    detail: 'Vela proposes, you approve each trade.',
  },
  {
    title: 'No trade fees',
  },
];

const PREMIUM_ADDITIONS: Array<{ title: string; detail?: string }> = [
  {
    title: 'Every asset, 24/7 coverage',
    detail: 'Signals on every market Vela watches, round the clock.',
  },
  {
    title: 'Auto-execute trades',
    detail: 'Vela trades the moment a signal fires.',
  },
  {
    title: 'Priority support',
  },
];

// Wireframe: mockups/pricing-page-v5.html
//
// The prior "recommendedTier" prop is removed in v5: Premium is always
// the visually recommended plan via its neobrutalist treatment (green
// tint, thicker border, shadow, "Recommended" badge), not a dynamic
// runtime hint. If Batch 2e needs to remember an originally-chosen tier
// across the trial detour, it should live in sessionStorage alongside
// the existing vela_pending_tier key, not as a prop here.
function OnboardingPlanSelection({
  onCheckout,
  onSkipToFree,
  checkoutError,
}: {
  onCheckout: (tier: 'standard' | 'premium', billingCycle: 'monthly' | 'annual') => Promise<void>;
  /** Kept wired for Batch 2e (trial offer screen fallthrough). Not rendered in 2c. */
  onSkipToFree: () => void;
  checkoutError?: string | null;
}) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [checkingOut, setCheckingOut] = useState(false);

  const handleCheckout = async (tier: 'standard' | 'premium') => {
    setCheckingOut(true);
    try {
      await onCheckout(tier, billingCycle);
    } finally {
      setCheckingOut(false);
    }
  };

  const standardTier = TIER_DEFINITIONS.find(t => t.tier === 'standard')!;
  const premiumTier = TIER_DEFINITIONS.find(t => t.tier === 'premium')!;

  const getPrice = (tier: typeof standardTier): string => {
    if (billingCycle === 'annual') {
      return `$${Math.ceil(tier.annual_price_usd / 12)}`;
    }
    return `$${tier.monthly_price_usd}`;
  };

  const getBillingNote = (tier: typeof standardTier): string => {
    if (billingCycle === 'annual') {
      return `Billed $${tier.annual_price_usd}/yr`;
    }
    return 'Billed monthly';
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
          style={{ marginBottom: 'var(--space-2)', fontSize: '1.75rem', letterSpacing: '-0.01em' }}
        >
          Choose your plan
        </h2>
        <p
          className="vela-body-sm vela-text-secondary"
          style={{ marginBottom: 'var(--space-5)', fontSize: 14 }}
        >
          Cancel anytime from your account settings.
        </p>

        {/* Billing cycle toggle — segmented control, monthly default */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--color-bg-surface)',
            border: '2px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 4,
            marginBottom: 'var(--space-5)',
            boxShadow: '3px 3px 0 var(--color-border-default)',
          }}
        >
          {(['monthly', 'annual'] as const).map(cycle => {
            const active = billingCycle === cycle;
            return (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                aria-pressed={active}
                aria-label={`Bill ${cycle}`}
                style={{
                  padding: '12px 10px',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: active ? 'var(--vela-ink)' : 'transparent',
                  color: active ? 'var(--white)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'all 120ms ease-out',
                }}
              >
                {cycle === 'monthly' ? 'Monthly' : 'Annual'}
                {cycle === 'annual' && (
                  <span
                    style={{
                      background: 'var(--amber-light, #fde68a)',
                      color: 'var(--amber-dark, #7a4f00)',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 'var(--radius-full, 999px)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                    }}
                  >
                    Save 17%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Plan cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <PlanCard
            tier="standard"
            displayName={standardTier.display_name}
            price={getPrice(standardTier)}
            billingNote={getBillingNote(standardTier)}
            features={STANDARD_FEATURES}
            variant="standard"
            ctaLabel={`Subscribe to ${standardTier.display_name}`}
            onClick={() => handleCheckout('standard')}
            disabled={checkingOut}
            loading={checkingOut}
          />

          <PlanCard
            tier="premium"
            displayName={premiumTier.display_name}
            price={getPrice(premiumTier)}
            billingNote={getBillingNote(premiumTier)}
            featuresHeading="Everything in Standard, plus:"
            features={PREMIUM_ADDITIONS}
            variant="premium"
            ctaLabel={`Subscribe to ${premiumTier.display_name}`}
            onClick={() => handleCheckout('premium')}
            disabled={checkingOut}
            loading={checkingOut}
          />
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

      {/* Trial-offer detour (Batch 2e). Clicking this does NOT drop the user
          onto Free — it routes to the trial-offer screen first, which is where
          the "Continue on Free" exit lives. Prop name kept as onSkipToFree
          because the trial screen still ultimately calls it. */}
      <div style={{ textAlign: 'center', marginTop: 'var(--space-5)' }}>
        <button
          type="button"
          onClick={onSkipToFree}
          data-testid="skip-to-trial-offer"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 13,
            color: 'var(--color-text-muted)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            cursor: 'pointer',
          }}
        >
          I&apos;m not ready to subscribe yet
        </button>
      </div>
    </div>
  );
}

// ── Trial offer (step 5 — reached from plan's "not ready" link) ──
//
// One decision screen. Premium trial or Free — no detours, no billing-cycle
// toggle (7-day trial is always Premium monthly, auto-charges on day 8 at
// $20/mo). See docs/threat-reports/trial-system.md Invariant #6 for the
// fee-calc contract during trial; this screen only carries the UX promise.
function OnboardingTrialOffer({
  onStartTrial,
  onContinueFree,
  busy,
  errorMessage,
}: {
  onStartTrial: () => Promise<void>;
  onContinueFree: () => Promise<void>;
  busy: boolean;
  errorMessage: string | null;
}) {
  const bullets = [
    'Signals on every market Vela watches',
    'Auto-execute trades the moment they fire',
    '0.5% trade fee during your trial',
    'No charge until day 8. Cancel anytime.',
  ];
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
        <div
          style={{
            display: 'inline-block',
            background: 'var(--vela-signal-green, #0fe68c)',
            color: 'var(--vela-ink)',
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: 'var(--radius-full, 999px)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            border: '2px solid var(--color-border-default)',
            marginBottom: 'var(--space-3)',
          }}
        >
          7 days free
        </div>
        <h2
          className="vela-heading-lg"
          style={{ marginBottom: 'var(--space-2)', fontSize: '1.75rem', letterSpacing: '-0.01em' }}
        >
          Try Premium free for 7 days
        </h2>
        <p
          className="vela-body-sm vela-text-secondary"
          style={{ marginBottom: 'var(--space-5)', fontSize: 14 }}
        >
          Full Premium features. No charge until day 8. Cancel anytime from your account.
        </p>

        <div
          style={{
            background: 'var(--green-tint, #f0fdf6)',
            border: '3px solid var(--color-border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            boxShadow: '6px 6px 0 var(--color-border-default)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {bullets.map(text => (
              <li
                key={text}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: 'var(--color-text-primary)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    color: 'var(--green-dark)',
                  }}
                >
                  ✓
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        {errorMessage && (
          <div
            style={{
              marginBottom: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: 'var(--red-light, #FFF0F0)',
              border: '2px solid var(--red-primary)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <p className="vela-body-sm" style={{ margin: 0, color: 'var(--red-primary)' }}>
              {errorMessage}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onStartTrial}
          disabled={busy}
          className="vela-btn vela-btn-primary"
          style={{
            width: '100%',
            padding: 'var(--space-3)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          {busy ? 'Starting...' : 'Start 7-day free trial'}
        </button>

        <div style={{ textAlign: 'center' }}>
          <button
            type="button"
            onClick={onContinueFree}
            disabled={busy}
            data-testid="continue-on-free"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 13,
              color: 'var(--color-text-muted)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            Continue on Free
          </button>
        </div>
      </div>
    </div>
  );
}

interface PlanCardProps {
  tier: 'standard' | 'premium';
  displayName: string;
  price: string;
  billingNote: string;
  features: Array<{ title: string; detail?: string }>;
  featuresHeading?: string;
  variant: 'standard' | 'premium';
  ctaLabel: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
}

function PlanCard({
  tier,
  displayName,
  price,
  billingNote,
  features,
  featuresHeading,
  variant,
  ctaLabel,
  onClick,
  disabled,
  loading,
}: PlanCardProps) {
  const isPremium = variant === 'premium';
  return (
    <div
      data-plan={tier}
      style={{
        position: 'relative',
        background: isPremium ? 'var(--green-tint, #f0fdf6)' : 'var(--color-bg-surface)',
        border: `${isPremium ? 3 : 2}px solid var(--color-border-default)`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5) var(--space-5) var(--space-4)',
        boxShadow: isPremium ? '6px 6px 0 var(--color-border-default)' : 'none',
        marginTop: isPremium ? 'var(--space-4)' : 0,
      }}
    >
      {isPremium && (
        <span
          style={{
            position: 'absolute',
            top: -12,
            left: 18,
            background: 'var(--vela-signal-green, #0fe68c)',
            color: 'var(--vela-ink)',
            fontSize: 11,
            fontWeight: 700,
            padding: '5px 12px',
            borderRadius: 'var(--radius-full, 999px)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            border: '2px solid var(--color-border-default)',
          }}
        >
          Recommended
        </span>
      )}

      <div
        style={{
          fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {displayName}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {price}
        </span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          / month
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {billingNote}
      </div>

      {featuresHeading && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {featuresHeading}
        </div>
      )}

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          marginBottom: 'var(--space-3)',
          padding: 0,
        }}
      >
        {features.map((feature, i) => (
          <li
            key={feature.title}
            style={{
              fontSize: 14,
              lineHeight: 1.45,
              padding: '9px 0',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              borderBottom:
                i < features.length - 1 ? '1px solid var(--color-border-muted, #e5e7eb)' : 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: 'var(--green-dark, #059669)',
                fontWeight: 800,
                flexShrink: 0,
                width: 14,
                fontSize: 14,
              }}
            >
              ✓
            </span>
            <span>
              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              >
                {feature.title}
              </span>
              {feature.detail && (
                <span
                  style={{
                    color: 'var(--color-text-muted)',
                    fontWeight: 400,
                    display: 'block',
                    fontSize: 12.5,
                    marginTop: 2,
                  }}
                >
                  {feature.detail}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        disabled={disabled}
        className={`vela-btn ${isPremium ? 'vela-btn-primary' : 'vela-btn-secondary'}`}
        style={{
          width: '100%',
          fontSize: 14,
          padding: '13px',
          cursor: disabled ? 'wait' : 'pointer',
          fontWeight: 700,
        }}
      >
        {loading ? 'Redirecting...' : ctaLabel}
      </button>
    </div>
  );
}

// ── Main onboarding orchestrator ───────────────────────────

type OnboardingStep = 'splash' | 'plan' | 'trial';

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuthContext();
  const { isOnboarded, isChecking, completeOnboarding } = useOnboarding();
  const { startCheckout } = useSubscription();

  // If already onboarded (e.g. direct /welcome visit), redirect to dashboard.
  useEffect(() => {
    if (isOnboarded) {
      navigate('/', { replace: true });
    }
  }, [isOnboarded, navigate]);

  // Detect Stripe cancel return. If present, skip straight to plan step and
  // open the bail sheet so users can retry or bail cleanly. Guarded against
  // already-onboarded users (who will be redirected by the effect above) so
  // the sheet does not briefly flash before the redirect fires.
  const returnedFromCancel =
    new URLSearchParams(window.location.search).get('checkout') === 'cancelled' && !isOnboarded;

  // State initializers are lazy (only fire on mount) — perfect for the
  // cancel-return path, which must capture the URL param before the bail
  // sheet dismissal removes it.
  const [step, setStep] = useState<OnboardingStep>(() => (returnedFromCancel ? 'plan' : 'splash'));
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showBailSheet, setShowBailSheet] = useState(returnedFromCancel);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);

  // Consume-once: clear the persisted tier after the state initializers have
  // read it, so sessionStorage doesn't leak across users on the same tab or
  // resurface during a future unrelated cancel flow. Runs in an effect (not
  // the render body) to avoid the impure-render React anti-pattern.
  useEffect(() => {
    if (returnedFromCancel) {
      sessionStorage.removeItem('vela_pending_tier');
    }
    // Mount-only: returnedFromCancel is captured at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When user authenticates (after Privy login), advance to the plan step.
  // A returning user who is authenticated AND already onboarded will be
  // redirected to '/' by the isOnboarded effect above, so we must not race
  // past splash before that redirect can fire.
  useEffect(() => {
    if (isAuthenticated && !isChecking && !isOnboarded && step === 'splash') {
      setStep('plan');
      track(AnalyticsEvent.ONBOARDING_STEP_VIEWED, { step: 'plan' });
    }
  }, [isAuthenticated, isChecking, isOnboarded, step]);

  // Browser back from the plan step: there is no in-app previous step now
  // that TradingModeSetup is gone. We intentionally do NOT push a history
  // entry, so Back follows normal browser behavior and exits /welcome to
  // wherever the user came from (marketing site, bookmark, etc.).

  const handleGetStarted = () => {
    if (isAuthenticated) {
      // Already logged in (e.g. returning user who hasn't completed onboarding)
      setStep('plan');
    } else {
      login();
    }
  };

  const handlePlanCheckout = async (
    tier: 'standard' | 'premium',
    billingCycle: 'monthly' | 'annual'
  ) => {
    // Do NOT call completeOnboarding() here. Onboarded status is set on
    // confirmed Stripe success in Account.tsx once the paid tier lands.
    // Setting it optimistically caused users who abandoned Stripe to fall
    // silently into the Free tier. Stripe cancel returns to
    // /welcome?checkout=cancelled, which triggers the bail sheet.
    setCheckoutError(null);

    // Persist the selected tier so a cancel return can restore the user's
    // recommendation instead of silently reverting to the Standard default.
    sessionStorage.setItem('vela_pending_tier', tier);

    try {
      await startCheckout(tier, billingCycle);
      // startCheckout sets window.location.href → hard redirect to Stripe
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      console.error('[Onboarding] Checkout redirect failed:', msg);
      setCheckoutError(
        `Couldn\u2019t start checkout: ${msg}. You can try again or continue on the free plan.`
      );
    }
  };

  const handleSkipToFree = async () => {
    // User decided to skip paid plan — continue on free tier
    sessionStorage.removeItem('vela_pending_tier');
    await completeOnboarding();
    navigate('/', { replace: true });
  };

  // "I'm not ready to subscribe yet" routes to the trial-offer detour,
  // not straight to Free. Free stays reachable from the trial screen.
  const handleShowTrialOffer = () => {
    setTrialError(null);
    setStep('trial');
    track(AnalyticsEvent.ONBOARDING_STEP_VIEWED, { step: 'trial' });
  };

  const handleStartTrial = async () => {
    setTrialBusy(true);
    setTrialError(null);
    try {
      // Trial is Premium-only per threat-report Open Q1. Monthly billing
      // is a product simplification: if the user ultimately converts, they
      // can switch to annual from the customer portal.
      await startCheckout('premium', 'monthly', { trial: true });
      // startCheckout hard-redirects to Stripe; code below only runs on
      // throw (network error or 409 "Trial already used").
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start trial';
      setTrialError(msg);
      setTrialBusy(false);
    }
  };

  if (step === 'splash') {
    return <WelcomeSplash onGetStarted={handleGetStarted} onLogin={login} />;
  }

  if (step === 'trial') {
    return (
      <OnboardingTrialOffer
        onStartTrial={handleStartTrial}
        onContinueFree={handleSkipToFree}
        busy={trialBusy}
        errorMessage={trialError}
      />
    );
  }

  const handleBailSheetDismiss = () => {
    setShowBailSheet(false);
    // Strip the ?checkout=cancelled query param so refreshes don't reopen
    // the sheet and the URL reads cleanly.
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
    // Belt-and-suspenders cleanup in case the cancel-return initializer
    // didn't run (e.g. the sheet surfaced via some other path in the future).
    sessionStorage.removeItem('vela_pending_tier');
  };

  const handleBailSheetStartTrial = async () => {
    setShowBailSheet(false);
    // Strip the ?checkout=cancelled param so a failed trial attempt doesn't
    // re-open the bail sheet on refresh.
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
    sessionStorage.removeItem('vela_pending_tier');
    setStep('trial');
    track(AnalyticsEvent.ONBOARDING_STEP_VIEWED, { step: 'trial' });
    // Immediately kick off the trial checkout — the user already saw the
    // plan page and bailed; the trial screen itself will show if anything
    // throws (e.g. 409 "Trial already used.").
    await handleStartTrial();
  };

  return (
    <>
      <OnboardingPlanSelection
        onCheckout={handlePlanCheckout}
        onSkipToFree={handleShowTrialOffer}
        checkoutError={checkoutError}
      />
      {showBailSheet && (
        <BailSheet
          onChoosePlan={handleBailSheetDismiss}
          onStartTrial={handleBailSheetStartTrial}
          trialBusy={trialBusy}
        />
      )}
    </>
  );
}
