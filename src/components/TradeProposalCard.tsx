import { useState } from 'react';
import { Card, LoadingSpinner } from './VelaComponents';
import { formatPrice } from '../lib/helpers';
import type { TradeProposal, TradeProposalStatus } from '../types';

function getStatusConfig(status: TradeProposalStatus): {
  label: string;
  description: string;
  color: string;
  dimmed: boolean;
} {
  switch (status) {
    case 'approved':
    case 'auto_approved':
      return {
        label: 'Approved',
        description: 'Approved — sending to exchange...',
        color: 'var(--green-primary)',
        dimmed: false,
      };
    case 'executing':
      return {
        label: 'Executing',
        description: 'Placing order now...',
        color: 'var(--green-primary)',
        dimmed: false,
      };
    case 'executed':
      return {
        label: 'Filled',
        description: 'Trade executed successfully.',
        color: 'var(--green-dark)',
        dimmed: false,
      };
    case 'failed':
      return {
        label: 'Failed',
        description: 'Execution failed. Check your balance and try again.',
        color: 'var(--red-primary)',
        dimmed: false,
      };
    case 'declined':
      return {
        label: 'Declined',
        description: 'You declined this trade.',
        color: 'var(--gray-400)',
        dimmed: true,
      };
    case 'expired':
      return {
        label: 'Expired',
        description: 'This proposal expired before action was taken.',
        color: 'var(--gray-400)',
        dimmed: true,
      };
    default:
      return {
        label: status,
        description: '',
        color: 'var(--gray-300)',
        dimmed: true,
      };
  }
}

interface TradeProposalCardProps {
  proposal: TradeProposal;
  assetSymbol: string;
  onAccept: (proposalId: string) => Promise<void>;
  onDecline: (proposalId: string) => Promise<void>;
  /** Wallet balance for insufficient funds warning */
  walletBalance?: number;
}

/**
 * Neobrutalist card showing a pending trade proposal with accept/decline actions.
 *
 * Displayed on AssetDetail when a pending proposal exists for the current asset.
 * Also usable in a standalone proposals list.
 */
export default function TradeProposalCard({
  proposal,
  assetSymbol,
  onAccept,
  onDecline,
  walletBalance,
}: TradeProposalCardProps) {
  const [acting, setActing] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBalanceWarning, setShowBalanceWarning] = useState(false);

  const isTrim = proposal.proposal_type === 'trim';
  const isLong = proposal.side === 'long';
  const expiresAt = new Date(proposal.expires_at);
  const timeLeft = expiresAt.getTime() - Date.now();
  const expired = timeLeft <= 0;

  // Determine colors and labels based on proposal type
  const borderColor = isTrim ? '#FFD700' : isLong ? 'var(--green-primary)' : 'var(--red-primary)';
  const bgColor = isTrim
    ? 'rgba(255, 215, 0, 0.08)'
    : isLong
      ? 'var(--color-status-buy-bg)'
      : 'var(--color-status-sell-bg)';
  const badgeColor = isTrim ? '#FFD700' : isLong ? 'var(--green-primary)' : 'var(--red-primary)';
  const badgeText = isTrim ? `Trim ${proposal.trim_pct}%` : isLong ? 'Long' : 'Short';

  // Check if balance is insufficient for this trade (non-trim proposals only)
  const insufficientBalance =
    !isTrim && walletBalance !== undefined && walletBalance < proposal.proposed_size_usd;

  const handleAcceptClick = () => {
    if (insufficientBalance && !showBalanceWarning) {
      setShowBalanceWarning(true);
      return;
    }
    handleAction('accept');
  };

  const handleAction = async (action: 'accept' | 'decline') => {
    setActing(action);
    setError(null);
    setShowBalanceWarning(false);
    try {
      if (action === 'accept') {
        await onAccept(proposal.id);
      } else {
        await onDecline(proposal.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setActing(null);
    }
  };

  if (proposal.status !== 'pending') {
    const statusConfig = getStatusConfig(proposal.status);
    const isInFlight =
      proposal.status === 'approved' ||
      proposal.status === 'executing' ||
      proposal.status === 'auto_approved';

    return (
      <Card
        style={{
          borderLeft: `4px solid ${statusConfig.color}`,
          opacity: statusConfig.dimmed ? 0.7 : 1,
        }}
        compact
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {isInFlight && <LoadingSpinner size={14} />}
            {proposal.status === 'executed' && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="7" fill="var(--green-primary)" />
                <path
                  d="M4 7l2 2 4-4"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {proposal.status === 'failed' && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="7" fill="var(--red-primary)" />
                <path
                  d="M5 5l4 4M9 5l-4 4"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
            <span
              className="vela-body-sm"
              style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}
            >
              {assetSymbol} {proposal.side.toUpperCase()}
            </span>
          </div>
          <span className="vela-label-sm" style={{ color: statusConfig.color }}>
            {statusConfig.label}
          </span>
        </div>

        {/* Status description */}
        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, marginTop: 'var(--space-1)' }}
        >
          {statusConfig.description}
        </p>
      </Card>
    );
  }

  return (
    <Card
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: bgColor,
      }}
      compact
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            className="vela-label-sm"
            style={{
              backgroundColor: badgeColor,
              color: isTrim ? 'var(--black)' : 'var(--white)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '2px solid var(--black)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {badgeText}
          </span>
          <span className="vela-heading-base">{assetSymbol}</span>
        </div>

        {/* Expiry countdown */}
        {!expired && (
          <span
            className="vela-label-sm"
            style={{
              color: timeLeft < 30 * 60 * 1000 ? 'var(--red-dark)' : 'var(--color-text-muted)',
            }}
          >
            {formatTimeLeft(timeLeft)}
          </span>
        )}
        {expired && (
          <span className="vela-label-sm" style={{ color: 'var(--red-dark)' }}>
            Expired
          </span>
        )}
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <DetailRow
          label={isTrim ? 'Current price' : 'Entry price'}
          value={formatPrice(proposal.entry_price_at_proposal)}
        />
        <DetailRow
          label={isTrim ? 'Trim amount' : 'Position size'}
          value={`$${proposal.proposed_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}${isTrim && proposal.trim_pct ? ` (${proposal.trim_pct}%)` : ''}`}
        />
        {!isTrim && <DetailRow label="Leverage" value={`${proposal.proposed_leverage}x`} />}
      </div>

      {/* Insufficient balance warning */}
      {showBalanceWarning && insufficientBalance && (
        <div
          style={{
            marginTop: 'var(--space-2)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--color-status-yellow-bg, #fffbeb)',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--color-status-yellow, #f59e0b)',
          }}
        >
          <p
            className="vela-body-sm"
            style={{ fontWeight: 600, margin: 0, marginBottom: 'var(--space-1)' }}
          >
            Insufficient balance
          </p>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ margin: 0, marginBottom: 'var(--space-2)' }}
          >
            This trade needs $
            {proposal.proposed_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
            USDC. Your balance: $
            {walletBalance?.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <a
              href="https://app.hyperliquid-testnet.xyz/drip"
              target="_blank"
              rel="noopener noreferrer"
              className="vela-btn vela-btn-primary vela-btn-sm"
              style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}
            >
              Fund wallet
            </a>
            <button
              className="vela-btn vela-btn-ghost vela-btn-sm"
              onClick={() => handleAction('accept')}
              disabled={acting !== null}
              style={{ flex: 1 }}
            >
              {acting === 'accept' ? 'Approving...' : 'Accept anyway'}
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          style={{
            marginTop: 'var(--space-2)',
            padding: 'var(--space-2)',
            backgroundColor: 'var(--color-status-sell-bg)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--red-primary)',
          }}
        >
          <p className="vela-body-sm" style={{ color: 'var(--red-dark)', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {/* Action buttons */}
      {!expired && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-3)',
          }}
        >
          <button
            className={`vela-btn ${isTrim ? 'vela-btn-warning' : 'vela-btn-buy'} vela-btn-sm`}
            onClick={handleAcceptClick}
            disabled={acting !== null}
            style={{
              flex: 1,
              ...(isTrim && { backgroundColor: '#FFD700', color: 'var(--black)' }),
            }}
          >
            {acting === 'accept' ? 'Approving...' : isTrim ? 'Accept trim' : 'Accept trade'}
          </button>
          <button
            className="vela-btn vela-btn-ghost vela-btn-sm"
            onClick={() => handleAction('decline')}
            disabled={acting !== null}
            style={{ flex: 1 }}
          >
            {acting === 'decline' ? 'Declining...' : 'Decline'}
          </button>
        </div>
      )}

      {/* Plain English context */}
      <p
        className="vela-body-sm"
        style={{
          color: 'var(--color-text-muted)',
          marginTop: 'var(--space-2)',
          marginBottom: 0,
          fontStyle: 'italic',
        }}
      >
        {isTrim
          ? 'Lock in partial profits while keeping the rest of your position running.'
          : isLong
            ? 'This will open a long position — profit if price goes up.'
            : 'This will open a short position — profit if price goes down.'}
      </p>
    </Card>
  );
}

// ── Helpers ──

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        className="vela-body-sm"
        style={{ fontFamily: 'var(--type-mono-base-font)', fontWeight: 600 }}
      >
        {value}
      </span>
    </div>
  );
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
