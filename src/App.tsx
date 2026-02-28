import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import Layout from './components/Layout';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { PRIVY_APP_ID, privyConfig } from './lib/privy';
import VelaLogo from './components/VelaLogo';
import { useOnboarding } from './hooks/useOnboarding';
import DeactivationScreen from './components/DeactivationScreen';
import CookieConsent from './components/CookieConsent';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy load pages for faster initial load
const Home = lazy(() => import('./pages/Home'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const TrackRecord = lazy(() => import('./pages/TrackRecord'));
const Account = lazy(() => import('./pages/Account'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));

function PageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 'var(--space-20)',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <VelaLogo variant="mark" size={48} pulse />
      <span className="vela-body-sm vela-text-muted">Loading...</span>
    </div>
  );
}

/**
 * Redirects new users to /welcome. Returns children for onboarded users.
 * Only gates the main app routes — /welcome itself is outside this wrapper.
 */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { isOnboarded, isChecking } = useOnboarding();
  const location = useLocation();

  // Don't redirect while checking — avoids flash
  if (isChecking) return <PageLoader />;

  // New user on any app route → send to onboarding
  if (!isOnboarded && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
}

/**
 * Intercepts deactivated users and shows the reactivation screen.
 * If the user's profile has deactivated_at set (returned by auth-exchange),
 * they see DeactivationScreen instead of the normal app. Un-bypassable.
 */
function DeactivationGate({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthContext();

  // Only intercept authenticated users with a deactivated account
  if (isAuthenticated && user?.deactivatedAt) {
    return <DeactivationScreen />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <DeactivationGate>
              <Routes>
                {/* Legal pages — outside Layout + OnboardingGate (accessible without login) */}
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />

                {/* Onboarding — outside Layout (no nav bar) */}
                <Route path="/welcome" element={<Onboarding />} />

                {/* Main app — gated by onboarding check */}
                <Route
                  element={
                    <OnboardingGate>
                      <Layout />
                    </OnboardingGate>
                  }
                >
                  <Route
                    path="/"
                    element={
                      <ErrorBoundary>
                        <Home />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/asset/:assetId"
                    element={
                      <ErrorBoundary>
                        <AssetDetail />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/trades"
                    element={
                      <ErrorBoundary>
                        <TrackRecord />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/account"
                    element={
                      <ErrorBoundary>
                        <Account />
                      </ErrorBoundary>
                    }
                  />
                </Route>
              </Routes>
            </DeactivationGate>
          </Suspense>
          <CookieConsent />
          <Analytics />
          <SpeedInsights />
        </BrowserRouter>
      </AuthProvider>
    </PrivyProvider>
  );
}
