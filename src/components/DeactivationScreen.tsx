import { useAuthContext } from '../contexts/AuthContext';
import { useAccountDelete } from '../hooks/useAccountDelete';
import VelaLogo from './VelaLogo';

/**
 * Full-screen gate shown to deactivated users who log back in during
 * the 30-day reactivation window. Offers reactivation or logout.
 *
 * Rendered by DeactivationGate in App.tsx — un-bypassable.
 */
export default function DeactivationScreen() {
  const { user, logout } = useAuthContext();
  const { reactivate, reactivating, error } = useAccountDelete();

  const deactivatedDate = user?.deactivatedAt
    ? new Date(user.deactivatedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'recently';

  const deletionDate = user?.deletionScheduledAt
    ? new Date(user.deletionScheduledAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '30 days after deactivation';

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
      {/* Logo header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <VelaLogo size={28} />
      </div>

      <div style={{ flex: 1, maxWidth: 440, margin: '0 auto', width: '100%' }}>
        {/* Warning icon */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: 'var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--space-4)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 9v4m0 4h.01M12 3L2 21h20L12 3z"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
          Your account is scheduled for deletion
        </h2>
        <p
          className="vela-body-base vela-text-secondary"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          You deactivated your account on {deactivatedDate}. Permanent deletion is scheduled for{' '}
          {deletionDate}.
        </p>

        {/* Info card */}
        <div
          className="vela-card"
          style={{
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
            backgroundColor: 'var(--red-bg, #fef2f2)',
            border: '2px solid var(--color-error)',
          }}
        >
          <p
            className="vela-label-sm"
            style={{ marginBottom: 'var(--space-3)', color: 'var(--color-error)' }}
          >
            DURING THIS WINDOW
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 'var(--space-4)',
              listStyle: 'disc',
            }}
          >
            <li className="vela-body-sm" style={{ marginBottom: 'var(--space-1)' }}>
              You cannot access your wallet through Vela
            </li>
            <li className="vela-body-sm" style={{ marginBottom: 'var(--space-1)' }}>
              No new signals or trades will be generated
            </li>
            <li className="vela-body-sm">Your data has not yet been deleted</li>
          </ul>
        </div>

        <p className="vela-body-base" style={{ fontWeight: 600, marginBottom: 'var(--space-4)' }}>
          Want to come back?
        </p>

        {error && (
          <p
            className="vela-body-sm"
            role="alert"
            style={{
              color: 'var(--color-error)',
              marginBottom: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: 'var(--red-bg, #fef2f2)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-error)',
            }}
          >
            {error}
          </p>
        )}

        <button
          className="vela-btn vela-btn-primary"
          onClick={reactivate}
          disabled={reactivating}
          style={{ width: '100%', marginBottom: 'var(--space-3)' }}
        >
          {reactivating ? (
            <span
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <VelaLogo variant="mark" size={16} pulse />
              Reactivating...
            </span>
          ) : (
            'Reactivate my account'
          )}
        </button>

        <button
          className="vela-btn vela-btn-ghost"
          onClick={logout}
          style={{ width: '100%', color: 'var(--color-text-muted)' }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}
