import { useState, useEffect } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

declare global {
  interface Window {
    Tally?: {
      loadEmbeds: () => void;
      openPopup: (formId: string, options?: Record<string, unknown>) => void;
      closePopup: (formId: string) => void;
    };
  }
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        flexShrink: 0,
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 150ms ease-out',
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="var(--gray-400)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SettingsItemProps {
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
  expanded?: boolean;
}

function SettingsItem({ label, value, onClick, danger, expanded }: SettingsItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: 'var(--space-4)',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--gray-200)',
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <span
        className="vela-body-sm"
        style={{
          fontWeight: 500,
          color: danger ? 'var(--color-error)' : 'var(--color-text-primary)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {value && (
          <span className="vela-body-sm vela-text-muted" style={{ fontSize: 13 }}>
            {value}
          </span>
        )}
        {onClick && !danger && <ExpandIcon expanded={!!expanded} />}
      </div>
    </button>
  );
}

function WalletPanel({ address }: { address?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <p
        className="vela-label-sm"
        style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-muted)' }}
      >
        WALLET ADDRESS
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--gray-200)',
        }}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {address ?? 'Wallet is being created...'}
        </span>
        {address && (
          <button
            onClick={handleCopy}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 'var(--space-1)',
              color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <p className="vela-body-sm vela-text-muted" style={{ marginTop: 'var(--space-2)' }}>
        This is your embedded Ethereum wallet, created and secured by Vela.
      </p>
    </div>
  );
}

function SupportPanel() {
  const openFeedbackForm = () => {
    if (window.Tally) {
      window.Tally.openPopup('MebPN0', { layout: 'modal' });
    } else {
      window.open('https://tally.so/r/MebPN0', '_blank');
    }
  };

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        {/* FAQ */}
        <div>
          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
            FAQ
          </p>
          <p className="vela-body-sm vela-text-muted">
            Common questions about signals, trading, and your account — coming soon.
          </p>
        </div>

        {/* Email support */}
        <div>
          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
            Email support
          </p>
          <a
            href="mailto:support@vela.exchange"
            className="vela-body-sm"
            style={{ color: 'var(--color-action-primary)', textDecoration: 'none' }}
          >
            support@vela.exchange
          </a>
        </div>

        {/* Feedback / bug report */}
        <div>
          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            Send feedback or report a bug
          </p>
          <button
            className="vela-btn vela-btn-secondary vela-btn-sm"
            onClick={openFeedbackForm}
          >
            Open feedback form
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Account() {
  const { isAuthenticated, user, logout, login } = useAuthContext();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Load Tally widget script for feedback popup
  useEffect(() => {
    if (document.querySelector('script[src*="tally.so"]')) return;

    const script = document.createElement('script');
    script.src = 'https://tally.so/widgets/embed.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  if (!isAuthenticated) {
    return (
      <div
        style={{
          padding: 'var(--space-4)',
          paddingTop: 80,
          paddingBottom: 80,
          maxWidth: 600,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <div className="vela-card vela-card-lavender" style={{ padding: 'var(--space-8)' }}>
          <h2 className="vela-heading-lg" style={{ marginBottom: 'var(--space-2)' }}>
            Log in to your account
          </h2>
          <p
            className="vela-body-base vela-text-secondary"
            style={{ marginBottom: 'var(--space-6)' }}
          >
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
    <div
      style={{
        padding: 'var(--space-4)',
        paddingTop: 'var(--space-6)',
        paddingBottom: 80,
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Profile header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: 'var(--vela-purple)',
            border: '3px solid var(--black)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--white)',
            fontFamily: 'Space Grotesk, system-ui, sans-serif',
            fontWeight: 700,
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          {(user?.email?.[0] ?? 'U').toUpperCase()}
        </div>
        <div>
          <p className="vela-body-base" style={{ fontWeight: 600 }}>
            {user?.email ?? 'Connected user'}
          </p>
          <p className="vela-body-sm vela-text-muted">Free tier</p>
        </div>
      </div>

      {/* Settings list */}
      <div
        className="vela-card"
        style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-6)' }}
      >
        <SettingsItem
          label="Personal info"
          value={user?.email ?? '—'}
          onClick={() => toggleSection('personal')}
          expanded={expandedSection === 'personal'}
        />
        {expandedSection === 'personal' && (
          <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--gray-200)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--space-6)',
              }}
            >
              <span className="vela-body-sm vela-text-muted">Email</span>
              <span className="vela-body-sm" style={{ fontWeight: 600 }}>
                {user?.email ?? '—'}
              </span>
            </div>

            {/* Delete account — tucked under personal info */}
            <div
              style={{
                borderTop: '1px solid var(--gray-200)',
                paddingTop: 'var(--space-4)',
              }}
            >
              <p
                className="vela-body-sm"
                style={{ fontWeight: 600, color: 'var(--color-error)', marginBottom: 'var(--space-1)' }}
              >
                Delete account
              </p>
              <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                Permanently delete your account and all associated data.
              </p>
              <button
                className="vela-btn vela-btn-sm"
                style={{
                  backgroundColor: 'var(--color-error)',
                  color: 'var(--white)',
                  border: '2px solid var(--black)',
                }}
              >
                Delete my account
              </button>
            </div>
          </div>
        )}

        <SettingsItem
          label="Connected wallet"
          value={user?.walletAddress ? truncateAddress(user.walletAddress) : '—'}
          onClick={() => toggleSection('wallet')}
          expanded={expandedSection === 'wallet'}
        />
        {expandedSection === 'wallet' && (
          <div style={{ borderBottom: '1px solid var(--gray-200)' }}>
            <WalletPanel address={user?.walletAddress} />
          </div>
        )}

        <SettingsItem
          label="Notifications"
          value="Email"
          onClick={() => toggleSection('notifications')}
          expanded={expandedSection === 'notifications'}
        />
        {expandedSection === 'notifications' && (
          <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--gray-200)' }}>
            <p className="vela-body-sm vela-text-muted">
              Notification preferences coming soon. You currently receive signal alerts via email.
            </p>
          </div>
        )}

        <SettingsItem
          label="Support & feedback"
          onClick={() => toggleSection('support')}
          expanded={expandedSection === 'support'}
        />
        {expandedSection === 'support' && (
          <div style={{ borderBottom: '1px solid var(--gray-200)' }}>
            <SupportPanel />
          </div>
        )}
      </div>

      {/* Log out */}
      <button
        className="vela-btn vela-btn-ghost"
        onClick={logout}
        style={{ width: '100%', color: 'var(--color-error)' }}
      >
        Log out
      </button>
    </div>
  );
}
