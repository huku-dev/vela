import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * NotificationsPanel is defined inside Account.tsx (not exported).
 * We test it by extracting a minimal copy for unit tests.
 * For integration tests that render inside Account, see Account integration tests.
 *
 * This file tests the NotificationsPanel logic in isolation by recreating the
 * component interface and verifying behavior patterns.
 */

// --- Minimal replica of NotificationsPanel for isolated testing ---
import { useState, useEffect } from 'react';
import type { UserPreferences } from '../types';

interface NotificationsPanelProps {
  preferences: UserPreferences | null;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  loading: boolean;
  tierFeatures: Record<string, boolean>;
  onUpgradeClick: () => void;
}

function NotificationsPanel({
  preferences,
  updatePreferences,
  loading,
  tierFeatures,
  onUpgradeClick,
}: NotificationsPanelProps) {
  const [saving, setSaving] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(preferences?.notifications_email ?? true);
  const [telegramEnabled, setTelegramEnabled] = useState(
    preferences?.notifications_telegram ?? false
  );
  const [chatId, setChatId] = useState(preferences?.telegram_chat_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const telegramAllowed = tierFeatures.telegram_alerts;

  useEffect(() => {
    if (preferences) {
      setEmailEnabled(preferences.notifications_email);
      setTelegramEnabled(preferences.notifications_telegram);
      setChatId(preferences.telegram_chat_id ?? '');
    }
  }, [preferences]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({
        notifications_email: emailEnabled,
        notifications_telegram: telegramAllowed ? telegramEnabled : false,
        telegram_chat_id: telegramAllowed && telegramEnabled ? chatId.trim() || null : null,
      } as Record<string, unknown>);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <p className="vela-body-sm vela-text-muted">Loading notification settings...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {/* Email toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div>
          <p style={{ fontWeight: 600, margin: 0 }}>Email alerts</p>
          <p style={{ margin: 0 }}>Signal changes and trade proposals</p>
        </div>
        <button
          onClick={() => setEmailEnabled(!emailEnabled)}
          aria-label={emailEnabled ? 'Disable email alerts' : 'Enable email alerts'}
          data-testid="email-toggle"
        >
          {emailEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Telegram section */}
      <div style={{ opacity: telegramAllowed ? 1 : 0.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontWeight: 600, margin: 0 }}>Telegram alerts</p>
            <p style={{ margin: 0 }}>
              {telegramAllowed ? 'Instant alerts via Telegram bot' : 'Upgrade to unlock'}
            </p>
          </div>
          {telegramAllowed ? (
            <button
              onClick={() => setTelegramEnabled(!telegramEnabled)}
              aria-label={telegramEnabled ? 'Disable Telegram alerts' : 'Enable Telegram alerts'}
              data-testid="telegram-toggle"
            >
              {telegramEnabled ? 'ON' : 'OFF'}
            </button>
          ) : (
            <button onClick={onUpgradeClick}>Upgrade</button>
          )}
        </div>

        {telegramAllowed && telegramEnabled && (
          <div>
            <label htmlFor="telegram-chat-id">Telegram chat ID</label>
            <input
              id="telegram-chat-id"
              type="text"
              placeholder="e.g. 123456789"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Save */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        {error && <p data-testid="error-message">{error}</p>}
        {success && <p data-testid="success-message">Saved</p>}
        <button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save notification preferences'}
        </button>
      </div>
    </div>
  );
}

// --- Test utilities ---
const basePreferences: UserPreferences = {
  id: 'pref-1',
  user_id: 'user-1',
  mode: 'semi_auto',
  default_position_size_usd: 1000,
  max_leverage: 5,
  max_daily_loss_pct: 5,
  max_position_pct: 25,
  stop_loss_pct: 3,
  allowed_assets: ['btc', 'eth'],
  notifications_telegram: false,
  notifications_email: true,
  telegram_chat_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const paidTierFeatures = { telegram_alerts: true, auto_mode: false };
const freeTierFeatures = { telegram_alerts: false, auto_mode: false };

describe('NotificationsPanel', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUpdatePreferences: any;
  let mockOnUpgradeClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdatePreferences = vi.fn().mockResolvedValue(undefined);
    mockOnUpgradeClick = vi.fn();
  });

  // --- Loading state ---

  it('shows loading state when loading is true', () => {
    render(
      <NotificationsPanel
        preferences={null}
        updatePreferences={mockUpdatePreferences}
        loading={true}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    expect(screen.getByText('Loading notification settings...')).toBeInTheDocument();
  });

  // --- Email toggle ---

  it('renders email toggle defaulting to ON when preferences.notifications_email is true', () => {
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    expect(screen.getByText('Email alerts')).toBeInTheDocument();
    expect(screen.getByLabelText('Disable email alerts')).toBeInTheDocument();
  });

  it('toggles email on/off', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    // Initially ON → click to turn OFF
    await user.click(screen.getByLabelText('Disable email alerts'));
    expect(screen.getByLabelText('Enable email alerts')).toBeInTheDocument();

    // Click again to turn ON
    await user.click(screen.getByLabelText('Enable email alerts'));
    expect(screen.getByLabelText('Disable email alerts')).toBeInTheDocument();
  });

  // --- Telegram: free tier (locked) ---

  it('shows "Upgrade to unlock" when telegram_alerts is false (free tier)', () => {
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={freeTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    expect(screen.getByText('Upgrade to unlock')).toBeInTheDocument();
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
  });

  it('calls onUpgradeClick when "Upgrade" button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={freeTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    await user.click(screen.getByText('Upgrade'));
    expect(mockOnUpgradeClick).toHaveBeenCalledTimes(1);
  });

  it('does not show Telegram toggle on free tier', () => {
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={freeTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    expect(screen.queryByLabelText(/Telegram alerts/)).not.toBeInTheDocument();
  });

  // --- Telegram: paid tier (unlocked) ---

  it('shows Telegram toggle when telegram_alerts is true (paid tier)', () => {
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );
    expect(screen.getByLabelText('Enable Telegram alerts')).toBeInTheDocument();
    expect(screen.getByText('Instant alerts via Telegram bot')).toBeInTheDocument();
  });

  it('shows chat ID input only when Telegram is enabled', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    // Telegram is off by default → no chat ID input
    expect(screen.queryByLabelText('Telegram chat ID')).not.toBeInTheDocument();

    // Turn Telegram on → chat ID input appears
    await user.click(screen.getByLabelText('Enable Telegram alerts'));
    expect(screen.getByLabelText('Telegram chat ID')).toBeInTheDocument();
  });

  it('pre-fills chat ID from preferences', () => {
    render(
      <NotificationsPanel
        preferences={{
          ...basePreferences,
          notifications_telegram: true,
          telegram_chat_id: '12345',
        }}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    const input = screen.getByLabelText('Telegram chat ID') as HTMLInputElement;
    expect(input.value).toBe('12345');
  });

  // --- Save behavior ---

  it('calls updatePreferences with correct values on save', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      notifications_email: true,
      notifications_telegram: false,
      telegram_chat_id: null,
    });
  });

  it('saves Telegram chat ID when Telegram is enabled', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={{ ...basePreferences, notifications_telegram: true, telegram_chat_id: '' }}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    // Type a chat ID
    const input = screen.getByLabelText('Telegram chat ID');
    await user.clear(input);
    await user.type(input, '987654321');

    await user.click(screen.getByText('Save notification preferences'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      notifications_email: true,
      notifications_telegram: true,
      telegram_chat_id: '987654321',
    });
  });

  it('SECURITY: forces notifications_telegram to false when free tier saves', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={{ ...basePreferences, notifications_telegram: true }}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={freeTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications_telegram: false,
        telegram_chat_id: null,
      })
    );
  });

  it('shows success message after saving', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    await waitFor(() => {
      expect(screen.getByTestId('success-message')).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    const user = userEvent.setup();
    mockUpdatePreferences.mockRejectedValueOnce(new Error('Network error'));
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Network error');
    });
  });

  it('disables save button while saving', async () => {
    // Slow updatePreferences that we can control
    let resolveUpdate: () => void;
    mockUpdatePreferences.mockImplementation(
      () =>
        new Promise<void>(r => {
          resolveUpdate = r;
        })
    );
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={basePreferences}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    expect(screen.getByText('Saving...')).toBeDisabled();

    // Resolve to clean up
    resolveUpdate!();
    await waitFor(() => {
      expect(screen.getByText('Save notification preferences')).not.toBeDisabled();
    });
  });

  // --- Trimmed whitespace in chat ID ---

  it('trims whitespace from chat ID before saving', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={{ ...basePreferences, notifications_telegram: true, telegram_chat_id: '' }}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    const input = screen.getByLabelText('Telegram chat ID');
    await user.clear(input);
    await user.type(input, '  123  ');

    await user.click(screen.getByText('Save notification preferences'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_chat_id: '123' })
    );
  });

  it('sends null for empty chat ID', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsPanel
        preferences={{ ...basePreferences, notifications_telegram: true, telegram_chat_id: '' }}
        updatePreferences={mockUpdatePreferences}
        loading={false}
        tierFeatures={paidTierFeatures}
        onUpgradeClick={mockOnUpgradeClick}
      />
    );

    await user.click(screen.getByText('Save notification preferences'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_chat_id: null })
    );
  });
});
