/**
 * Issue #222 — standardized error handling and retry mechanism.
 *
 * Verifies the `Retry-After` contract end-to-end with mocked `fetch`:
 *
 * - delta-seconds form on `429` and `503` is honoured as the wait time,
 *   overriding the computed exponential backoff;
 * - the HTTP-date form is parsed (RFC 7231 §7.1.3) instead of being silently
 *   dropped;
 * - the parsed wait time is surfaced on the typed `RateLimitError` /
 *   `InternalServerError` (`details.retryAfter`) for callers that choose not to
 *   retry automatically;
 * - non-retryable client errors (400/401/403/404) throw the correct typed
 *   error immediately, with zero retry attempts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '@astroid/errors';
import { parseRetryAfter } from '@astroid/core';
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

/** An error response with no JSON body, so the status alone drives the mapping. */
function bareErrorResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('error', {
    status,
    headers: { ...headers },
  });
}

/** Mock fetch returning queued responses in order (the last one repeats). */
function fetchQueue(...responses: Response[]): ReturnType<typeof vi.fn> {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const res = responses[idx] ?? responses[responses.length - 1]!;
    idx++;
    return res;
  });
}

const BASE = { apiKey: 'sk_test_222', baseUrl: 'https://api.astroid.test' };

/* -------------------------------------------------------------------------- */
/* parseRetryAfter — both header forms                                         */
/* -------------------------------------------------------------------------- */

describe('parseRetryAfter (RFC 7231 §7.1.3)', () => {
  const NOW = Date.parse('2026-09-27T12:00:00.000Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses the HTTP-date form relative to now', () => {
    const target = new Date(NOW + 90_000).toUTCString();
    expect(parseRetryAfter(target, NOW)).toBe(90);
  });

  it('clamps a past HTTP-date to zero instead of waiting forever', () => {
    const past = new Date(NOW - 60_000).toUTCString();
    expect(parseRetryAfter(past, NOW)).toBe(0);
  });

  it('treats absent, empty, and unparseable headers as undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
    expect(parseRetryAfter('soon-ish')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Retry-After honoured during retries                                         */
/* -------------------------------------------------------------------------- */

describe('#222 — Retry-After overrides the computed backoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits the Retry-After delta-seconds before retrying a 429 (fakes timers)', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(
      bareErrorResponse(429, { 'retry-after': '2' }),
      okResponse({ id: 'rl' }),
    );
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      minTimeout: 5000, // backoff would wait 5000ms — the header must win
      maxTimeout: 10_000,
      jitter: false,
    });

    const pending = client.wallets.get('w-rl');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still inside the 2s wait
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ id: 'rl' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on a 503 maintenance-window response', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(
      bareErrorResponse(503, { 'retry-after': '1' }),
      okResponse({ id: 'mt' }),
    );
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      minTimeout: 60_000, // backoff would wait 60s — the 1s header must win
      maxTimeout: 60_000,
      jitter: false,
    });

    const pending = client.wallets.get('w-mt');
    await vi.advanceTimersByTimeAsync(1050);
    await expect(pending).resolves.toMatchObject({ id: 'mt' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('parses the HTTP-date form against a real 429 response', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const header = new Date(start + 1_000).toUTCString();
    const fetchMock = fetchQueue(bareErrorResponse(429, { 'retry-after': header }), okResponse());

    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      minTimeout: 60_000,
      maxTimeout: 60_000,
      jitter: false,
    });

    const pending = client.wallets.get('w-date');
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toMatchObject({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps the Retry-After wait at maxDelayMs', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(bareErrorResponse(429, { 'retry-after': '600' }), okResponse());
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      minTimeout: 1,
      maxTimeout: 2_000, // cap below the advised 600s
      jitter: false,
    });

    const pending = client.wallets.get('w-cap');
    await vi.advanceTimersByTimeAsync(2_050);
    await expect(pending).resolves.toMatchObject({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff when Retry-After is unparseable', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchQueue(
      bareErrorResponse(429, { 'retry-after': 'not-a-date' }),
      okResponse(),
    );
    const client = new Astroid({
      ...BASE,
      fetch: fetchMock,
      minTimeout: 10,
      maxTimeout: 100,
      jitter: false,
    });

    const pending = client.wallets.get('w-fallback');
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Typed errors carry the parsed wait time                                     */
/* -------------------------------------------------------------------------- */

describe('#222 — retryAfter surfaced on typed errors', () => {
  it('populates RateLimitError.retryAfter from the header', async () => {
    const fetchMock = fetchQueue(bareErrorResponse(429, { 'retry-after': '7' }));
    const client = new Astroid({ ...BASE, fetch: fetchMock, retries: 0 });

    const err = await client.http.get('/wallets/rl').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(7);
  });

  it('prefers the body-enveloped retryAfter over the header', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(
          JSON.stringify({
            error: { code: 'RATE_LIMITED', message: 'slow down', details: { retryAfter: 30 } },
          }),
          { status: 429, headers: { 'retry-after': '5' } },
        ),
    );
    const client = new Astroid({ ...BASE, fetch: fetchMock, retries: 0 });

    const err = await client.http.get('/wallets/body-rl').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(30);
  });

  it('populates a bare 503 InternalServerError with the parsed wait', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response('gateway unavailable', {
          status: 503,
          headers: { 'retry-after': '3' },
        }),
    );
    const client = new Astroid({ ...BASE, fetch: fetchMock, retries: 0 });

    const err = await client.http.get('/wallets/mt').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).details?.retryAfter).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Non-retryable client errors throw immediately                               */
/* -------------------------------------------------------------------------- */

describe('#222 — non-retryable client errors throw immediately with the typed class', () => {
  const CASES: ReadonlyArray<{
    status: number;
    ErrorClass: unknown;
    label: string;
  }> = [
    { status: 400, ErrorClass: ValidationError, label: '400' },
    { status: 401, ErrorClass: AuthenticationError, label: '401' },
    { status: 403, ErrorClass: ForbiddenError, label: '403' },
    { status: 404, ErrorClass: NotFoundError, label: '404' },
  ];

  for (const { status, ErrorClass, label } of CASES) {
    it(`throws immediately for ${label} with zero retry attempts`, async () => {
      const fetchMock = vi.fn(async () => bareErrorResponse(status));
      const client = new Astroid({
        ...BASE,
        fetch: fetchMock,
        retries: 5,
        minTimeout: 1,
        maxTimeout: 5,
      });

      await expect(client.wallets.get(`w-${status}`)).rejects.toBeInstanceOf(ErrorClass);
      expect(fetchMock, `${label} must not be retried`).toHaveBeenCalledTimes(1);
    });
  }
});
