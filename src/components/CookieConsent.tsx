import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vela_cookie_consent';

/**
 * Detect if the user is likely in the EU/EEA based on their timezone.
 * Covers all EU member states + EEA (Iceland, Norway, Liechtenstein) + UK.
 * No API call needed — uses the browser's Intl API.
 */
function isLikelyEU(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return false;
    // All EU/EEA timezones are under Europe/ or Atlantic/ (Iceland, Canaries, Azores)
    if (tz.startsWith('Europe/')) return true;
    // Iceland (EEA)
    if (tz === 'Atlantic/Reykjavik') return true;
    // Canary Islands (Spain/EU), Azores + Madeira (Portugal/EU)
    if (tz === 'Atlantic/Canary' || tz === 'Atlantic/Azores' || tz === 'Atlantic/Madeira')
      return true;
    return false;
  } catch {
    // If timezone detection fails, don't show banner (err on side of less intrusion)
    return false;
  }
}

/**
 * Minimal cookie consent banner. Shows once (EU/EEA only), persists acceptance
 * in localStorage. Vela only uses essential cookies (auth via Privy), so no
 * "decline" is needed — GDPR allows essential cookies without consent, but
 * transparency is good practice for EU users.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay to avoid layout shift during page load
    const timer = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY) && isLikelyEU()) {
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
