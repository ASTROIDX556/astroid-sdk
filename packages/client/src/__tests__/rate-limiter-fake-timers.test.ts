/**
 * Issue #230 — deterministic (fake-timer) tests for the token-bucket rate
 * limiter and rate-limit retry backoff.
 *
 * Using `vi.useFakeTimers()` keeps these tests fast and exact: token refill,
 * queueing/draining, `Retry-After` cooldowns and the 429 retry delay are all
 * verified by advancing virtual time instead of sleeping in real time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '@astroid/errors';
import type { PreparedRequest } from '@astroid/core';
import { Astroid, createRateLimiterMiddleware } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function makeRequest(signal?: AbortSignal): PreparedRequest {
  return {
    method: 'GET',
    url: 'https://api.test/v1/wallets',
    headers: {},
    body: undefined,
    timeoutMs: 1000,
    retryable: true,
    signal,
    options: { method: 'GET', path: '/wallets' },
  };
}

/** Flush pending microtasks so async chains settle under fake timers. */
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Token bucket                                                                */
/* -------------------------------------------------------------------------- */

describe('#230 — token bucket with fake timers', () => {
  it('lets a burst up to capacity through with no delay', async () => {
    const mw = createRateLimiterMiddleware({ maxRequestsPerSecond: 1, burstCapacity: 3 });
    const startedAt = Date.now();

    await mw.onRequest!(makeRequest());
    await mw.onRequest!(makeRequest());
    await mw.onRequest!(makeRequest());

    expect(Date.now()).toBe(startedAt); // no virtual time elapsed
  });

  it('refills at the configured rate and drains the queue in order', async () => {
    // 2 requests/second → one token every 500ms, bucket starts with 1 token.
    const mw = createRateLimiterMiddleware({ maxRequestsPerSecond: 2, burstCapacity: 1 });
    await mw.onRequest!(makeRequest()); // consume the initial token

    const order: number[] = [];
    const second = Promise.resolve(mw.onRequest!(makeRequest())).then(() => order.push(2));
    const third = Promise.resolve(mw.onRequest!(makeRequest())).then(() => order.push(3));

    await vi.advanceTimersByTimeAsync(499);
    expect(order).toEqual([]); // nothing refilled yet

    await vi.advanceTimersByTimeAsync(1); // t = 500ms → first refill
    await flushMicrotasks();
    expect(order).toEqual([2]);

    await vi.advanceTimersByTimeAsync(500); // t = 1000ms → second refill
    await flushMicrotasks();
    expect(order).toEqual([2, 3]);

    await Promise.all([second, third]);
  });

  it('rejects immediately when the queue is full', async () => {
    const mw = createRateLimiterMiddleware({
      maxRequestsPerSecond: 1,
      burstCapacity: 1,
      maxQueueLength: 1,
    });

    await mw.onRequest!(makeRequest()); // takes the token
    const queued = mw.onRequest!(makeRequest()); // fills the queue

    await expect(mw.onRequest!(makeRequest())).rejects.toBeInstanceOf(RateLimitError);

    // Drain the queued request so the test leaves no dangling timer state.
    await vi.advanceTimersByTimeAsync(1000);
    await queued;
  });

  it('fails a queued request once queueTimeoutMs elapses', async () => {
    const mw = createRateLimiterMiddleware({
      maxRequestsPerSecond: 1, // ~1000ms between tokens
      burstCapacity: 1,
      maxQueueLength: 10,
      queueTimeoutMs: 100,
    });

    await mw.onRequest!(makeRequest()); // consume the token

    const queued = mw.onRequest!(makeRequest());
    const outcome = Promise.resolve(queued).then(
      () => null,
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(100);

    const error = await outcome;
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).code).toBe('RATE_LIMIT_QUEUE_TIMEOUT');
  });

  it('rejects a queued request when its signal aborts', async () => {
    const mw = createRateLimiterMiddleware({ maxRequestsPerSecond: 1, burstCapacity: 1 });
    await mw.onRequest!(makeRequest()); // consume the token

    const controller = new AbortController();
    const queued = mw.onRequest!(makeRequest(controller.signal));
    const outcome = Promise.resolve(queued).then(
      () => null,
      (err: unknown) => err,
    );

    controller.abort();
    const error = await outcome;
    expect((error as { name?: string }).name).toBe('AbortError');
  });
});

/* -------------------------------------------------------------------------- */
/* Retry-After                                                                 */
/* -------------------------------------------------------------------------- */

describe('#230 — Retry-After cooldown with fake timers', () => {
  it('pauses refills until the Retry-After window elapses', async () => {
    const mw = createRateLimiterMiddleware({ maxRequestsPerSecond: 1000, burstCapacity: 1 });

    await mw.onRequest!(makeRequest()); // consume the token

    // Server rate-limits us and asks for a 1s back-off.
    mw.onResponse!(
      {
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
        body: undefined,
        requestId: undefined,
      },
      makeRequest(),
    );

    const released = vi.fn();
    const queued = Promise.resolve(mw.onRequest!(makeRequest())).then(released);

    await vi.advanceTimersByTimeAsync(999);
    expect(released).not.toHaveBeenCalled(); // still cooling down

    await vi.advanceTimersByTimeAsync(2); // past the cooldown: a token is minted
    await flushMicrotasks();
    expect(released).toHaveBeenCalledTimes(1);

    await queued;
  });
});

/* -------------------------------------------------------------------------- */
/* 429 retry backoff                                                           */
/* -------------------------------------------------------------------------- */

describe('#230 — 429 retry honours Retry-After (fake timers)', () => {
  it('does not retry before Retry-After elapses, then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too Many Requests' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0.2' },
          },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'w_ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_230',
      baseUrl: 'https://api.test',
      fetch: fetchMock as unknown as typeof fetch,
      // maxDelayMs must be >= the Retry-After window so the delay is honoured.
      retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 5000 },
    });

    const pending = client.wallets.get('w_ok');
    await flushMicrotasks();
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1); // 200ms Retry-After has not elapsed

    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    await expect(pending).resolves.toMatchObject({ id: 'w_ok' });
    expect(calls).toBe(2);
  });
});
