import { useAuthContext } from '../contexts/AuthContext';

export default function Account() {
  const { isAuthenticated, user, logout, login } = useAuthContext();

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 'var(--space-4)', paddingTop: 80, paddingBottom: 80, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        <div className="vela-card vela-card-lavender" style={{ padding: 'var(--space-8)' }}>
          <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
            Log in to your account
          </h2>
          <p className="vela-body-base vela-text-secondary" style={{ marginBottom: 'var(--space-6)' }}>
            Sign in to manage your preferences and track your portfolio.
          </p>
          <button className="vela-btn vela-btn-primary" onClick={login}>
            Log in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)', paddingTop: 'var(--space-6)', paddingBottom: 80, maxWidth: 600, margin: '0 auto' }}>
      <div className="vela-stack vela-stack-sm" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="vela-heading-xl">Account</h1>
        <p className="vela-body-base vela-text-secondary">Manage your profile and settings</p>
      </div>

      {/* Profile card */}
      <div className="vela-card vela-card-lavender" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            backgroundColor: '#8b5cf6', border: '3px solid #000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 20,
          }}>
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </div>
          <div>
            <p className="vela-body-base" style={{ fontWeight: 600 }}>
              {user?.email ?? 'Connected user'}
            </p>
            <p className="vela-label-sm vela-text-muted">
              Free tier
            </p>
          </div>
        </div>
      </div>

      {/* Subscription card */}
      <div className="vela-card vela-card-mint" style={{ marginBottom: 'var(--space-4)' }}>
        <p className="vela-label-sm" style={{ marginBottom: 'var(--space-2)' }}>SUBSCRIPTION</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="vela-body-base" style={{ fontWeight: 600 }}>Free</p>
            <p className="vela-body-sm vela-text-secondary">Basic signal access</p>
          </div>
          <span className="vela-badge vela-badge-neutral">Active</span>
        </div>
      </div>

      {/* Connected account card */}
      <div className="vela-card" style={{ marginBottom: 'var(--space-8)' }}>
        <p className="vela-label-sm" style={{ marginBottom: 'var(--space-3)' }}>CONNECTED ACCOUNT</p>
        {user?.email && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <p className="vela-body-sm">Email</p>
            <p className="vela-body-sm" style={{ fontWeight: 600 }}>{user.email}</p>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="vela-body-sm">Privy ID</p>
          <p className="vela-body-sm vela-text-muted" style={{ fontFamily: 'JetBrains Mono', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.privyDid ?? '—'}
          </p>
        </div>
      </div>

      {/* Log out */}
      <button
        className="vela-btn vela-btn-ghost"
        onClick={logout}
        style={{ width: '100%', color: 'var(--color-error, #ef4444)' }}
      >
        Log out
      </button>
    </div>
  );
}
