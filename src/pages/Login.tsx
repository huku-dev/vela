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
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-6)',
          width: '100%',
          maxWidth: 360,
        }}
      >
        {/* Logo */}
        <VelaLogo size={48} />

        {/* Heading */}
        <div style={{ textAlign: 'center' }}>
          <h1
            className="vela-heading-lg"
            style={{ marginBottom: 'var(--space-2)' }}
          >
            Welcome back
          </h1>
          <p className="vela-body-base vela-text-secondary">
            Log in to see your signals and trades.
          </p>
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
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center' }}
        >
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
