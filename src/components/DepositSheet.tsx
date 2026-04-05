import { useState, useCallback, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useFundWallet } from '@privy-io/react-auth';
import { useAuthContext } from '../contexts/AuthContext';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { track, AnalyticsEvent } from '../lib/analytics';
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
 * DepositSheet — Two deposit methods (tabbed):
 *   1. Buy with card — Privy-powered fiat onramp (MoonPay) for card, Apple Pay, etc.
 *   2. Transfer USDC — show wallet address, QR code, and instructions
 *
 * Uses bottom sheet pattern (like TradeConfirmationSheet).
 */
export default function DepositSheet({ wallet, onClose, onRefresh }: DepositSheetProps) {
  useBodyScrollLock();
  track(AnalyticsEvent.DEPOSIT_SHEET_OPENED);
  const { getToken } = useAuthContext();
  const [activeTab, setActiveTab] = useState<'transfer' | 'card'>('card');
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{
    balance?: number;
    depositDetected?: number | null;
  } | null>(null);
  // Error state removed — balance refresh failures are silent (users contact support if needed)
  const address = wallet.master_address;

  // ── Copy address ──
  const handleCopy = useCallback(() => {
    track(AnalyticsEvent.DEPOSIT_ADDRESS_COPIED);
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  // ── Refresh balance ──
  const handleRefreshBalance = useCallback(async () => {
    setRefreshing(true);
    setRefreshResult(null);

    try {
      const token = await getToken();
      if (!token) return; // Dev bypass or logged out — skip silently

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
      // Silent failure — no user-facing error for background balance checks
    } finally {
      setRefreshing(false);
    }
  }, [getToken, onRefresh]);

  // ── Auto-poll while sheet is open ──
  // Fire immediately on open, then every 30s to catch deposits quickly
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    handleRefreshBalance();
    pollRef.current = setInterval(handleRefreshBalance, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // Only run on mount/unmount — handleRefreshBalance is stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deposit to Wallet"
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
            Deposit to Wallet
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
            label="Deposit cash"
            active={activeTab === 'card'}
            onClick={() => {
              track(AnalyticsEvent.DEPOSIT_TAB_CHANGED, { tab: 'card' });
              setActiveTab('card');
            }}
          />
          <TabButton
            label="Transfer USDC"
            active={activeTab === 'transfer'}
            onClick={() => {
              track(AnalyticsEvent.DEPOSIT_TAB_CHANGED, { tab: 'transfer' });
              setActiveTab('transfer');
            }}
          />
        </div>

        {/* Tab content — min-height prevents layout shift when switching tabs */}
        <div style={{ minHeight: 460 }}>
          {activeTab === 'card' && (
            <CardFundingTab
              wallet={wallet}
              refreshResult={refreshResult}
              onFundingComplete={handleRefreshBalance}
            />
          )}

          {activeTab === 'transfer' && (
            <TransferTab
              address={address}
              copied={copied}
              onCopy={handleCopy}
              refreshing={refreshing}
              refreshResult={refreshResult}
              onConfirmSent={() => {
                handleRefreshBalance();
              }}
            />
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

// ── Transfer Tab ───────────────────────────────────────────────────────

function TransferTab({
  address,
  copied,
  onCopy,
  refreshResult,
  onConfirmSent,
}: {
  address: string;
  copied: boolean;
  onCopy: () => void;
  refreshing?: boolean;
  refreshResult: { balance?: number; depositDetected?: number | null } | null;
  onConfirmSent: () => void;
}) {
  const [selectedNetwork, setSelectedNetwork] = useState<'arbitrum' | 'hyperliquid' | null>(null);
  const [sentConfirmed, setSentConfirmed] = useState(false);

  const handleConfirm = () => {
    setSentConfirmed(true);
    onConfirmSent(); // Triggers immediate balance check
  };

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
              fontSize: '0.75rem',
              color: 'var(--color-text-primary)',
              wordBreak: 'break-all',
              lineHeight: 1.4,
            }}
          >
            {address}
          </span>
          <button
            onClick={onCopy}
            style={{
              whiteSpace: 'nowrap',
              flexShrink: 0,
              background: 'none',
              border: '1.5px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: '0.7rem',
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--color-text-primary)',
            }}
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
      <select
        value={selectedNetwork ?? ''}
        onChange={e => {
          const val = e.target.value;
          setSelectedNetwork(val === '' ? null : (val as 'arbitrum' | 'hyperliquid'));
        }}
        aria-label="Select deposit network"
        style={{
          width: '100%',
          padding: 'var(--space-2) var(--space-3)',
          border: '2px solid var(--gray-200)',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--color-bg-surface)',
          color: selectedNetwork ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          fontWeight: 600,
          fontSize: '0.85rem',
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%23666' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 12px center',
          marginBottom: 'var(--space-3)',
        }}
      >
        <option value="">Choose a network...</option>
        <option value="arbitrum">Arbitrum · USDC transfer · 5-10 min</option>
        <option value="hyperliquid">Hyperliquid · usdSend · instant</option>
      </select>

      {/* Warning — only shown when a network is selected */}
      {selectedNetwork && (
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
              ? 'Only send USDC on Arbitrum. Minimum deposit: $5 USDC. Deposits below $5 may not appear in your balance. Other tokens or chains will also not be detected.'
              : 'Only send via Hyperliquid usdSend. Regular token transfers on other networks will not appear in your balance.'}
          </p>
        </div>
      )}

      {/* Action section — transfer-specific */}
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

        {!sentConfirmed ? (
          <>
            <button
              className="vela-btn vela-btn-primary"
              onClick={handleConfirm}
              disabled={!selectedNetwork}
              style={{
                width: '100%',
                marginBottom: 'var(--space-2)',
                opacity: selectedNetwork ? 1 : 0.5,
                cursor: selectedNetwork ? 'pointer' : 'not-allowed',
              }}
            >
              I&apos;ve sent the USDC
            </button>

            <p
              className="vela-body-sm vela-text-muted"
              style={{
                textAlign: 'center',
                margin: 0,
                fontSize: '0.7rem',
              }}
            >
              We&apos;ll check for your deposit automatically. It may take a few minutes to appear.
            </p>
          </>
        ) : (
          <p
            className="vela-body-sm"
            style={{
              textAlign: 'center',
              color: 'var(--green-primary)',
              fontWeight: 600,
              margin: 0,
            }}
          >
            ✓ We&apos;ll check for deposits to your wallet
          </p>
        )}

        {/* Balance refresh errors are silent — no user-facing display */}
      </div>
    </>
  );
}

// ── Card Funding Tab (Privy Fiat Onramp) ─────────────────────────────

/** Minimum deposit in USDC — matches Arbitrum bridge threshold in deposit-monitor */
const MIN_DEPOSIT_USDC = 5;

/** How long to show the "deposit received" confirmation before resetting (ms) */
const DEPOSIT_CONFIRMATION_MS = 4000;

/**
 * CardFundingTab — Fund wallet via card, Apple Pay, or bank transfer.
 *
 * Uses Privy's `useFundWallet` hook which opens a native modal with
 * MoonPay (and other enabled providers). Funds land as USDC on Arbitrum,
 * then the existing deposit-monitor cron auto-bridges to Hyperliquid.
 *
 * States: idle → pending (opening checkout) → transferring (purchased,
 * waiting for Arb→HL) → confirmed (brief flash) → back to idle.
 */
function CardFundingTab({
  wallet,
  refreshResult,
  onFundingComplete,
}: {
  wallet: UserWallet;
  refreshResult: { balance?: number; depositDetected?: number | null } | null;
  onFundingComplete: () => void;
}) {
  const { fundWallet } = useFundWallet();
  const [fundingState, setFundingState] = useState<
    'idle' | 'pending' | 'transferring' | 'confirmed' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null);

  const handleFund = async () => {
    track(AnalyticsEvent.DEPOSIT_ONRAMP_STARTED);
    setFundingState('pending');
    setErrorMessage(null);

    try {
      const result = await fundWallet({
        address: wallet.master_address,
        options: {
          chain: { id: 42161 }, // Arbitrum
          amount: '50',
          asset: 'USDC',
          defaultFundingMethod: 'card',
          card: { preferredProvider: 'moonpay' },
        },
      });

      if (result.status === 'completed') {
        // Funds purchased — now waiting for Arbitrum → Hyperliquid (2-4 min)
        setFundingState('transferring');
        onFundingComplete();
      } else {
        // User cancelled the checkout flow
        setFundingState('idle');
      }
    } catch (err) {
      // Privy may throw when user closes the popup — treat as cancellation, not error
      const message = err instanceof Error ? err.message : '';
      const isCancellation =
        message.includes('cancel') ||
        message.includes('closed') ||
        message.includes('rejected') ||
        message.includes('user denied') ||
        message.includes('popup');

      if (isCancellation) {
        console.log('[DepositSheet] Funding cancelled by user');
        setFundingState('idle');
      } else {
        console.error('[DepositSheet] Funding error:', err);
        setFundingState('error');
        setErrorMessage(message || 'Something went wrong. Try again.');
      }
    }
  };

  // When deposit detected on Hyperliquid, briefly show confirmation then reset
  useEffect(() => {
    if (
      fundingState === 'transferring' &&
      refreshResult?.depositDetected != null &&
      refreshResult.depositDetected > 0
    ) {
      setConfirmedAmount(refreshResult.depositDetected);
      setConfirmedBalance(refreshResult.balance ?? null);
      setFundingState('confirmed');
      const timer = setTimeout(() => {
        setFundingState('idle');
        setConfirmedAmount(null);
        setConfirmedBalance(null);
      }, DEPOSIT_CONFIRMATION_MS);
      return () => clearTimeout(timer);
    }
  }, [fundingState, refreshResult?.depositDetected, refreshResult?.balance]);

  return (
    <div>
      {/* ── Status banners (slot in above the default content) ── */}

      {/* Transferring — payment done, waiting for funds to arrive */}
      {fundingState === 'transferring' && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--blue-light, #EBF5FF)',
            border: '2px solid var(--blue-primary, #3B82F6)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, fontWeight: 600, fontSize: '0.8rem' }}>
            &#9203; Payment received, processing.
          </p>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ margin: 0, marginTop: 'var(--space-1)', fontSize: '0.7rem' }}
          >
            Transferring funds to your trading wallet.
          </p>
        </div>
      )}

      {/* Confirmed — brief flash before returning to idle */}
      {fundingState === 'confirmed' && confirmedAmount != null && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--green-light, #F0FFF4)',
            border: '2px solid var(--green-primary)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, fontWeight: 600, fontSize: '0.8rem' }}>
            Deposit received: +${confirmedAmount.toFixed(2)}
          </p>
          {confirmedBalance != null && (
            <p
              className="vela-body-sm vela-text-muted"
              style={{ margin: 0, marginTop: 'var(--space-1)', fontSize: '0.7rem' }}
            >
              New balance: ${confirmedBalance.toFixed(2)}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {fundingState === 'error' && errorMessage && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--red-light, #FFF5F5)',
            border: '2px solid var(--red-primary, #E53E3E)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, fontWeight: 600, fontSize: '0.8rem' }}>
            {errorMessage}
          </p>
        </div>
      )}

      {/* ── Default content (always visible) ── */}

      {/* Headline */}
      <p
        className="vela-body-sm"
        style={{
          margin: 0,
          marginBottom: 'var(--space-3)',
          fontSize: '0.85rem',
          color: 'var(--color-text-muted)',
        }}
      >
        Add funds to your Vela wallet using one of these methods:
      </p>

      {/* Payment methods — non-interactive indicators */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <PaymentMethodLabel icon={<CardIcon />} label="Card" />
        <PaymentMethodLabel icon={<ApplePayIcon />} label="Apple Pay" />
        <PaymentMethodLabel icon={<BankIcon />} label="Bank transfer" />
      </div>

      {/* CTA */}
      <button
        className="vela-btn vela-btn-primary"
        onClick={handleFund}
        disabled={fundingState === 'pending'}
        style={{
          width: '100%',
          marginBottom: 'var(--space-4)',
          opacity: fundingState === 'pending' ? 0.6 : 1,
          cursor: fundingState === 'pending' ? 'not-allowed' : 'pointer',
        }}
      >
        {fundingState === 'pending' ? 'Connecting to payment provider...' : 'Add funds'}
      </button>

      {/* Minimum notice + transition hint */}
      <div
        style={{
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--gray-200)',
        }}
      >
        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, fontSize: '0.75rem', lineHeight: 1.5 }}
        >
          <strong style={{ color: 'var(--color-text-primary)' }}>
            Minimum deposit: ${MIN_DEPOSIT_USDC}
          </strong>
          <br />
          Smaller amounts can&apos;t be credited to your trading wallet.
        </p>
      </div>
    </div>
  );
}

// ── Payment Method Icons ─────────────────────────────────────────────

/** Non-interactive label showing a supported payment method */
function PaymentMethodLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-2)',
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', color: 'var(--color-text-primary)' }}>
        {icon}
      </span>
      <span
        className="vela-body-sm"
        style={{ fontSize: '0.75rem', color: 'var(--color-text-primary)' }}
      >
        {label}
      </span>
    </div>
  );
}

function CardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3,10 12,4 21,10" />
      <line x1="5" y1="10" x2="5" y2="17" />
      <line x1="9" y1="10" x2="9" y2="17" />
      <line x1="15" y1="10" x2="15" y2="17" />
      <line x1="19" y1="10" x2="19" y2="17" />
      <line x1="3" y1="17" x2="21" y2="17" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function ApplePayIcon() {
  return (
    <svg viewBox="0 0 512 210.2" width="40" height="16" fill="currentColor" aria-label="Apple Pay">
      <path d="M93.6,27.1C87.6,34.2,78,39.8,68.4,39c-1.2-9.6,3.5-19.8,9-26.1c6-7.3,16.5-12.5,25-12.9C103.4,10,99.5,19.8,93.6,27.1 M102.3,40.9c-13.9-0.8-25.8,7.9-32.4,7.9c-6.7,0-16.8-7.5-27.8-7.3c-14.3,0.2-27.6,8.3-34.9,21.2c-15,25.8-3.9,64,10.6,85c7.1,10.4,15.6,21.8,26.8,21.4c10.6-0.4,14.8-6.9,27.6-6.9c12.9,0,16.6,6.9,27.8,6.7c11.6-0.2,18.9-10.4,26-20.8c8.1-11.8,11.4-23.3,11.6-23.9c-0.2-0.2-22.4-8.7-22.6-34.3c-0.2-21.4,17.5-31.6,18.3-32.2C123.3,42.9,107.7,41.3,102.3,40.9 M182.6,11.9v155.9h24.2v-53.3h33.5c30.6,0,52.1-21,52.1-51.4c0-30.4-21.1-51.2-51.3-51.2H182.6z M206.8,32.3h27.9c21,0,33,11.2,33,30.9c0,19.7-12,31-33.1,31h-27.8V32.3z M336.6,169c15.2,0,29.3-7.7,35.7-19.9h0.5v18.7h22.4V90.2c0-22.5-18-37-45.7-37c-25.7,0-44.7,14.7-45.4,34.9h21.8c1.8-9.6,10.7-15.9,22.9-15.9c14.8,0,23.1,6.9,23.1,19.6v8.6l-30.2,1.8c-28.1,1.7-43.3,13.2-43.3,33.2C298.4,155.6,314.1,169,336.6,169z M343.1,150.5c-12.9,0-21.1-6.2-21.1-15.7c0-9.8,7.9-15.5,23-16.4l26.9-1.7v8.8C371.9,140.1,359.5,150.5,343.1,150.5z M425.1,210.2c23.6,0,34.7-9,44.4-36.3L512,54.7h-24.6l-28.5,92.1h-0.5l-28.5-92.1h-25.3l41,113.5l-2.2,6.9c-3.7,11.7-9.7,16.2-20.4,16.2c-1.9,0-5.6-0.2-7.1-0.4v18.7C417.3,210,423.3,210.2,425.1,210.2z" />
    </svg>
  );
}
