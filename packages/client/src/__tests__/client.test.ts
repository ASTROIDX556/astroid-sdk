/**
 * Issue #390 — configurable retry wrapper with exponential backoff and jitter.
 *
 * Acceptance criteria covered here:
 * - `RetryOptions` is exported from both the `@astroid/client` root and the
 *   `@astroid/client/client` entry point.
 * - Transient `503` responses are retried and a later success is returned.
 * - `400 Bad Request` fails fast without consuming a retry.
 * - The default retry set includes `500`, and `Retry-After` is honoured.
 * - Only idempotent methods (GET/PUT/DELETE) are retried by default.
 * - Backoff grows exponentially and is jittered when enabled.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Astroid, backoffDelay, type RetryOptions } from '../index.js';
import { AstroidClient, type RetryOptions as RetryOptionsFromClientEntry } from '../client.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function okResponse(data: unknown = { id: 'ok' }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code = 'SERVER_ERROR', message = 'error'): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function retryAfterResponse(status: number, retryAfter: string): Response {
  return new Response(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'retry' } }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after': retryAfter },
  });
}

/** Mock fetch returning queued responses in order; the last response repeats. */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const response = responses[index] ?? responses[responses.length - 1]!;
    index += 1;
    return response;
  });
}

const BASE_CONFIG = {
  apiKey: 'sk_test_390',
  baseUrl: 'https://api.astroid.test',
};

/* -------------------------------------------------------------------------- */
/* Public retry options                                                        */
/* -------------------------------------------------------------------------- */

describe('Issue #390 — RetryOptions surface', () => {
  it('exports the same RetryOptions interface from the root and client entry points', () => {
    expectTypeOf<RetryOptionsFromClientEntry>().toEqualTypeOf<RetryOptions>();
    expect(AstroidClient).toBe(Astroid);
  });

  it('accepts maxRetries, baseDelayMs, maxDelayMs, jitter and retryable statuses', () => {
    const options: RetryOptions = {
      maxRetries: 2,
      baseDelayMs: 5,
      maxDelayMs: 20,
      jitter: false,
      retryableStatuses: [429, 500, 502, 503, 504],
    };

    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: vi.fn() as unknown as typeof fetch,
      retry: options,
    });

    expect(client.http.config.retry).toMatchObject(options);
  });

  it('accepts the flat maxRetries / baseDelayMs shorthand on the client config', () => {
    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: vi.fn() as unknown as typeof fetch,
      maxRetries: 4,
      baseDelayMs: 10,
      jitter: false,
    });

    expect(client.http.config.retry).toMatchObject({
      maxRetries: 4,
      baseDelayMs: 10,
      jitter: false,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Retry behaviour                                                             */
/* -------------------------------------------------------------------------- */

describe('Issue #390 — transient retry behaviour', () => {
  it('retries a GET on 503 and returns the successful response', async () => {
    const fetchMock = fetchQueue(
      errorResponse(503, 'SERVICE_UNAVAILABLE', 'temporarily unavailable'),
      okResponse({ id: 'wlt_recovered' }),
    );

    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });

    await expect(client.wallets.get('wlt_recovered')).resolves.toMatchObject({
      id: 'wlt_recovered',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast on 400 Bad Request without retrying', async () => {
    const fetchMock = fetchQueue(errorResponse(400, 'VALIDATION_ERROR', 'bad request'));

    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });

    await expect(client.wallets.get('wlt_invalid')).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries the default 500 status', async () => {
    const fetchMock = fetchQueue(
      errorResponse(500, 'INTERNAL_ERROR', 'boom'),
      okResponse({ id: 'wlt_500' }),
    );

    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });

    await expect(client.wallets.get('wlt_500')).resolves.toMatchObject({ id: 'wlt_500' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on a 503 response', async () => {
    const timestamps: number[] = [];
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      timestamps.push(Date.now());
      return calls === 1 ? retryAfterResponse(503, '0.03') : okResponse({ id: 'wlt_after' });
    });

    const client = new AstroidClient({
      ...BASE_CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 1_000,
      jitter: false,
    });

    await client.wallets.get('wlt_after');

    expect(calls).toBe(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(20);
  });

  it('only retries idempotent methods by default', async () => {
    const getFetch = fetchQueue(errorResponse(503), okResponse({ id: 'wlt_get' }));
    const getClient = new AstroidClient({
      ...BASE_CONFIG,
      fetch: getFetch as unknown as typeof fetch,
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });
    await expect(getClient.wallets.get('wlt_get')).resolves.toMatchObject({ id: 'wlt_get' });
    expect(getFetch).toHaveBeenCalledTimes(2);

    const postFetch = fetchQueue(errorResponse(503), okResponse({ id: 'wlt_post' }));
    const postClient = new AstroidClient({
      ...BASE_CONFIG,
      fetch: postFetch as unknown as typeof fetch,
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });
    await expect(postClient.wallets.create({ label: 'no-retry' })).rejects.toBeDefined();
    expect(postFetch).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff with full jitter', () => {
    const config = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitter: false,
    };

    expect(backoffDelay(1, config)).toBe(100);
    expect(backoffDelay(2, config)).toBe(200);
    expect(backoffDelay(3, config)).toBe(400);

    expect(backoffDelay(1, { ...config, jitter: true }, () => 0.5)).toBe(50);
    expect(backoffDelay(2, { ...config, jitter: true }, () => 0.5)).toBe(100);
  });
});
