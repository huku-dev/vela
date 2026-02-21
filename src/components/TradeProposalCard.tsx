import { useState } from 'react';
import { Card } from './VelaComponents';
import { formatPrice } from '../lib/helpers';
import type { TradeProposal } from '../types';

interface TradeProposalCardProps {
  proposal: TradeProposal;
  assetSymbol: string;
  onAccept: (proposalId: string) => Promise<void>;
  onDecline: (proposalId: string) => Promise<void>;
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
}: TradeProposalCardProps) {
  const [acting, setActing] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLong = proposal.side === 'long';
  const expiresAt = new Date(proposal.expires_at);
  const timeLeft = expiresAt.getTime() - Date.now();
  const expired = timeLeft <= 0;

  const handleAction = async (action: 'accept' | 'decline') => {
    setActing(action);
    setError(null);
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
    return (
      <Card
        style={{
          borderLeft: `4px solid var(--gray-300)`,
          opacity: 0.7,
        }}
        compact
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            {assetSymbol} {proposal.side.toUpperCase()} proposal
          </span>
          <span
            className="vela-label-sm"
            style={{
              color:
                proposal.status === 'approved' || proposal.status === 'executed'
                  ? 'var(--green-dark)'
                  : 'var(--color-text-muted)',
            }}
          >
            {proposal.status === 'approved'
              ? 'Approved'
              : proposal.status === 'executed'
                ? 'Executed'
                : proposal.status === 'declined'
                  ? 'Declined'
                  : proposal.status === 'expired'
                    ? 'Expired'
                    : proposal.status}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card
      style={{
        borderLeft: `4px solid ${isLong ? 'var(--green-primary)' : 'var(--red-primary)'}`,
        backgroundColor: isLong ? 'var(--color-status-buy-bg)' : 'var(--color-status-sell-bg)',
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
              backgroundColor: isLong ? 'var(--green-primary)' : 'var(--red-primary)',
              color: 'var(--white)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '2px solid var(--black)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {isLong ? 'Long' : 'Short'}
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
        <DetailRow label="Entry price" value={formatPrice(proposal.entry_price_at_proposal)} />
        <DetailRow
          label="Position size"
          value={`$${proposal.proposed_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <DetailRow label="Leverage" value={`${proposal.proposed_leverage}x`} />
      </div>

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
            className="vela-btn vela-btn-buy vela-btn-sm"
            onClick={() => handleAction('accept')}
            disabled={acting !== null}
            style={{ flex: 1 }}
          >
            {acting === 'accept' ? 'Approving...' : 'Accept trade'}
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
        {isLong
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
