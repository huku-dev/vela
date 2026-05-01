import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';
import { useTierAccess } from '../hooks/useTierAccess';
import VelaToast from './VelaToast';
import PendingProposalsBanner from './PendingProposalsBanner';

const navItems = [
  {
    label: 'Signals',
    path: '/',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <polyline
          points="2,14 6,6 10,10 14,4 18,8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    label: 'Your Trades',
    path: '/trades',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect
          x="2"
          y="10"
          width="4"
          height="8"
          rx="1"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <rect
          x="8"
          y="6"
          width="4"
          height="12"
          rx="1"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <rect
          x="14"
          y="2"
          width="4"
          height="16"
          rx="1"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    ),
  },
  {
    label: 'Account',
    path: '/account',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
        <path
          d="M3 18C3 14.5 6 12 10 12C14 12 17 14.5 17 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
];

/** Map raw Hyperliquid / backend errors to plain-English messages */
function friendlyTradeError(raw: string): string {
  if (!raw) return 'Something went wrong. Please try again.';
  const lower = raw.toLowerCase();
  if (lower.includes('builder fee has not been approved'))
    return 'Trade setup in progress. Vela will retry automatically.';
  if (lower.includes('95% away from the reference price'))
    return 'Price moved too far. Vela will retry at a better price.';
  if (lower.includes('below hyperliquid minimum') || lower.includes('minimum value of $10'))
    return 'Balance too low to trade. Deposit at least $10 USDC to get started.';
  if (lower.includes('insufficient') || lower.includes('balance'))
    return 'Insufficient balance. Check your wallet and try again.';
  if (lower.includes('rate limit')) return 'Too many requests. Please wait a moment.';
  // Fallback: return raw but cap length
  return raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading, login } = useAuthContext();
  const { proposals, wallet } = useTrading();
  const { needsFunding } = useTierAccess();
  const pendingCount = proposals.filter(p => p.status === 'pending').length;

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Global failure toast — detect when any proposal transitions to 'failed'
  const [failureToast, setFailureToast] = useState<string | null>(null);
  const prevProposalStatusesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prevStatuses = prevProposalStatusesRef.current;

    for (const p of proposals) {
      const prevStatus = prevStatuses.get(p.id);
      // Only show toast when we see a transition TO 'failed' (not on initial load)
      if (p.status === 'failed' && prevStatus && prevStatus !== 'failed') {
        const asset = p.asset_id?.toUpperCase() ?? '';
        const side = p.side?.toUpperCase() ?? '';
        const rawReason = p.error_message || '';
        // Translate technical errors into user-friendly messages
        const reason = friendlyTradeError(rawReason);
        setFailureToast(`${asset} ${side} failed: ${reason}`);
        break; // one toast at a time
      }
    }

    // Update ref with current statuses
    const nextStatuses = new Map<string, string>();
    for (const p of proposals) {
      nextStatuses.set(p.id, p.status);
    }
    prevProposalStatusesRef.current = nextStatuses;
  }, [proposals]);

  // Red dot on Account tab: show when funding is needed, clear once user visits /account
  const fundingNeeded = needsFunding(wallet?.balance_usdc);
  const accountDotSeenRef = useRef(false);
  // Reset "seen" when funding state changes (e.g. balance drops to 0 again)
  useEffect(() => {
    if (!fundingNeeded) accountDotSeenRef.current = false;
  }, [fundingNeeded]);
  // Mark as seen when user is on the account page
  useEffect(() => {
    if (location.pathname === '/account' && fundingNeeded) {
      accountDotSeenRef.current = true;
    }
  }, [location.pathname, fundingNeeded]);
  const showAccountDot = fundingNeeded && !accountDotSeenRef.current;

  const getNavValue = useCallback(() => {
    const idx = navItems.findIndex(item => item.path === location.pathname);
    return idx >= 0 ? idx : 0;
  }, [location.pathname]);

  const [value, setValue] = useState(getNavValue);

  useEffect(() => {
    setValue(getNavValue());
  }, [getNavValue]);

  const showNav = location.pathname !== '/welcome';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-page)' }}>
      <a
        href="#main-content"
        style={{
          position: 'absolute',
          left: '-9999px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        }}
        onFocus={e => {
          e.currentTarget.style.position = 'fixed';
          e.currentTarget.style.left = 'var(--space-4)';
          e.currentTarget.style.top = 'var(--space-4)';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.overflow = 'visible';
          e.currentTarget.style.zIndex = '9999';
          e.currentTarget.style.padding = 'var(--space-3) var(--space-4)';
          e.currentTarget.style.background = 'var(--color-action-primary)';
          e.currentTarget.style.color = 'var(--color-text-on-accent)';
          e.currentTarget.style.borderRadius = 'var(--radius-md)';
          e.currentTarget.style.fontWeight = '600';
          e.currentTarget.style.textDecoration = 'none';
          e.currentTarget.style.border = '3px solid var(--black)';
        }}
        onBlur={e => {
          e.currentTarget.style.position = 'absolute';
          e.currentTarget.style.left = '-9999px';
          e.currentTarget.style.width = '1px';
          e.currentTarget.style.height = '1px';
          e.currentTarget.style.overflow = 'hidden';
        }}
      >
        Skip to main content
      </a>
      {/* Global failure toast — shown when any trade proposal fails */}
      {failureToast && (
        <VelaToast
          message={failureToast}
          variant="error"
          autoDismissMs={5000}
          onDismiss={() => setFailureToast(null)}
        />
      )}
      <main id="main-content">
        {/* Global pending-proposals banner. Owns its own wrapper so it
            renders nothing (no empty padding) when there's no pending
            proposal. Hidden on /trades (proposal cards are the page content
            there) and /welcome (auth flow). */}
        {location.pathname !== '/trades' && location.pathname !== '/welcome' && (
          <PendingProposalsBanner />
        )}
        <Outlet />
      </main>
      {showNav && (
        <nav
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 56,
            backgroundColor: 'var(--color-bg-surface)',
            borderTop: '2px solid var(--gray-200)',
          }}
        >
          {navItems.map((item, idx) => {
            const isActive = value === idx;
            const itemLabel =
              item.path === '/account'
                ? isLoading
                  ? '...'
                  : isAuthenticated
                    ? 'Account'
                    : 'Log in'
                : item.label;

            return (
              <button
                key={item.label}
                onClick={() => {
                  if (item.path === '/account' && !isAuthenticated) {
                    login();
                    return;
                  }
                  setValue(idx);
                  navigate(item.path);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  flex: 1,
                  maxWidth: 168,
                  minWidth: 80,
                  height: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  // Equal-weight tappability: all tabs near-ink so no tab looks
                  // "lighter" than another. Active state layers a top bar +
                  // bold label on top; orientation and tappability are
                  // separate concerns. See mockups/bottom-nav-v3.html Option B.
                  color: 'var(--gray-800)',
                  position: 'relative',
                  transition: 'color var(--motion-fast) var(--motion-ease-out)',
                  WebkitTapHighlightColor: 'transparent',
                }}
                aria-label={itemLabel}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -2,
                      left: '14%',
                      right: '14%',
                      height: 3,
                      background: 'var(--vela-ink)',
                      borderRadius: '0 0 3px 3px',
                    }}
                  />
                )}
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {item.icon}
                  {item.path === '/account' && showAccountDot && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -4,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: 'var(--red-primary)',
                      }}
                    />
                  )}
                  {item.path === '/' && pendingCount > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -8,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        backgroundColor: 'var(--red-primary)',
                        color: 'var(--white)',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'Inter, system-ui, sans-serif',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 4px',
                        lineHeight: 1,
                      }}
                    >
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontFamily: 'var(--type-label-sm-font)',
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: '0.04em',
                  }}
                >
                  {itemLabel}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
