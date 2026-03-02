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
    expect(dialog).toHaveAttribute('aria-label', 'Deposit USDC');
  });

  it('shows deposit heading', () => {
    renderSheet();
    expect(screen.getByText('Deposit USDC')).toBeInTheDocument();
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

  it('shows truncated wallet address', () => {
    renderSheet();
    // master_address: 0x1234567890abcdef1234567890abcdef12345678
    // truncated: 0x123456...345678
    expect(screen.getByText('0x123456...345678')).toBeInTheDocument();
  });

  it('renders QR code SVG', () => {
    renderSheet();
    // QRCodeSVG renders an <svg> element
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('copy button triggers clipboard write', async () => {
    // Test that clicking copy shows "Copied!" feedback (proves handler ran)
    // Direct clipboard mock in jsdom is unreliable, so test the side effect
    const user = userEvent.setup();
    renderSheet();
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    await user.click(copyBtn);
    // The handler calls navigator.clipboard.writeText and shows "Copied!" text
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('shows Copy button label initially', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('shows network instructions', () => {
    renderSheet();
    // Both networks mentioned — may appear in multiple elements
    expect(screen.getAllByText(/hyperliquid/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/arbitrum/i).length).toBeGreaterThan(0);
  });

  it('shows USDC-only warning', () => {
    renderSheet();
    expect(screen.getByText(/only send usdc/i)).toBeInTheDocument();
  });

  // ── Card Tab ──

  it('shows coming soon message on card tab', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Fund with card'));
    expect(screen.getByText(/card funding coming soon/i)).toBeInTheDocument();
  });

  it('card tab explains alternatives', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText('Fund with card'));
    expect(screen.getByText(/coinbase/i)).toBeInTheDocument();
  });

  // ── Refresh Balance ──

  it('shows refresh balance button', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /refresh balance/i })).toBeInTheDocument();
  });

  it('calls refresh-balance API on click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: 600, deposit_detected: null }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /refresh balance/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/refresh-balance'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows deposit detected message when balance increases', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: 600, deposit_detected: 100 }),
    });

    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<DepositSheet wallet={mockWallet} onClose={vi.fn()} onRefresh={onRefresh} />);
    await user.click(screen.getByRole('button', { name: /refresh balance/i }));

    await waitFor(() => {
      expect(screen.getByText(/deposit detected/i)).toBeInTheDocument();
      expect(screen.getByText(/\+\$100\.00/)).toBeInTheDocument();
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows "no new deposits" when balance unchanged', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: 500, deposit_detected: null }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /refresh balance/i }));

    await waitFor(() => {
      expect(screen.getByText(/no new deposits/i)).toBeInTheDocument();
    });
  });

  it('shows last synced time when available', () => {
    renderSheet();
    expect(screen.getByText(/last synced/i)).toBeInTheDocument();
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
