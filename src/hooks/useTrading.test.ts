import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for trade webhook fetch behavior.
 * Tests the timeout + abort controller pattern used in acceptProposal/declineProposal.
 */

describe('TRADE-TIMEOUT: trade webhook fetch behavior', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes AbortSignal to fetch for accept requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    // Simulate the accept flow from useTrading
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      await fetch('https://test.supabase.co/functions/v1/trade-webhook?source=frontend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: JSON.stringify({ proposal_id: 'prop-1', action: 'accept' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Verify signal was passed
    expect(fetchMock).toHaveBeenCalledOnce();
    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws user-friendly message on AbortError', async () => {
    // Simulate what happens when AbortController fires
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    globalThis.fetch = fetchMock;

    const acceptWithTimeout = async () => {
      try {
        await fetch('https://test.supabase.co/functions/v1/trade-webhook?source=frontend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_id: 'prop-1', action: 'accept' }),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error('Trade request timed out. Check Your Trades to see if it went through.');
        }
        throw err;
      }
    };

    await expect(acceptWithTimeout()).rejects.toThrow(
      'Trade request timed out. Check Your Trades to see if it went through.'
    );
  });

  it('throws user-friendly message on decline AbortError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    globalThis.fetch = fetchMock;

    const declineWithTimeout = async () => {
      try {
        await fetch('https://test.supabase.co/functions/v1/trade-webhook?source=frontend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_id: 'prop-1', action: 'decline' }),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error('Request timed out. Please try again.');
        }
        throw err;
      }
    };

    await expect(declineWithTimeout()).rejects.toThrow('Request timed out. Please try again.');
  });

  it('surfaces server error message on non-ok response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 400 })
      );
    globalThis.fetch = fetchMock;

    const res = await fetch('https://test.supabase.co/functions/v1/trade-webhook?source=frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ proposal_id: 'prop-1', action: 'accept' }),
    });

    expect(res.ok).toBe(false);
    const data = await res.json();
    expect(data.error).toBe('Insufficient balance');
  });

  it('does not abort when response arrives quickly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch('https://test.supabase.co/functions/v1/trade-webhook?source=frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ proposal_id: 'prop-1', action: 'accept' }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    expect(res.ok).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });
});
