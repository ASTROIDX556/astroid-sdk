/**
 * Issue #272 — client-level request retry configuration.
 *
 * Verifies that `@astroid/client` accepts the flat retry options
 * (`retries`, `minTimeout`, `maxTimeout`, `retryableStatuses`, `jitter`),
 * retries transient network/status failures with exponential backoff, throws
 * the final error once retries are exhausted, honours a custom status
 * allow-list, and aborts a pending retry immediately via `AbortSignal`.
 */

import { describe, expect, it, vi } from 'vitest';
import { ServerError } from '@astroid/errors';
import { Astroid } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { id: 'ok' }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code = 'SERVICE_UNAVAILABLE', message = 'error'): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
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

const BASE = { apiKey: 'sk_test_272', baseUrl: 'https://api.astroid.test' };
const noFetch = vi.fn() as unknown as typeof fetch;

/* -------------------------------------------------------------------------- */
/* Configuration mapping                                                       */
/* -------------------------------------------------------------------------- */

describe('#272 — retry configuration options', () => {
  it('maps retries / minTimeout / maxTimeout / retryableStatuses / jitter', () => {
    const client = new Astroid({
      ...BASE,
      fetch: noFetch,
      retries: 4,
      minTimeout: 50,
      maxTimeout: 900,
      retryableStatuses: [503, 429],
      jitter: false,
    });

    expect(client.http.config.retry).toEqual({
      maxRetries: 4,
      baseDelayMs: 50,
      maxDelayMs: 900,
      retryableStatuses: [503, 429],
      jitter: false,
    });
  });

  it('supports the legacy retryDelay alias and keeps core defaults', () => {
    const client = new Astroid({ ...BASE, fetch: noFetch, retryDelay: 123 });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 2,
      baseDelayMs: 123,
      maxDelayMs: 8000,
    });
  });

  it('merges shorthand options over an explicit retry object', () => {
    const client = new Astroid({
      ...BASE,
      fetch: noFetch,
      retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100 },
      retries: 5,
      maxTimeout: 2000,
    });

    expect(client.http.config.retry).toEqual({
      maxRetries: 5,
      baseDelayMs: 10,
      maxDelayMs: 2000,
    });
  });

  it('lets retry: false win over shorthand options', () => {
    const client = new Astroid({ ...BASE, fetch: noFetch, retry: false, retries: 5 });
    expect(client.http.config.retry).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Retry behaviour                                                             */
/* -------------------------------------------------------------------------- */

describe('#272 — retry behaviour', () => {
  it('succeeds after a transient 503', async () => {
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'w1' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 5, maxTimeout: 20 });

    await expect(client.wallets.get('w1')).resolves.toMatchObject({ id: 'w1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries the default transient statuses (429, 502, 503, 504)', async () => {
    for (const status of [429, 502, 503, 504]) {
      const fetchMock = fetchQueue(errorResponse(status), okResponse({ id: 'w' }));
      const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

      await expect(client.wallets.get('w')).resolves.toMatchObject({ id: 'w' });
      expect(fetchMock, `status ${status} should be retried`).toHaveBeenCalledTimes(2);
    }
  });

  it('exhausts retries and throws the final error', async () => {
    const fetchMock = vi.fn(async () => errorResponse(503));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 2,
      minTimeout: 1,
      maxTimeout: 5,
    });

    await expect(client.wallets.get('w')).rejects.toBeInstanceOf(ServerError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('honours a custom retryableStatuses allow-list', async () => {
    const fetchMock = vi.fn(async () => errorResponse(502));
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 3,
      retryableStatuses: [503],
      minTimeout: 1,
      maxTimeout: 5,
    });

    await expect(client.wallets.get('w')).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // 502 is not in the allow-list
  });

  it('retries network-level failures', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return okResponse({ id: 'w-net' });
    });
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

    await expect(client.wallets.get('w-net')).resolves.toMatchObject({ id: 'w-net' });
    expect(calls).toBe(2);
  });

  it('does not retry a non-transient 400', async () => {
    const fetchMock = vi.fn(async () => errorResponse(400, 'VALIDATION_ERROR', 'bad input'));
    const client = new Astroid({ ...BASE, fetch: fetchMock, retries: 3, minTimeout: 1, maxTimeout: 5 });

    await expect(client.wallets.get('w')).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency policy                                                          */
/* -------------------------------------------------------------------------- */

describe('#272 — idempotency policy', () => {
  it('retries idempotent GET requests by default', async () => {
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'g' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

    await expect(client.http.get('/wallets/w')).resolves.toMatchObject({ data: { id: 'g' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-idempotent POST by default', async () => {
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'p' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

    await expect(client.http.post('/wallets', { label: 'x' })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a POST explicitly marked retryable', async () => {
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'p2' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

    await expect(
      client.http.request({
        method: 'POST',
        path: '/wallets',
        body: { label: 'x' },
        retryable: true,
      }),
    ).resolves.toMatchObject({ data: { id: 'p2' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a POST carrying an idempotency key', async () => {
    const fetchMock = fetchQueue(errorResponse(503), okResponse({ id: 'p3' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, minTimeout: 1, maxTimeout: 5 });

    await expect(
      client.http.post('/wallets', { label: 'x' }, { idempotencyKey: 'key-1' }),
    ).resolves.toMatchObject({ data: { id: 'p3' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Backoff timing                                                              */
/* -------------------------------------------------------------------------- */

describe('#272 — exponential backoff delays', () => {
  it('increases exponentially when jitter is disabled', async () => {
    const starts: number[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      starts.push(Date.now());
      calls++;
      return calls <= 2 ? errorResponse(503) : okResponse({ id: 'w' });
    });
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 3,
      minTimeout: 40,
      maxTimeout: 1000,
      jitter: false,
    });

    await client.wallets.get('w');

    expect(calls).toBe(3);
    const firstGap = starts[1]! - starts[0]!;
    const secondGap = starts[2]! - starts[1]!;
    // attempt 1 ≈ 40ms, attempt 2 ≈ 80ms (with scheduling tolerance).
    expect(firstGap).toBeGreaterThanOrEqual(35);
    expect(secondGap).toBeGreaterThanOrEqual(75);
    expect(secondGap).toBeGreaterThan(firstGap);
  });
});

/* -------------------------------------------------------------------------- */
/* Cancellation                                                                */
/* -------------------------------------------------------------------------- */

describe('#272 — AbortSignal cancels pending retries', () => {
  it('aborts immediately during the retry backoff and stops sending', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return errorResponse(503);
    });
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      retries: 5,
      minTimeout: 100,
      maxTimeout: 1000,
      jitter: false,
    });

    const pending = client.http.get('/wallets/w-abort', { signal: controller.signal });

    // Let the first attempt resolve and the backoff begin, then abort.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1); // no further attempts after abort
  });
});
