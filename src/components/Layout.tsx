import { useState, useEffect, lazy, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import CircularProgress from '@mui/material/CircularProgress';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import BarChartIcon from '@mui/icons-material/BarChart';

const navItems = [
  { label: 'Signals', icon: <ShowChartIcon />, path: '/' },
  { label: 'Your Trades', icon: <BarChartIcon />, path: '/trades' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const getNavValue = () => {
    const idx = navItems.findIndex((item) => item.path === location.pathname);
    return idx >= 0 ? idx : 0;
  };

  const [value, setValue] = useState(getNavValue);

  useEffect(() => {
    setValue(getNavValue());
  }, [location.pathname]);

  const showNav = !location.pathname.startsWith('/asset/');

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#FEF9EF' }}>
      <Outlet />
      {showNav && (
        <BottomNavigation
          value={value}
          onChange={(_, newValue) => {
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
          {navItems.map((item) => (
            <BottomNavigationAction
              key={item.label}
              label={item.label}
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
