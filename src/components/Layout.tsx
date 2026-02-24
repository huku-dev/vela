import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useTrading } from '../hooks/useTrading';

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
          strokeWidth="1.5"
          fill="none"
        />
        <rect
          x="8"
          y="6"
          width="4"
          height="12"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        <rect
          x="14"
          y="2"
          width="4"
          height="16"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.5"
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
        <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path
          d="M3 18C3 14.5 6 12 10 12C14 12 17 14.5 17 18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading, login } = useAuthContext();
  const { proposals } = useTrading();
  const pendingCount = proposals.filter(p => p.status === 'pending').length;

  const getNavValue = useCallback(() => {
    const idx = navItems.findIndex(item => item.path === location.pathname);
    return idx >= 0 ? idx : 0;
  }, [location.pathname]);

  const [value, setValue] = useState(getNavValue);

  useEffect(() => {
    setValue(getNavValue());
  }, [getNavValue]);

  const showNav = !location.pathname.startsWith('/asset/') && location.pathname !== '/welcome';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-page)' }}>
      <Outlet />
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
                  color: isActive ? 'var(--color-text-primary)' : 'var(--gray-400)',
                  transition: 'color var(--motion-fast) var(--motion-ease-out)',
                  WebkitTapHighlightColor: 'transparent',
                }}
                aria-label={itemLabel}
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {item.icon}
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
                    fontWeight: isActive ? 700 : 600,
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
