import { useNavigate } from 'react-router-dom';
import VelaLogo from './VelaLogo';
import {
  usePendingProposalsCountdown,
  type BannerUrgency,
} from '../hooks/usePendingProposalsCountdown';

/**
 * Sticky banner shown on every authenticated page when the user has pending
 * trade proposals (semi_auto + view_only). Hidden for full_auto users.
 *
 * Mounted globally in Layout (not on /trades, where proposal cards are the
 * page content). Tap navigates to /trades.
 *
 * Visual urgency escalates with countdown:
 *   normal  (T > 60m)  — pale amber bg, slow pulse
 *   urgent  (T <= 60m) — deeper amber bg, faster pulse
 *   critical(T <= 10m) — same deeper amber + thicker border, sec-by-sec countdown
 *   neutral (view_only) — grey, no countdown, no urgency
 *
 * Owns its own outer wrapper (centered, max-width 720, top padding) so the
 * Layout caller doesn't render an empty padded slot when the banner returns
 * null.
 */
export default function PendingProposalsBanner() {
  const state = usePendingProposalsCountdown();
  const navigate = useNavigate();

  if (!state) return null;

  const { label, countdownText, urgency } = state;

  // Critical state ticks every second. Polite live region so screen readers
  // get a periodic update without spamming on every minute-tick when the
  // banner is sitting in normal urgency.
  const countdownLive = urgency === 'critical' ? 'polite' : 'off';

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-4) 0',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <button
        type="button"
        onClick={() => navigate('/trades')}
        aria-label={`${label}, review pending trades`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 'var(--space-3) var(--space-4)',
          backgroundColor: bgFor(urgency),
          border: `${urgency === 'critical' ? 3 : 2}px solid ${borderFor(urgency)}`,
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontFamily: 'Inter, system-ui, sans-serif',
          boxShadow: '2px 2px 0 var(--black)',
          gap: 'var(--space-3)',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            minWidth: 0,
            flex: 1,
          }}
        >
          <VelaLogo variant="mark" size={20} pulse={urgency !== 'neutral'} />
          <span
            className="vela-body-sm"
            style={{
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
        </div>
        {countdownText && (
          <span
            className="vela-body-sm"
            aria-live={countdownLive}
            aria-atomic="true"
            style={{
              fontWeight: 700,
              color: countdownColorFor(urgency),
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {countdownText}
          </span>
        )}
        <span
          aria-hidden="true"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-action-primary)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          &rarr;
        </span>
      </button>
    </div>
  );
}

function bgFor(urgency: BannerUrgency): string {
  switch (urgency) {
    case 'normal':
      return 'var(--color-status-wait-bg)';
    case 'urgent':
    case 'critical':
      return 'var(--color-banner-urgent-bg)';
    case 'neutral':
      return 'var(--gray-100)';
  }
}

function borderFor(urgency: BannerUrgency): string {
  switch (urgency) {
    case 'normal':
      return 'var(--color-status-wait-border)';
    case 'urgent':
    case 'critical':
      return 'var(--color-banner-urgent-border)';
    case 'neutral':
      return 'var(--gray-300)';
  }
}

function countdownColorFor(urgency: BannerUrgency): string {
  switch (urgency) {
    case 'normal':
      return 'var(--color-status-wait-text)';
    case 'urgent':
    case 'critical':
      return 'var(--color-banner-urgent-text)';
    case 'neutral':
      return 'var(--color-text-secondary)';
  }
}
