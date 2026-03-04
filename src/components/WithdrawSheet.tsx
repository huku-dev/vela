import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import type { UserWallet } from '../types';

// ── Types ──────────────────────────────────────────────────────────────

interface WithdrawSheetProps {
  wallet: UserWallet;
  onClose: () => void;
  /** Called after a successful withdrawal (parent can refresh balance) */
  onSuccess?: () => void;
}

type WithdrawStep = 'form' | 'otp_sent' | 'confirming' | 'success' | 'error';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Ethereum address format: 0x followed by 40 hex characters */
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Flat withdrawal fee in USDC (matches tier_config default; backend enforces actual value) */
const WITHDRAWAL_FEE = 1.0;

/** Minimum withdrawal amount in USDC */
const MIN_WITHDRAWAL = 2.0;

// ── Component ──────────────────────────────────────────────────────────

/**
 * WithdrawSheet — Two-step withdrawal flow (form → OTP → confirm).
 *
 * Follows TradeConfirmationSheet pattern (bottom sheet, role="dialog").
 * Reinforces "You Stay in Control" pillar with clear confirmation steps.
 */
export default function WithdrawSheet({ wallet, onClose, onSuccess }: WithdrawSheetProps) {
  useBodyScrollLock();
  const { getToken } = useAuthContext();

  // ── State ──
  const [step, setStep] = useState<WithdrawStep>('form');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);

  const otpInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus amount input on mount
  useEffect(() => {
    amountInputRef.current?.focus();
  }, []);

  // Auto-focus OTP input when step changes to otp_sent
  useEffect(() => {
    if (step === 'otp_sent') {
      otpInputRef.current?.focus();
    }
  }, [step]);

  // ── Derived values ──
  const parsedAmount = parseFloat(amount);
  const availableBalance = wallet.balance_usdc ?? 0;
  const netAmount = parsedAmount - WITHDRAWAL_FEE;
  const isAmountValid =
    !isNaN(parsedAmount) &&
    parsedAmount >= MIN_WITHDRAWAL &&
    parsedAmount <= availableBalance &&
    netAmount > 0;
  const isAddressValid = ETH_ADDRESS_RE.test(destination);
  const isFormValid = isAmountValid && isAddressValid;
  const isOtpValid = otpCode.length === 6 && /^\d{6}$/.test(otpCode);

  // ── API call helper ──
  const callApi = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/process-withdrawal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    },
    [getToken]
  );

  // ── Step 1: Request OTP ──
  const handleRequestOtp = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      await callApi({
        action: 'request_otp',
        amount: parsedAmount,
        destination_address: destination,
      });
      setStep('otp_sent');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Confirm withdrawal ──
  const handleConfirm = async () => {
    setStep('confirming');
    setLoading(true);
    setErrorMessage('');

    try {
      await callApi({
        action: 'confirm',
        amount: parsedAmount,
        destination_address: destination,
        otp_code: otpCode,
      });
      setSuccessAmount(parsedAmount - WITHDRAWAL_FEE);
      setStep('success');
      onSuccess?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Withdrawal failed');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // ── Resend OTP ──
  const handleResendOtp = async () => {
    setLoading(true);
    setErrorMessage('');
    setOtpCode('');

    try {
      await callApi({
        action: 'request_otp',
        amount: parsedAmount,
        destination_address: destination,
      });
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Withdraw USDC"
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
        if (e.target === e.currentTarget && !loading) onClose();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape' && !loading) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-md)',
          border: '3px solid var(--black)',
          padding: 'var(--space-5)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
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
            Withdraw USDC
          </h3>
          <button
            onClick={onClose}
            disabled={loading}
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

        {/* Step content */}
        {step === 'form' && (
          <FormStep
            amount={amount}
            destination={destination}
            availableBalance={availableBalance}
            isAmountValid={isAmountValid}
            isAddressValid={isAddressValid}
            isFormValid={isFormValid}
            loading={loading}
            errorMessage={errorMessage}
            amountInputRef={amountInputRef}
            onAmountChange={setAmount}
            onDestinationChange={setDestination}
            onSetMax={() => setAmount(availableBalance.toFixed(2))}
            onSubmit={handleRequestOtp}
          />
        )}

        {(step === 'otp_sent' || step === 'confirming') && (
          <OtpStep
            otpCode={otpCode}
            isOtpValid={isOtpValid}
            loading={loading}
            errorMessage={errorMessage}
            otpInputRef={otpInputRef}
            isConfirming={step === 'confirming'}
            amount={parsedAmount}
            fee={WITHDRAWAL_FEE}
            destination={destination}
            onOtpChange={setOtpCode}
            onConfirm={handleConfirm}
            onResend={handleResendOtp}
            onBack={() => {
              setStep('form');
              setOtpCode('');
              setErrorMessage('');
            }}
          />
        )}

        {step === 'success' && (
          <SuccessStep amount={successAmount} destination={destination} onClose={onClose} />
        )}

        {step === 'error' && (
          <ErrorStep
            errorMessage={errorMessage}
            onRetry={() => {
              setStep('otp_sent');
              setOtpCode('');
              setErrorMessage('');
            }}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ── Form Step ──────────────────────────────────────────────────────────

interface FormStepProps {
  amount: string;
  destination: string;
  availableBalance: number;
  isAmountValid: boolean;
  isAddressValid: boolean;
  isFormValid: boolean;
  loading: boolean;
  errorMessage: string;
  amountInputRef: React.RefObject<HTMLInputElement | null>;
  onAmountChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSetMax: () => void;
  onSubmit: () => void;
}

function FormStep({
  amount,
  destination,
  availableBalance,
  isAmountValid,
  isAddressValid,
  isFormValid,
  loading,
  errorMessage,
  amountInputRef,
  onAmountChange,
  onDestinationChange,
  onSetMax,
  onSubmit,
}: FormStepProps) {
  const [showArbitrumInfo, setShowArbitrumInfo] = useState(false);
  const parsedAmount = parseFloat(amount);
  const netAmount = parsedAmount - WITHDRAWAL_FEE;
  const showAmountError = amount !== '' && !isAmountValid;
  const showAddressError = destination !== '' && !isAddressValid;

  return (
    <>
      {/* Available balance */}
      <div
        style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-sm)',
          border: '2px solid var(--gray-200)',
          marginBottom: 'var(--space-4)',
          textAlign: 'center',
        }}
      >
        <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
          Available balance
        </span>
        <div
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: '1.5rem',
            fontWeight: 700,
            marginTop: 'var(--space-1)',
          }}
        >
          $
          {availableBalance.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      </div>

      {/* Amount input */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label
          className="vela-label-sm"
          htmlFor="withdraw-amount"
          style={{ display: 'block', marginBottom: 'var(--space-2)' }}
        >
          Amount (USDC)
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            ref={amountInputRef}
            id="withdraw-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={availableBalance}
            placeholder="0.00"
            value={amount}
            onChange={e => onAmountChange(e.target.value)}
            style={{
              flex: 1,
              padding: 'var(--space-3)',
              border: `2px solid ${showAmountError ? 'var(--red-primary)' : 'var(--gray-200)'}`,
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--type-mono-base-font)',
              fontSize: '1rem',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
            }}
          />
          <button
            className="vela-btn vela-btn-ghost vela-btn-sm"
            onClick={onSetMax}
            type="button"
            style={{ whiteSpace: 'nowrap' }}
          >
            Max
          </button>
        </div>
        {showAmountError && (
          <p
            className="vela-body-sm"
            style={{ color: 'var(--red-primary)', marginTop: 'var(--space-1)', marginBottom: 0 }}
          >
            {parsedAmount > availableBalance
              ? 'Amount exceeds available balance'
              : parsedAmount > 0 && parsedAmount < MIN_WITHDRAWAL
                ? `Minimum withdrawal is $${MIN_WITHDRAWAL.toFixed(2)}`
                : 'Enter a valid amount'}
          </p>
        )}
      </div>

      {/* Destination address input */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            marginBottom: 'var(--space-2)',
          }}
        >
          <label className="vela-label-sm" htmlFor="withdraw-address">
            Destination address (Arbitrum)
          </label>
          <button
            type="button"
            onClick={() => setShowArbitrumInfo(!showArbitrumInfo)}
            aria-label="What is Arbitrum?"
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: '1.5px solid var(--gray-400)',
              background: 'none',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--gray-500)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ?
          </button>
        </div>
        {showArbitrumInfo && (
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--blue-light)',
              border: '1.5px solid var(--blue-primary)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <p
              className="vela-body-sm"
              style={{
                margin: 0,
                color: 'var(--blue-primary)',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              Withdrawals are processed on the Arbitrum network. Make sure your destination supports
              Arbitrum — most Ethereum-style wallets do, but if you&apos;re withdrawing to an
              exchange, select &ldquo;Arbitrum&rdquo; as the deposit network.
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            id="withdraw-address"
            type="text"
            placeholder="0x..."
            value={destination}
            onChange={e => onDestinationChange(e.target.value)}
            style={{
              flex: 1,
              padding: 'var(--space-3)',
              border: `2px solid ${showAddressError ? 'var(--red-primary)' : 'var(--gray-200)'}`,
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--type-mono-base-font)',
              fontSize: '0.85rem',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
            }}
          />
          <button
            className="vela-btn vela-btn-ghost vela-btn-sm"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (ETH_ADDRESS_RE.test(text)) {
                  onDestinationChange(text);
                }
              } catch {
                // Clipboard access denied — ignore silently
              }
            }}
            type="button"
            aria-label="Paste from clipboard"
            style={{ whiteSpace: 'nowrap' }}
          >
            Paste
          </button>
        </div>
        {showAddressError && (
          <p
            className="vela-body-sm"
            style={{ color: 'var(--red-primary)', marginTop: 'var(--space-1)', marginBottom: 0 }}
          >
            Enter a valid Ethereum address (0x...)
          </p>
        )}
      </div>

      {/* Fee breakdown summary */}
      {isFormValid && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--gray-200)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}
          >
            <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
              Withdraw
            </span>
            <span
              className="vela-body-sm"
              style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
            >
              $
              {parsedAmount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}
          >
            <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
              Network fee
            </span>
            <span
              className="vela-body-sm"
              style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
            >
              -$
              {WITHDRAWAL_FEE.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--gray-200)',
            }}
          >
            <span className="vela-body-sm" style={{ fontWeight: 600 }}>
              You receive
            </span>
            <span
              className="vela-body-sm"
              style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 700 }}
            >
              $
              {netAmount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      )}

      {/* Error display */}
      {errorMessage && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--red-light, #FFF0F1)',
            border: '2px solid var(--red-primary)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, color: 'var(--red-primary)' }}>
            {errorMessage}
          </p>
        </div>
      )}

      {/* Submit */}
      <button
        className="vela-btn vela-btn-primary"
        onClick={onSubmit}
        disabled={!isFormValid || loading}
        style={{ width: '100%' }}
      >
        {loading ? 'Sending code...' : 'Send verification code'}
      </button>

      {/* Trust note */}
      <p
        className="vela-body-sm vela-text-muted"
        style={{ textAlign: 'center', marginTop: 'var(--space-3)', marginBottom: 0 }}
      >
        We&apos;ll send a code to your email to verify this withdrawal.
      </p>
    </>
  );
}

// ── OTP Step ───────────────────────────────────────────────────────────

interface OtpStepProps {
  otpCode: string;
  isOtpValid: boolean;
  loading: boolean;
  errorMessage: string;
  otpInputRef: React.RefObject<HTMLInputElement | null>;
  isConfirming: boolean;
  amount: number;
  fee: number;
  destination: string;
  onOtpChange: (value: string) => void;
  onConfirm: () => void;
  onResend: () => void;
  onBack: () => void;
}

function OtpStep({
  otpCode,
  isOtpValid,
  loading,
  errorMessage,
  otpInputRef,
  isConfirming,
  amount,
  fee,
  destination,
  onOtpChange,
  onConfirm,
  onResend,
  onBack,
}: OtpStepProps) {
  const shortAddr = `${destination.slice(0, 6)}...${destination.slice(-4)}`;
  const netAmount = amount - fee;

  return (
    <>
      {/* Withdrawal summary */}
      <div
        style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-sm)',
          border: '2px solid var(--gray-200)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-2)',
          }}
        >
          <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            Amount
          </span>
          <span
            className="vela-body-sm"
            style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
          >
            $
            {amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-2)',
          }}
        >
          <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            Network fee
          </span>
          <span
            className="vela-body-sm"
            style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
          >
            -${fee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-2)',
            paddingTop: 'var(--space-2)',
            borderTop: '1px solid var(--gray-200)',
          }}
        >
          <span className="vela-body-sm" style={{ fontWeight: 600 }}>
            You receive
          </span>
          <span
            className="vela-body-sm"
            style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 700 }}
          >
            $
            {netAmount.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            To
          </span>
          <span
            className="vela-body-sm"
            style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
          >
            {shortAddr}
          </span>
        </div>
      </div>

      {/* Arbitrum address warning */}
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'var(--yellow-light, #FFFDE7)',
          border: '1.5px solid var(--yellow-primary, #FFD700)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <p
          className="vela-body-sm"
          style={{ margin: 0, fontWeight: 600, fontSize: '0.8rem', color: '#92600a' }}
        >
          Double-check your address supports Arbitrum. Sending to the wrong network may result in
          lost funds.
        </p>
      </div>

      {/* OTP instruction */}
      <p
        className="vela-body-sm"
        style={{ textAlign: 'center', marginBottom: 'var(--space-4)', marginTop: 0 }}
      >
        Enter the 6-digit code we sent to your email
      </p>

      {/* OTP input */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <input
          ref={otpInputRef}
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={otpCode}
          onChange={e => {
            const val = e.target.value.replace(/\D/g, '').slice(0, 6);
            onOtpChange(val);
          }}
          disabled={isConfirming}
          style={{
            width: '100%',
            padding: 'var(--space-4)',
            border: `2px solid ${errorMessage ? 'var(--red-primary)' : 'var(--gray-200)'}`,
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: '1.5rem',
            textAlign: 'center',
            letterSpacing: '0.3em',
            backgroundColor: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            boxSizing: 'border-box',
          }}
          aria-label="Verification code"
        />
      </div>

      {/* Error display */}
      {errorMessage && (
        <div
          style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--red-light, #FFF0F1)',
            border: '2px solid var(--red-primary)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <p className="vela-body-sm" style={{ margin: 0, color: 'var(--red-primary)' }}>
            {errorMessage}
          </p>
        </div>
      )}

      {/* Confirm button */}
      <button
        className="vela-btn vela-btn-primary"
        onClick={onConfirm}
        disabled={!isOtpValid || loading}
        style={{ width: '100%', marginBottom: 'var(--space-3)' }}
      >
        {isConfirming ? 'Processing withdrawal...' : 'Confirm withdrawal'}
      </button>

      {/* Resend + Back links */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <button
          onClick={onResend}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          Resend code
        </button>
        <button
          onClick={onBack}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          Go back
        </button>
      </div>
    </>
  );
}

// ── Success Step ───────────────────────────────────────────────────────

function SuccessStep({
  amount,
  destination,
  onClose,
}: {
  amount: number;
  destination: string;
  onClose: () => void;
}) {
  const shortAddr = `${destination.slice(0, 6)}...${destination.slice(-4)}`;

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>{'✓'}</div>
      <h4 className="vela-heading-base" style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
        Withdrawal sent
      </h4>
      <p
        className="vela-body-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)' }}
      >
        ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
        USDC is on its way to {shortAddr}
      </p>
      <button className="vela-btn vela-btn-primary" onClick={onClose} style={{ width: '100%' }}>
        Done
      </button>
    </div>
  );
}

// ── Error Step ─────────────────────────────────────────────────────────

function ErrorStep({
  errorMessage,
  onRetry,
  onClose,
}: {
  errorMessage: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)', color: 'var(--red-primary)' }}
      >
        {'✕'}
      </div>
      <h4 className="vela-heading-base" style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
        Withdrawal failed
      </h4>
      <p
        className="vela-body-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)' }}
      >
        {errorMessage || 'Something went wrong. Your funds are safe.'}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button className="vela-btn vela-btn-ghost" onClick={onClose} style={{ flex: 1 }}>
          Close
        </button>
        <button className="vela-btn vela-btn-primary" onClick={onRetry} style={{ flex: 1 }}>
          Try again
        </button>
      </div>
    </div>
  );
}
