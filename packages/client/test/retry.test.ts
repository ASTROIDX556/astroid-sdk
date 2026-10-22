import { describe, it, expect, vi, afterEach } from 'vitest';
import { Astroid } from '../src/index.js';

/* -------------------------------------------------------------------------- */
/* Helpers (same pattern as src/__tests__/request-retry.test.ts)               */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { id: 'ok' }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code = 'SERVICE_UNAVAILABLE',
  message = 'error',
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Mock fetch returning queued responses in order (last one repeats). */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[idx] ?? responses[responses.length - 1]!;
    idx++;
    return res;
  });
}

const BASE = { apiKey: 'sk_test_retry', baseUrl: 'https://api.astroid.test/v1' };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retry configuration', () => {
  it('accepts retries, retryDelay, and retryableStatuses options', () => {
    const noFetch = vi.fn() as unknown as typeof fetch;
    const client = new Astroid({
      ...BASE,
      fetch: noFetch,
      retries: 3,
      retryDelay: 10,
      retryableStatuses: [429, 503],
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 3,
      baseDelayMs: 10,
      retryableStatuses: [429, 503],
    });
  });
});

describe('retry behavior', () => {
  it('retries a transient 503 failure with exponential backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'w_1' }));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 2,
      retryDelay: 1,
      jitter: false,
    });

    const pending = client.wallets.get('w_1');
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ id: 'w_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transient network errors before succeeding', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network dropped'))
      .mockResolvedValueOnce(okResponse({ id: 'w_2' }));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 2,
      retryDelay: 1,
      jitter: false,
    });

    const pending = client.wallets.get('w_2');
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ id: 'w_2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(errorResponse(503));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 1,
      retryDelay: 1,
      jitter: false,
    });

    const pending = client.wallets.get('w_3');
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry POST by default', async () => {
    const fetchMock = fetchQueue(errorResponse(503));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 3,
      retryDelay: 1,
      jitter: false,
    });

    await expect(
      client.http.request({
        method: 'POST',
        path: '/wallets',
        body: { name: 'Temp' },
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects the Retry-After header on 429 responses', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(
      errorResponse(429, 'RATE_LIMITED', 'slow down', { 'retry-after': '2' }),
      okResponse({ id: 'w_4' }),
    );
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 2,
      retryDelay: 5000, // backoff would wait 5000ms — the header must win
      maxTimeout: 10_000,
      jitter: false,
    });

    const pending = client.wallets.get('w_4');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still inside the 2s wait
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ id: 'w_4' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours custom retryableStatuses', async () => {
    const fetchMock = fetchQueue(errorResponse(418, 'TEAPOT', 'nope'));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 2,
      retryDelay: 1,
      jitter: false,
      retryableStatuses: [418],
    });

    await expect(client.wallets.get('w_5')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
