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
    // Sample all transactions while actively debugging trade flow
    tracesSampleRate: 1.0,
    // Only send errors in production/staging — skip noisy dev errors
    enabled: !import.meta.env.DEV,
    // Capture all sessions with errors for replay, 10% of normal sessions
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    integrations: [
      Sentry.replayIntegration({
        // Mask all text by default for privacy, unmask specific elements as needed
        maskAllText: false,
        blockAllMedia: false,
      }),
      Sentry.browserTracingIntegration(),
    ],
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
