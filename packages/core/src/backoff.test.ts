import { describe, expect, it } from 'vitest';

import {
  backoffDelay,
  DEFAULT_RETRYABLE_STATUSES,
  isRetryableStatus,
  parseRetryAfter,
  sleep,
} from './backoff.js';
import type { RetryConfig } from './config.js';

/** A retry config with deterministic (un-jittered) defaults. */
function config(overrides: Partial<RetryConfig> = {}): RetryConfig {
  return { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 8_000, jitter: false, ...overrides };
}

describe('backoffDelay', () => {
  it('grows the capped delay by the default factor (2) when jitter is disabled', () => {
    // jitter:false makes the curve observable: 100, 200, 400, 800.
    expect(backoffDelay(1, config())).toBe(100);
    expect(backoffDelay(2, config())).toBe(200);
    expect(backoffDelay(3, config())).toBe(400);
    expect(backoffDelay(4, config())).toBe(800);
  });

  it('honours a custom backoffFactor', () => {
    expect(backoffDelay(1, config({ backoffFactor: 3 }))).toBe(100);
    expect(backoffDelay(2, config({ backoffFactor: 3 }))).toBe(300);
    expect(backoffDelay(3, config({ backoffFactor: 3 }))).toBe(900);
  });

  it('produces a constant delay when backoffFactor is 1', () => {
    expect(backoffDelay(1, config({ backoffFactor: 1 }))).toBe(100);
    expect(backoffDelay(5, config({ backoffFactor: 1 }))).toBe(100);
  });

  it('applies full jitter by default — a random point in [0, capped]', () => {
    // jitter defaults to true, so the injected RNG scales the capped delay.
    expect(backoffDelay(1, config({ jitter: true }), () => 0.5)).toBe(50);
    expect(backoffDelay(2, config({ jitter: true }), () => 0.5)).toBe(100);
    // random() = 0 → no delay.
    expect(backoffDelay(3, config({ jitter: true }), () => 0)).toBe(0);
  });

  it('returns the raw capped delay (ignoring the RNG) when jitter is disabled', () => {
    expect(backoffDelay(2, config(), () => 0)).toBe(200);
    expect(backoffDelay(2, config(), () => 0.99)).toBe(200);
  });

  it('never exceeds maxDelayMs', () => {
    expect(backoffDelay(10, config({ maxDelayMs: 1_000 }))).toBe(1_000);
    expect(backoffDelay(100, config({ backoffFactor: 10, maxDelayMs: 500 }))).toBe(500);
  });
});

describe('isRetryableStatus', () => {
  it('exposes the default transient set: 429 and gateway errors', () => {
    expect([...DEFAULT_RETRYABLE_STATUSES]).toEqual([429, 502, 503, 504]);
  });

  it('retries only the default transient statuses', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    // 500 and the rest of 5xx are not in the default set, and neither are
    // ordinary 4xx client errors.
    for (const status of [400, 401, 403, 404, 408, 422, 499, 500, 501, 505, 599]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it('honours a caller-supplied allow-list', () => {
    expect(isRetryableStatus(500, [500])).toBe(true);
    expect(isRetryableStatus(503, [500])).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds form', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter(' 30 ')).toBe(30);
  });

  it('clamps negative deltas at 0', () => {
    expect(parseRetryAfter('-5')).toBe(0);
  });

  it('parses the HTTP-date form relative to `now`', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const future = new Date(now + 5_000).toUTCString();
    expect(parseRetryAfter(future, now)).toBe(5);
    // A date already in the past clamps to 0.
    const past = new Date(now - 5_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it('returns undefined for absent or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    const started = Date.now();
    await sleep(10);
    expect(Date.now() - started).toBeGreaterThanOrEqual(8);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1_000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when the signal aborts while waiting', async () => {
    const controller = new AbortController();
    const pending = sleep(1_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
