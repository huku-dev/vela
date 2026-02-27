import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vela_cookie_consent';

/**
 * Minimal cookie consent banner. Shows once, persists acceptance in localStorage.
 * Vela only uses essential cookies (auth via Privy), so no "decline" is needed —
 * GDPR allows essential cookies without consent, but transparency is good practice.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay to avoid layout shift during page load
    const timer = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 72, // Above the bottom nav bar (56px + spacing)
        left: 'var(--space-4)',
        right: 'var(--space-4)',
        zIndex: 900, // Below modals (9999) but above content
        maxWidth: 440,
        margin: '0 auto',
        backgroundColor: 'var(--color-bg-surface, #FFFBF5)',
        border: '3px solid var(--black, #0A0A0A)',
        borderRadius: 'var(--radius-md, 12px)',
        padding: 'var(--space-4)',
        boxShadow: '4px 4px 0 var(--black, #0A0A0A)',
      }}
    >
      <p className="vela-body-sm" style={{ margin: 0, marginBottom: 'var(--space-3)' }}>
        Vela uses essential cookies for authentication and session management.{' '}
        <a
          href="/privacy"
          style={{
            color: 'var(--color-text-secondary)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          Privacy Policy
        </a>
      </p>
      <button
        className="vela-btn vela-btn-primary"
        onClick={handleAccept}
        style={{ width: '100%', padding: 'var(--space-2) var(--space-4)' }}
      >
        Got it
      </button>
    </div>
  );
}
