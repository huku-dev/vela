import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WithdrawSheet from './WithdrawSheet';
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

// ── Fixtures ───────────────────────────────────────────────────────────

const mockWallet: UserWallet = {
  id: 'wallet-1',
  user_id: 'did:privy:test',
  master_wallet_id: 'mw-1',
  master_address: '0x1234567890abcdef1234567890abcdef12345678',
  agent_wallet_id: 'aw-1',
  agent_address: '0xagentaddr',
  agent_registered: true,
  balance_usdc: 1000.0,
  balance_last_synced_at: null,
  trial_trade_used: false,
  environment: 'testnet',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const validEthAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';

function renderSheet(props?: Partial<Parameters<typeof WithdrawSheet>[0]>) {
  const defaultProps = {
    wallet: mockWallet,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  return render(<WithdrawSheet {...defaultProps} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('WithdrawSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ otp_sent: true }),
    });
  });

  // ── Rendering ──

  it('renders the dialog with correct role and aria attributes', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Withdraw USDC');
  });

  it('shows available balance from wallet', () => {
    renderSheet();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('Available balance')).toBeInTheDocument();
  });

  it('shows amount and destination inputs', () => {
    renderSheet();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument();
  });

  // ── Amount Validation ──

  it('disables submit when amount is empty', () => {
    renderSheet();
    const submitBtn = screen.getByRole('button', { name: /send verification code/i });
    expect(submitBtn).toBeDisabled();
  });

  it('shows error when amount exceeds balance', async () => {
    const user = userEvent.setup();
    renderSheet();
    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '2000');
    expect(screen.getByText('Amount exceeds available balance')).toBeInTheDocument();
  });

  it('shows error for negative/zero amounts', async () => {
    const user = userEvent.setup();
    renderSheet();
    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '0');
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument();
  });

  it('Max button sets amount to full balance', async () => {
    const user = userEvent.setup();
    renderSheet();
    const maxBtn = screen.getByRole('button', { name: /max/i });
    await user.click(maxBtn);
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    // Number inputs may strip trailing zeros — check numeric value
    expect(parseFloat(amountInput.value)).toBe(1000);
  });

  // ── Address Validation ──

  it('shows error for invalid Ethereum address', async () => {
    const user = userEvent.setup();
    renderSheet();
    const addressInput = screen.getByLabelText(/destination/i);
    await user.type(addressInput, 'not-an-address');
    expect(screen.getByText(/valid ethereum address/i)).toBeInTheDocument();
  });

  it('accepts valid Ethereum address', async () => {
    const user = userEvent.setup();
    renderSheet();
    const addressInput = screen.getByLabelText(/destination/i);
    await user.type(addressInput, validEthAddress);
    expect(screen.queryByText(/valid ethereum address/i)).not.toBeInTheDocument();
  });

  // ── Form Submission ──

  it('enables submit when both fields are valid', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    const submitBtn = screen.getByRole('button', { name: /send verification code/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls API with correct payload on submit', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/process-withdrawal'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"request_otp"'),
        })
      );
    });
  });

  it('shows OTP step after successful code request', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
    });
  });

  it('shows error message on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Insufficient balance' }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    });
  });

  // ── OTP Step ──

  it('OTP input only accepts 6 digits', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ otp_sent: true }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });

    const otpInput = screen.getByLabelText(/verification code/i) as HTMLInputElement;
    await user.type(otpInput, 'abc123456xyz');
    // Should strip non-digits and limit to 6
    expect(otpInput.value).toBe('123456');
  });

  it('confirm button disabled until 6-digit OTP entered', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ otp_sent: true }),
    });

    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm withdrawal/i })).toBeDisabled();
    });
  });

  // ── Dismiss ──

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet wallet={mockWallet} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet wallet={mockWallet} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet wallet={mockWallet} onClose={onClose} />);
    // Click the backdrop (the dialog overlay itself)
    const dialog = screen.getByRole('dialog');
    await user.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Success Flow ──

  it('shows success state after confirmed withdrawal', async () => {
    // First call: request_otp success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ otp_sent: true }),
    });
    // Second call: confirm success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, amount: 100, completed_at: '2026-01-01T00:00:00Z' }),
    });

    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet wallet={mockWallet} onClose={vi.fn()} onSuccess={onSuccess} />);

    // Fill form
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    // Enter OTP
    await waitFor(() => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirm withdrawal/i }));

    // Check success
    await waitFor(() => {
      expect(screen.getByText(/withdrawal sent/i)).toBeInTheDocument();
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  // ── Loading States ──

  it('shows loading text while sending code', async () => {
    // Make fetch hang
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.type(screen.getByLabelText(/destination/i), validEthAddress);
    await user.click(screen.getByRole('button', { name: /send verification code/i }));

    expect(screen.getByText(/sending code/i)).toBeInTheDocument();
  });
});
