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

  it('renders two tabs: Transfer USDC and Fund with card', () => {
    renderSheet();
    expect(screen.getByText('Transfer USDC')).toBeInTheDocument();
    expect(screen.getByText('Fund with card')).toBeInTheDocument();
  });

  // ── Transfer Tab ──

  it('shows deposit address label', () => {
    renderSheet();
    expect(screen.getByText('YOUR DEPOSIT ADDRESS')).toBeInTheDocument();
  });

  it('shows full wallet address (not truncated)', () => {
    renderSheet();
    expect(
      screen.getByText('0x1234567890abcdef1234567890abcdef12345678')
    ).toBeInTheDocument();
  });

  it('renders QR code SVG', () => {
    renderSheet();
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('copy button triggers clipboard write', async () => {
    const user = userEvent.setup();
    renderSheet();
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    await user.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('shows Copy button label initially', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  // ── Network Dropdown ──

  it('shows network dropdown with placeholder', () => {
    renderSheet();
    const select = screen.getByLabelText('Select deposit network');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('');
  });

  it('does not show USDC warning when no network is selected', () => {
    renderSheet();
    expect(screen.queryByText(/only send usdc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/only send via hyperliquid/i)).not.toBeInTheDocument();
  });

  it('shows Arbitrum warning when Arbitrum is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'arbitrum');
    expect(screen.getByText(/only send usdc on arbitrum/i)).toBeInTheDocument();
  });

  it('shows Hyperliquid warning when Hyperliquid is selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.selectOptions(screen.getByLabelText('Select deposit network'), 'hyperliquid');
    expect(screen.getByText(/only send via hyperliquid usdsend/i)).toBeInTheDocument();
  });

  // ── Card Tab ──

  it('shows coming soon message on card tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Fund with card'));
    expect(screen.getByText(/card funding coming soon/i)).toBeInTheDocument();
  });

  it('card tab does not show "I\'ve sent the USDC" button', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Fund with card'));
    expect(screen.queryByRole('button', { name: /i've sent the usdc/i })).not.toBeInTheDocument();
  });

  it('card tab does not show "Don\'t have USDC?" banner', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Fund with card'));
    expect(screen.queryByText(/don't have usdc/i)).not.toBeInTheDocument();
  });

  // ── Refresh Balance ──

  it('shows "I\'ve sent the USDC" button on transfer tab', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /i've sent the usdc/i })).toBeInTheDocument();
  });

  it('does not show "Check balance now" button', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: /check balance now/i })).not.toBeInTheDocument();
  });

  it('shows deposit detected message when balance increases', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: 600, deposit_detected: 100 }),
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    render(<DepositSheet wallet={mockWallet} onClose={onClose} onRefresh={onRefresh} />);

    // "I've sent the USDC" triggers refresh + close
    await user.click(screen.getByRole('button', { name: /i've sent the usdc/i }));
    expect(onClose).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/refresh-balance'),
        expect.objectContaining({ method: 'POST' })
      );
    });
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
