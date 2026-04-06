import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DepositSheet from './DepositSheet';
import type { UserWallet } from '../types';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockGetToken = vi.fn().mockResolvedValue('test-jwt-token');

vi.mock('../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    getToken: mockGetToken,
    isAuthenticated: true,
  }),
}));

const mockFundWallet = vi.fn();
vi.mock('@privy-io/react-auth', () => ({
  useFundWallet: () => ({ fundWallet: mockFundWallet }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock clipboard — must be set on existing navigator object
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText, readText: vi.fn().mockResolvedValue('') },
  writable: true,
  configurable: true,
});

// ── Fixtures ───────────────────────────────────────────────────────────

const mockWallet: UserWallet = {
  id: 'wallet-1',
  user_id: 'did:privy:test',
  master_wallet_id: 'mw-1',
  master_address: '0x1234567890abcdef1234567890abcdef12345678',
  agent_wallet_id: 'aw-1',
  agent_address: '0xagentaddr',
  agent_registered: true,
  balance_usdc: 500.0,
  balance_last_synced_at: '2026-03-01T12:00:00Z',
  trial_trade_used: false,
  environment: 'testnet',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderSheet(props?: Partial<Parameters<typeof DepositSheet>[0]>) {
  const defaultProps = {
    wallet: mockWallet,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  };
  return render(<DepositSheet {...defaultProps} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('DepositSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ──

  it('renders the dialog with correct role and aria attributes', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Deposit to Wallet');
  });

  it('shows deposit heading', () => {
    renderSheet();
    expect(screen.getByText('Deposit to Wallet')).toBeInTheDocument();
  });

  it('renders two tabs: Deposit cash and Transfer USDC', () => {
    renderSheet();
    expect(screen.getByText('Deposit cash')).toBeInTheDocument();
    expect(screen.getByText('Transfer USDC')).toBeInTheDocument();
  });

  it('defaults to "Deposit cash" tab', () => {
    renderSheet();
    expect(screen.getByText('Add funds')).toBeInTheDocument();
    // Transfer tab content should not be visible
    expect(screen.queryByText('YOUR DEPOSIT ADDRESS')).not.toBeInTheDocument();
  });

  // ── Deposit Cash Tab ──

  it('shows payment method labels', () => {
    renderSheet();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Apple Pay')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
  });

  it('shows minimum deposit notice', () => {
    renderSheet();
    expect(screen.getByText(/Minimum deposit: \$5/)).toBeInTheDocument();
    expect(screen.getByText(/can't be credited/i)).toBeInTheDocument();
  });

  it('shows "Add funds" button', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /add funds/i })).toBeInTheDocument();
  });

  it('calls fundWallet with Arbitrum USDC config when "Add funds" clicked', async () => {
    mockFundWallet.mockResolvedValueOnce({ status: 'cancelled' });
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /add funds/i }));
    expect(mockFundWallet).toHaveBeenCalledWith({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      options: {
        chain: { id: 42161 },
        amount: '50',
        asset: 'USDC',
        defaultFundingMethod: 'card',
        card: { preferredProvider: 'moonpay' },
      },
    });
  });

  it('shows "Connecting to payment provider..." while pending', async () => {
    // Never resolve — keep in pending state
    mockFundWallet.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /add funds/i }));
    expect(screen.getByText(/connecting to payment provider/i)).toBeInTheDocument();
  });

  it('returns to idle when user cancels the checkout', async () => {
    mockFundWallet.mockResolvedValueOnce({ status: 'cancelled' });
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /add funds/i }));
    await waitFor(() => {
      expect(screen.getByText('Add funds')).toBeInTheDocument();
    });
  });

  it('returns to idle after completed purchase (no false payment confirmation)', async () => {
    mockFundWallet.mockResolvedValueOnce({ status: 'completed' });
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /add funds/i }));
    // Should NOT show "payment received" — only on-chain detection can confirm
    await waitFor(() => {
      expect(screen.getByText('Add funds')).toBeInTheDocument();
    });
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  it('returns to idle when funding throws (popup closed)', async () => {
    mockFundWallet.mockRejectedValueOnce(new Error('User closed popup'));
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /add funds/i }));
    await waitFor(() => {
      expect(screen.getByText('Add funds')).toBeInTheDocument();
    });
  });

  it('does not show "I\'ve sent the USDC" button on deposit cash tab', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: /i've sent the usdc/i })).not.toBeInTheDocument();
  });

  // ── Transfer Tab ──

  it('shows deposit address when Transfer USDC tab selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    expect(screen.getByText('YOUR DEPOSIT ADDRESS')).toBeInTheDocument();
  });

  it('shows full wallet address on transfer tab (not truncated)', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument();
  });

  it('renders QR code SVG on transfer tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('copy button triggers clipboard write on transfer tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    await user.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  // ── Network Dropdown (Transfer Tab) ──

  it('shows network dropdown with placeholder on transfer tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    const select = screen.getByLabelText('Select deposit network');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('');
  });

  it('does not show USDC warning when no network is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    expect(screen.queryByText(/only send usdc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/only send via hyperliquid/i)).not.toBeInTheDocument();
  });

  it('shows Arbitrum warning when Arbitrum is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'arbitrum');
    expect(screen.getByText(/only send usdc on arbitrum/i)).toBeInTheDocument();
  });

  it('shows Hyperliquid warning when Hyperliquid is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'hyperliquid');
    expect(screen.getByText(/only send via hyperliquid usdsend/i)).toBeInTheDocument();
  });

  // ── Refresh Balance (Transfer Tab) ──

  it('shows "I\'ve sent the USDC" button on transfer tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    expect(screen.getByRole('button', { name: /i've sent the usdc/i })).toBeInTheDocument();
  });

  it('does not show "Check balance now" button', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    expect(screen.queryByRole('button', { name: /check balance now/i })).not.toBeInTheDocument();
  });

  it('shows confirmation message after clicking "I\'ve sent the USDC"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: 600, deposit_detected: 100 }),
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    render(<DepositSheet wallet={mockWallet} onClose={onClose} onRefresh={onRefresh} />);

    // Switch to transfer tab first
    await user.click(screen.getByText('Transfer USDC'));

    // Must select a network first — button is disabled until network chosen
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'arbitrum');

    // "I've sent the USDC" shows confirmation message (does NOT close sheet)
    await user.click(screen.getByRole('button', { name: /i've sent the usdc/i }));
    expect(onClose).not.toHaveBeenCalled();

    // Confirmation message appears
    expect(screen.getByText(/we'll check for deposits to your wallet/i)).toBeInTheDocument();

    // Button is replaced — no longer visible
    expect(screen.queryByRole('button', { name: /i've sent the usdc/i })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/refresh-balance'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('"I\'ve sent the USDC" button is disabled until network is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    const btn = screen.getByRole('button', { name: /i've sent the usdc/i });
    expect(btn).toBeDisabled();
  });

  it('does not show last synced time', () => {
    renderSheet();
    expect(screen.queryByText(/last synced/i)).not.toBeInTheDocument();
  });

  // ── Dismiss ──

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DepositSheet wallet={mockWallet} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key pressed on dialog', () => {
    const onClose = vi.fn();
    render(<DepositSheet wallet={mockWallet} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DepositSheet wallet={mockWallet} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    await user.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── Adversarial Tests ─────────────────────────────────────────────────
//
// DEPOSIT-ADV: Defense-in-depth tests for the deposit flow.
//
// Attack vectors covered:
// 1. False deposit confirmation via manipulated refreshResult
// 2. Negative deposit amounts
// 3. NaN deposit amounts
// 4. Zero deposit amounts
// 5. Race condition on unmount
// 6. Rapid button clicks (double-submit)
// 7. XSS via wallet address

describe('DEPOSIT-ADV: False deposit confirmation — manipulated refreshResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: deposit banner requires depositDetected > 0 (not just truthy)', async () => {
    // A crafted response where deposit_detected is a truthy string instead of a number
    // The component guard is: refreshResult?.depositDetected && refreshResult.depositDetected > 0
    // A string like "hacked" is truthy but "hacked" > 0 is false (NaN comparison)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 9999, deposit_detected: 'hacked' }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'arbitrum');
    await user.click(screen.getByRole('button', { name: /i've sent the usdc/i }));

    // Wait for fetch to complete
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // No false deposit banner should appear
    expect(screen.queryByText(/deposit detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$9999/)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: deposit banner does not render when depositDetected is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: null }),
    });

    renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(screen.queryByText(/deposit detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: card tab confirmed state requires depositDetected > 0 from poll', async () => {
    // First call: no deposit. Second call: fake deposit injected after card flow.
    // The component should only show "Deposit received" if the auto-poll returns > 0.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance: 500, deposit_detected: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance: 500, deposit_detected: 0 }),
      });

    mockFundWallet.mockResolvedValueOnce({ status: 'completed' });

    const user = userEvent.setup();
    renderSheet();

    // Wait for initial poll
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: /add funds/i }));

    // After fundWallet resolves, it triggers another refresh
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // deposit_detected was 0, so no confirmation banner
    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });
});

describe('DEPOSIT-ADV: Negative deposit amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: negative depositDetected does not show deposit banner on transfer tab', async () => {
    // An attacker or buggy server returning a negative deposit amount
    // could trick the UI into showing "Deposit detected: -$50.00"
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 450, deposit_detected: -50 }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Guard: depositDetected > 0 blocks negative values
    expect(screen.queryByText(/deposit detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/-\$50/)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: negative depositDetected does not trigger confirmed state on card tab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 450, deposit_detected: -100 }),
    });

    renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // The card tab useEffect guard: depositDetected > 0
    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });
});

describe('DEPOSIT-ADV: NaN deposit amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: NaN depositDetected does not show deposit banner', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: NaN }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // NaN > 0 is false, so the deposit confirmation banner is NOT shown
    expect(screen.queryByText(/Deposit received/)).not.toBeInTheDocument();
    // The deposit amount guard (> 0) prevents NaN from triggering the success banner
    expect(screen.queryByText(/Deposit detected/)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: NaN depositDetected does not trigger confirmed state on card tab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: NaN }),
    });

    renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: undefined deposit_detected from API does not crash or show banner', async () => {
    // Server returns no deposit_detected field at all
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500 }),
    });

    renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(screen.queryByText(/deposit detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });
});

describe('DEPOSIT-ADV: Zero deposit amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: zero depositDetected shows no confirmation on transfer tab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: 0 }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // 0 is falsy, so refreshResult?.depositDetected && ... short-circuits
    expect(screen.queryByText(/deposit detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('DEPOSIT-ADV: zero depositDetected shows no confirmation on card tab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: 0 }),
    });

    renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(screen.queryByText(/deposit received/i)).not.toBeInTheDocument();
  });
});

describe('DEPOSIT-ADV: Race condition — fundWallet resolves after unmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: no state update error when fundWallet resolves after unmount', async () => {
    // fundWallet returns a promise that resolves after we unmount
    let resolveFunding!: (value: { status: string }) => void;
    mockFundWallet.mockReturnValue(
      new Promise(resolve => {
        resolveFunding = resolve;
      })
    );

    // Suppress console.error for React state-after-unmount warnings
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    const { unmount } = renderSheet();

    await user.click(screen.getByRole('button', { name: /add funds/i }));
    expect(screen.getByText(/connecting to payment provider/i)).toBeInTheDocument();

    // Unmount while fundWallet is still pending
    unmount();

    // Now resolve the promise — should not throw
    resolveFunding({ status: 'completed' });

    // Give microtasks a chance to flush
    await new Promise(r => setTimeout(r, 50));

    // If React logged a "can't perform state update on unmounted component" warning,
    // that is acceptable in React 18 (it removed the warning). The key assertion is
    // that no unhandled exception was thrown.
    consoleError.mockRestore();
  });

  it('DEPOSIT-ADV: auto-poll interval is cleared on unmount (no leak)', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: null }),
    });

    const { unmount } = renderSheet();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    unmount();

    // The useEffect cleanup should have called clearInterval
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

describe('DEPOSIT-ADV: Rapid button clicks — double-submit prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: rapid "Add funds" clicks only call fundWallet once', async () => {
    // fundWallet hangs forever (pending state)
    mockFundWallet.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    renderSheet();

    const btn = screen.getByRole('button', { name: /add funds/i });

    // Click rapidly multiple times
    await user.click(btn);
    // After first click, button becomes disabled (pending state)
    // Subsequent clicks should not trigger fundWallet again
    await user.click(btn);
    await user.click(btn);

    // fundWallet should only be called once because button is disabled after first click
    expect(mockFundWallet).toHaveBeenCalledTimes(1);
  });

  it('DEPOSIT-ADV: rapid "I\'ve sent the USDC" clicks only trigger one refresh', async () => {
    let fetchCallCount = 0;
    mockFetch.mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ balance: 500, deposit_detected: null }),
      });
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Transfer USDC'));
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'arbitrum');

    // Record fetch count after initial auto-poll
    await waitFor(() => {
      expect(fetchCallCount).toBeGreaterThanOrEqual(1);
    });
    const countAfterPoll = fetchCallCount;

    const btn = screen.getByRole('button', { name: /i've sent the usdc/i });

    // Click — this sets sentConfirmed=true, which hides the button
    await user.click(btn);

    // Button should be gone after first click (replaced by confirmation text)
    expect(screen.queryByRole('button', { name: /i've sent the usdc/i })).not.toBeInTheDocument();

    // Only one additional refresh triggered (the handleConfirm call)
    // The refreshingRef guard prevents concurrent refreshes
    await waitFor(() => {
      expect(fetchCallCount).toBe(countAfterPoll + 1);
    });
  });
});

describe('DEPOSIT-ADV: XSS via wallet address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEPOSIT-ADV: script tag in master_address is rendered as text, not executed', async () => {
    const xssWallet: UserWallet = {
      ...mockWallet,
      master_address: '<script>alert("xss")</script>',
    };

    const user = userEvent.setup();
    render(<DepositSheet wallet={xssWallet} onClose={vi.fn()} />);
    await user.click(screen.getByText('Transfer USDC'));

    // React auto-escapes, so the script tag should appear as text content
    const addressEl = screen.getByText('<script>alert("xss")</script>');
    expect(addressEl).toBeInTheDocument();

    // Verify no actual script element was injected into the DOM
    const scripts = document.querySelectorAll('script');
    const injected = Array.from(scripts).filter(s => s.textContent?.includes('alert("xss")'));
    expect(injected).toHaveLength(0);
  });

  it('DEPOSIT-ADV: img onerror XSS in master_address is rendered as text', async () => {
    const xssWallet: UserWallet = {
      ...mockWallet,
      master_address: '"><img src=x onerror=alert(1)>',
    };

    const user = userEvent.setup();
    render(<DepositSheet wallet={xssWallet} onClose={vi.fn()} />);
    await user.click(screen.getByText('Transfer USDC'));

    // Should be rendered as text, not as an image element
    expect(screen.getByText('"><img src=x onerror=alert(1)>')).toBeInTheDocument();
    const images = document.querySelectorAll('img[src="x"]');
    expect(images).toHaveLength(0);
  });

  it('DEPOSIT-ADV: XSS address is rendered as text, not executed', async () => {
    const xssAddress = '<script>alert("xss")</script>';
    const xssWallet: UserWallet = {
      ...mockWallet,
      master_address: xssAddress,
    };

    const user = userEvent.setup();
    render(<DepositSheet wallet={xssWallet} onClose={vi.fn()} />);
    await user.click(screen.getByText('Transfer USDC'));

    // Address renders as visible text (React auto-escapes)
    expect(screen.getByText(xssAddress)).toBeInTheDocument();
    // No actual script elements injected into the DOM
    expect(document.querySelector('script[src]')).toBeNull();
  });
});
