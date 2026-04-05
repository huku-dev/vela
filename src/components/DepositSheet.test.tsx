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
