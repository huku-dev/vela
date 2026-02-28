import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import VelaLogo from '../components/VelaLogo';

/**
 * Login page for returning users.
 *
 * Distinct from /welcome (onboarding) — this is a clean, focused screen
 * that triggers Privy auth and sends the user straight to the dashboard.
 * New users who land here can tap "Get started" to go to onboarding.
 */
export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, login } = useAuthContext();

  // Already logged in → go to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        backgroundColor: 'var(--color-bg-page)',
        padding: 'var(--space-6) var(--space-4)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Radial glow behind logo */}
      <div
        style={{
          position: 'absolute',
          top: '35%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(15, 230, 140, 0.08) 0%, rgba(15, 230, 140, 0.03) 40%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-6)',
          width: '100%',
          maxWidth: 360,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo with signal pulse animation */}
        <div className="vela-signal-pulse vela-signal-pulse--active">
          <VelaLogo variant="mark" size={64} />
        </div>

        {/* Heading */}
        <div style={{ textAlign: 'center' }}>
          <h1 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
            Welcome back!
          </h1>
          <p className="vela-body-base vela-text-secondary">
            Log in to see your signals and trades.
          </p>
        </div>

        {/* Live signal preview — teaser of what's inside */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <SignalPill asset="BTC" status="buy" />
          <SignalPill asset="ETH" status="sell" />
          <SignalPill asset="SOL" status="wait" />
        </div>

        {/* Login button */}
        <button
          className="vela-btn vela-btn-primary"
          onClick={login}
          disabled={isLoading}
          style={{ width: '100%' }}
        >
          {isLoading ? 'Loading...' : 'Log in'}
        </button>

        {/* New user link */}
        <p className="vela-body-sm vela-text-muted" style={{ textAlign: 'center' }}>
          New to Vela?{' '}
          <Link
            to="/welcome"
            style={{
              color: 'var(--color-text-secondary)',
              textDecoration: 'underline',
              fontWeight: 500,
            }}
          >
            Get started
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Mini signal status pill — decorative teaser of the product */
function SignalPill({ asset, status }: { asset: string; status: 'buy' | 'sell' | 'wait' }) {
  const colors = {
    buy: { bg: 'var(--color-status-buy-bg)', text: 'var(--green-dark)', label: 'BUY' },
    sell: { bg: 'var(--color-status-sell-bg)', text: 'var(--red-dark)', label: 'SELL' },
    wait: { bg: 'var(--gray-100)', text: 'var(--gray-500)', label: 'WAIT' },
  };
  const c = colors[status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        border: '1.5px solid var(--gray-200)',
        backgroundColor: 'var(--color-bg-surface)',
        fontSize: 12,
        fontFamily: 'var(--type-label-sm-font)',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      <span style={{ color: 'var(--color-text-primary)' }}>{asset}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          padding: '2px 6px',
          borderRadius: 4,
          backgroundColor: c.bg,
          color: c.text,
        }}
      >
        {c.label}
      </span>
    </div>
  );
}
