import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';
import { useOnboarding } from '../hooks/useOnboarding';
import { useSubscription } from '../hooks/useSubscription';
import VelaLogo from '../components/VelaLogo';
import type { TradingMode } from '../types';

// ── Splash panel data ──────────────────────────────────────

interface SplashPanel {
  screenshot: string;
  headline: string;
  subline: string;
}

const PANELS: SplashPanel[] = [
  {
    screenshot: '/onboarding/signals-dashboard.svg',
    headline: 'AI that finds the best opportunities \u2014 in both directions',
    subline: 'Vela watches the markets 24/7 so you don\u2019t have to',
  },
  {
    screenshot: '/onboarding/asset-brief.svg',
    headline: 'Understand what\u2019s moving and why, in plain English',
    subline: 'Quick briefs cut through the noise so you can act with confidence',
  },
  {
    screenshot: '/onboarding/trade-approval.svg',
    headline: 'You approve every trade. Vela brings you the right moments.',
    subline: 'Safe, secure, and transparent \u2014 every step of the way',
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
    description: 'See signals and analysis. Great for learning how Vela works.',
    tier: 'Free — included with your account',
  },
  {
    mode: 'semi_auto',
    label: 'Semi-auto',
    description:
      'Vela proposes trades, you approve each one before it executes. The best balance of control and convenience.',
    tier: 'Standard · $10/mo',
    recommended: true,
  },
  {
    mode: 'full_auto',
    label: 'Full auto',
    description:
      'Vela executes trades automatically when it spots an opportunity. Hands-free investing.',
    tier: 'Premium · $20/mo',
  },
];

// ── Step components ────────────────────────────────────────

function WelcomeSplash({ onGetStarted }: { onGetStarted: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(idx);
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
      <div style={{ padding: 'var(--space-6) var(--space-4) var(--space-2)' }}>
        <VelaLogo size={28} />
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
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-6)',
            }}
          >
            {/* Product screenshot */}
            <div
              style={{
                width: '100%',
                maxWidth: 320,
                aspectRatio: '9 / 16',
                borderRadius: 'var(--radius-md)',
                border: '3px solid var(--black)',
                overflow: 'hidden',
                backgroundColor: 'var(--gray-100)',
                boxShadow: '4px 4px 0 var(--black)',
              }}
            >
              <img
                src={panel.screenshot}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top',
                }}
                onError={e => {
                  // Hide broken image — show empty card instead
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>

            {/* Copy */}
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              <h2
                className="vela-heading-lg"
                style={{ marginBottom: 'var(--space-2)', lineHeight: 1.25 }}
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
          padding: 'var(--space-4) var(--space-4) var(--space-8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-5)',
        }}
      >
        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {PANELS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === activeIndex ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === activeIndex ? 'var(--black)' : 'var(--gray-300)',
                transition: 'all 200ms ease-out',
              }}
            />
          ))}
        </div>

        {/* CTA */}
        <button
          className="vela-btn vela-btn-primary"
          onClick={onGetStarted}
          style={{ width: '100%', maxWidth: 340 }}
        >
          Get started
        </button>

        {/* Terms placeholder */}
        <p className="vela-body-sm vela-text-muted" style={{ textAlign: 'center', maxWidth: 300 }}>
          By continuing, you agree to our{' '}
          <a
            href="/terms"
            style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href="/privacy"
            style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}
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
        padding: 'var(--space-6) var(--space-4) var(--space-8)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <VelaLogo size={28} />
      </div>

      <div style={{ flex: 1, maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
          How do you want to trade?
        </h2>
        <p
          className="vela-body-base vela-text-secondary"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          Vela watches the crypto markets 24/7 and flags the best moments to buy or sell. When it
          spots an opportunity, it creates a trade signal. Here&apos;s how you can act on those
          signals:
        </p>

        {/* Mode options */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-8)',
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
                  padding: 'var(--space-4)',
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
                  <p className="vela-body-base" style={{ fontWeight: 600, margin: 0 }}>
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
                  <p className="vela-body-sm vela-text-muted" style={{ margin: 0, marginTop: 2 }}>
                    {description}
                  </p>
                  <p
                    className="vela-body-sm"
                    style={{
                      margin: 0,
                      marginTop: 'var(--space-2)',
                      fontWeight: 600,
                      fontSize: 12,
                      color: mode === 'view_only' ? 'var(--color-text-muted)' : 'var(--green-dark)',
                    }}
                  >
                    {tier}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className="vela-body-sm vela-text-muted" style={{ marginTop: 0 }}>
          You can change this anytime in your account settings.
        </p>
      </div>

      <button
        className="vela-btn vela-btn-primary"
        onClick={() => onContinue(selectedMode)}
        style={{ width: '100%', maxWidth: 440, margin: '0 auto' }}
      >
        {selectedMode === 'view_only' ? 'Continue' : 'Continue to checkout'}
      </button>
    </div>
  );
}

function WalletSetup({ onComplete }: { onComplete: () => void }) {
  const handleFundNow = () => {
    // Open faucet in new tab (testnet — will become Stripe/on-ramp for mainnet)
    window.open('https://app.hyperliquid-testnet.xyz/drip', '_blank');
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
        <VelaLogo size={28} />
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
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <button
          className="vela-btn vela-btn-primary"
          onClick={handleFundNow}
          style={{ width: '100%', marginBottom: 'var(--space-3)' }}
        >
          Fund now
        </button>
        <button className="vela-btn vela-btn-ghost" onClick={onComplete} style={{ width: '100%' }}>
          Skip — I&apos;ll do this later
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
  const { isOnboarded, completeOnboarding } = useOnboarding();
  const { startCheckout } = useSubscription();

  // If already onboarded (e.g. direct /welcome visit), redirect to dashboard
  useEffect(() => {
    if (isOnboarded) {
      navigate('/', { replace: true });
    }
  }, [isOnboarded, navigate]);

  // Determine starting step based on auth state
  const [step, setStep] = useState<OnboardingStep>('splash');
  const [pendingCheckout, setPendingCheckout] = useState<'standard' | 'premium' | null>(null);

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

    setStep('wallet');
  };

  const handleComplete = async () => {
    await completeOnboarding();

    if (pendingCheckout) {
      // User selected a paid mode — redirect to Stripe checkout
      try {
        await startCheckout(pendingCheckout, 'monthly');
        // startCheckout redirects to Stripe, so this line may not execute
      } catch {
        // If checkout fails, just go to dashboard — they can upgrade later via CTAs
        console.warn('[Onboarding] Checkout redirect failed, navigating to dashboard');
        navigate('/', { replace: true });
      }
    } else {
      navigate('/', { replace: true });
    }
  };

  if (step === 'splash') {
    return <WelcomeSplash onGetStarted={handleGetStarted} />;
  }

  if (step === 'trading_mode') {
    return <TradingModeSetup onContinue={handleModeSelected} />;
  }

  return <WalletSetup onComplete={handleComplete} />;
}
