import { describe, expect, it } from 'vitest';

import { backoffDelay, isRetryableStatus, sleep } from './backoff.js';

/** A retry config with `multiplier` explicitly set. */
function config(multiplier = 2, maxDelayMs = 8_000) {
  return { maxRetries: 3, baseDelayMs: 100, maxDelayMs, multiplier };
}

/** A legacy retry config that predates the optional `multiplier` field. */
const WITHOUT_MULTIPLIER = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 8_000 };

describe('backoffDelay', () => {
  it('grows the uncapped delay exponentially by the default multiplier (2)', () => {
    // With random() = 1 the full jitter returns the capped delay, so the
    // growth curve is observable: 100, 200, 400, 800.
    expect(backoffDelay(1, config(), () => 1)).toBe(100);
    expect(backoffDelay(2, config(), () => 1)).toBe(200);
    expect(backoffDelay(3, config(), () => 1)).toBe(400);
    expect(backoffDelay(4, config(), () => 1)).toBe(800);
  });

  it('honours a custom multiplier', () => {
    expect(backoffDelay(1, config(3), () => 1)).toBe(100);
    expect(backoffDelay(2, config(3), () => 1)).toBe(300);
    expect(backoffDelay(3, config(3), () => 1)).toBe(900);
  });

  it('falls back to a multiplier of 2 when the field is omitted (back-compat)', () => {
    expect(backoffDelay(1, WITHOUT_MULTIPLIER, () => 1)).toBe(100);
    expect(backoffDelay(2, WITHOUT_MULTIPLIER, () => 1)).toBe(200);
    expect(backoffDelay(3, WITHOUT_MULTIPLIER, () => 1)).toBe(400);
  });

  it('produces a constant delay when multiplier is 1', () => {
    expect(backoffDelay(1, config(1), () => 1)).toBe(100);
    expect(backoffDelay(5, config(1), () => 1)).toBe(100);
  });

  it('applies full jitter — the delay is a random point in [0, capped]', () => {
    // random() = 0.5 → half of the capped exponential.
    expect(backoffDelay(1, config(), () => 0.5)).toBe(50);
    expect(backoffDelay(2, config(), () => 0.5)).toBe(100);
    // random() = 0 → no delay.
    expect(backoffDelay(3, config(), () => 0)).toBe(0);
  });

  it('never exceeds maxDelayMs', () => {
    expect(backoffDelay(10, config(2, 1_000), () => 1)).toBe(1_000);
    expect(backoffDelay(100, config(10, 500), () => 1)).toBe(500);
  });
});

describe('isRetryableStatus', () => {
  it('retries 429 and every 5xx', () => {
    for (const status of [429, 500, 501, 502, 503, 504, 505, 599]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('never retries other client errors', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 425, 499]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
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
});
