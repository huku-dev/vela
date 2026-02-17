import React from 'react';
import { Alert } from './VelaComponents';
import { isDataStale } from '../utils/calculations';

interface StaleDataIndicatorProps {
  timestamp: string | Date;
  dataType?: string; // e.g., "Price", "Signal", "Market data"
  onRefresh?: () => void;
}

/**
 * StaleDataIndicator Component
 * TRUST-CRITICAL: Shows warning when financial data is >5 minutes old.
 * For Vela's "You Stay in Control" principle, users must know if they're
 * seeing outdated information that could affect their decisions.
 *
 * Usage:
 * <StaleDataIndicator
 *   timestamp={lastUpdated}
 *   dataType="Price"
 *   onRefresh={fetchLatestPrice}
 * />
 */
export function StaleDataIndicator({
  timestamp,
  dataType = 'Data',
  onRefresh,
}: StaleDataIndicatorProps) {
  const stale = isDataStale(timestamp);

  if (!stale) {
    return null;
  }

  const timestampDate = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const minutesAgo = Math.floor((Date.now() - timestampDate.getTime()) / (1000 * 60));

  return (
    <Alert variant="warning">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span>⚠️</span>
        <div style={{ flex: 1 }}>
          <strong>{dataType} may be outdated</strong>
          <p style={{ margin: 0, fontSize: '0.875rem', opacity: 0.8 }}>
            Last updated {minutesAgo} minutes ago. For trading decisions, use current data.
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{
              background: 'var(--color-warning)',
              color: 'var(--color-warning-text)',
              border: '2px solid var(--color-border-strong)',
              padding: 'var(--space-2) var(--space-4)',
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            Refresh
          </button>
        )}
      </div>
    </Alert>
  );
}

/**
 * Inline stale indicator for use in cards/smaller spaces
 */
export function InlineStaleIndicator({ timestamp }: { timestamp: string | Date }) {
  const stale = isDataStale(timestamp);

  if (!stale) {
    return null;
  }

  return (
    <span
      style={{
        color: 'var(--color-warning)',
        fontSize: '0.75rem',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      ⚠️ Data may be outdated
    </span>
  );
}

/**
 * Hook to check if data is stale
 * Can be used in components to conditionally render UI
 */
export function useStaleDataCheck(timestamp: string | Date | null): boolean {
  if (!timestamp) return false;

  try {
    return isDataStale(timestamp);
  } catch {
    return false;
  }
}
