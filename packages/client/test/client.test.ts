/**
 * Issue #559 — configurable retry mechanism with exponential backoff.
 *
 * `@astroid/client` previously failed immediately on transient 5xx responses
 * and network-level errors. These tests prove that:
 *
 * - the retry policy is configurable through the client constructor
 *   (`maxRetries`, `baseDelayMs`, … — see {@link RetryClientOptions}),
 * - a transient `503 Service Unavailable` is retried and the call recovers,
 * - retries back off exponentially between attempts,
 * - the original error is thrown once `maxRetries` is exhausted,
 * - non-idempotent mutations (POST) are not retried unless flagged, and
 * - a server-supplied `Retry-After` header is honoured.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Astroid } from '../src/index.js';
import type { RetryClientOptions } from '../src/types.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { id: 'ok', label: 'Ops' }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code = 'SERVICE_UNAVAILABLE',
  message = 'service temporarily unavailable',
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Mock fetch returning queued responses in order (the last one repeats).
 *
 * A `Response` body stream can only be consumed once, so an entry may be a
 * factory that builds a fresh response for every attempt.
 */
function fetchQueue(...responses: Array<Response | (() => Response)>): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const entry = responses[index] ?? responses[responses.length - 1]!;
    index++;
    return typeof entry === 'function' ? entry() : entry;
  });
}

const BASE = { apiKey: 'sk_test_retry', baseUrl: 'https://api.astroid.test/v1' };

function createClient(fetchImpl: typeof fetch, retry: RetryClientOptions = {}): Astroid {
  return new Astroid({ ...BASE, fetch: fetchImpl, jitter: false, ...retry });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

describe('retry configuration (#559)', () => {
  it('accepts maxRetries and baseDelayMs in the client config', () => {
    const options: RetryClientOptions = { maxRetries: 4, baseDelayMs: 120 };
    const client = createClient(vi.fn() as unknown as typeof fetch, options);

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 4,
      baseDelayMs: 120,
    });
  });

  it('merges shorthand aliases into the resolved retry policy', () => {
    const client = createClient(vi.fn() as unknown as typeof fetch, {
      retries: 2,
      minTimeout: 50,
      maxTimeout: 500,
      backoffFactor: 3,
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 2,
      baseDelayMs: 50,
      maxDelayMs: 500,
      backoffFactor: 3,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Recovery                                                                   */
/* -------------------------------------------------------------------------- */

describe('transient 503 recovery (#559)', () => {
  it('recovers on the second attempt after a transient 503', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'w_retry' }));
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 2,
      baseDelayMs: 10,
    });

    const pending = client.wallets.get('w_retry');
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({ id: 'w_retry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially between attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503), errorResponse(503), okResponse());
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 2,
      baseDelayMs: 100,
    });

    const pending = client.wallets.get('w_backoff');

    // First retry waits 100ms (100 * 2^0) — still one call at 99ms.
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second retry waits 200ms (100 * 2^1).
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws the original 503 error after exhausting maxRetries', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(() => errorResponse(503));
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 2,
      baseDelayMs: 5,
    });

    const pending = client.http.request({ method: 'GET', path: '/wallets/w_exhausted' });
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    // maxRetries = 2 → three total attempts (initial + 2 retries).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency & headers                                                      */
/* -------------------------------------------------------------------------- */

describe('retry safety (#559)', () => {
  it('does not retry POST requests by default', async () => {
    const fetchMock = fetchQueue(errorResponse(503));
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 3,
      baseDelayMs: 1,
    });

    await expect(
      client.http.request({ method: 'POST', path: '/wallets', body: { label: 'Temp' } }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries POST requests explicitly flagged as retryable', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'w_post' }));
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 2,
      baseDelayMs: 5,
    });

    const pending = client.http.request({
      method: 'POST',
      path: '/wallets',
      body: { label: 'Temp' },
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toMatchObject({ data: { id: 'w_post' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours the Retry-After header on a 503 response', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'maintenance', { 'retry-after': '2' }),
      okResponse(),
    );
    const client = createClient(fetchMock as unknown as typeof fetch, {
      maxRetries: 1,
      baseDelayMs: 5000, // backoff would wait 5s — the header must win
      maxDelayMs: 10_000,
    });

    const pending = client.wallets.get('w_retry_after');

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
