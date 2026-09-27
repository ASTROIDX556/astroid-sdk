# feat(client): configurable request retry with exponential backoff

Adds an optional, configurable request-retry mechanism to `@astroid/client`
for autonomous agents that hit transient network hiccups and rate limits.
The client now accepts flat retry options (`retries`, `minTimeout`,
`maxTimeout`, `retryableStatuses`, `jitter`), retries network failures plus
`429`/`502`/`503`/`504`, and cancels pending retries immediately when the
caller aborts via `AbortController`.

Closes #272

---

## Background

`@astroid/client` routes every call through the shared `HttpClient` in
`@astroid/core`, which already had a retry loop and a fixed retryable-status
set. Issue #272 asks for a **first-class, documented configuration surface**
and correct cancellation semantics. Three gaps existed:

1. Only `retries` / `retryDelay` were accepted — there was no `minTimeout`,
   `maxTimeout`, or `retryableStatuses`.
2. The retryable set was hard-coded (`408, 425, 429, 500, 502, 503, 504`) and
   could not be configured; the issue specifies `429 / 502 / 503 / 504`.
3. `isAbortError` used `value instanceof Error`, but `fetch`/`sleep` reject with
   a `DOMException` that is **not** an `Error` in every runtime — so an abort
   during the retry backoff was misclassified as a retryable network error and
   retried instead of stopping.

The idempotency behaviour (GET/PUT/DELETE safely retried; POST/PATCH only when
marked `retryable` or carrying an `Idempotency-Key`) already existed and is
preserved.

---

## Changes

### `packages/core/src/config.ts` — `RetryConfig`

- Added `retryableStatuses?: number[]` — per-client status allow-list.
- Added `jitter?: boolean` — full jitter on/off (default `true`).

### `packages/core/src/backoff.ts`

- `DEFAULT_RETRYABLE_STATUSES = [429, 502, 503, 504]`, exported.
- `isRetryableStatus(status, statuses = DEFAULT_RETRYABLE_STATUSES)` — the
  default set is now exactly the issue's list and callers can pass their own.
- `backoffDelay` applies full jitter by default and returns the deterministic
  capped exponential delay when `config.jitter === false`.

### `packages/core/src/http-client.ts`

- The retry loop selects its predicate with precedence: per-middleware
  `shouldRetryStatus` → client `retryableStatuses` → SDK default.
- `isAbortError` now matches any object whose `name === 'AbortError'`
  (covering `DOMException`), so an abort stops the retry loop **immediately**.

### `packages/core/src/middleware.ts`

- `createRetryMiddleware` forwards `retryableStatuses` and `jitter` into the
  request-scoped retry config.

### `packages/client/src/index.ts`

- `AstroidClientConfig` gains `minTimeout`, `maxTimeout`, `retryableStatuses`,
  and `jitter`; `retryDelay` remains as a deprecated alias of `minTimeout`.
- `normalizeConfig` merges the flat shorthand into the `retry` block, with
  shorthand winning over an explicit `retry` object and `retry: false` always
  disabling retries.
- Re-exports `DEFAULT_RETRYABLE_STATUSES`.

### `packages/client/src/middleware/retry.ts`

- Forwards `retryableStatuses` / `jitter` and derives `shouldRetryStatus` from a
  custom allow-list when supplied.

---

## Tests

`packages/client/src/__tests__/request-retry.test.ts` (new, 16 tests, mocked
`fetch`):

- **Config mapping** — `retries`/`minTimeout`/`maxTimeout`/`retryableStatuses`/
  `jitter` land in `client.http.config.retry`; legacy `retryDelay` still works;
  shorthand merges over an explicit `retry` object; `retry: false` wins.
- **Retry behaviour** — success after a transient `503`; every default status
  (`429`, `502`, `503`, `504`) retried; exhaustion throws the final
  `ServerError` after `maxRetries + 1` attempts; custom `retryableStatuses`
  allow-list respected; network-level failures retried; `400` not retried.
- **Idempotency** — GET retried by default; POST not retried unless marked
  `retryable` or carrying an `Idempotency-Key`.
- **Backoff** — with `jitter: false`, delays grow exponentially (≈40ms then
  ≈80ms for `minTimeout: 40`).
- **Cancellation** — aborting during the backoff rejects with an `AbortError`
  and performs no further fetch attempts.

`packages/client/src/retry.test.ts` — updated `isRetryableStatus` expectations
for the new default set and the custom-status override.

---

## Acceptance criteria

- [x] Client configuration type accepts retry options (`retries`,
      `minTimeout`, `maxTimeout`, `retryableStatuses`, and `jitter`).
- [x] Retry loop with exponential backoff and optional jitter in the transport
      layer.
- [x] Retries network errors and `429`/`502`/`503`/`504` by default.
- [x] Idempotent GET (and PUT/DELETE) retried safely; mutations only when
      configured or safe (idempotency key).
- [x] Unit tests mock network failures and rate-limit responses and assert retry
      counts and backoff delays, plus retry exhaustion.
- [x] `AbortSignal` aborts pending retries immediately.

---

## Validation

| package | command | result |
| --- | --- | --- |
| `@astroid/client` | `pnpm test` | 234 passed (16 files) |
| `@astroid/client` | `pnpm typecheck` | pass |
| workspace | `pnpm test` | all packages pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |
| workspace | `pnpm build` | pass |
