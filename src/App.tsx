import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import Layout from './components/Layout';
import { AuthProvider } from './contexts/AuthContext';
import { PRIVY_APP_ID, privyConfig } from './lib/privy';
import { LoadingSpinner } from './components/VelaComponents';

// Lazy load pages for faster initial load
const Home = lazy(() => import('./pages/Home'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const TrackRecord = lazy(() => import('./pages/TrackRecord'));
const Account = lazy(() => import('./pages/Account'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-20)' }}>
      <LoadingSpinner size={24} />
    </div>
  );
}

export default function App() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <AuthProvider>
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
      </AuthProvider>
    </PrivyProvider>
  );
}
