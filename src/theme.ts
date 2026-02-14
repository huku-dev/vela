import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#6ee7b7' },      // Green accent
    secondary: { main: '#94a3b8' },     // Muted slate
    background: {
      default: '#0a0a0a',
      paper: '#141414',
    },
    text: {
      primary: '#e2e8f0',
      secondary: '#94a3b8',
    },
    success: { main: '#22c55e' },       // Signal green
    error: { main: '#ef4444' },         // Signal red
    warning: { main: '#eab308' },       // Yellow events
    info: { main: '#64748b' },          // Signal grey
  },
  typography: {
    fontFamily: '"DM Sans", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 500, color: '#94a3b8' },
    body2: { color: '#94a3b8' },
  },
  shape: { borderRadius: 16 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
          transition: 'border-color 0.2s ease',
          '&:hover': {
            borderColor: 'rgba(255,255,255,0.12)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          letterSpacing: '0.02em',
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: '#141414',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
  },
});

export default theme;
