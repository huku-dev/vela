import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import { AuthProvider, useAuthContext } from '../contexts/AuthContext';
import { PRIVY_APP_ID, privyConfig } from '../lib/privy';
import { useOnboarding } from '../hooks/useOnboarding';
import { ErrorBoundary } from './ErrorBoundary';
import DeactivationScreen from './DeactivationScreen';
import Layout from './Layout';
import PageLoader from './PageLoader';

// Lazy load pages for code splitting
const Home = lazy(() => import('../pages/Home'));
const AssetDetail = lazy(() => import('../pages/AssetDetail'));
const TrackRecord = lazy(() => import('../pages/TrackRecord'));
const Account = lazy(() => import('../pages/Account'));
const Onboarding = lazy(() => import('../pages/Onboarding'));
const Login = lazy(() => import('../pages/Login'));

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

/**
 * Authentication shell — lazy-loaded wrapper that brings in Privy + AuthProvider.
 *
 * This component is the code-splitting boundary for all auth-dependent code.
 * By lazy-loading this shell, the main bundle stays small (~100KB gzipped)
 * and Privy (~300KB gzipped) only downloads when an auth route is visited.
 *
 * Public routes (/terms, /privacy) bypass this entirely.
 */
export default function AuthShell() {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <DeactivationGate>
            <Routes>
              {/* Onboarding — outside Layout (no nav bar) */}
              <Route path="/welcome" element={<Onboarding />} />

              {/* Login — returning users, no onboarding steps */}
              <Route path="/login" element={<Login />} />

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

              {/* Catch-all — unknown routes redirect to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DeactivationGate>
        </Suspense>
      </AuthProvider>
    </PrivyProvider>
  );
}
