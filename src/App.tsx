import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CookieConsent from './components/CookieConsent';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import PageLoader from './components/PageLoader';

// ── Lazy-loaded shells & pages ──
// AuthShell bundles Privy + AuthProvider + all auth-dependent routes.
// By lazy-loading it, the main chunk stays small and public pages
// (/terms, /privacy) never download the Privy SDK at all.
const AuthShell = lazy(() => import('./components/AuthShell'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes — no Privy, instant load */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* All other routes — Privy loaded on demand via AuthShell */}
          <Route path="/*" element={<AuthShell />} />
        </Routes>
      </Suspense>
      <CookieConsent />
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
  );
}
