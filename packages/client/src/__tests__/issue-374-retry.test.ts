/**
 * Issue #374 — Retry mechanism with exponential backoff and jitter to AstroidHttpClient.
 *
 * Acceptance Criteria & Test Coverage:
 * - [x] Add retry configuration options to the AstroidHttpClient constructor interface.
 * - [x] Implement exponential backoff calculation with jitter inside the request execution loop.
 * - [x] Ensure non-retryable errors (e.g., 400 Bad Request, 401 Unauthorized) fail immediately without retrying.
 * - [x] Add unit tests simulating transient 503/429 responses and verifying successful recovery after retries.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Astroid,
  AstroidClient,
  AstroidHttpClient,
  type AstroidHttpClientOptions,
  backoffDelay,
} from '../index.js';
import { AstroidHttpClient as ClientFromModule } from '../client.js';

/* -------------------------------------------------------------------------- */
/* Helpers & Fixtures                                                          */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code = 'ERROR',
  message = 'Request failed',
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponseWithRetryAfter(
  status: number,
  retryAfterSeconds: string,
  code = 'RATE_LIMITED',
  message = 'Too many requests',
): Response {
  return errorResponse(status, code, message, { 'retry-after': retryAfterSeconds });
}

/** Mock fetch returning responses from a FIFO queue (cloning response so body can be read multiple times). */
function createFetchQueue(
  ...responses: Array<Response | (() => Response)>
): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[index] ?? responses[responses.length - 1]!;
    index++;
    return typeof res === 'function' ? res() : res.clone();
  });
}

const BASE_CONFIG: AstroidHttpClientOptions = {
  apiKey: 'sk_test_issue_374',
  baseUrl: 'https://api.astroid.test/v1',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1. AstroidHttpClient Constructor Interface & Configuration                 */
/* -------------------------------------------------------------------------- */

describe('Issue #374 — AstroidHttpClient constructor interface & imports', () => {
  it('exports AstroidHttpClient class alias matching Astroid from index and client entry points', () => {
    expect(AstroidHttpClient).toBe(Astroid);
    expect(AstroidClient).toBe(Astroid);
    expect(ClientFromModule).toBe(Astroid);
  });

  it('accepts retry configuration options directly on constructor interface', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      maxRetries: 4,
      baseDelay: 200,
      maxDelay: 5000,
      retryableStatusCodes: [429, 502, 503, 504],
      jitter: false,
      backoffFactor: 3,
    });

    expect(client.http.config.retry).toEqual({
      maxRetries: 4,
      baseDelayMs: 200,
      maxDelayMs: 5000,
      retryableStatuses: [429, 502, 503, 504],
      jitter: false,
      backoffFactor: 3,
    });
  });

  it('accepts retry options via retryPolicy object alias', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      retryPolicy: {
        maxRetries: 5,
        baseDelayMs: 100,
        maxDelayMs: 4000,
        backoffFactor: 2,
        jitter: true,
      },
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 4000,
      backoffFactor: 2,
      jitter: true,
    });
  });

  it('accepts retry options via retryOptions object alias', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      retryOptions: {
        maxRetries: 2,
        baseDelayMs: 150,
      },
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 2,
      baseDelayMs: 150,
    });
  });

  it('disables retries when retry, retryPolicy, or retryOptions is set to false', () => {
    const noopFetch = vi.fn() as unknown as typeof fetch;

    const clientA = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      retry: false,
      maxRetries: 5,
    });
    expect(clientA.http.config.retry).toBeNull();

    const clientB = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      retryPolicy: false,
      maxRetries: 5,
    });
    expect(clientB.http.config.retry).toBeNull();

    const clientC = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: noopFetch,
      retryOptions: false,
      maxRetries: 5,
    });
    expect(clientC.http.config.retry).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Exponential Backoff Calculation with Jitter                             */
/* -------------------------------------------------------------------------- */

describe('Issue #374 — Exponential backoff calculation with jitter', () => {
  it('calculates deterministic exponential backoff when jitter is false', () => {
    const retryConfig = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffFactor: 2,
      jitter: false,
    };

    // attempt 1: 100 * 2^0 = 100
    expect(backoffDelay(1, retryConfig)).toBe(100);
    // attempt 2: 100 * 2^1 = 200
    expect(backoffDelay(2, retryConfig)).toBe(200);
    // attempt 3: 100 * 2^2 = 400
    expect(backoffDelay(3, retryConfig)).toBe(400);
    // attempt 4: 100 * 2^3 = 800
    expect(backoffDelay(4, retryConfig)).toBe(800);
    // attempt 5: capped at maxDelayMs (1000)
    expect(backoffDelay(5, retryConfig)).toBe(1000);
  });

  it('supports custom backoff factor in exponential growth', () => {
    const retryConfig = {
      maxRetries: 3,
      baseDelayMs: 50,
      maxDelayMs: 5000,
      backoffFactor: 3,
      jitter: false,
    };

    expect(backoffDelay(1, retryConfig)).toBe(50);
    expect(backoffDelay(2, retryConfig)).toBe(150);
    expect(backoffDelay(3, retryConfig)).toBe(450);
  });

  it('applies full jitter by default within [0, capped]', () => {
    const retryConfig = {
      maxRetries: 3,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      backoffFactor: 2,
      jitter: true,
    };

    const mockRandomMin = () => 0.0;
    const mockRandomMid = () => 0.5;
    const mockRandomMax = () => 0.999;

    // attempt 1 capped = 200
    expect(backoffDelay(1, retryConfig, mockRandomMin)).toBe(0);
    expect(backoffDelay(1, retryConfig, mockRandomMid)).toBe(100);
    expect(backoffDelay(1, retryConfig, mockRandomMax)).toBe(199);

    // attempt 2 capped = 400
    expect(backoffDelay(2, retryConfig, mockRandomMid)).toBe(200);
  });

  it('executes backoff sleep intervals using fake timers', async () => {
    vi.useFakeTimers();

    const fetchMock = createFetchQueue(
      errorResponse(503, 'OVERLOAD', 'temporary'),
      errorResponse(503, 'OVERLOAD', 'temporary'),
      okResponse({ data: 'success' }),
    );

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      retries: 3,
      baseDelay: 100,
      backoffFactor: 2,
      jitter: false,
    });

    const pending = client.get('/status');

    // Initial attempt fires immediately
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Wait 99ms (total 100ms): attempt 1 backoff (100ms) elapses
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Wait 199ms: attempt 2 backoff is 200ms -> not yet fired
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Advance 5ms more (total 204ms): attempt 2 backoff completes -> 3rd request fires and succeeds
    await vi.advanceTimersByTimeAsync(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result.data).toEqual({ data: 'success' });
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Non-retryable Errors Fail Immediately                                   */
/* -------------------------------------------------------------------------- */

describe('Issue #374 — Non-retryable errors fail immediately without retrying', () => {
  it('fails immediately on 400 Bad Request without retrying', async () => {
    const fetchMock = createFetchQueue(errorResponse(400, 'BAD_REQUEST', 'Invalid syntax'));
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(client.get('/agents')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 401 Unauthorized without retrying when no refresh handler succeeds', async () => {
    const fetchMock = createFetchQueue(errorResponse(401, 'UNAUTHORIZED', 'Invalid API key'));
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(client.get('/wallets')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 403 Forbidden without retrying', async () => {
    const fetchMock = createFetchQueue(errorResponse(403, 'FORBIDDEN', 'Access denied'));
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(client.get('/policies')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 404 Not Found without retrying', async () => {
    const fetchMock = createFetchQueue(errorResponse(404, 'NOT_FOUND', 'Wallet does not exist'));
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(client.get('/wallets/missing-123')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 422 Unprocessable Entity without retrying', async () => {
    const fetchMock = createFetchQueue(errorResponse(422, 'UNPROCESSABLE', 'Validation failed'));
    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(client.get('/budgets')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Transient 503 / 429 Simulation and Successful Recovery                  */
/* -------------------------------------------------------------------------- */

describe('Issue #374 — Transient 503/429 simulation and recovery', () => {
  it('recovers successfully after a transient 503 Service Unavailable', async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'Temporarily down'),
      okResponse({ walletId: 'w_recovered_503', balance: '100.5' }),
    );

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 10,
      jitter: false,
    });

    const pending = client.wallets.get('w_recovered_503');
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result).toMatchObject({ walletId: 'w_recovered_503', balance: '100.5' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers successfully after a transient 429 Too Many Requests', async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchQueue(
      errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Rate limit reached'),
      okResponse({ agentId: 'agent_active', status: 'ACTIVE' }),
    );

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    const pending = client.agents.get('agent_active');
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result).toMatchObject({ agentId: 'agent_active', status: 'ACTIVE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After header duration on 429 responses', async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchQueue(
      errorResponseWithRetryAfter(429, '3', 'RATE_LIMITED', 'Back off for 3 seconds'),
      okResponse({ id: 'recovered_after_header' }),
    );

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 10, // Backoff would have been 10ms, but header requires 3000ms
      maxTimeout: 10_000,
      jitter: false,
    });

    const pending = client.get('/transactions/tx_1');

    // At 2990ms: retry has not fired yet
    await vi.advanceTimersByTimeAsync(2990);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // At 3050ms: 3s Retry-After expired, retry executed
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const result = await pending;
    expect(result.data).toEqual({ id: 'recovered_after_header' });
  });

  it('recovers from transient network drop errors (TypeError / timeout)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch: connection reset by peer'))
      .mockResolvedValueOnce(okResponse({ connected: true }));

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 10,
      jitter: false,
    });

    const pending = client.get('/health');
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result.data).toEqual({ connected: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exhausts maxRetries and throws the final error if server never recovers', async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchQueue(errorResponse(503, 'OUTAGE', 'Persistent outage'));

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    const pending = client.get('/critical');
    const failureAssertion = expect(pending).rejects.toThrow('Persistent outage');

    await vi.advanceTimersByTimeAsync(500);
    await failureAssertion;

    // 1 initial attempt + 3 retries = 4 total calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('respects idempotency: does not retry non-idempotent POST without idempotencyKey', async () => {
    const fetchMock = createFetchQueue(errorResponse(503, 'SERVICE_UNAVAILABLE', 'Down'));

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
    });

    await expect(
      client.post('/wallets', { label: 'New Custodial' }),
    ).rejects.toThrow();

    // POST without idempotency key or explicit retryable flag is called exactly once
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries non-idempotent POST when idempotencyKey is provided', async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'Down'),
      okResponse({ created: true, id: 'w_idempotent' }),
    );

    const client = new AstroidHttpClient({
      ...BASE_CONFIG,
      fetch: fetchMock,
      maxRetries: 2,
      baseDelay: 10,
      jitter: false,
    });

    const pending = client.post(
      '/wallets',
      { label: 'Idempotent Wallet' },
      { idempotencyKey: 'idem_key_unique_123' },
    );

    await vi.advanceTimersByTimeAsync(50);
    const res = await pending;

    expect(res.data).toEqual({ created: true, id: 'w_idempotent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
