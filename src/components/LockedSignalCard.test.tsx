/**
 * Tests for LockedSignalCard — the tier-locked asset card.
 *
 * Free users see signal direction (BUY/SELL/WAIT), price, and 24h change. The
 * trade action and detailed brief are gated behind a paid plan. The card is
 * fully clickable into the upgrade sheet, with a subtle lock indicator on the
 * action area only.
 *
 * Covers:
 * - Rendering: asset icon, symbol, name, signal chip, price, 24h change
 * - Action area: upgrade CTA + lock glyph (chip is NOT hidden)
 * - Accessibility: role="button", aria-label, keyboard navigation
 * - Click behavior: onUpgradeClick callback fires
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LockedSignalCard from './LockedSignalCard';
import type { Asset, Signal, PriceData } from '../types';

// ── Fixtures ───────────────────────────────────────────────────────

const BTC_ASSET: Asset = {
  id: 'btc',
  symbol: 'BTC',
  name: 'Bitcoin',
  coingecko_id: 'bitcoin',
  enabled: true,
};

const ETH_ASSET: Asset = {
  id: 'eth',
  symbol: 'ETH',
  name: 'Ethereum',
  coingecko_id: 'ethereum',
  enabled: true,
};

const HYPE_ASSET: Asset = {
  id: 'hype',
  symbol: 'HYPE',
  name: 'Hyperliquid',
  coingecko_id: 'hyperliquid',
  enabled: true,
};

function makeSignal(color: 'green' | 'red' | 'grey'): Signal {
  return {
    id: 'sig-1',
    asset_id: 'eth',
    timestamp: '2026-05-11T00:00:00Z',
    signal_color: color,
    reason_code: 'ema_cross',
    price_at_signal: 3500,
    ema_9: 3500,
    ema_21: 3450,
    rsi_14: 55,
    sma_50_daily: 3300,
    adx_4h: 25,
    near_confirmation: false,
    created_at: '2026-05-11T00:00:00Z',
  };
}

const PRICE_DATA: PriceData = {
  price: 3525,
  change24h: 2.4,
  priceSource: 'hyperliquid',
};

function renderCard(props?: Partial<Parameters<typeof LockedSignalCard>[0]>) {
  const defaultProps = {
    asset: ETH_ASSET,
    upgradeLabel: 'Upgrade your plan to unlock trades and full briefs',
    onUpgradeClick: vi.fn(),
    signal: makeSignal('green'),
    priceData: PRICE_DATA,
  };
  return {
    onUpgradeClick: defaultProps.onUpgradeClick,
    ...render(<LockedSignalCard {...defaultProps} {...props} />),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('LockedSignalCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ──

  describe('rendering', () => {
    it('displays the asset symbol', () => {
      renderCard();
      expect(screen.getByText('ETH')).toBeInTheDocument();
    });

    it('displays the asset name', () => {
      renderCard();
      expect(screen.getByText('Ethereum')).toBeInTheDocument();
    });

    it('displays the upgrade label in the action area', () => {
      renderCard({ upgradeLabel: 'Upgrade your plan to unlock trades and full briefs' });
      expect(
        screen.getByText(/Upgrade your plan to unlock trades and full briefs/)
      ).toBeInTheDocument();
    });

    it('renders asset icon img when coingecko_id is available', () => {
      renderCard({ asset: BTC_ASSET });
      const img = screen.getByAltText('BTC');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src');
    });

    it('has cursor: pointer style', () => {
      const { container } = renderCard();
      const card = container.firstElementChild as HTMLElement;
      expect(card.style.cursor).toBe('pointer');
    });
  });

  // ── Signal direction visibility (FREE TIER REQUIREMENT) ──

  describe('signal direction is visible to free users', () => {
    it('renders the BUY label for a green signal', () => {
      renderCard({ signal: makeSignal('green') });
      expect(screen.getByText(/buy/i)).toBeInTheDocument();
    });

    it('renders the SELL label for a red signal', () => {
      renderCard({ signal: makeSignal('red') });
      expect(screen.getByText(/sell/i)).toBeInTheDocument();
    });

    it('renders the WAIT label for a grey signal', () => {
      renderCard({ signal: makeSignal('grey') });
      expect(screen.getByText(/wait/i)).toBeInTheDocument();
    });

    it('renders no signal chip when signal is null (avoids fake WAIT impression)', () => {
      renderCard({ signal: null });
      // WAIT is a meaningful direction-neutral state, not a no-data placeholder.
      // Rendering it for null signals would mislead free users into thinking
      // Vela is telling them to wait when really there is no signal data.
      expect(screen.queryByText(/wait|buy|sell/i)).not.toBeInTheDocument();
    });

    it('renders the formatted price when priceData is provided', () => {
      renderCard({ priceData: PRICE_DATA });
      // formatPrice on 3525 produces a $-prefixed string with commas
      expect(screen.getByText(/3,525|3525/)).toBeInTheDocument();
    });

    it('renders the 24h change percentage when priceData has change24h', () => {
      renderCard({ priceData: { ...PRICE_DATA, change24h: 2.4 } });
      expect(screen.getByText(/2\.4%/)).toBeInTheDocument();
    });

    it('falls back to signal.price_at_signal when priceData has no price', () => {
      renderCard({ priceData: null, signal: makeSignal('green') });
      expect(screen.getByText(/3,500|3500/)).toBeInTheDocument();
    });
  });

  // ── Gated content (paid-only) ──

  describe('gated content is not rendered', () => {
    it('does NOT render any brief headline on the card', () => {
      // The brief / news rationale is gated behind paid. We removed the
      // briefHeadline prop entirely; this guards against re-introducing it.
      renderCard();
      const card = screen.getByRole('button');
      expect(card.textContent?.toLowerCase()).not.toMatch(/momentum|news|rationale/);
    });

    it('does NOT render an approve / trade action button', () => {
      renderCard();
      // No "approve" or "trade" or "execute" button on the card
      const buttons = screen.queryAllByRole('button');
      // The whole card is role="button" but it should be the only one
      expect(buttons.length).toBe(1);
      const card = buttons[0];
      expect(card.textContent?.toLowerCase()).not.toMatch(/approve|execute trade/);
    });
  });

  // ── Accessibility ──

  describe('accessibility', () => {
    it('has role="button"', () => {
      renderCard();
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('has correct aria-label', () => {
      renderCard({ asset: ETH_ASSET });
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-label',
        'Upgrade to unlock Ethereum signals'
      );
    });

    it('has tabIndex=0 for keyboard focus', () => {
      renderCard();
      expect(screen.getByRole('button')).toHaveAttribute('tabindex', '0');
    });

    it('fires onUpgradeClick on Enter key', () => {
      const { onUpgradeClick } = renderCard();
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });

    it('fires onUpgradeClick on Space key', () => {
      const { onUpgradeClick } = renderCard();
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: ' ' });
      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onUpgradeClick on Tab key', () => {
      const { onUpgradeClick } = renderCard();
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: 'Tab' });
      expect(onUpgradeClick).not.toHaveBeenCalled();
    });
  });

  // ── Click behavior ──

  describe('click behavior', () => {
    it('fires onUpgradeClick on click', async () => {
      const user = userEvent.setup();
      const { onUpgradeClick } = renderCard();
      const card = screen.getByRole('button');
      await user.click(card);
      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });

    it('fires onUpgradeClick with different assets', async () => {
      const user = userEvent.setup();
      const { onUpgradeClick } = renderCard({ asset: HYPE_ASSET });
      const card = screen.getByRole('button');
      await user.click(card);
      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });
  });
});
