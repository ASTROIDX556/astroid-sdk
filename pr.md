# feat(client): configurable retry with exponential backoff & jitter

Makes `@astroid/client` resilient to transient network failures and rate limits
by aligning the SDK's already-built retry pipeline with the exact policy
required by the issue: retry on `429` and **all** `5xx`, never on any other
`4xx`, with a default of **3** retries and exponential full-jitter backoff.

Closes #262

---

## Background

`@astroid/client` sends every request through the shared `HttpClient` in
`@astroid/core`, which already owns the retry loop (`HttpClient.request`):
it classifies each response, computes a backoff delay, sleeps, and re-attempts
up to the configured limit. Policy is supplied by `backoffDelay`,
`isRetryableStatus`, `RetryConfig`, and the opt-in `createRetryMiddleware`.

This PR does **not** add a second, parallel retry stack. It corrects the two
places where that pipeline diverged from the issue's requirements and hardens
the client-level tests around them.

### Gap 1 — default retry count was 2, issue requires 3

`DEFAULT_RETRY.maxRetries` (`packages/core/src/config.ts`) and
`DEFAULT_MAX_RETRIES` (`packages/client/src/middleware/retry.ts`) were both `2`.
Because retries are **enabled by default**, a fresh
`new Astroid({ apiKey })` made only two retry attempts.

### Gap 2 — non-`429` 4xx statuses were retried

`isRetryableStatus` used a fixed allow-list
`{408, 425, 429, 500, 502, 503, 504}`. `408 Request Timeout` and `425 Too Early`
are 4xx client errors, and the issue is explicit: *retry on 5xx and 429, but
never retry on 4xx client errors (except 429)*. The allow-list also meant
legitimate 5xx statuses such as `501` and `505` were never retried.

---

## Changes

### `packages/core/src/backoff.ts` — retry predicate

Replaces the allow-list with an explicit, documented rule:

```ts
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}
```

- `429 Too Many Requests` → retried (rate-limit window reopens).
- **Every** `5xx` → retried (server-side failure, including `501`, `505`, …).
- Every other `4xx` → never retried (client error: bad request, auth,
  validation, not-found, `408`, `425`, …).
- Full-jitter exponential backoff in `backoffDelay` is unchanged:
  `floor(random() * min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs))`.

### `packages/core/src/config.ts` — default retries

- `DEFAULT_RETRY.maxRetries`: `2` → **`3`**; `RetryConfig` doc updated.
- `baseDelayMs` remains `250` (configurable), `maxDelayMs` remains `8000`.

### `packages/core/src/middleware.ts` — middleware default

- `createRetryMiddleware()` default `maxRetries`: `2` → **`3`**.

### `packages/client/src/middleware/retry.ts` — client middleware

- `DEFAULT_MAX_RETRIES`: `2` → **`3`**.
- `@default` JSDoc and the retryable-status documentation updated to describe
  `429` + any `5xx` rather than the old hard-coded list.

### `packages/client/src/middleware/error.ts` — doc accuracy

- The error-translator comment no longer lists `408` among the statuses the
  retry loop owns (`429`, `5xx`).

---

## Tests

All added/extended in the client package (`vitest` + mocked `fetch`).

`packages/client/src/__tests__/retry.test.ts`
- Default retry config is now asserted as `{ maxRetries: 3, baseDelayMs: 250,
  maxDelayMs: 8000 }`.
- New: `408` and `425` are **not** retried (exactly one `fetch` call).
- New: `new Astroid({ apiKey })` resolves to `retry.maxRetries === 3` with a
  `250ms` base delay when no retry config is supplied.
- Existing coverage retained: `502 → 200` recovery, `503`/`504` retries,
  `maxRetries` exhaustion throwing `ServerError`, `429` retry + `Retry-After`
  honouring, `400`/`404`/`422` non-retryal, network-error retry,
  `retry: false` disabling retries, and `onRetry` instrumentation.

`packages/client/src/retry.test.ts`
- Extends the predicate test to cover `501`/`505` (retryable) and
  `408`/`422`/`425` (non-retryable).

---

## Acceptance criteria

- [x] Client automatically retries failed requests matching retryable statuses
      (`429` and all `5xx`), enabled by default.
- [x] Exponential backoff increases between attempts with full jitter applied.
- [x] Non-retryable errors (`400`, `401`, `403`, `404`, `408`, `422`, `425`)
      throw immediately without retrying.
- [x] Configurable `maxRetries` (default **3**) and base backoff delay.
- [x] Comprehensive unit tests in the client package using `vitest` and mocked
      `fetch`, including a `502 Bad Gateway` followed by a `200 OK`.

---

## Validation

| package | command | result |
| --- | --- | --- |
| `@astroid/client` | `pnpm test` | 221 passed (15 files) |
| `@astroid/client` | `pnpm typecheck` | pass |
| workspace | `pnpm test` | all packages pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |

The retry mechanism itself was originally introduced in #186/#196/#171; this PR
brings its defaults and status policy in line with #262 and adds the tests that
pin that behaviour.
