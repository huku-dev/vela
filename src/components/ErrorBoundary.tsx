import React, { Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { Card, Button, Alert } from './VelaComponents';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI instead of crashing the entire app.
 *
 * Usage:
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console (in production, send to error tracking service)
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Send to Sentry for production error tracking
    Sentry.captureException(error, {
      contexts: {
        react: { componentStack: errorInfo.componentStack ?? '' },
      },
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '50vh',
            padding: 'var(--space-6)',
          }}
        >
          <Card variant="peach" style={{ maxWidth: '600px' }}>
            <div className="vela-stack vela-stack-lg">
              {/* Error Icon */}
              <div style={{ fontSize: '3rem', textAlign: 'center' }}>⚠️</div>

              {/* Error Title */}
              <div className="vela-stack vela-stack-sm">
                <h2 className="vela-heading-xl" style={{ textAlign: 'center' }}>
                  Something went wrong
                </h2>
                <p className="vela-body-lg vela-text-secondary" style={{ textAlign: 'center' }}>
                  We encountered an unexpected error. This has been logged and we&apos;ll look into
                  it.
                </p>
              </div>

              {/* Error Details (only in development) */}
              {import.meta.env.DEV && this.state.error && (
                <Alert variant="error">
                  <div className="vela-stack vela-stack-sm">
                    <strong>Error:</strong>
                    <code style={{ fontSize: '0.875rem' }}>{this.state.error.toString()}</code>
                    {this.state.errorInfo && (
                      <>
                        <strong>Component Stack:</strong>
                        <pre
                          style={{
                            fontSize: '0.75rem',
                            overflow: 'auto',
                            maxHeight: '200px',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </>
                    )}
                  </div>
                </Alert>
              )}

              {/* Action Buttons */}
              <div
                className="vela-row vela-row-md"
                style={{ justifyContent: 'center', flexWrap: 'wrap' }}
              >
                <Button variant="primary" onClick={this.handleReset}>
                  Try Again
                </Button>
                <Button variant="secondary" onClick={this.handleReload}>
                  Reload Page
                </Button>
                <Button variant="ghost" onClick={() => (window.location.href = '/')}>
                  Go Home
                </Button>
              </div>

              {/* Support Message */}
              <p className="vela-body-sm vela-text-muted" style={{ textAlign: 'center' }}>
                If this problem persists, please contact support.
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight Error Boundary for inline use
 * Shows a smaller error message suitable for cards/sections
 */
export function InlineErrorBoundary({
  children,
  message = 'Failed to load this section',
}: {
  children: ReactNode;
  message?: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <Alert variant="error">
          <div className="vela-stack vela-stack-sm">
            <span>⚠️ {message}</span>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </Alert>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
