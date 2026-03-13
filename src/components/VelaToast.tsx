import { useEffect, useState, useCallback } from 'react';

interface VelaToastProps {
  message: string;
  variant?: 'success' | 'error';
  /** Auto-dismiss after this many ms. 0 = never. Default: 3000 */
  autoDismissMs?: number;
  onDismiss: () => void;
}

/**
 * Temporary toast notification — appears at top of viewport, auto-dismisses.
 * Use for contextual feedback like checkout success, settings saved, etc.
 */
export default function VelaToast({
  message,
  variant = 'success',
  autoDismissMs = 3000,
  onDismiss,
}: VelaToastProps) {
  const [visible, setVisible] = useState(true);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 200); // wait for fade-out
  }, [onDismiss]);

  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = setTimeout(dismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, dismiss]);

  const isError = variant === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'var(--space-6)',
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '-8px'})`,
        opacity: visible ? 1 : 0,
        backgroundColor: isError ? 'var(--color-status-sell-bg)' : 'var(--color-status-buy-bg)',
        border: `1.5px solid ${isError ? 'var(--red-primary)' : 'var(--green-primary)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3) var(--space-5)',
        boxShadow: '3px 3px 0 var(--black)',
        zIndex: 800,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        maxWidth: 480,
        width: 'calc(100% - var(--space-6) * 2)',
        transition: 'opacity 200ms ease, transform 200ms ease',
      }}
    >
      <span
        className="vela-body-sm"
        style={{
          fontWeight: 600,
          color: isError ? 'var(--red-dark)' : 'var(--green-dark)',
        }}
      >
        {message}
      </span>
      <button
        onClick={() => dismiss()}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: isError ? 'var(--red-dark)' : 'var(--green-dark)',
          fontSize: 16,
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        &#x2715;
      </button>
    </div>
  );
}
