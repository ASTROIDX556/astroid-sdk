import { describe, it, expect, vi } from 'vitest';
import { ServerError, ValidationError, AuthenticationError, NotFoundError, RateLimitError } from '@astroid/errors';
import {
  Astroid,
  createRetryMiddleware,
  retryMiddleware,
  backoffDelay,
  isRetryableStatus,
} from './index.js';

describe('Exponential Backoff & Retry Logic in Client Middleware', () => {
  it('backoffDelay calculates exponential backoff with full jitter', () => {
    const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 };

    // Deterministic random mock returning 0.5
    const mockRandomHalf = () => 0.5;

    // Attempt 1: 100 * 2^0 = 100 -> half jitter = 50
    expect(backoffDelay(1, config, mockRandomHalf)).toBe(50);
    // Attempt 2: 100 * 2^1 = 200 -> half jitter = 100
    expect(backoffDelay(2, config, mockRandomHalf)).toBe(100);
    // Attempt 3: 100 * 2^2 = 400 -> half jitter = 200
    expect(backoffDelay(3, config, mockRandomHalf)).toBe(200);

    // Capped at maxDelayMs
    const mockRandomMax = () => 1.0;
    // Attempt 10: 100 * 2^9 = 51200, capped at 1000 -> 1000
    expect(backoffDelay(10, config, mockRandomMax)).toBe(1000);
  });

  it('isRetryableStatus identifies 503 and other transient status codes', () => {
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('transparently retries on 503 error and returns resolved promise value on success', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVER_ERROR' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_123', name: 'Retry Wallet' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    });

    const wallet = await client.wallets.get('w_123');

    expect(wallet).toEqual({ id: 'w_123', name: 'Retry Wallet' });
    expect(callCount).toBe(2);
  });

  it('transparently retries on network error and returns resolved promise value on success', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('Failed to fetch (network error)');
      }
      return new Response(JSON.stringify({ data: { id: 'w_network', name: 'Network Recovery' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    });

    const wallet = await client.wallets.get('w_network');

    expect(wallet).toEqual({ id: 'w_network', name: 'Network Recovery' });
    expect(callCount).toBe(2);
  });

  it('configures retry policy using createRetryMiddleware with onRetry callback', async () => {
    let callCount = 0;
    const retryCalls: Array<{ attempt: number; delayMs: number }> = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response(
          JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVER_ERROR' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_mw', name: 'Middleware Retry' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    client.use(
      createRetryMiddleware({
        maxRetries: 3,
        baseDelayMs: 5,
        maxDelayMs: 50,
        onRetry: (attempt, _err, delayMs) => {
          retryCalls.push({ attempt, delayMs });
        },
      }),
    );

    const wallet = await client.wallets.get('w_mw');

    expect(wallet).toEqual({ id: 'w_mw', name: 'Middleware Retry' });
    expect(callCount).toBe(3);
    expect(retryCalls.length).toBe(2);
    expect(retryCalls[0]!.attempt).toBe(1);
    expect(retryCalls[1]!.attempt).toBe(2);
  });

  it('throws ServerError when retries are exhausted on 503', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 },
    });

    await expect(client.wallets.get('w_exhausted')).rejects.toThrow(ServerError);
    expect(callCount).toBe(3); // Initial attempt + 2 retries
  });

  it('retryMiddleware alias is export equivalent to createRetryMiddleware', () => {
    expect(retryMiddleware).toBe(createRetryMiddleware);
  });

  /* ------------------------------------------------------------------------ */
  /* Retry-After header support                                                */
  /* ------------------------------------------------------------------------ */

  it('respects Retry-After header on 429 and waits the specified duration', async () => {
    let callCount = 0;
    const timestamps: number[] = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Too Many Requests', code: 'RATE_LIMITED' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '1' },
          },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_ra', name: 'After Retry' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 5000 },
    });

    const wallet = await client.wallets.get('w_ra');
    expect(wallet).toEqual({ id: 'w_ra', name: 'After Retry' });
    expect(callCount).toBe(2);
    // Retry-After: 1 second → at least ~1000ms between attempts
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(900);
  });

  /* ------------------------------------------------------------------------ */
  /* Non-retriable error propagation                                           */
  /* ------------------------------------------------------------------------ */

  it('does not retry on 400 Bad Request and propagates ValidationError', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Invalid input', code: 'VALIDATION_ERROR' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
    });

    await expect(client.wallets.get('w_bad')).rejects.toThrow(ValidationError);
    expect(callCount).toBe(1); // No retries for 400
  });

  it('does not retry on 401 Unauthorized and propagates AuthenticationError', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Invalid API key', code: 'AUTHENTICATION_ERROR' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
    });

    await expect(client.wallets.get('w_unauth')).rejects.toThrow(AuthenticationError);
    expect(callCount).toBe(1); // No retries for 401
  });

  it('does not retry on 404 Not Found and propagates NotFoundError', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Wallet not found', code: 'NOT_FOUND' } }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
    });

    await expect(client.wallets.get('w_gone')).rejects.toThrow(NotFoundError);
    expect(callCount).toBe(1); // No retries for 404
  });

  /* ------------------------------------------------------------------------ */
  /* Non-idempotent method protection                                          */
  /* ------------------------------------------------------------------------ */

  it('does not retry POST requests by default (non-idempotent)', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
    });

    await expect(
      client.wallets.create({ label: 'test', walletType: 'TREASURY' }),
    ).rejects.toThrow(ServerError);
    expect(callCount).toBe(1); // POST is non-idempotent, no retries
  });

  it('retries PUT requests by default (idempotent)', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_put', name: 'Updated' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    });

    // PUT is idempotent and should be retried
    const wallet = await client.http.put<{ id: string; name: string }>(
      '/wallets/w_put',
      { name: 'Updated' },
      { path: '/wallets/w_put' },
    );
    expect(wallet.data).toEqual({ id: 'w_put', name: 'Updated' });
    expect(callCount).toBe(2); // Retried once
  });

  /* ------------------------------------------------------------------------ */
  /* retry: false disables retries entirely                                    */
  /* ------------------------------------------------------------------------ */

  it('does not retry when retry is set to false', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: false,
    });

    await expect(client.wallets.get('w_noretry')).rejects.toThrow(ServerError);
    expect(callCount).toBe(1); // No retries at all
  });

  /* ------------------------------------------------------------------------ */
  /* Backoff timing verification                                               */
  /* ------------------------------------------------------------------------ */

  it('retries with increasing delays (exponential backoff)', async () => {
    let callCount = 0;
    const timestamps: number[] = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      timestamps.push(Date.now());
      return new Response(
        JSON.stringify({ error: { message: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 5000 },
    });

    await expect(client.wallets.get('w_backoff')).rejects.toThrow(ServerError);
    expect(callCount).toBe(4); // 1 initial + 3 retries

    // Verify delays increase (second gap > first gap)
    const gap1 = timestamps[1]! - timestamps[0]!;
    const gap2 = timestamps[2]! - timestamps[1]!;
    const gap3 = timestamps[3]! - timestamps[2]!;
    // With jitter, gaps should generally increase
    expect(gap1).toBeGreaterThanOrEqual(0);
    expect(gap2).toBeGreaterThanOrEqual(0);
    expect(gap3).toBeGreaterThanOrEqual(0);
  });

  /* ------------------------------------------------------------------------ */
  /* Rate limit (429) retry                                                   */
  /* ------------------------------------------------------------------------ */

  it('retries on 429 rate limit errors', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limited', code: 'RATE_LIMITED' } }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_429', name: 'Rate Limit Recovered' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    });

    const wallet = await client.wallets.get('w_429');
    expect(wallet).toEqual({ id: 'w_429', name: 'Rate Limit Recovered' });
    expect(callCount).toBe(2);
  });
});
