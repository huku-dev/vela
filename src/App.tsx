import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { PrivyProvider } from '@privy-io/react-auth';
import theme from './theme';
import Layout from './components/Layout';
import { AuthProvider } from './contexts/AuthContext';
import { PRIVY_APP_ID, privyConfig } from './lib/privy';

// Lazy load pages for faster initial load
const Home = lazy(() => import('./pages/Home'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const TrackRecord = lazy(() => import('./pages/TrackRecord'));
const Account = lazy(() => import('./pages/Account'));

function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>
      <CircularProgress size={24} sx={{ color: '#1A1A1A' }} />
    </Box>
  );
}

export default function App() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <AuthProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/asset/:assetId" element={<AssetDetail />} />
                  <Route path="/trades" element={<TrackRecord />} />
                  <Route path="/account" element={<Account />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </PrivyProvider>
  );
}
