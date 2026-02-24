import { useState, useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';
import { useAccountDelete } from '../hooks/useAccountDelete';
import { LoadingSpinner } from '../components/VelaComponents';
import type { TradingMode } from '../types';

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

function BalancePanel() {
  const { wallet, hasWallet, isTradingEnabled } = useTrading();

  // No wallet / trading not enabled — prompt user
  if (!isTradingEnabled || !hasWallet || !wallet) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <div
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--gray-200)',
            textAlign: 'center',
          }}
        >
          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
            Enable trading to see your balance
          </p>
          <p className="vela-body-sm vela-text-muted">
            Set your trading mode to Semi-auto or Full auto to create your wallet.
          </p>
        </div>
      </div>
    );
  }

  const balance = wallet.balance_usdc;
  const isTestnet = wallet.environment === 'testnet';

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <p
        className="vela-label-sm"
        style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-muted)' }}
      >
        YOUR TRADING BALANCE
      </p>

      {/* Big balance display */}
      <div
        style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--gray-200)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <p
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 28,
            fontWeight: 700,
            color: balance > 0 ? 'var(--green-dark)' : 'var(--color-text-primary)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          $
          {balance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, marginTop: 'var(--space-1)' }}
        >
          USDC {isTestnet && '· Testnet'}
        </p>
      </div>

      {/* Fund wallet CTA */}
      {isTestnet && (
        <>
          <a
            href="https://app.hyperliquid-testnet.xyz/drip"
            target="_blank"
            rel="noopener noreferrer"
            className="vela-btn vela-btn-primary vela-btn-sm"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'center',
              textDecoration: 'none',
              boxSizing: 'border-box',
            }}
          >
            Get test USDC
          </a>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ marginTop: 'var(--space-2)', textAlign: 'center' }}
          >
            Get free test tokens to try paper trading.
          </p>
        </>
      )}

      {/* Coming soon */}
      <div
        style={{
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--gray-200)',
        }}
      >
        <p
          className="vela-label-sm"
          style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
        >
          COMING SOON
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="vela-body-sm vela-text-muted">Deposit from card</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="vela-body-sm vela-text-muted">Withdraw to external wallet</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreasuryInfo() {
  const address = import.meta.env.VITE_SAFE_TREASURY_ADDRESS;
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        padding: 'var(--space-3)',
        backgroundColor: 'var(--gray-50)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--gray-200)',
      }}
    >
      <p
        className="vela-label-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
      >
        VELA TREASURY
      </p>
      <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-2)' }}>
        Fees are collected to a secure multi-signature wallet.
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'var(--color-text-primary)',
          }}
        >
          {truncateAddress(address)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={`https://arbiscan.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="vela-body-sm"
            style={{
              color: 'var(--color-action-primary)',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            View on Arbiscan
          </a>
        </div>
      </div>
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
          <button className="vela-btn vela-btn-secondary vela-btn-sm" onClick={openFeedbackForm}>
            Open feedback form
          </button>
        </div>

        {/* Treasury transparency */}
        <TreasuryInfo />
      </div>
    </div>
  );
}

const MODE_LABELS: Record<TradingMode, string> = {
  view_only: 'View only',
  semi_auto: 'Semi-auto',
  full_auto: 'Full auto',
};

const MODE_DESCRIPTIONS: Record<TradingMode, string> = {
  view_only: 'Signals only. No trade proposals or executions.',
  semi_auto: 'Vela proposes trades. You approve each one before execution.',
  full_auto: 'Vela executes trades automatically based on your signal preferences.',
};

function TradingPanel() {
  const { preferences, isTradingEnabled, updatePreferences, loading, circuitBreakers } =
    useTrading();

  const [saving, setSaving] = useState(false);
  const [positionSize, setPositionSize] = useState(
    preferences?.default_position_size_usd?.toString() ?? '100'
  );
  const [leverage, setLeverage] = useState(preferences?.max_leverage?.toString() ?? '1');
  const [stopLoss, setStopLoss] = useState(preferences?.stop_loss_pct?.toString() ?? '5');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Sync form state when preferences load
  useEffect(() => {
    if (preferences) {
      setPositionSize(preferences.default_position_size_usd.toString());
      setLeverage(preferences.max_leverage.toString());
      setStopLoss(preferences.stop_loss_pct.toString());
    }
  }, [preferences]);

  const handleModeChange = async (mode: TradingMode) => {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({ mode } as Record<string, unknown>);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({
        default_position_size_usd: Number(positionSize) || 100,
        max_leverage: Math.min(Math.max(Number(leverage) || 1, 1), 20),
        stop_loss_pct: Math.min(Math.max(Number(stopLoss) || 5, 1), 50),
      } as Record<string, unknown>);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <p className="vela-body-sm vela-text-muted">Loading trading settings...</p>
      </div>
    );
  }

  const currentMode = preferences?.mode ?? 'view_only';

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {/* Circuit breaker warning */}
      {circuitBreakers.length > 0 && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--color-status-sell-bg)',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--red-primary)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <p
            className="vela-body-sm"
            style={{ fontWeight: 600, color: 'var(--red-dark)', margin: 0 }}
          >
            Trading paused — circuit breaker active
          </p>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ marginTop: 'var(--space-1)', marginBottom: 0 }}
          >
            {circuitBreakers[0].trigger_type.replace(/_/g, ' ')}. Review your positions.
          </p>
        </div>
      )}

      {/* Trading mode selector */}
      <p
        className="vela-label-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
      >
        TRADING MODE
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {(['view_only', 'semi_auto', 'full_auto'] as TradingMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            disabled={saving}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: currentMode === mode ? 'var(--gray-100)' : 'transparent',
              border: currentMode === mode ? '2px solid var(--black)' : '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              cursor: saving ? 'wait' : 'pointer',
              textAlign: 'left',
              fontFamily: 'Inter, system-ui, sans-serif',
              width: '100%',
              boxShadow: currentMode === mode ? '2px 2px 0 var(--black)' : 'none',
            }}
          >
            {/* Radio indicator */}
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `2px solid ${currentMode === mode ? 'var(--black)' : 'var(--gray-300)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {currentMode === mode && (
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: 'var(--black)',
                  }}
                />
              )}
            </div>
            <div>
              <p className="vela-body-sm" style={{ fontWeight: 600, margin: 0 }}>
                {MODE_LABELS[mode]}
              </p>
              <p className="vela-body-sm vela-text-muted" style={{ margin: 0, marginTop: 2 }}>
                {MODE_DESCRIPTIONS[mode]}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Trading settings — only show if trading enabled */}
      {isTradingEnabled && (
        <>
          <p
            className="vela-label-sm"
            style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
          >
            POSITION SETTINGS
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {/* Position size */}
            <div>
              <label
                htmlFor="position-size"
                className="vela-body-sm"
                style={{ fontWeight: 500, display: 'block', marginBottom: 'var(--space-1)' }}
              >
                Default position size (USD)
              </label>
              <input
                id="position-size"
                type="number"
                value={positionSize}
                onChange={e => setPositionSize(e.target.value)}
                min={10}
                max={10000}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  border: '2px solid var(--gray-300)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
              <p
                className="vela-body-sm vela-text-muted"
                style={{ marginTop: 'var(--space-1)', marginBottom: 0 }}
              >
                Amount in USDC per trade
              </p>
            </div>

            {/* Max leverage */}
            <div>
              <label
                className="vela-body-sm"
                style={{ fontWeight: 500, display: 'block', marginBottom: 'var(--space-1)' }}
              >
                Max leverage: {leverage}x
              </label>
              <input
                type="range"
                value={leverage}
                onChange={e => setLeverage(e.target.value)}
                min={1}
                max={20}
                step={1}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="vela-body-sm vela-text-muted">1x</span>
                <span className="vela-body-sm vela-text-muted">20x</span>
              </div>
            </div>

            {/* Stop-loss */}
            <div>
              <label
                htmlFor="stop-loss"
                className="vela-body-sm"
                style={{ fontWeight: 500, display: 'block', marginBottom: 'var(--space-1)' }}
              >
                Stop-loss percentage
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  id="stop-loss"
                  type="number"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  min={1}
                  max={50}
                  style={{
                    width: 80,
                    padding: 'var(--space-2) var(--space-3)',
                    border: '2px solid var(--gray-300)',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 14,
                    textAlign: 'center',
                  }}
                />
                <span className="vela-body-sm">%</span>
              </div>
              <p
                className="vela-body-sm vela-text-muted"
                style={{ marginTop: 'var(--space-1)', marginBottom: 0 }}
              >
                Automatically close position if it drops below this threshold
              </p>
            </div>
          </div>

          <button
            className="vela-btn vela-btn-primary vela-btn-sm"
            onClick={handleSaveSettings}
            disabled={saving}
            style={{ width: '100%' }}
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </>
      )}

      {/* Status messages */}
      {error && (
        <p
          className="vela-body-sm"
          style={{ color: 'var(--color-error)', marginTop: 'var(--space-2)' }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="vela-body-sm"
          style={{ color: 'var(--green-dark)', marginTop: 'var(--space-2)' }}
        >
          Settings saved
        </p>
      )}
    </div>
  );
}

// ── Delete Account Flow ──────────────────────────────────────

function DeleteAccountFlow() {
  const { step, error, deletionScheduledAt, startDelete, proceedToConfirm, confirmDelete, cancel } =
    useAccountDelete();
  const [confirmInput, setConfirmInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the confirm input when entering confirm step
  useEffect(() => {
    if (step === 'confirm') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step]);

  // Idle — show the trigger button
  if (step === 'idle') {
    return (
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
          Deactivate your account with a 30-day window to change your mind.
        </p>
        <button
          className="vela-btn vela-btn-sm"
          onClick={startDelete}
          style={{
            backgroundColor: 'var(--color-error)',
            color: 'var(--white)',
            border: '2px solid var(--black)',
          }}
        >
          Delete my account
        </button>
      </div>
    );
  }

  // Warning — explain consequences
  if (step === 'warning') {
    return (
      <div
        style={{
          borderTop: '1px solid var(--gray-200)',
          paddingTop: 'var(--space-4)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--red-bg, #fef2f2)',
            border: '2px solid var(--color-error)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <p
            className="vela-label-sm"
            style={{ color: 'var(--color-error)', marginBottom: 'var(--space-3)' }}
          >
            DANGER ZONE
          </p>

          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            If you delete your account:
          </p>

          <ul
            style={{
              margin: 0,
              paddingLeft: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
              listStyle: 'disc',
            }}
          >
            <li className="vela-body-sm" style={{ marginBottom: 'var(--space-1)' }}>
              You will lose access to your trading wallet through Vela
            </li>
            <li className="vela-body-sm" style={{ marginBottom: 'var(--space-1)' }}>
              All pending trades will be cancelled
            </li>
            <li className="vela-body-sm" style={{ marginBottom: 'var(--space-1)' }}>
              Your signal history and trade record will be deleted after 30 days
            </li>
            <li className="vela-body-sm">
              You will <strong>not</strong> be able to access your wallet through Vela after
              deletion
            </li>
          </ul>

          <p
            className="vela-body-sm vela-text-secondary"
            style={{ marginBottom: 'var(--space-4)' }}
          >
            You have 30 days to change your mind and reactivate. After that, remaining funds will be
            swept to treasury and your data permanently deleted.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button className="vela-btn vela-btn-ghost vela-btn-sm" onClick={cancel}>
              Cancel
            </button>
            <button
              className="vela-btn vela-btn-sm"
              onClick={proceedToConfirm}
              style={{
                backgroundColor: 'var(--color-error)',
                color: 'var(--white)',
                border: '2px solid var(--black)',
              }}
            >
              I understand, continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Confirm — type DELETE
  if (step === 'confirm') {
    const canConfirm = confirmInput === 'DELETE';
    return (
      <div
        style={{
          borderTop: '1px solid var(--gray-200)',
          paddingTop: 'var(--space-4)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--red-bg, #fef2f2)',
            border: '2px solid var(--color-error)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
            Type DELETE to confirm
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            This will deactivate your account immediately. You will be logged out.
          </p>

          <input
            ref={inputRef}
            type="text"
            value={confirmInput}
            onChange={e => setConfirmInput(e.target.value)}
            placeholder="Type DELETE"
            aria-label="Type DELETE to confirm account deletion"
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 14,
              fontWeight: 600,
              border: '2px solid var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--white)',
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-4)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button
              className="vela-btn vela-btn-ghost vela-btn-sm"
              onClick={() => {
                setConfirmInput('');
                cancel();
              }}
            >
              Cancel
            </button>
            <button
              className="vela-btn vela-btn-sm"
              onClick={confirmDelete}
              disabled={!canConfirm}
              style={{
                backgroundColor: canConfirm ? 'var(--color-error)' : 'var(--gray-300)',
                color: 'var(--white)',
                border: '2px solid var(--black)',
                opacity: canConfirm ? 1 : 0.5,
                cursor: canConfirm ? 'pointer' : 'not-allowed',
              }}
            >
              Delete my account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Deleting — loading state
  if (step === 'deleting') {
    return (
      <div
        style={{
          borderTop: '1px solid var(--gray-200)',
          paddingTop: 'var(--space-4)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-6)',
            textAlign: 'center',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <LoadingSpinner size={24} />
          <p className="vela-body-sm vela-text-muted" style={{ marginTop: 'var(--space-3)' }}>
            Deleting your account...
          </p>
        </div>
      </div>
    );
  }

  // Done — success + auto-logout
  if (step === 'done') {
    const deletionDate = deletionScheduledAt
      ? new Date(deletionScheduledAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '30 days from now';

    return (
      <div
        style={{
          borderTop: '1px solid var(--gray-200)',
          paddingTop: 'var(--space-4)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-6)',
            textAlign: 'center',
            border: '2px solid var(--green-primary, #00D084)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--green-bg, #f0fdf4)',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: 'var(--green-primary, #00D084)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--space-3)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 10l3.5 3.5L15 7"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="vela-body-base" style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            Account deactivated
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-1)' }}>
            You&apos;ll receive a confirmation email shortly.
          </p>
          <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            You have until <strong>{deletionDate}</strong> to reactivate.
          </p>
          <p className="vela-body-sm vela-text-muted">Logging you out...</p>
        </div>
      </div>
    );
  }

  // Error — retry or cancel
  return (
    <div
      style={{
        borderTop: '1px solid var(--gray-200)',
        paddingTop: 'var(--space-4)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-4)',
          border: '2px solid var(--color-error)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--red-bg, #fef2f2)',
        }}
      >
        <p className="vela-body-sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
          Something went wrong
        </p>
        <p
          className="vela-body-sm vela-text-muted"
          role="alert"
          style={{ marginBottom: 'var(--space-4)' }}
        >
          {error || 'An unexpected error occurred. Please try again.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button className="vela-btn vela-btn-ghost vela-btn-sm" onClick={cancel}>
            Cancel
          </button>
          <button
            className="vela-btn vela-btn-sm"
            onClick={confirmDelete}
            style={{
              backgroundColor: 'var(--color-error)',
              color: 'var(--white)',
              border: '2px solid var(--black)',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Account() {
  const { isAuthenticated, user, logout, login } = useAuthContext();
  const { preferences, wallet, isTradingEnabled } = useTrading();
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
    setExpandedSection(prev => (prev === section ? null : section));
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

            {/* Delete account — multi-step flow */}
            <DeleteAccountFlow />
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
          label="Balance"
          value={
            wallet
              ? `$${wallet.balance_usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC`
              : '—'
          }
          onClick={() => toggleSection('balance')}
          expanded={expandedSection === 'balance'}
        />
        {expandedSection === 'balance' && (
          <div style={{ borderBottom: '1px solid var(--gray-200)' }}>
            <BalancePanel />
          </div>
        )}

        <SettingsItem
          label="Trading"
          value={isTradingEnabled ? MODE_LABELS[preferences?.mode ?? 'view_only'] : 'View only'}
          onClick={() => toggleSection('trading')}
          expanded={expandedSection === 'trading'}
        />
        {expandedSection === 'trading' && (
          <div style={{ borderBottom: '1px solid var(--gray-200)' }}>
            <TradingPanel />
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
