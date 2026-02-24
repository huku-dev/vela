import React, { useState } from 'react';
import type { SubscriptionTier, TierConfig } from '../types';
import { TIER_DEFINITIONS, COMPARISON_FEATURES } from '../lib/tier-definitions';

interface TierComparisonSheetProps {
  currentTier: SubscriptionTier;
  onClose: () => void;
}

/**
 * Full-screen overlay showing tier comparison with annual/monthly toggle.
 * Follows the Vela neobrutalist design system.
 */
export default function TierComparisonSheet({ currentTier, onClose }: TierComparisonSheetProps) {
  const [billingCycle, setBillingCycle] = useState<'annual' | 'monthly'>('annual');

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
            const isRecommended = tier.tier === 'standard';
            const isPaid = tier.monthly_price_usd > 0;

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

                {/* Tier name */}
                <h3
                  className="vela-heading-base"
                  style={{
                    margin: 0,
                    marginBottom: 'var(--space-1)',
                    fontSize: '1rem',
                    fontWeight: 700,
                  }}
                >
                  {tier.display_name}
                </h3>

                {/* Price */}
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
                  {isPaid && billingCycle === 'annual' && (
                    <p
                      className="vela-body-sm vela-text-muted"
                      style={{ margin: 0, marginTop: 2, fontSize: '0.65rem' }}
                    >
                      Billed {getBillingNote(tier)}
                    </p>
                  )}
                </div>

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
                    disabled
                    className="vela-btn vela-btn-primary vela-label-sm"
                    style={{
                      width: '100%',
                      opacity: 0.6,
                      cursor: 'not-allowed',
                      fontWeight: 600,
                    }}
                    title="Coming soon"
                  >
                    Coming soon
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center', fontSize: '0.7rem', lineHeight: 1.5 }}
        >
          All plans include real-time signal monitoring and market analysis.
          <br />
          Paid plans will be available soon via Stripe. You won&apos;t be charged until you upgrade.
        </p>
      </div>
    </div>
  );
}
