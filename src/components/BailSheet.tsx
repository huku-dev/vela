import { useEffect } from 'react';

interface BailSheetProps {
  onChoosePlan: () => void;
  /**
   * Optional secondary path: try Premium free for 7 days. When present, a
   * secondary CTA renders above "Choose a plan". Omitted (or no-op) when
   * the user has already used their trial — eligibility is enforced
   * server-side by create-checkout-session, so the CTA is safe to show
   * unconditionally and will surface a 409 on click if misused.
   */
  onStartTrial?: () => void;
}

/**
 * Bottom sheet shown when the user returns from Stripe having cancelled or
 * abandoned checkout. Reassures them nothing was charged and offers a path
 * back to the plan selection. Dismissed via the primary CTA, backdrop tap,
 * or Escape key.
 *
 * Wireframe: mockups/stripe-bail-prompt-v1.html
 *
 * Note on focus: we deliberately do NOT programmatically focus the CTA on
 * mount. The design-system focus ring (blue, 3px) was visually jarring on
 * auto-focus and added no real a11y value here — the dialog has only one
 * focusable element, so Tab lands on it naturally, and screen readers
 * announce the sheet via aria-modal + aria-labelledby.
 */
export function BailSheet({ onChoosePlan, onStartTrial }: BailSheetProps) {
  useEffect(() => {
    // Lock body scroll while the sheet is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onChoosePlan();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [onChoosePlan]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-end',
        animation: 'bail-fade 180ms ease-out',
      }}
    >
      {/* Backdrop. aria-hidden keeps it out of the a11y tree; clicks dismiss. */}
      <div
        aria-hidden="true"
        onClick={onChoosePlan}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(10, 10, 10, 0.42)',
          cursor: 'default',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bail-sheet-title"
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 520,
          margin: '0 auto',
          background: 'var(--color-bg-page)',
          borderTop: '3px solid var(--color-border-default)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          padding: 'var(--space-4) var(--space-5) var(--space-6)',
          boxShadow: '0 -4px 0 var(--black)',
          animation: 'bail-slide 220ms ease-out',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 4,
            background: 'var(--gray-400)',
            borderRadius: 'var(--radius-full)',
            margin: '0 auto var(--space-4)',
          }}
        />

        <div
          style={{
            display: 'inline-block',
            background: 'var(--amber-light)',
            color: 'var(--amber-dark)',
            fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--weight-bold)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            marginBottom: 'var(--space-3)',
            border: '1.5px solid var(--color-border-default)',
          }}
        >
          Subscription not started
        </div>

        <h2
          id="bail-sheet-title"
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--weight-bold)',
            lineHeight: 'var(--leading-tight)',
            letterSpacing: 'var(--tracking-tight)',
            marginBottom: 'var(--space-2)',
            color: 'var(--color-text-primary)',
          }}
        >
          No worries. Nothing was charged.
        </h2>

        <p
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-normal)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Pick up where you left off and choose a plan when you&apos;re ready.
        </p>

        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            marginBottom: 'var(--space-4)',
          }}
        >
          <strong style={{ color: 'var(--green-dark)', fontWeight: 'var(--weight-bold)' }}>
            No card was saved.
          </strong>{' '}
          No payment went through.
        </div>

        {onStartTrial && (
          <button
            onClick={onStartTrial}
            className="vela-btn vela-btn-secondary"
            data-testid="bail-sheet-start-trial"
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Try Premium free for 7 days
          </button>
        )}
        <button
          onClick={onChoosePlan}
          className="vela-btn vela-btn-primary"
          style={{
            width: '100%',
            padding: 'var(--space-3)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Choose a plan
        </button>
      </div>

      <style>{`
        @keyframes bail-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bail-slide {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
