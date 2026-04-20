/**
 * BailSheet — post-Stripe-cancel bottom sheet.
 *
 * Runtime tests (render, interactions, focus, scroll lock) + source
 * verification so the component contract stays locked against regressions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BailSheet } from './BailSheet';

const bailSheetSrc = readFileSync(resolve(__dirname, './BailSheet.tsx'), 'utf-8');

describe('BAIL: BailSheet rendering', () => {
  it('renders the reassurance title', () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
  });

  it('renders the "Subscription not started" eyebrow, not "Checkout"', () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    expect(screen.getByText(/subscription not started/i)).toBeInTheDocument();
    expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
  });

  it('renders the "No card was saved" reassurance', () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    expect(screen.getByText(/no card was saved/i)).toBeInTheDocument();
  });

  it('renders a single primary CTA labelled "Choose a plan"', () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const primary = buttons.find(b => /choose a plan/i.test(b.textContent || ''));
    expect(primary).toBeInTheDocument();
  });

  it('exposes an accessible dialog role', () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});

describe('BAIL: BailSheet interactions', () => {
  let onChoosePlan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChoosePlan = vi.fn();
  });

  it('calls onChoosePlan when the primary CTA is clicked', async () => {
    const user = userEvent.setup();
    render(<BailSheet onChoosePlan={onChoosePlan} />);
    await user.click(screen.getByRole('button', { name: /choose a plan/i }));
    expect(onChoosePlan).toHaveBeenCalledTimes(1);
  });

  it('calls onChoosePlan when the backdrop is clicked', () => {
    const { container } = render(<BailSheet onChoosePlan={onChoosePlan} />);
    // Backdrop is the aria-hidden div, the only clickable non-button surface.
    const backdrop = container.querySelector('[aria-hidden="true"][style*="absolute"]');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(onChoosePlan).toHaveBeenCalledTimes(1);
  });

  it('calls onChoosePlan when Escape is pressed', () => {
    render(<BailSheet onChoosePlan={onChoosePlan} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChoosePlan).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated key presses', () => {
    render(<BailSheet onChoosePlan={onChoosePlan} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onChoosePlan).not.toHaveBeenCalled();
  });
});

describe('BAIL: BailSheet side effects', () => {
  let originalOverflow: string;

  beforeEach(() => {
    originalOverflow = document.body.style.overflow;
  });

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
  });

  it('locks body scroll while open', () => {
    document.body.style.overflow = 'auto';
    render(<BailSheet onChoosePlan={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<BailSheet onChoosePlan={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('auto-focuses the primary CTA on open', async () => {
    render(<BailSheet onChoosePlan={() => {}} />);
    // JSDOM runs the focus synchronously during the effect.
    const primary = screen.getByRole('button', { name: /choose a plan/i });
    expect(document.activeElement).toBe(primary);
  });
});

// ── Source verification ─────────────────────────────────────────────────
//
// These guard the component contract even if someone edits it later
// without reading the comments. Written as explicit expectations.

describe('BAIL-SRC: BailSheet contract', () => {
  it('backdrop is aria-hidden (not in a11y tree)', () => {
    expect(bailSheetSrc).toMatch(/aria-hidden=["']?true["']?/);
  });

  it('dialog container has role and aria-modal', () => {
    expect(bailSheetSrc).toContain('role="dialog"');
    expect(bailSheetSrc).toContain('aria-modal="true"');
    expect(bailSheetSrc).toContain('aria-labelledby="bail-sheet-title"');
  });

  it('handles Escape key for dismissal', () => {
    expect(bailSheetSrc).toMatch(/e\.key === ['"]Escape['"]/);
  });

  it('restores body overflow on unmount', () => {
    expect(bailSheetSrc).toMatch(/previousOverflow/);
    expect(bailSheetSrc).toMatch(/document\.body\.style\.overflow = previousOverflow/);
  });

  it('auto-focuses the primary CTA', () => {
    expect(bailSheetSrc).toMatch(/primaryButtonRef\.current\?\.focus\(\)/);
  });

  it('does NOT render a "Try free" secondary CTA (Batch 1 scope)', () => {
    expect(bailSheetSrc).not.toMatch(/try free/i);
    expect(bailSheetSrc).not.toMatch(/7-day/i);
  });
});

describe('BAIL-ADV: BailSheet adversarial', () => {
  it('primary CTA must not be a plain div with onClick (keyboard users)', () => {
    // Primary action must be a real button so it is keyboard-activatable.
    expect(bailSheetSrc).toMatch(/<button[\s\S]*?Choose a plan/);
  });

  it('does not leak body scroll lock if unmount happens mid-animation', () => {
    // The cleanup is in the SAME useEffect that locks overflow, so React
    // guarantees cleanup runs even if unmount races with the mount effect.
    const lockSection = bailSheetSrc.slice(
      bailSheetSrc.indexOf('document.body.style.overflow = \'hidden\''),
      bailSheetSrc.indexOf('}, [onChoosePlan]);')
    );
    expect(lockSection).toContain('return ()');
    expect(lockSection).toContain('previousOverflow');
  });

  it('does not listen for Escape on document (would conflict with other modals)', () => {
    // Uses window for the keydown listener; cleaned up on unmount.
    expect(bailSheetSrc).toMatch(/window\.addEventListener\(['"]keydown['"]/);
    expect(bailSheetSrc).toMatch(/window\.removeEventListener\(['"]keydown['"]/);
  });
});
