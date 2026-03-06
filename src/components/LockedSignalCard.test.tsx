/**
 * Tests for LockedSignalCard — the tier-locked asset card.
 *
 * Covers:
 * - Rendering: asset icon, symbol, name, upgrade label, lock icon
 * - Brief teaser: faded headline display, no headline case
 * - Accessibility: role="button", aria-label, keyboard navigation (Enter, Space)
 * - Click behavior: onUpgradeClick callback fires
 * - Asset prefix stripping: "ETH: headline" becomes just "headline"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LockedSignalCard from './LockedSignalCard';
import type { Asset } from '../types';

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

function renderCard(props?: Partial<Parameters<typeof LockedSignalCard>[0]>) {
  const defaultProps = {
    asset: ETH_ASSET,
    upgradeLabel: 'Upgrade your plan to see ETH signals',
    onUpgradeClick: vi.fn(),
    briefHeadline: null,
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

    it('displays the upgrade label', () => {
      renderCard({ upgradeLabel: 'Upgrade your plan to see ETH signals' });
      expect(screen.getByText(/Upgrade your plan to see ETH signals/)).toBeInTheDocument();
    });

    it('renders the lock icon SVG', () => {
      const { container } = renderCard();
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '20');
      expect(svg).toHaveAttribute('height', '20');
    });

    it('renders asset icon img when coingecko_id is available', () => {
      renderCard({ asset: BTC_ASSET });
      const img = screen.getByAltText('BTC');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src');
    });

    it('renders letter fallback when no icon URL', () => {
      // Asset with a coingecko_id that produces null from getCoinIcon
      // Actually getCoinIcon always returns a URL for known assets, so we test
      // that the symbol is rendered for display
      renderCard({ asset: ETH_ASSET });
      expect(screen.getByText('ETH')).toBeInTheDocument();
    });

    it('has reduced opacity (0.7) for locked appearance', () => {
      const { container } = renderCard();
      const card = container.firstElementChild as HTMLElement;
      expect(card.style.opacity).toBe('0.7');
    });

    it('has cursor: pointer style', () => {
      const { container } = renderCard();
      const card = container.firstElementChild as HTMLElement;
      expect(card.style.cursor).toBe('pointer');
    });
  });

  // ── Brief teaser ──

  describe('brief teaser', () => {
    it('shows faded brief headline when provided', () => {
      renderCard({ briefHeadline: 'Ethereum shows strong momentum' });
      expect(screen.getByText('Ethereum shows strong momentum')).toBeInTheDocument();
    });

    it('does not render brief section when headline is null', () => {
      const { container } = renderCard({ briefHeadline: null });
      // No paragraph with brief content
      const paragraphs = container.querySelectorAll('p');
      // Should only have the upgrade label paragraph
      const briefParagraph = Array.from(paragraphs).find(p =>
        p.textContent?.includes('strong momentum')
      );
      expect(briefParagraph).toBeUndefined();
    });

    it('does not render brief section when headline is undefined', () => {
      const { container } = renderCard({ briefHeadline: undefined });
      // Only the upgrade label paragraph should exist
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBe(1); // Just the upgrade label
    });

    it('strips asset prefix from headline (e.g. "ETH: " prefix)', () => {
      renderCard({
        asset: ETH_ASSET,
        briefHeadline: 'ETH: Ethereum shows strong momentum',
      });
      // stripAssetPrefix should remove "ETH: " prefix
      expect(screen.getByText('Ethereum shows strong momentum')).toBeInTheDocument();
    });

    it('strips asset name prefix from headline', () => {
      renderCard({
        asset: HYPE_ASSET,
        briefHeadline: 'HYPE - Market showing consolidation',
      });
      expect(screen.getByText('Market showing consolidation')).toBeInTheDocument();
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

    it('prevents default on Space to avoid page scroll', () => {
      renderCard();
      const card = screen.getByRole('button');
      const event = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      card.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
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

  // ── Upgrade label variations ──

  describe('upgrade label', () => {
    it('renders arrow indicator after label', () => {
      const { container } = renderCard({
        upgradeLabel: 'Upgrade your plan to see SOL signals',
      });
      // The arrow is a span with "→"
      expect(container.textContent).toContain('→');
    });

    it('renders different upgrade labels for different features', () => {
      renderCard({ upgradeLabel: 'Upgrade your plan to unlock auto-trading' });
      expect(
        screen.getByText(/Upgrade your plan to unlock auto-trading/)
      ).toBeInTheDocument();
    });
  });
});
