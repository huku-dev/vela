import { useState, useCallback, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthContext } from '../contexts/AuthContext';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import type { UserWallet } from '../types';

// ── Types ──────────────────────────────────────────────────────────────

interface DepositSheetProps {
  wallet: UserWallet;
  onClose: () => void;
  /** Called after a successful balance refresh */
  onRefresh?: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// ── Component ──────────────────────────────────────────────────────────

/**
 * DepositSheet — Shows deposit instructions with wallet address + QR code.
 *
 * Two deposit methods (tabbed):
 *   1. Transfer USDC — show wallet address, QR code, and instructions
 *   2. Fund with card — coming soon (Stripe onramp requires Arbitrum support)
 *
 * Uses bottom sheet pattern (like TradeConfirmationSheet).
 */
export default function DepositSheet({ wallet, onClose, onRefresh }: DepositSheetProps) {
  useBodyScrollLock();
  const { getToken } = useAuthContext();
  const [activeTab, setActiveTab] = useState<'transfer' | 'card'>('transfer');
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{
    balance?: number;
    depositDetected?: number | null;
  } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const address = wallet.master_address;

  // ── Copy address ──
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  // ── Refresh balance ──
  const handleRefreshBalance = useCallback(async () => {
    setRefreshing(true);
    setRefreshResult(null);
    setRefreshError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated — please log in again');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/refresh-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to refresh balance');
      }

      setRefreshResult({
        balance: data.balance,
        depositDetected: data.deposit_detected,
      });

      onRefresh?.();
    } catch (err) {
      console.error('[DepositSheet] Refresh error:', err);
      setRefreshError(err instanceof Error ? err.message : 'Failed to refresh balance');
    } finally {
      setRefreshing(false);
    }
  }, [getToken, onRefresh]);

  // ── Auto-poll every 2 minutes while sheet is open ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(handleRefreshBalance, 120_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [handleRefreshBalance]);

  // ── Time since last sync ──
  const lastSynced = wallet.balance_last_synced_at
    ? getTimeSince(wallet.balance_last_synced_at)
    : null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deposit USDC"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-md)',
          border: '3px solid var(--black)',
          padding: 'var(--space-5)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
          maxHeight: '90vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch' as const,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-4)',
          }}
        >
          <h3 className="vela-heading-base" style={{ margin: 0 }}>
            Deposit USDC
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: 'var(--space-1)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <TabButton
            label="Transfer USDC"
            active={activeTab === 'transfer'}
            onClick={() => setActiveTab('transfer')}
          />
          <TabButton
            label="Fund with card"
            active={activeTab === 'card'}
            onClick={() => setActiveTab('card')}
          />
        </div>

        {/* Tab content */}
        {activeTab === 'transfer' && (
          <TransferTab address={address} copied={copied} onCopy={handleCopy} />
        )}

        {activeTab === 'card' && <CardTab />}

        {/* Action section */}
        <div
          style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--gray-200)',
          }}
        >
          {/* Deposit detected feedback */}
          {refreshResult?.depositDetected && refreshResult.depositDetected > 0 && (
            <div
              style={{
                marginBottom: 'var(--space-3)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--green-light, #F0FFF4)',
                border: '2px solid var(--green-primary)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <p className="vela-body-sm" style={{ margin: 0, fontWeight: 600 }}>
                Deposit detected: +${refreshResult.depositDetected.toFixed(2)} USDC
              </p>
              <p
                className="vela-body-sm vela-text-muted"
                style={{ margin: 0, marginTop: 'var(--space-1)', fontSize: '0.75rem' }}
              >
                New balance: ${refreshResult.balance?.toFixed(2) ?? '—'}
              </p>
            </div>
          )}

          {/* Primary action: "I've sent the USDC" — triggers refresh + closes */}
          <button
            className="vela-btn vela-btn-primary"
            onClick={() => {
              handleRefreshBalance();
              onClose();
            }}
            style={{ width: '100%', marginBottom: 'var(--space-2)' }}
          >
            I&apos;ve sent the USDC
          </button>

          <p
            className="vela-body-sm vela-text-muted"
            style={{
              textAlign: 'center',
              margin: 0,
              marginBottom: 'var(--space-2)',
              fontSize: '0.7rem',
            }}
          >
            We&apos;ll check for your deposit automatically. It may take a few minutes to appear.
          </p>

          {/* Secondary: manual check balance */}
          <button
            onClick={handleRefreshBalance}
            disabled={refreshing}
            style={{
              display: 'block',
              margin: '0 auto',
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: '0.75rem',
              cursor: refreshing ? 'default' : 'pointer',
              textDecoration: 'underline',
              padding: 'var(--space-1)',
            }}
          >
            {refreshing ? 'Checking...' : 'Check balance now'}
          </button>

          {refreshResult && !refreshResult.depositDetected && (
            <p
              className="vela-body-sm vela-text-muted"
              style={{
                textAlign: 'center',
                marginTop: 'var(--space-2)',
                marginBottom: 0,
                fontSize: '0.75rem',
              }}
            >
              Balance: ${refreshResult.balance?.toFixed(2) ?? '—'} · No new deposits detected
            </p>
          )}

          {/* Error feedback */}
          {refreshError && (
            <p
              className="vela-body-sm"
              style={{
                textAlign: 'center',
                marginTop: 'var(--space-2)',
                marginBottom: 0,
                fontSize: '0.75rem',
                color: 'var(--red-primary)',
              }}
            >
              {refreshError}
            </p>
          )}

          {lastSynced && (
            <p
              className="vela-body-sm vela-text-muted"
              style={{
                textAlign: 'center',
                marginTop: 'var(--space-2)',
                marginBottom: 0,
                fontSize: '0.7rem',
              }}
            >
              Last synced: {lastSynced}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab Button ─────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 'var(--space-2) var(--space-3)',
        border: `2px solid ${active ? 'var(--black)' : 'var(--gray-200)'}`,
        borderRadius: 'var(--radius-sm)',
        backgroundColor: active ? 'var(--black)' : 'transparent',
        color: active ? 'var(--color-bg-surface)' : 'var(--color-text-primary)',
        fontWeight: 600,
        fontSize: '0.85rem',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

// ── Network Option ────────────────────────────────────────────────────

function NetworkOption({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 'var(--space-2) var(--space-3)',
        border: `2px solid ${active ? 'var(--black)' : 'var(--gray-200)'}`,
        borderRadius: 'var(--radius-sm)',
        backgroundColor: active ? 'var(--gray-50)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
    >
      <span
        style={{
          display: 'block',
          fontWeight: 600,
          fontSize: '0.85rem',
          color: 'var(--color-text-primary)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          marginTop: 2,
        }}
      >
        {detail}
      </span>
    </button>
  );
}

// ── Transfer Tab ───────────────────────────────────────────────────────

function TransferTab({
  address,
  copied,
  onCopy,
}: {
  address: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const [selectedNetwork, setSelectedNetwork] = useState<'arbitrum' | 'hyperliquid'>('arbitrum');
  const shortAddress = `${address.slice(0, 8)}...${address.slice(-6)}`;

  return (
    <>
      {/* QR Code */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: '#FFFFFF',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--gray-200)',
          }}
        >
          <QRCodeSVG value={address} size={120} level="M" bgColor="#FFFFFF" fgColor="#0A0A0A" />
        </div>
      </div>

      {/* Address display + copy */}
      <div
        style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-sm)',
          border: '2px solid var(--gray-200)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <p
          className="vela-label-sm"
          style={{
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
            marginTop: 0,
          }}
        >
          YOUR DEPOSIT ADDRESS
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
              fontFamily: 'var(--type-mono-base-font)',
              fontSize: '0.8rem',
              color: 'var(--color-text-primary)',
              wordBreak: 'break-all',
            }}
            title={address}
          >
            {shortAddress}
          </span>
          <button
            className="vela-btn vela-btn-ghost vela-btn-sm"
            onClick={onCopy}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Network selector */}
      <p
        className="vela-label-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)', marginTop: 0 }}
      >
        SELECT NETWORK
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <NetworkOption
          label="Arbitrum"
          detail="USDC transfer · 5-10 min"
          active={selectedNetwork === 'arbitrum'}
          onClick={() => setSelectedNetwork('arbitrum')}
        />
        <NetworkOption
          label="Hyperliquid"
          detail="usdSend · instant"
          active={selectedNetwork === 'hyperliquid'}
          onClick={() => setSelectedNetwork('hyperliquid')}
        />
      </div>

      {/* Warning */}
      <div
        style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--yellow-light, #FFFDE7)',
          border: '2px solid var(--yellow-primary, #FFD700)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <p
          className="vela-body-sm"
          style={{
            margin: 0,
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          {selectedNetwork === 'arbitrum'
            ? 'Only send USDC on Arbitrum. Other tokens or chains sent to this address will not appear in your balance.'
            : 'Only send via Hyperliquid usdSend. Regular token transfers on other networks will not appear in your balance.'}
        </p>
      </div>

      {/* Other chains note */}
      <p
        className="vela-body-sm vela-text-muted"
        style={{ margin: 0, fontSize: '0.7rem', lineHeight: 1.4 }}
      >
        Deposits on other networks (Base, Polygon, Ethereum, etc.) will not appear in your balance.
        Only Arbitrum and Hyperliquid are supported.
      </p>
    </>
  );
}

// ── Card Tab (Coming Soon) ─────────────────────────────────────────────

function CardTab() {
  return (
    <div style={{ padding: 'var(--space-3) 0' }}>
      {/* Coming soon section */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '2rem', marginBottom: 'var(--space-2)' }}>💳</div>
        <h4 className="vela-heading-base" style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
          Card funding coming soon
        </h4>
        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}
        >
          We&apos;re working on credit and debit card support so you can buy USDC directly in the
          app.
        </p>
      </div>

      {/* "Don't have USDC?" info banner — left aligned */}
      <div
        style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--blue-light)',
          border: '1.5px solid var(--blue-primary)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <p
          className="vela-body-sm"
          style={{
            margin: 0,
            marginBottom: 'var(--space-1)',
            fontWeight: 600,
            color: 'var(--blue-primary)',
          }}
        >
          Don&apos;t have USDC?
        </p>
        <p
          className="vela-body-sm"
          style={{ margin: 0, color: 'var(--blue-primary)', fontSize: '0.8rem', lineHeight: 1.5 }}
        >
          You can buy USDC on Coinbase, Binance, or most major exchanges, then transfer it to your
          deposit address using the &ldquo;Transfer USDC&rdquo; tab.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getTimeSince(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  return `${Math.floor(hours / 24)} days ago`;
}
