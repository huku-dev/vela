import { useState } from 'react';

interface UpgradeNudgeBannerProps {
  onUpgrade: () => void;
}

/**
 * Dismissible banner shown to free-tier users on the Home page.
 * Encourages upgrade to unlock trading features.
 *
 * Show conditions:
 *   - User is authenticated + onboarded
 *   - Tier is 'free'
 *   - Not dismissed this session (sessionStorage)
 *
 * Dismissal persists for the browser session only — reappears on next visit.
 */
export default function UpgradeNudgeBanner({ onUpgrade }: UpgradeNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('vela_upgrade_dismissed') === 'true'
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem('vela_upgrade_dismissed', 'true');
    setDismissed(true);
  };

  return (
    <div
      style={{
        border: '3px solid var(--vela-ink)',
        borderLeft: '5px solid var(--green-primary)',
        backgroundColor: 'var(--color-bg-primary)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-4)',
        position: 'relative',
      }}
    >
      <p
        style={{
          fontWeight: 700,
          fontSize: '0.85rem',
          margin: 0,
          paddingRight: 'var(--space-6)',
        }}
      >
        Upgrade to start trading
      </p>
      <p className="vela-body-sm vela-text-muted" style={{ margin: 'var(--space-1) 0 0' }}>
        Free plan is view-only. Unlock trading, auto-mode, and more.
      </p>
      <button
        onClick={onUpgrade}
        style={{
          marginTop: 'var(--space-2)',
          padding: '6px 16px',
          fontSize: '0.78rem',
          fontWeight: 700,
          fontFamily: 'var(--type-heading-base-font)',
          backgroundColor: 'var(--green-primary)',
          color: 'var(--vela-ink)',
          border: '2px solid var(--vela-ink)',
          cursor: 'pointer',
        }}
      >
        See Plans
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss upgrade banner"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontSize: '1.1rem',
          lineHeight: 1,
          padding: '4px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
