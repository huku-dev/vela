import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TradeConfirmationSheet from './TradeConfirmationSheet';
import type { TradeProposal } from '../types';

// ── Fixtures ───────────────────────────────────────────────────────────

const baseProposal: TradeProposal = {
  id: 'prop-1',
  user_id: 'did:privy:test',
  asset_id: 'hype',
  signal_id: 'sig-1',
  side: 'long',
  proposed_size_usd: 10,
  proposed_leverage: 1,
  entry_price_at_proposal: 36.83,
  status: 'pending',
  approval_source: null,
  approved_at: null,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  proposal_type: 'open',
  trim_pct: null,
  parent_position_id: null,
  position_type: 'bb2_30m',
  use_spot: false,
  error_message: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const defaultProps = {
  proposal: baseProposal,
  assetSymbol: 'HYPE',
  estimatedFee: 0.05,
  feeRatePct: 0.5,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('TradeConfirmationSheet', () => {
  describe('CONFIRM-UX: price display', () => {
    it('shows both proposal price and current execution price when price has moved', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          currentPrice={36.88}
        />
      );

      expect(screen.getByText('Proposal price')).toBeInTheDocument();
      expect(screen.getByText('Execution price')).toBeInTheDocument();
      // Proposal price should be struck through (muted)
      const proposalRow = screen.getByText('Proposal price').closest('div');
      const proposalValue = proposalRow?.querySelector('span:last-child') as HTMLElement | null;
      expect(proposalValue?.style.textDecoration).toBe('line-through');
    });

    it('shows current execution price with ~ prefix', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          currentPrice={36.88}
        />
      );

      // Execution price should contain the tilde prefix
      const execRow = screen.getByText('Execution price').closest('div');
      const execValue = execRow?.querySelector('span:last-child');
      expect(execValue?.textContent).toMatch(/^~/);
    });

    it('shows market order explanation when price has moved', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          currentPrice={36.88}
        />
      );

      expect(
        screen.getByText(/executes as a market order/i)
      ).toBeInTheDocument();
    });

    it('does not show market order note when prices match', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          currentPrice={36.83}
        />
      );

      expect(
        screen.queryByText(/executes as a market order/i)
      ).not.toBeInTheDocument();
    });

    it('does not show market order note when currentPrice is undefined', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
        />
      );

      expect(
        screen.queryByText(/executes as a market order/i)
      ).not.toBeInTheDocument();
    });

    it('shows "Current price" label for trim proposals', () => {
      const trimProposal: TradeProposal = {
        ...baseProposal,
        proposal_type: 'trim',
        trim_pct: 50,
      };

      render(
        <TradeConfirmationSheet
          {...defaultProps}
          proposal={trimProposal}
          currentPrice={37.0}
        />
      );

      expect(screen.getByText('Current price')).toBeInTheDocument();
      expect(screen.queryByText('Execution price')).not.toBeInTheDocument();
    });
  });

  describe('CONFIRM-UX: actions', () => {
    it('shows "Confirming..." while submitting', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          isSubmitting
        />
      );

      expect(screen.getByText('Confirming...')).toBeInTheDocument();
    });

    it('disables buttons while submitting', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          isSubmitting
        />
      );

      expect(screen.getByText('Confirming...')).toBeDisabled();
      expect(screen.getByText('Cancel')).toBeDisabled();
    });

    it('calls onConfirm when confirm button clicked', async () => {
      const onConfirm = vi.fn();
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          onConfirm={onConfirm}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: 'Confirm trade' }));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onCancel when cancel button clicked', async () => {
      const onCancel = vi.fn();
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          onCancel={onCancel}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('CONFIRM-UX: content display', () => {
    it('shows BUY action for long proposals', () => {
      render(<TradeConfirmationSheet {...defaultProps} />);
      expect(screen.getByText('BUY HYPE')).toBeInTheDocument();
    });

    it('shows SELL action for short proposals', () => {
      render(
        <TradeConfirmationSheet
          {...defaultProps}
          proposal={{ ...baseProposal, side: 'short' }}
        />
      );
      expect(screen.getByText('SELL HYPE')).toBeInTheDocument();
    });

    it('shows position size', () => {
      render(<TradeConfirmationSheet {...defaultProps} />);
      expect(screen.getByText('$10')).toBeInTheDocument();
    });

    it('shows leverage', () => {
      render(<TradeConfirmationSheet {...defaultProps} />);
      expect(screen.getByText('1x')).toBeInTheDocument();
    });

    it('shows estimated fee', () => {
      render(<TradeConfirmationSheet {...defaultProps} />);
      expect(screen.getByText('Est. fee (0.5%)')).toBeInTheDocument();
      expect(screen.getByText('$0.05')).toBeInTheDocument();
    });

    it('shows trust note', () => {
      render(<TradeConfirmationSheet {...defaultProps} />);
      expect(
        screen.getByText(/you stay in control/i)
      ).toBeInTheDocument();
    });
  });
});
