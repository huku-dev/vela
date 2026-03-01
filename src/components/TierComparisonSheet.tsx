import React, { useState } from 'react';
import type { SubscriptionTier, TierConfig } from '../types';
import { TIER_DEFINITIONS, COMPARISON_FEATURES } from '../lib/tier-definitions';

interface TierComparisonSheetProps {
  currentTier: SubscriptionTier;
  onClose: () => void;
  /** Called when the user clicks an upgrade/downgrade CTA. Redirect handled by caller. */
  onStartCheckout?: (
    tier: 'standard' | 'premium',
    billingCycle: 'monthly' | 'annual'
  ) => Promise<void>;
}

/**
 * Full-screen overlay showing tier comparison with annual/monthly toggle.
 * Follows the Vela neobrutalist design system.
 */
export default function TierComparisonSheet({
  currentTier,
  onClose,
  onStartCheckout,
}: TierComparisonSheetProps) {
  const [billingCycle, setBillingCycle] = useState<'annual' | 'monthly'>('annual');
  const [checkingOutTier, setCheckingOutTier] = useState<SubscriptionTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [expandedTiers, setExpandedTiers] = useState<Set<SubscriptionTier>>(new Set());

  const TIER_ORDER: SubscriptionTier[] = ['free', 'standard', 'premium'];
  const currentTierIndex = TIER_ORDER.indexOf(currentTier);

  // Recommend the next tier above current (the upgrade target)
  const recommendedTier: SubscriptionTier | null =
    currentTierIndex < TIER_ORDER.length - 1 ? TIER_ORDER[currentTierIndex + 1] : null;

  // Tiers at or below current tier start collapsed
  const shouldCollapse = (tier: SubscriptionTier): boolean => {
    const tierIndex = TIER_ORDER.indexOf(tier);
    // When at top tier, keep current expanded (nothing to upgrade to)
    if (recommendedTier === null && tier === currentTier) return false;
    return tierIndex <= currentTierIndex;
  };

  async function handleCta(tier: TierConfig) {
    if (!onStartCheckout || tier.monthly_price_usd === 0) return;
    setCheckingOutTier(tier.tier);
    setCheckoutError(null);
    try {
      await onStartCheckout(tier.tier as 'standard' | 'premium', billingCycle);
    } catch (err) {
      console.error('[TierComparisonSheet] Checkout error:', err);
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setCheckoutError(msg);
      setCheckingOutTier(null);
    }
  }

  function getCtaLabel(tier: TierConfig): string {
    if (checkingOutTier === tier.tier) return 'Redirecting…';
    const tierIndex = TIER_ORDER.indexOf(tier.tier);
    if (tierIndex > currentTierIndex) return `Upgrade to ${tier.display_name}`;
    return `Switch to ${tier.display_name}`;
  }

  const getPrice = (tier: TierConfig): string => {
    if (tier.monthly_price_usd === 0) return 'Free';
    if (billingCycle === 'annual') {
      const monthly = Math.ceil(tier.annual_price_usd / 12);
      return `$${monthly}`;
    }
    return `$${tier.monthly_price_usd}`;
  };

  const getBillingNote = (tier: TierConfig): string | null => {
    if (tier.monthly_price_usd === 0) return null;
    if (billingCycle === 'annual') {
      return `$${tier.annual_price_usd}/yr`;
    }
    return '/mo';
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'var(--color-bg-page)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 'var(--space-6) var(--space-4) var(--space-10)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-6)',
          }}
        >
          <h2 className="vela-heading-lg" style={{ margin: 0, fontSize: '1.3rem' }}>
            Choose your plan
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 'var(--space-2)',
              color: 'var(--color-text-primary)',
              fontSize: 20,
            }}
          >
            ✕
          </button>
        </div>

        {/* Billing toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <button
            onClick={() => setBillingCycle('annual')}
            className="vela-label-sm"
            style={{
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              border:
                billingCycle === 'annual' ? '2px solid var(--black)' : '1px solid var(--gray-200)',
              backgroundColor: billingCycle === 'annual' ? 'var(--gray-100)' : 'transparent',
              fontWeight: billingCycle === 'annual' ? 700 : 500,
              cursor: 'pointer',
              boxShadow: billingCycle === 'annual' ? '2px 2px 0 var(--black)' : 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Annual
            <span
              style={{
                marginLeft: 'var(--space-2)',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--green-dark)',
                backgroundColor: 'var(--color-status-buy-bg)',
                padding: '1px 6px',
                borderRadius: '3px',
              }}
            >
              Save 17%
            </span>
          </button>
          <button
            onClick={() => setBillingCycle('monthly')}
            className="vela-label-sm"
            style={{
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              border:
                billingCycle === 'monthly' ? '2px solid var(--black)' : '1px solid var(--gray-200)',
              backgroundColor: billingCycle === 'monthly' ? 'var(--gray-100)' : 'transparent',
              fontWeight: billingCycle === 'monthly' ? 700 : 500,
              cursor: 'pointer',
              boxShadow: billingCycle === 'monthly' ? '2px 2px 0 var(--black)' : 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Monthly
          </button>
        </div>

        {/* Tier cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}
        >
          {TIER_DEFINITIONS.map(tier => {
            const isCurrent = tier.tier === currentTier;
            const isRecommended = tier.tier === recommendedTier;
            const isPaid = tier.monthly_price_usd > 0;
            const isCollapsible = shouldCollapse(tier.tier);
            const isExpanded = expandedTiers.has(tier.tier);

            // Collapsed summary for tiers at or below current
            if (isCollapsible && !isExpanded) {
              return (
                <div
                  key={tier.tier}
                  className="vela-card"
                  onClick={() => setExpandedTiers(prev => new Set(prev).add(tier.tier))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setExpandedTiers(prev => new Set(prev).add(tier.tier));
                  }}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    border: '1.5px solid var(--gray-200)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <h3
                      className="vela-heading-base"
                      style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}
                    >
                      {tier.display_name}
                    </h3>
                    {isPaid && (
                      <span className="vela-body-sm vela-text-muted" style={{ fontSize: '0.7rem' }}>
                        {getPrice(tier)}/mo
                      </span>
                    )}
                    {isCurrent && (
                      <span
                        className="vela-label-sm"
                        style={{
                          fontSize: '0.6rem',
                          fontWeight: 600,
                          color: 'var(--color-text-muted)',
                          border: '1px solid var(--gray-200)',
                          borderRadius: '3px',
                          padding: '1px 6px',
                        }}
                      >
                        Current plan
                      </span>
                    )}
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{ flexShrink: 0 }}
                  >
                    <path
                      d="M4 6l4 4 4-4"
                      stroke="var(--color-text-muted)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              );
            }

            return (
              <div
                key={tier.tier}
                className="vela-card"
                style={{
                  padding: 'var(--space-5)',
                  border: isRecommended ? '3px solid var(--black)' : '1.5px solid var(--gray-200)',
                  boxShadow: isRecommended ? '4px 4px 0 var(--black)' : 'none',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Recommended badge */}
                {isRecommended && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -10,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--green-dark)',
                      backgroundColor: 'var(--color-status-buy-bg)',
                      border: '1.5px solid var(--green-primary)',
                      borderRadius: '4px',
                      padding: '2px 10px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Recommended
                  </span>
                )}

                {/* Collapse button for expanded collapsible tiers */}
                {isCollapsible && isExpanded && (
                  <button
                    onClick={() =>
                      setExpandedTiers(prev => {
                        const next = new Set(prev);
                        next.delete(tier.tier);
                        return next;
                      })
                    }
                    style={{
                      position: 'absolute',
                      top: 'var(--space-3)',
                      right: 'var(--space-3)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 'var(--space-1)',
                    }}
                    aria-label="Collapse"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M4 10l4-4 4 4"
                        stroke="var(--color-text-muted)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}

                {/* Tier name */}
                <h3
                  className="vela-heading-base"
                  style={{
                    margin: 0,
                    marginBottom: isPaid ? 'var(--space-1)' : 'var(--space-3)',
                    fontSize: '1rem',
                    fontWeight: 700,
                  }}
                >
                  {tier.display_name}
                </h3>

                {/* Price — hidden for free tier (name is self-explanatory) */}
                {isPaid && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '1.8rem',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                        lineHeight: 1.1,
                      }}
                    >
                      {getPrice(tier)}
                    </span>
                    {getBillingNote(tier) && (
                      <span
                        className="vela-body-sm vela-text-muted"
                        style={{ marginLeft: 'var(--space-1)', fontSize: '0.7rem' }}
                      >
                        {billingCycle === 'annual' ? '/mo' : getBillingNote(tier)}
                      </span>
                    )}
                    {billingCycle === 'annual' && (
                      <p
                        className="vela-body-sm vela-text-muted"
                        style={{ margin: 0, marginTop: 2, fontSize: '0.65rem' }}
                      >
                        Billed {getBillingNote(tier)}
                      </p>
                    )}
                  </div>
                )}

                {/* Feature list */}
                <div style={{ flex: 1, marginBottom: 'var(--space-4)' }}>
                  {COMPARISON_FEATURES.map(feature => (
                    <div
                      key={feature.key}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: 'var(--space-1) 0',
                        borderBottom: '1px solid var(--gray-100)',
                      }}
                    >
                      <span className="vela-body-sm vela-text-muted" style={{ fontSize: '0.7rem' }}>
                        {feature.label}
                      </span>
                      <span
                        className="vela-body-sm"
                        style={{
                          fontWeight: 600,
                          fontSize: '0.7rem',
                          color:
                            feature.getValue(tier) === '\u2014'
                              ? 'var(--color-text-muted)'
                              : feature.key === 'fee' && feature.getValue(tier) === 'Free'
                                ? 'var(--green-dark)'
                                : 'var(--color-text-primary)',
                        }}
                      >
                        {feature.getValue(tier)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                {isCurrent ? (
                  <div
                    className="vela-label-sm"
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-2) var(--space-4)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1.5px solid var(--gray-200)',
                      color: 'var(--color-text-muted)',
                      fontWeight: 600,
                    }}
                  >
                    Current plan
                  </div>
                ) : isPaid ? (
                  <button
                    onClick={() => handleCta(tier)}
                    disabled={checkingOutTier !== null}
                    className="vela-btn vela-btn-primary vela-label-sm"
                    style={{
                      width: '100%',
                      fontWeight: 600,
                      opacity: checkingOutTier !== null ? 0.7 : 1,
                      cursor: checkingOutTier !== null ? 'wait' : 'pointer',
                    }}
                  >
                    {getCtaLabel(tier)}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Checkout error */}
        {checkoutError && (
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: 'var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              border: '1.5px solid var(--red-primary)',
              backgroundColor: 'var(--color-status-sell-bg)',
              textAlign: 'center',
            }}
          >
            <span className="vela-body-sm" style={{ color: 'var(--red-dark)' }}>
              {checkoutError}
            </span>
          </div>
        )}

        {/* Footer note */}
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center', fontSize: '0.7rem', lineHeight: 1.5 }}
        >
          All plans include real-time signal monitoring and market analysis.
          <br />
          Cancel anytime. You won&apos;t be charged until you confirm on the next screen.
        </p>
      </div>
    </div>
  );
}
