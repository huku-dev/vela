import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './styles/vela-design-system.css';

// Initialize Sentry before rendering — captures errors, unhandled rejections, and console errors
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    // Sample 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    // Only send errors in production/staging — skip noisy dev errors
    enabled: !import.meta.env.DEV,
    // Filter out non-actionable errors
    beforeSend(event) {
      // Skip ResizeObserver loop errors (browser noise, not actionable)
      if (event.exception?.values?.[0]?.value?.includes('ResizeObserver loop')) {
        return null;
      }
      return event;
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
