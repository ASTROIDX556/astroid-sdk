# feat(client): add token bucket rate limiter and retry middleware

Hardens the `@astroid/client` token-bucket rate limiter so it throttles at the
**configured** refill rate (it previously slept the queue wait a second time),
and adds the deterministic `vi.useFakeTimers()` test suite the issue calls for
to verify token refill, queue draining, `Retry-After` cooldowns and 429 retry
backoff without slowing the test suite.

Closes #230

---

## Background

`@astroid/client` already shipped a token-bucket rate-limiter middleware
(`packages/client/src/middleware/rate-limiter.ts`) and the shared `HttpClient`
retry loop with `Retry-After` support. While validating the limiter against
issue #230's acceptance criteria, two gaps surfaced:

1. **Double throttling.** `TokenBucketLimiter.acquire()` already *waits* until a
   token refills before resolving, but `createRateLimiterMiddleware.onRequest`
   then slept the returned wait duration again. A request that should dispatch
   the instant a token refills was delayed by an extra full wait interval — so
   the limiter effectively ran at **half** the configured rate.
2. **Real timers in tests.** The existing rate-limiter suite asserted loose
   wall-clock bounds with real `setTimeout`, taking seconds and making refill /
   backoff behaviour hard to pin down. Issue #230 explicitly asks for
   `vi.useFakeTimers()`.

This PR fixes the throttle and adds the fast, deterministic tests.

---

## Changes

### `packages/client/src/middleware/rate-limiter.ts`

- `onRequest` now just `await limiter.acquire(req.signal)` — the wait already
  happens inside the bucket, so the redundant `sleep(delayMs)` is removed. The
  limiter now dispatches queued requests exactly when tokens refill.
- Removed the now-unused `sleep` helper.
- Updated the `acquire` and `createRateLimiterMiddleware` TSDoc to state that
  the wait is handled inside the bucket and callers must not sleep the returned
  value again.

No behaviour change to capacity, refill rate, queue limits, `Retry-After`
handling or `@astroid/errors` typing — all of which were already correct.

### `packages/client/src/__tests__/rate-limiter-fake-timers.test.ts` (new, 7 tests)

Deterministic tests using `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`:

- A burst up to `burstCapacity` passes through with **zero** elapsed virtual
  time.
- With `maxRequestsPerSecond: 2`, queued requests are released exactly at the
  500ms refill boundaries, in FIFO order.
- A request is rejected with `RateLimitError` when `maxQueueLength` is exceeded.
- A request is rejected with `RateLimitError` (`RATE_LIMIT_QUEUE_TIMEOUT`) once
  `queueTimeoutMs` elapses.
- A queued request rejects with an `AbortError` when its signal aborts.
- A `429` with `Retry-After: 1` pauses refills for the full cooldown window.
- At the client level, a `429` carrying `Retry-After: 0.2` is **not** retried
  before 200ms of virtual time elapse, then succeeds.

---

## Acceptance criteria

- [x] Token-bucket rate limiter in `@astroid/client` that respects the
      configured capacity and refill rate (and now dispatches at that rate).
- [x] `429` responses drive automatic retries and `Retry-After` is honoured up
      to the configured `maxRetries`.
- [x] Exponential backoff with jitter applied to transient failures (shared
      `HttpClient` retry loop).
- [x] Errors typed/mapped via `@astroid/errors` (`RateLimitError`).
- [x] Vitest unit tests cover rate-limiter behaviour and retry logic, using
      mock timers to verify refill and backoff delays.
- [x] Burst scenarios exceeding the threshold queue and dispatch on delay.

---

## Validation

| check | command | result |
| --- | --- | --- |
| client tests | `pnpm --filter @astroid/client test` | 225 passed (16 files) |
| workspace tests | `pnpm test` | all packages pass |
| workspace typecheck | `pnpm typecheck` | 16/16 packages pass |
| workspace build | `pnpm build` | pass |
| workspace lint | `pnpm lint` | pass (no warnings) |

The real-timer `rate-limiter.test.ts` suite also got faster (≈3.3s → ≈2.2s) as
a side effect of removing the extra sleep.
