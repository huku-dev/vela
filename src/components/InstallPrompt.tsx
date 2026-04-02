import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vela_install_dismissed';
const MIN_ACCOUNT_AGE_DAYS = 3; // Only show after user has been registered for 3+ days

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type PlatformInfo = {
  os: 'ios' | 'android';
  browser: string;
};

function getMobilePlatform(): PlatformInfo | null {
  const ua = navigator.userAgent;

  if (/iPhone|iPad|iPod/.test(ua)) {
    if (/CriOS/.test(ua)) return { os: 'ios', browser: 'Chrome' };
    if (/FxiOS/.test(ua)) return { os: 'ios', browser: 'Firefox' };
    if (/Safari/.test(ua)) return { os: 'ios', browser: 'Safari' };
    return { os: 'ios', browser: 'your browser' };
  }

  if (/Android/.test(ua)) {
    if (/Firefox/.test(ua)) return { os: 'android', browser: 'Firefox' };
    if (/SamsungBrowser/.test(ua)) return { os: 'android', browser: 'Samsung Internet' };
    if (/OPR/.test(ua)) return { os: 'android', browser: 'Opera' };
    if (/Edge/.test(ua)) return { os: 'android', browser: 'Edge' };
    if (/Chrome/.test(ua)) return { os: 'android', browser: 'Chrome' };
    return { os: 'android', browser: 'your browser' };
  }

  return null;
}

/**
 * Check if the user's account is old enough to show the install prompt.
 * Reads the profile created_at from localStorage (set during auth flow).
 */
function isAccountOldEnough(): boolean {
  const createdAt = localStorage.getItem('vela_account_created_at');
  if (!createdAt) return false; // No data = don't show (new user or not logged in)
  const age = Date.now() - new Date(createdAt).getTime();
  return age >= MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Bottom-sheet PWA install prompt. Covers ~70% of the screen from the bottom,
 * with the page dimmed behind it. Shows platform- and browser-specific
 * instructions with visual mockups. Only appears for established users on mobile.
 */
export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localStorage.getItem(STORAGE_KEY)) return;
      if (isStandalone()) return;
      if (!localStorage.getItem('vela_cookie_consent')) return;

      // Debug: ?pwa=ios or ?pwa=android to force-show on desktop
      const debugOs = new URLSearchParams(window.location.search).get('pwa') as 'ios' | 'android' | null;
      const isDebug = !!debugOs;

      // Only show to users with accounts older than MIN_ACCOUNT_AGE_DAYS
      if (!isDebug && !isAccountOldEnough()) return;

      const detected = getMobilePlatform() || (debugOs ? { os: debugOs, browser: debugOs === 'ios' ? 'Safari' : 'Chrome' } : null);
      if (detected) {
        setPlatformInfo(detected);
        setVisible(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible || !platformInfo) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  };

  const { os, browser } = platformInfo;

  return (
    <>
      {/* Backdrop - dimmed page content */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9997,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
        }}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Vela to your home screen"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9998,
          backgroundColor: '#111111',
          borderRadius: '20px 20px 0 0',
          padding: '12px 20px 32px',
          maxHeight: '78vh',
          overflowY: 'auto',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
            }}
          />
        </div>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 30,
            height: 30,
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          ✕
        </button>

        {/* Copy */}
        <p
          style={{
            fontSize: 15,
            color: 'rgba(255, 255, 255, 0.5)',
            margin: '8px 0 4px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          For a better mobile experience,
        </p>
        <h2
          style={{
            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
            fontSize: 20,
            fontWeight: 700,
            color: '#ffffff',
            margin: '0 0 4px',
            textAlign: 'center',
          }}
        >
          add Vela to your home screen
        </h2>
        <p
          style={{
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.35)',
            margin: '0 0 24px',
            textAlign: 'center',
          }}
        >
          as an app from {browser}.
        </p>

        {/* Steps */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxWidth: 340,
            margin: '0 auto',
          }}
        >
          {os === 'ios' ? (
            <>
              <StepCard
                number={1}
                text={<>Tap the <strong>share icon</strong> in {browser}&apos;s toolbar</>}
              >
                <BrowserMockup highlight="share" />
              </StepCard>

              <StepCard
                number={2}
                text={<>Choose <strong>Add to Home Screen</strong> from the options</>}
              >
                <MenuItemMockup
                  icon={<PlusSquareIcon />}
                  label="Add to Home Screen"
                />
              </StepCard>
            </>
          ) : (
            <>
              <StepCard
                number={1}
                text={<>Tap the <strong>menu icon</strong> in {browser}</>}
              >
                <BrowserMockup highlight="menu" />
              </StepCard>

              <StepCard
                number={2}
                text={<>Choose <strong>Add to Home Screen</strong> from the options</>}
              >
                <MenuItemMockup
                  icon={<PhoneIcon />}
                  label="Add to Home Screen"
                />
              </StepCard>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Sub-components ────────────────────────────────────── */

function StepCard({
  number,
  text,
  children,
}: {
  number: number;
  text: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: '#0fe68c',
            color: '#0a0a0a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {number}
        </span>
        <span
          style={{
            fontSize: 13,
            color: 'rgba(255, 255, 255, 0.85)',
            lineHeight: 1.4,
          }}
        >
          {text}
        </span>
      </div>
      {children}
    </div>
  );
}

function BrowserMockup({ highlight }: { highlight: 'share' | 'menu' }) {
  return (
    <div style={{ position: 'relative' }}>
      {/* Address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.07)',
          borderRadius: 8,
          padding: '7px 12px',
          marginBottom: 6,
        }}
      >
        <LockIcon />
        <span
          style={{
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.45)',
            marginLeft: 6,
          }}
        >
          app.getvela.xyz
        </span>
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: highlight === 'share' ? 'space-around' : 'flex-end',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: 8,
          padding: '6px 12px',
          gap: 6,
        }}
      >
        {highlight === 'share' ? (
          <>
            <ToolbarIcon>‹</ToolbarIcon>
            <ToolbarIcon>›</ToolbarIcon>
            <ToolbarIcon highlight><ShareIcon /></ToolbarIcon>
            <ToolbarIcon>☰</ToolbarIcon>
            <ToolbarIcon>⊞</ToolbarIcon>
          </>
        ) : (
          <>
            <ToolbarIcon>⟳</ToolbarIcon>
            <div style={{ flex: 1 }} />
            <ToolbarIcon highlight>⋮</ToolbarIcon>
          </>
        )}
      </div>

      {/* Arrow from highlighted icon to address bar */}
      <div
        style={{
          position: 'absolute',
          ...(highlight === 'share'
            ? { left: '50%', transform: 'translateX(-50%)' }
            : { right: 20 }),
          top: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <svg width="2" height="14" style={{ opacity: 0.35 }}>
          <line x1="1" y1="0" x2="1" y2="14" stroke="#0fe68c" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        <svg width="8" height="6" viewBox="0 0 10 8" style={{ opacity: 0.35, marginTop: -1 }}>
          <polygon points="5,8 0,0 10,0" fill="#0fe68c" />
        </svg>
      </div>
    </div>
  );
}

function ToolbarIcon({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          color: highlight ? '#0fe68c' : 'rgba(255, 255, 255, 0.25)',
          backgroundColor: highlight ? 'rgba(15, 230, 140, 0.1)' : 'transparent',
          border: highlight ? '1.5px solid rgba(15, 230, 140, 0.25)' : '1.5px solid transparent',
        }}
      >
        {children}
      </div>
      {highlight && (
        <div
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#0fe68c',
            boxShadow: '0 0 6px rgba(15, 230, 140, 0.5)',
          }}
        />
      )}
    </div>
  );
}

function MenuItemMockup({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderRadius: 8,
        padding: '9px 12px',
      }}
    >
      <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: 16 }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.5)',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'rgba(15, 230, 140, 0.6)',
          fontWeight: 600,
        }}
      >
        ← this one
      </span>
    </div>
  );
}

/* ─── Icons ─────────────────────────────────────────────── */

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function PlusSquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
