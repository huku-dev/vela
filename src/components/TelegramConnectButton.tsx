import { useState, useEffect, useRef, useCallback } from 'react';
import { useTrading } from '../hooks/useTrading';

interface TelegramConnectButtonProps {
  /** Current telegram_chat_id from preferences (null = not connected) */
  chatId: string | null;
  /** Called after successful connection or disconnection */
  onStatusChange?: () => void;
  /** Compact mode for nudge cards (smaller text) */
  compact?: boolean;
}

const POLL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * One-tap Telegram connection button.
 * Opens t.me deep link, polls user_preferences for chat_id.
 */
export default function TelegramConnectButton({
  chatId,
  onStatusChange,
  compact = false,
}: TelegramConnectButtonProps) {
  const { generateTelegramLink, updatePreferences, preferences } = useTrading();
  const [status, setStatus] = useState<'idle' | 'linking' | 'polling' | 'connected' | 'error'>(
    chatId ? 'connected' : 'idle'
  );
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync status with external chatId prop
  useEffect(() => {
    if (chatId && status !== 'connected') setStatus('connected');
    if (!chatId && status === 'connected') setStatus('idle');
  }, [chatId, status]);

  const cleanup = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  // Detect connection via preferences polling
  useEffect(() => {
    if (preferences?.telegram_chat_id && status === 'polling') {
      setStatus('connected');
      cleanup();
      onStatusChange?.();
    }
  }, [preferences?.telegram_chat_id, status, onStatusChange, cleanup]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const handleConnect = async () => {
    setStatus('linking');
    setErrorMsg('');

    try {
      const deepLink = await generateTelegramLink();

      // Open Telegram in new tab
      window.open(deepLink, '_blank');

      // Start polling for connection
      setStatus('polling');

      // Timeout after 2 min
      timeoutRef.current = setTimeout(() => {
        cleanup();
        setStatus('idle');
      }, POLL_TIMEOUT_MS);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate link');
    }
  };

  const handleDisconnect = async () => {
    try {
      await updatePreferences({
        telegram_chat_id: null,
        notifications_telegram: false,
      } as Parameters<typeof updatePreferences>[0]);
      setStatus('idle');
      onStatusChange?.();
    } catch {
      // Best effort
      setStatus('idle');
    }
  };

  const textClass = compact ? 'vela-body-sm' : 'vela-body';

  if (status === 'connected') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className={textClass} style={{ color: 'var(--green-dark)', fontWeight: 600 }}>
          {telegramIcon(16)} Connected
        </span>
        <button
          onClick={handleDisconnect}
          className="vela-body-sm"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (status === 'polling') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className={textClass} style={{ color: 'var(--color-text-muted)' }}>
          Waiting for Telegram connection...
        </span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div>
        <button onClick={handleConnect} className={`vela-btn vela-btn-outline${compact ? ' vela-btn-sm' : ''}`} style={btnStyle(compact)}>
          Retry
        </button>
        <p className="vela-body-sm" style={{ color: 'var(--color-error)', marginTop: 'var(--space-1)' }}>
          {errorMsg}
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={status === 'linking'}
      className={`vela-btn vela-btn-outline${compact ? ' vela-btn-sm' : ''}`}
      style={btnStyle(compact)}
    >
      {status === 'linking' ? 'Opening...' : 'Connect'}
    </button>
  );
}

function btnStyle(compact: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontSize: compact ? 'var(--text-xs)' : 'var(--text-base)',
    padding: compact ? '4px 10px' : 'var(--space-2) var(--space-4)',
    whiteSpace: 'nowrap',
  };
}

function telegramIcon(size: number) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ flexShrink: 0 }}
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
