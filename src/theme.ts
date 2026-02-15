import { createTheme } from '@mui/material/styles';

export const colors = {
  bg: '#FEF9EF',
  cardBg: '#FFFFFF',
  border: '#1A1A1A',
  text: '#1A1A1A',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  green: '#22C55E',
  greenBg: '#DCFCE7',
  greenText: '#15803D',
  red: '#EF4444',
  redBg: '#FEE2E2',
  redText: '#DC2626',
  blue: '#3B82F6',
  blueBg: '#DBEAFE',
  blueText: '#2563EB',
  yellow: '#F59E0B',
  yellowBg: '#FEF3C7',
  yellowText: '#92400E',
  purple: '#8B5CF6',
  purpleBg: '#EDE9FE',
  shadow: '#1A1A1A',
  divider: '#E5E7EB',
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: colors.green },
    secondary: { main: colors.blue },
    background: { default: colors.bg, paper: colors.cardBg },
    text: { primary: colors.text, secondary: colors.textMuted },
    success: { main: colors.green },
    error: { main: colors.red },
    warning: { main: colors.yellow },
    info: { main: colors.blue },
  },
  typography: {
    fontFamily: '"DM Sans", sans-serif',
    h4: { fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.03em', color: colors.text },
    h5: { fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.02em', color: colors.text },
    h6: { fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.01em', color: colors.text },
    subtitle1: { fontWeight: 500, color: colors.textMuted },
    body1: { fontSize: '0.95rem', lineHeight: 1.6, color: colors.text },
    body2: { fontSize: '0.85rem', lineHeight: 1.6, color: colors.textMuted },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { backgroundColor: colors.bg } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `2.5px solid ${colors.border}`,
          boxShadow: `4px 4px 0px ${colors.shadow}`,
          borderRadius: 12,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          '&:hover': {
            transform: 'translate(-1px, -1px)',
            boxShadow: `5px 5px 0px ${colors.shadow}`,
          },
          '&:active': {
            transform: 'translate(2px, 2px)',
            boxShadow: `2px 2px 0px ${colors.shadow}`,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          letterSpacing: '0.04em',
          border: `2px solid ${colors.border}`,
          borderRadius: 8,
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          border: `2.5px solid ${colors.border}`,
          boxShadow: `4px 4px 0px ${colors.shadow}`,
          borderRadius: '12px !important',
          '&:before': { display: 'none' },
          '&.Mui-expanded': { margin: 0 },
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: colors.cardBg,
          borderTop: `2.5px solid ${colors.border}`,
          height: 64,
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          color: colors.textMuted,
          '&.Mui-selected': { color: colors.text },
        },
      },
    },
  },
});

export default theme;
