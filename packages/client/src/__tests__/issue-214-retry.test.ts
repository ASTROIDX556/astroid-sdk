/**
 * Issue #214 — Standard request retry handler with exponential backoff in @astroid/client.
 *
 * Acceptance Criteria & Test Coverage:
 * - [x] Add retry configuration options to the AstroidClient options interface.
 * - [x] Implement exponential backoff with jitter for transient errors (429, 5xx).
 * - [x] Respect custom Retry-After headers when returned by the API.
 * - [x] Add unit tests covering successful recovery after transient failures and max-retry exhaustion.
 * - [x] Respect standard HTTP idempotency semantics (idempotent methods / idempotency keys).
 * - [x] Ensure timeouts do not accumulate incorrectly across retry attempts.
 */

import { describe, expect, it, vi } from 'vitest';
import { ServerError } from '@astroid/errors';
import {
  Astroid,
  AstroidClient,
  type AstroidClientOptions,
  computeRetryDelay,
} from '../index.js';
import { AstroidClient as ClientFromModule } from '../client.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code = 'SERVICE_UNAVAILABLE', message = 'Service unavailable'): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponseWithRetryAfter(
  status: number,
  retryAfter: string,
  code = 'RATE_LIMITED',
  message = 'Too many requests',
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'content-type': 'application/json',
      'retry-after': retryAfter,
    },
  });
}

/** Mock fetch that returns queued responses in sequence; repeats the last response if more calls occur. */
function createFetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return res;
  });
}

const BASE_OPTIONS: AstroidClientOptions = {
  apiKey: 'sk_test_issue_214',
  baseUrl: 'https://api.astroid.test',
};

/* -------------------------------------------------------------------------- */
/* 1. AstroidClient options interface & configuration                          */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — AstroidClient options interface & imports', () => {
  it('exports AstroidClient class alias matching Astroid', () => {
    expect(AstroidClient).toBe(Astroid);
    expect(ClientFromModule).toBe(Astroid);
  });

  it('configures retry options using AstroidClientOptions with maxRetries, baseDelay, maxDelay, retryableStatusCodes', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: noopFetch,
      maxRetries: 4,
      baseDelay: 150,
      maxDelay: 2500,
      retryableStatusCodes: [429, 502, 503, 504],
      jitter: false,
      backoffFactor: 3,
    });

    expect(client.http.config.retry).toEqual({
      maxRetries: 4,
      baseDelayMs: 150,
      maxDelayMs: 2500,
      retryableStatuses: [429, 502, 503, 504],
      jitter: false,
      backoffFactor: 3,
    });
  });

  it('supports nested retry configuration object in AstroidClientOptions', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: noopFetch,
      retry: {
        maxRetries: 2,
        baseDelay: 100,
        maxDelay: 5000,
        retryableStatusCodes: [503],
      },
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      retryableStatusCodes: [503],
    });
  });

  it('disables retries when retry is set to false', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: noopFetch,
      retry: false,
      maxRetries: 5,
    });

    expect(client.http.config.retry).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Recovery after transient failures (Intermittent 503 -> 200 OK)          */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — Recovery after transient failures', () => {
  it('successfully recovers after an intermittent 503 Service Unavailable followed by 200 OK', async () => {
    const fetchMock = createFetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'Backend warm-up'),
      okResponse({ walletId: 'w_recovered' }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 10,
    });

    const result = await client.wallets.get('w_recovered');
    expect(result).toMatchObject({ walletId: 'w_recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers after multiple transient failures (503, 502, 504) followed by 200 OK', async () => {
    const fetchMock = createFetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'Temporarily down'),
      errorResponse(502, 'BAD_GATEWAY', 'Upstream proxy error'),
      errorResponse(504, 'GATEWAY_TIMEOUT', 'Gateway timeout'),
      okResponse({ recovered: true }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 4,
      baseDelay: 1,
      maxDelay: 10,
    });

    const response = await client.http.get('/system/status');
    expect(response.data).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('recovers after transport network error followed by 200 OK', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('Network connection reset');
      }
      return okResponse({ networkRecovered: true });
    });

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 10,
    });

    const response = await client.http.get('/health');
    expect(response.data).toEqual({ networkRecovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Max-retry exhaustion                                                     */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — Max-retry exhaustion', () => {
  it('exhausts configured maxRetries and throws the final error', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Persistent outage');
    });

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
    });

    await expect(client.wallets.get('w_exhausted')).rejects.toThrow(ServerError);
    // Initial attempt + 2 retries = 3 total attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable 4xx client errors (e.g. 400 Bad Request)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return errorResponse(400, 'BAD_REQUEST', 'Invalid agent id');
    });

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 5,
    });

    await expect(client.wallets.get('bad_id')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only retries statuses explicitly configured in retryableStatusCodes', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return errorResponse(502, 'BAD_GATEWAY', 'Bad gateway');
    });

    // Client only retries 503 and 429; 502 should not be retried
    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 3,
      retryableStatusCodes: [503, 429],
      baseDelay: 1,
      maxDelay: 5,
    });

    await expect(client.wallets.get('test')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Respect custom Retry-After headers                                       */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — Retry-After headers', () => {
  it('respects Retry-After header on 429 rate-limited responses', async () => {
    const fetchMock = createFetchQueue(
      errorResponseWithRetryAfter(429, '0.02', 'RATE_LIMITED', 'Slow down'),
      okResponse({ status: 'ok' }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 50,
      maxDelay: 500,
    });

    const start = Date.now();
    const result = await client.http.get('/status');
    const elapsed = Date.now() - start;

    expect(result.data).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it('respects Retry-After header on 503 maintenance responses', async () => {
    const fetchMock = createFetchQueue(
      errorResponseWithRetryAfter(503, '0.02', 'SERVICE_UNAVAILABLE', 'Maintenance window'),
      okResponse({ maintenanceDone: true }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 50,
      maxDelay: 500,
    });

    const start = Date.now();
    const result = await client.http.get('/maintenance');
    const elapsed = Date.now() - start;

    expect(result.data).toEqual({ maintenanceDone: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it('caps server Retry-After delay at maxDelay', () => {
    const config = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 2000 };
    // 10 seconds requested by server exceeds maxDelayMs (2000ms)
    const delay = computeRetryDelay(1, config, 429, 10);
    expect(delay).toBe(2000);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Standard HTTP idempotency semantics                                      */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — Standard HTTP idempotency semantics', () => {
  it('retries idempotent GET, PUT, DELETE requests on transient errors', async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const fetchMock = createFetchQueue(
        errorResponse(503),
        okResponse({ method }),
      );

      const client = new AstroidClient({
        ...BASE_OPTIONS,
        fetch: fetchMock,
        maxRetries: 2,
        baseDelay: 1,
        maxDelay: 5,
      });

      let res;
      if (method === 'GET') res = await client.http.get('/res');
      else if (method === 'PUT') res = await client.http.put('/res', { key: 'val' });
      else res = await client.http.delete('/res');

      expect(res.data).toEqual({ method });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('does not retry idempotent-unsafe POST or PATCH requests without explicit configuration', async () => {
    for (const method of ['POST', 'PATCH'] as const) {
      const fetchMock = createFetchQueue(
        errorResponse(503),
        okResponse({ method }),
      );

      const client = new AstroidClient({
        ...BASE_OPTIONS,
        fetch: fetchMock,
        maxRetries: 3,
        baseDelay: 1,
        maxDelay: 5,
      });

      if (method === 'POST') {
        await expect(client.http.post('/transactions', { amount: 100 })).rejects.toThrow();
      } else {
        await expect(client.http.patch('/agents/agt_1', { label: 'updated' })).rejects.toThrow();
      }

      // Not retried — failed after 1st attempt
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('retries non-idempotent requests when explicitly configured with retryable: true', async () => {
    const fetchMock = createFetchQueue(
      errorResponse(503),
      okResponse({ submitted: true }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
    });

    const result = await client.http.request({
      method: 'POST',
      path: '/transactions/submit',
      body: { tx: 'xdr_data' },
      retryable: true,
    });

    expect(result.data).toEqual({ submitted: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries non-idempotent requests when an idempotencyKey is supplied', async () => {
    const fetchMock = createFetchQueue(
      errorResponse(503),
      okResponse({ idempotentCreated: true }),
    );

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
    });

    const result = await client.http.post(
      '/payments',
      { amount: 50 },
      { idempotencyKey: 'idem_key_123' },
    );

    expect(result.data).toEqual({ idempotentCreated: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Timeout handling across retry attempts                                   */
/* -------------------------------------------------------------------------- */

describe('Issue #214 — Timeouts do not accumulate incorrectly across retry attempts', () => {
  it('each retry attempt gets an independent timeout without accumulating across attempts', async () => {
    let attempts = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        // First attempt takes 30ms, which is within the 100ms timeout
        await new Promise((r) => setTimeout(r, 30));
        return errorResponse(503);
      }
      // Second attempt takes 30ms, which is also within the 100ms timeout
      await new Promise((r) => setTimeout(r, 30));
      return okResponse({ attempts });
    });

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
      timeoutMs: 50, // Each attempt has 50ms deadline
    });

    // Total elapsed time will exceed 60ms, but neither individual attempt exceeded 50ms
    const res = await client.http.get('/status');
    expect(res.data).toEqual({ attempts: 2 });
    expect(attempts).toBe(2);
  });

  it('retries when an individual attempt times out', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      callCount++;
      if (callCount === 1) {
        // First attempt hangs until aborted by timeout
        return new Promise((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return okResponse({ recoveredAfterTimeout: true });
    });

    const client = new AstroidClient({
      ...BASE_OPTIONS,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 5,
      timeoutMs: 30,
    });

    const res = await client.http.get('/timeout-retry');
    expect(res.data).toEqual({ recoveredAfterTimeout: true });
    expect(callCount).toBe(2);
  });
});
