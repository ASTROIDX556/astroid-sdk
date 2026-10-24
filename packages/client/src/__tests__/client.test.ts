/**
 * Issue #382 — exponential backoff retries for the typed HTTP client.
 *
 * Verifies the public `Astroid` client wiring end to end: retry count and base
 * delay are configurable at construction time, transient `503` responses and
 * transport timeouts are retried with exponential backoff, and retries are
 * exhausted (or skipped) exactly when they should be.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstroidTimeoutError, ServerError } from '@astroid/errors';
import { Astroid, type AstroidClientConfig } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code = 'SERVICE_UNAVAILABLE',
  message = 'Service unavailable',
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mock fetch returning queued responses in order; repeats the last one. */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const response = responses[index] ?? responses[responses.length - 1]!;
    index++;
    return response;
  });
}

const BASE_CONFIG: AstroidClientConfig = {
  apiKey: 'sk_test_issue_382',
  baseUrl: 'https://api.astroid.test',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Configuration surface                                                       */
/* -------------------------------------------------------------------------- */

describe('#382 — retry configuration', () => {
  it('defaults to three retries with a 250ms base delay', () => {
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 3,
      baseDelayMs: 250,
      backoffFactor: 2,
    });
  });

  it('exposes retry count and base delay at client instantiation', () => {
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: vi.fn() as unknown as typeof fetch,
      maxRetries: 5,
      baseDelay: 125,
      backoffFactor: 3,
      jitter: false,
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 5,
      baseDelayMs: 125,
      backoffFactor: 3,
      jitter: false,
    });
  });

  it('disables retries completely when retry is false', () => {
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: vi.fn() as unknown as typeof fetch,
      retry: false,
    });

    expect(client.http.config.retry).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* HTTP 503 recovery and exponential delay sequence                            */
/* -------------------------------------------------------------------------- */

describe('#382 — 503 Service Unavailable retries', () => {
  it('recovers after a transient 503 using the configured base delay', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ walletId: 'w_1' }));
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 100,
      maxDelay: 1_000,
      jitter: false,
    });

    const pending = client.wallets.get('w_1');
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toMatchObject({ walletId: 'w_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially between successive 503 responses', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now());
      return callTimes.length <= 3 ? errorResponse(503) : okResponse({ recovered: true });
    });
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 50,
      maxDelay: 10_000,
      backoffFactor: 2,
      jitter: false,
    });

    const pending = client.http.get('/health');

    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(98);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(198);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2);

    await expect(pending).resolves.toMatchObject({ data: { recovered: true } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(50);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(100);
    expect(callTimes[3]! - callTimes[2]!).toBeGreaterThanOrEqual(200);
  });

  it('throws the final error after exhausting the retry budget', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => errorResponse(503));
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 10,
      maxDelay: 100,
      jitter: false,
    });

    const pending = client.wallets.get('w_exhausted');
    const assertion = expect(pending).rejects.toBeInstanceOf(ServerError);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    // Initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry client-side 4xx responses other than 429', async () => {
    const fetchMock = vi.fn(async () => errorResponse(400, 'BAD_REQUEST', 'Invalid id'));
    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 1,
      jitter: false,
    });

    await expect(client.wallets.get('bad_id')).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Transport timeouts                                                          */
/* -------------------------------------------------------------------------- */

describe('#382 — network timeout retries', () => {
  it('retries an attempt that times out and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      attempts++;
      if (attempts === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return okResponse({ recoveredAfterTimeout: true });
    });

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 2,
      baseDelay: 20,
      maxDelay: 100,
      jitter: false,
      timeoutMs: 100,
    });

    const pending = client.http.get('/slow');
    // First attempt hits its per-attempt timeout, then waits the 20ms backoff.
    await vi.advanceTimersByTimeAsync(121);

    await expect(pending).resolves.toMatchObject({ data: { recoveredAfterTimeout: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exposes the timeout error once retries are exhausted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(
      async (_url, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const client = new Astroid({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 1,
      baseDelay: 10,
      maxDelay: 100,
      jitter: false,
      timeoutMs: 50,
    });

    const pending = client.http.get('/never-responds');
    const assertion = expect(pending).rejects.toBeInstanceOf(AstroidTimeoutError);
    await vi.advanceTimersByTimeAsync(200);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                 */
/* -------------------------------------------------------------------------- */

describe('#382 — idempotency policy', () => {
  it('retries idempotent GET requests but not POST requests by default', async () => {
    const getFetch = fetchQueue(errorResponse(503), okResponse({ id: 'g' }));
    const getClient = new Astroid({
      ...BASE_CONFIG,
      fetch: getFetch,
      maxRetries: 2,
      baseDelay: 1,
      jitter: false,
    });

    await expect(getClient.http.get('/wallets/w_1')).resolves.toMatchObject({
      data: { id: 'g' },
    });
    expect(getFetch).toHaveBeenCalledTimes(2);

    const postFetch = fetchQueue(errorResponse(503), okResponse({ id: 'p' }));
    const postClient = new Astroid({
      ...BASE_CONFIG,
      fetch: postFetch,
      maxRetries: 2,
      baseDelay: 1,
      jitter: false,
    });

    await expect(postClient.http.post('/wallets', { label: 'Ops' })).rejects.toBeDefined();
    expect(postFetch).toHaveBeenCalledTimes(1);
  });
});
