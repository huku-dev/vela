import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import HistoryIcon from '@mui/icons-material/History';

const navItems = [
  { label: 'Signals', icon: <ShowChartIcon />, path: '/' },
  { label: 'Track Record', icon: <HistoryIcon />, path: '/track-record' },
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

  // Hide bottom nav on asset detail pages
  const showNav = !location.pathname.startsWith('/asset/');

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
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
                color: 'text.secondary',
                '&.Mui-selected': { color: 'primary.main' },
              }}
            />
          ))}
        </BottomNavigation>
      )}
    </Box>
  );
}
