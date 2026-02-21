import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useAuthContext } from '../contexts/AuthContext';

const navItems = [
  { label: 'Signals', icon: <ShowChartIcon />, path: '/' },
  { label: 'Your Trades', icon: <BarChartIcon />, path: '/trades' },
  { label: 'Account', icon: <PersonOutlineIcon />, path: '/account' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading, login } = useAuthContext();

  const getNavValue = useCallback(() => {
    const idx = navItems.findIndex(item => item.path === location.pathname);
    return idx >= 0 ? idx : 0;
  }, [location.pathname]);

  const [value, setValue] = useState(getNavValue);

  useEffect(() => {
    setValue(getNavValue());
  }, [getNavValue]);

  const showNav = !location.pathname.startsWith('/asset/');

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#FEF9EF' }}>
      <Outlet />
      {showNav && (
        <BottomNavigation
          value={value}
          onChange={(_, newValue) => {
            // Account tab: login if not authenticated, navigate if authenticated
            if (navItems[newValue]?.path === '/account' && !isAuthenticated) {
              login();
              return;
            }
            setValue(newValue);
            navigate(navItems[newValue].path);
          }}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
          }}
        >
          {navItems.map(item => (
            <BottomNavigationAction
              key={item.label}
              label={
                item.path === '/account'
                  ? isLoading
                    ? '...'
                    : isAuthenticated
                      ? 'Account'
                      : 'Log in'
                  : item.label
              }
              icon={item.icon}
              sx={{
                color: '#9CA3AF',
                '&.Mui-selected': { color: '#1A1A1A', fontWeight: 700 },
                '& .MuiBottomNavigationAction-label': {
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                },
              }}
            />
          ))}
        </BottomNavigation>
      )}
    </Box>
  );
}
