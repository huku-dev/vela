import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CookieConsent from './CookieConsent';

const STORAGE_KEY = 'vela_cookie_consent';

// Create a proper localStorage mock
function createLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(k => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

describe('CookieConsent', () => {
  let storageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    storageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', storageMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not render immediately (1s delay)', () => {
    render(<CookieConsent />);
    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
  });

  it('renders banner after 1-second delay', async () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText('Got it')).toBeInTheDocument();
    expect(
      screen.getByText(/essential cookies for authentication/)
    ).toBeInTheDocument();
  });

  it('includes a link to the Privacy Policy', () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    const link = screen.getByText('Privacy Policy');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('persists acceptance in localStorage when "Got it" is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    await user.click(screen.getByText('Got it'));

    expect(storageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'true');
  });

  it('hides the banner after accepting', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    await user.click(screen.getByText('Got it'));

    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
  });

  it('does not show banner if already accepted', () => {
    storageMock.getItem.mockReturnValue('true');
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
  });

  it('cleans up timeout on unmount', () => {
    const { unmount } = render(<CookieConsent />);
    // Should not throw when unmounting before timeout fires
    unmount();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    // No error means cleanup worked
  });
});
