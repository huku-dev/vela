import type { TradeProposal } from '../types';
import { formatPrice } from '../lib/helpers';

interface TradeConfirmationSheetProps {
  proposal: TradeProposal;
  assetSymbol: string;
  /** Estimated fee in USD based on position size × tier fee rate */
  estimatedFee: number;
  /** Fee rate percentage for display (e.g. 0.1) */
  feeRatePct: number;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

/**
 * Confirmation dialog shown before executing a trade.
 *
 * Reinforces the "You Stay in Control" pillar by giving users
 * a clear summary of what's about to happen before committing.
 */
export default function TradeConfirmationSheet({
  proposal,
  assetSymbol,
  estimatedFee,
  feeRatePct,
  onConfirm,
  onCancel,
  isSubmitting,
}: TradeConfirmationSheetProps) {
  const isTrim = proposal.proposal_type === 'trim';
  const isLong = proposal.side === 'long';
  const actionLabel = isTrim
    ? `TRIM ${proposal.trim_pct ?? ''}% ${assetSymbol}`
    : `${isLong ? 'BUY' : 'SELL'} ${assetSymbol}`;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm trade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
          border: '3px solid var(--black)',
          borderBottom: 'none',
          padding: 'var(--space-5)',
          boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Header */}
        <h3
          className="vela-heading-base"
          style={{
            margin: 0,
            marginBottom: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
          Confirm trade
        </h3>

        {/* Trade summary */}
        <div
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-sm)',
            border: '2px solid var(--gray-200)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {/* Action badge */}
          <div
            style={{
              textAlign: 'center',
              marginBottom: 'var(--space-3)',
              paddingBottom: 'var(--space-3)',
              borderBottom: '1px solid var(--gray-200)',
            }}
          >
            <span
              className="vela-label-sm"
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '0.05em',
                color: isTrim ? 'var(--black)' : isLong ? 'var(--green-dark)' : 'var(--red-dark)',
              }}
            >
              {actionLabel}
            </span>
          </div>

          {/* Detail rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <ConfirmRow
              label={isTrim ? 'Current price' : 'Entry price'}
              value={`~${formatPrice(proposal.entry_price_at_proposal)}`}
            />
            <ConfirmRow
              label={isTrim ? 'Trim amount' : 'Position size'}
              value={`$${proposal.proposed_size_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            />
            {!isTrim && <ConfirmRow label="Leverage" value={`${proposal.proposed_leverage}x`} />}
            {estimatedFee > 0 && (
              <ConfirmRow
                label={`Est. fee (${feeRatePct}%)`}
                value={`$${estimatedFee.toFixed(2)}`}
              />
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            className="vela-btn vela-btn-ghost"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button
            className={`vela-btn ${isTrim ? 'vela-btn-warning' : 'vela-btn-primary'} `}
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{
              flex: 1,
              ...(isTrim && { backgroundColor: '#FFD700', color: 'var(--black)' }),
            }}
          >
            {isSubmitting ? 'Confirming...' : 'Confirm trade'}
          </button>
        </div>

        {/* Trust note */}
        <p
          className="vela-body-sm vela-text-muted"
          style={{
            textAlign: 'center',
            marginTop: 'var(--space-3)',
            marginBottom: 0,
          }}
        >
          You stay in control. This trade only executes with your confirmation.
        </p>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
