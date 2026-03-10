import { useState } from 'react';
import { Card } from './VelaComponents';
import TradeConfirmationSheet from './TradeConfirmationSheet';
import VelaLogo from './VelaLogo';
import { formatPrice } from '../lib/helpers';
import { useTierAccess } from '../hooks/useTierAccess';
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
        description: 'Approved. Sending to exchange...',
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
  /** Wallet environment controls fund link (testnet faucet vs deposit) */
  walletEnvironment?: string;
  /** Whether this user's tier allows trading */
  canTrade?: boolean;
  /** Label for the upgrade CTA when user can't trade */
  upgradeLabel?: string;
  /** Called when user clicks the upgrade CTA */
  onUpgradeClick?: () => void;
  /** Current live price for delta display */
  currentPrice?: number;
  /** Asset icon URL (from getCoinIcon) */
  iconUrl?: string;
  /** Position entry price for trim P&L context */
  positionEntryPrice?: number;
  /** Current total position size in USD for trim context */
  positionSizeUsd?: number;
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
  walletEnvironment,
  canTrade = true,
  upgradeLabel,
  onUpgradeClick,
  currentPrice,
  iconUrl,
  positionEntryPrice,
  positionSizeUsd,
}: TradeProposalCardProps) {
  const [acting, setActing] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBalanceWarning, setShowBalanceWarning] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showLeverageWarning, setShowLeverageWarning] = useState(false);
  const [iconError, setIconError] = useState(false);
  const { tierConfig } = useTierAccess();

  const isTrim = proposal.proposal_type === 'trim';
  const isLong = proposal.side === 'long';
  const isBB2 = proposal.position_type === 'bb2' || proposal.position_type === 'bb2_30m';
  const expiresAt = new Date(proposal.expires_at);
  const timeLeft = expiresAt.getTime() - Date.now();
  const expired = timeLeft <= 0;

  // Fee estimation
  const feeRatePct = tierConfig.trade_fee_pct;
  const estimatedFee = proposal.proposed_size_usd * (feeRatePct / 100);

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
    setShowConfirmation(true);
  };

  const handleConfirmTrade = () => {
    setShowConfirmation(false);
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

  // ── Non-pending card (compact status feedback) ──
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
            {isInFlight && <VelaLogo variant="mark" size={16} pulse />}
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

        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, marginTop: 'var(--space-1)' }}
        >
          {proposal.status === 'failed' && proposal.error_message
            ? proposal.error_message
            : statusConfig.description}
        </p>

        {/* Auto-trading nudge for non-premium users */}
        {tierConfig?.tier !== 'premium' && (
          <>
            {proposal.status === 'executed' &&
              (() => {
                const delta =
                  currentPrice != null && proposal.entry_price_at_proposal
                    ? ((currentPrice - proposal.entry_price_at_proposal) /
                        proposal.entry_price_at_proposal) *
                      100
                    : undefined;
                const hasMoved = delta != null && Math.abs(delta) >= 0.5;
                return (
                  <AutoTradingNudge
                    message={
                      hasMoved
                        ? `Trade executed! But price moved ${Math.abs(delta!).toFixed(1)}% while you were deciding. With auto-trading, Vela executes instantly at the best price.`
                        : 'Nice catch! With auto-trading, Vela executes instantly at the best entry.'
                    }
                    onUpgradeClick={onUpgradeClick}
                  />
                );
              })()}
            {proposal.status === 'expired' && (
              <AutoTradingNudge
                message="This trade expired before you saw it. Auto-trading never misses a signal."
                onUpgradeClick={onUpgradeClick}
                strong
              />
            )}
            {proposal.status === 'declined' && (
              <AutoTradingNudge
                message="No problem. With auto-trading, Vela acts instantly on the best setups so you never have to worry about timing."
                onUpgradeClick={onUpgradeClick}
              />
            )}
          </>
        )}
      </Card>
    );
  }

  // ── Pending card (actionable) ──

  // Compute current price delta for display
  const proposalPrice = proposal.entry_price_at_proposal;
  const referencePrice = isTrim ? positionEntryPrice : proposalPrice;
  const priceDelta =
    currentPrice != null && referencePrice != null
      ? ((currentPrice - referencePrice) / referencePrice) * 100
      : undefined;

  const sizeStr = formatDollarAmount(proposal.proposed_size_usd);

  return (
    <Card
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: bgColor,
      }}
      compact
    >
      {/* Header: badge + icon + asset name + expiry */}
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
          {iconUrl && !iconError ? (
            <img
              src={iconUrl}
              alt={assetSymbol}
              onError={() => setIconError(true)}
              style={{ width: 24, height: 24, borderRadius: '50%' }}
            />
          ) : (
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: 'var(--gray-200)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {assetSymbol.charAt(0)}
            </span>
          )}
          <span className="vela-heading-base">{assetSymbol}</span>
        </div>

        {!expired && (
          <span
            className="vela-label-sm"
            style={{
              fontWeight: 400,
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

      {/* Detail rows: different for trim vs non-trim */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {isTrim ? (
          <>
            <DetailRow
              label="Your entry"
              value={positionEntryPrice != null ? formatPrice(positionEntryPrice) : '--'}
            />
            {currentPrice != null && (
              <DetailRow
                label="Current price"
                value={`${formatPrice(currentPrice)}${priceDelta != null ? ` (${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(1)}%)` : ''}`}
                valueColor={
                  priceDelta != null && priceDelta >= 0
                    ? 'var(--green-primary)'
                    : 'var(--red-primary)'
                }
              />
            )}
            {positionSizeUsd != null && (
              <div style={{ marginTop: 'var(--space-1)' }}>
                <DetailRow
                  label={`Your ${assetSymbol} position`}
                  value={formatDollarAmount(positionSizeUsd)}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <DetailRow label="Proposal price" value={formatPrice(proposalPrice)} />
            {currentPrice != null && (
              <DetailRow
                label="Current price"
                value={`${formatPrice(currentPrice)}${priceDelta != null ? ` (${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(1)}%)` : ''}`}
                valueColor={
                  priceDelta != null
                    ? priceDelta >= 0
                      ? 'var(--green-primary)'
                      : 'var(--red-primary)'
                    : undefined
                }
              />
            )}
            {proposal.proposed_leverage > 1 && (
              <div
                style={{
                  marginTop: 'var(--space-1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}
              >
                <LeverageRow
                  leverage={proposal.proposed_leverage}
                  showWarning={showLeverageWarning}
                  onToggleWarning={() => setShowLeverageWarning(prev => !prev)}
                />
                <DetailRow
                  label="Est. liquidation"
                  value={formatPrice(
                    estimateLiquidationPrice(proposalPrice, proposal.proposed_leverage, isLong)
                  )}
                  valueColor="var(--red-primary)"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Trade size line + action buttons */}
      {!canTrade ? (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-sm)',
            textAlign: 'center',
          }}
        >
          <p
            className="vela-body-sm vela-text-muted"
            style={{ margin: 0, marginBottom: 'var(--space-2)' }}
          >
            Upgrade your plan to act on trade proposals
          </p>
          {upgradeLabel && onUpgradeClick && (
            <button
              className="vela-btn vela-btn-primary vela-btn-sm"
              onClick={onUpgradeClick}
              style={{ width: '100%' }}
            >
              {upgradeLabel}
            </button>
          )}
        </div>
      ) : (
        !expired && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {/* Prominent trade size label */}
            <p
              className="vela-body-sm"
              style={{
                fontWeight: 700,
                margin: 0,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}
            >
              {isTrim
                ? `Trim ${proposal.trim_pct}% of position (${sizeStr})`
                : `Place a ${sizeStr}${!isLong ? ' short' : ''} trade`}
            </p>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="vela-btn vela-btn-buy vela-btn-sm"
                onClick={handleAcceptClick}
                disabled={acting !== null}
                style={{ flex: 1, border: '1px solid var(--green-primary)' }}
              >
                {acting === 'accept' ? 'Approving...' : isTrim ? 'Accept trim' : 'Accept trade'}
              </button>
              <button
                className="vela-btn vela-btn-ghost vela-btn-sm"
                onClick={() => handleAction('decline')}
                disabled={acting !== null}
                style={{
                  flex: 1,
                  color: 'var(--red-primary)',
                  border: '1px solid var(--gray-200, #E5E7EB)',
                }}
              >
                {acting === 'decline' ? 'Declining...' : 'Decline'}
              </button>
            </div>
          </div>
        )
      )}

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
            {proposal.proposed_size_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC.
            Your balance: ${walletBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
            USDC.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {walletEnvironment === 'testnet' ? (
              <a
                href="https://app.hyperliquid-testnet.xyz/drip"
                target="_blank"
                rel="noopener noreferrer"
                className="vela-btn vela-btn-primary vela-btn-sm"
                style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}
              >
                Get test USDC
              </a>
            ) : (
              <button
                className="vela-btn vela-btn-primary vela-btn-sm"
                onClick={() => window.dispatchEvent(new CustomEvent('vela:open-deposit'))}
                style={{ flex: 1 }}
              >
                Deposit USDC
              </button>
            )}
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

      {/* Dynamic price context */}
      <PriceContextMessage
        proposal={proposal}
        currentPrice={currentPrice}
        isLong={isLong}
        isTrim={isTrim}
        isBB2={isBB2}
        positionEntryPrice={positionEntryPrice}
      />

      {/* Trade confirmation overlay */}
      {showConfirmation && (
        <TradeConfirmationSheet
          proposal={proposal}
          assetSymbol={assetSymbol}
          estimatedFee={estimatedFee}
          feeRatePct={feeRatePct}
          onConfirm={handleConfirmTrade}
          onCancel={() => setShowConfirmation(false)}
          isSubmitting={acting === 'accept'}
        />
      )}
    </Card>
  );
}

// ── Helpers ──

function DetailRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        className="vela-body-sm"
        style={{
          fontFamily: 'var(--type-mono-base-font)',
          fontWeight: 600,
          ...(valueColor && { color: valueColor }),
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Dynamic context message below buttons */
function PriceContextMessage({
  proposal,
  currentPrice,
  isLong,
  isTrim,
  isBB2,
  positionEntryPrice,
}: {
  proposal: TradeProposal;
  currentPrice?: number;
  isLong: boolean;
  isTrim: boolean;
  isBB2: boolean;
  positionEntryPrice?: number;
}) {
  // Trims: info card with profit context
  if (isTrim) {
    if (positionEntryPrice != null && currentPrice != null) {
      const pnlPct = ((currentPrice - positionEntryPrice) / positionEntryPrice) * 100;
      if (pnlPct >= 0) {
        return (
          <InfoCard>
            Locking in some profit. You&apos;re up {pnlPct.toFixed(1)}% on this position since
            entry.
          </InfoCard>
        );
      }
      return (
        <InfoCard>
          Reducing exposure. You&apos;re down {Math.abs(pnlPct).toFixed(1)}% on this position since
          entry.
        </InfoCard>
      );
    }
    return (
      <InfoCard>
        Locking in partial profits while keeping the rest of your position running.
      </InfoCard>
    );
  }

  if (currentPrice == null) {
    return <InfoCard>{getStaticContext(isBB2, isLong)}</InfoCard>;
  }

  const proposalPrice = proposal.entry_price_at_proposal;
  const deltaPct = ((currentPrice - proposalPrice) / proposalPrice) * 100;
  const absDelta = Math.abs(deltaPct);

  if (absDelta < 0.5) {
    return <InfoCard>{getStaticContext(isBB2, isLong)}</InfoCard>;
  }

  const isUp = deltaPct > 0;
  const deltaStr = `${isUp ? '+' : ''}${deltaPct.toFixed(1)}%`;
  const priceStr = formatPrice(currentPrice);
  // For shorts, price going down confirms the thesis (favorable)
  const isFavorableMove = isLong ? deltaPct > 0 : deltaPct < 0;

  if (absDelta < 3) {
    if (isFavorableMove) {
      return (
        <InfoCard>
          Price is now {priceStr} ({deltaStr} since this proposal), confirming the trade thesis.
        </InfoCard>
      );
    }
    return (
      <InfoCard>
        Heads up: price is now {priceStr} ({deltaStr} since this proposal). Our analysis still
        suggests potential. You can still proceed.
      </InfoCard>
    );
  }

  if (isFavorableMove) {
    return (
      <InfoCard>
        Price has moved significantly ({deltaStr}). Some of the expected move may have already
        happened.
      </InfoCard>
    );
  }

  return (
    <InfoCard>
      Note: price has shifted to {priceStr} ({deltaStr} since this proposal). It might be better to
      wait for the next proposal for a better entry.
    </InfoCard>
  );
}

/** Styled info card with bulb emoji and smaller text */
function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        backgroundColor: 'var(--gray-50, #F9FAFB)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--gray-200, #E5E7EB)',
      }}
    >
      <p
        style={{
          margin: 0,
          color: 'var(--color-text-muted)',
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: 'inherit',
        }}
      >
        {'💡 '}
        {children}
      </p>
    </div>
  );
}

function getStaticContext(isBB2: boolean, isLong: boolean): string {
  if (isBB2) {
    return isLong
      ? 'Short-term trade. A quick buying opportunity based on recent price action.'
      : 'Short-term trade. Indicators suggest price may drop, opportunity to profit from it.';
  }
  return isLong
    ? 'This will open a long position. Profit if price goes up.'
    : 'This will open a short position. Profit if price goes down.';
}

/** Leverage row with warning — only shown for leverage > 1 */
function LeverageRow({
  leverage,
  showWarning,
  onToggleWarning,
}: {
  leverage: number;
  showWarning: boolean;
  onToggleWarning: () => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="vela-body-sm" style={{ color: 'var(--color-text-muted)' }}>
          Leverage
        </span>
        <button
          type="button"
          onClick={onToggleWarning}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--type-mono-base-font)',
            fontWeight: 600,
            fontSize: 'inherit',
            color: 'inherit',
          }}
        >
          {leverage}x{' '}
          <span style={{ fontSize: 12, color: 'var(--color-status-yellow, #f59e0b)' }}>⚠️</span>
        </button>
      </div>
      {showWarning && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-muted)',
            marginTop: 'var(--space-1)',
            marginBottom: 0,
            padding: 'var(--space-2)',
            backgroundColor: 'var(--color-status-yellow-bg, #fffbeb)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Leveraged trades amplify both gains and losses. A {leverage}x position means your profit
          or loss is multiplied by {leverage}.
        </p>
      )}
    </div>
  );
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}

/** Format dollar amount — omit .00 for whole numbers */
function formatDollarAmount(amount: number): string {
  if (amount === Math.floor(amount)) return `$${amount.toLocaleString('en-US')}`;
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Estimated liquidation price (simplified: ignores maintenance margin) */
function estimateLiquidationPrice(entryPrice: number, leverage: number, isLong: boolean): number {
  if (isLong) return entryPrice * (1 - 1 / leverage);
  return entryPrice * (1 + 1 / leverage);
}

/** Auto-trading upgrade nudge shown after trade execution or expiry */
function AutoTradingNudge({
  message,
  onUpgradeClick,
  strong,
}: {
  message: string;
  onUpgradeClick?: () => void;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        background: strong ? 'var(--yellow-50, #FFFBEB)' : 'var(--gray-50, #F9FAFB)',
        border: `1px solid ${strong ? 'var(--yellow-200, #FDE68A)' : 'var(--gray-200, #E5E7EB)'}`,
      }}
    >
      <p
        className="vela-body-sm"
        style={{ margin: 0, color: 'var(--color-text-primary)', lineHeight: 1.5 }}
      >
        {strong ? '⚡ ' : '💡 '}
        {message}
      </p>
      {onUpgradeClick && (
        <button
          type="button"
          onClick={onUpgradeClick}
          style={{
            marginTop: 'var(--space-1)',
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--vela-signal-green)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        >
          Upgrade to Premium →
        </button>
      )}
    </div>
  );
}
