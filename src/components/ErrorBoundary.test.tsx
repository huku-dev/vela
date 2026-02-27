import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Sentry from '@sentry/react';
import { ErrorBoundary, InlineErrorBoundary } from './ErrorBoundary';

// Mock Sentry
vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

// Component that throws an error on render
function ThrowingComponent({ error }: { error: Error }): React.ReactNode {
  throw error;
}

// Suppress React error boundary console.error noise in tests
const originalConsoleError = console.error;

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders default fallback UI when an error is thrown', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test error')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/encountered an unexpected error/)).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error page</div>}>
        <ThrowingComponent error={new Error('Test error')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom error page')).toBeInTheDocument();
  });

  it('CRITICAL: calls Sentry.captureException with error and component stack', () => {
    const testError = new Error('Sentry test error');
    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({
        contexts: expect.objectContaining({
          react: expect.objectContaining({
            componentStack: expect.any(String),
          }),
        }),
      })
    );
  });

  it('calls custom onError handler when provided', () => {
    const onError = vi.fn();
    const testError = new Error('Handler test');
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledWith(testError, expect.anything());
  });

  it('shows action buttons in default fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
    expect(screen.getByText('Go Home')).toBeInTheDocument();
  });

  it('"Try Again" resets error state', async () => {
    // Use a stateful parent to control whether child throws
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error('Recoverable error');
      return <p>Recovered successfully</p>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing and click Try Again
    shouldThrow = false;
    const user = userEvent.setup();
    await user.click(screen.getByText('Try Again'));

    // Force re-render after state reset
    rerender(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered successfully')).toBeInTheDocument();
  });

  it('shows contact support message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test')} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/contact support/)).toBeInTheDocument();
  });
});

describe('InlineErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error', () => {
    render(
      <InlineErrorBoundary>
        <p>Section content</p>
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Section content')).toBeInTheDocument();
  });

  it('renders inline error message when child throws', () => {
    render(
      <InlineErrorBoundary>
        <ThrowingComponent error={new Error('Section error')} />
      </InlineErrorBoundary>
    );
    expect(screen.getByText(/Failed to load this section/)).toBeInTheDocument();
  });

  it('renders custom message when provided', () => {
    render(
      <InlineErrorBoundary message="Custom section error">
        <ThrowingComponent error={new Error('Test')} />
      </InlineErrorBoundary>
    );
    expect(screen.getByText(/Custom section error/)).toBeInTheDocument();
  });

  it('includes a reload button in inline fallback', () => {
    render(
      <InlineErrorBoundary>
        <ThrowingComponent error={new Error('Test')} />
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
  });
});
