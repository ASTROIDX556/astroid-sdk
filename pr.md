# feat: analytics metrics helpers, client retry module, budget hooks & typed core errors

A four-part developer-experience batch for the Astroid TypeScript SDK. Each
issue is implemented on top of the existing resource/transport architecture, so
there is **no new parallel infrastructure** — the additions slot into the
conventions already used across the monorepo and reuse the shared
`@astroid/types` DTOs.

Closes #78
Closes #79
Closes #82
Closes #83

---

## Issue #78 — analytics metrics aggregation helpers (`@astroid/analytics`)

**New module:** `packages/analytics/src/analytics.ts`

Implements typed query methods and time-range filtering helpers for aggregated
financial metrics.

- **Query methods**
  - `getTransactionVolume(client, filter)` → `VolumeSummary` (total volume for the window).
  - `getFeeExpenditure(client, filter)` → `VolumeSummary` (aggregated fee spend).
  - `getAgentExecutionCounts(client, filter)` → `AgentAnalytics` (per-agent execution counts).
  - `AnalyticsQueryResource` class wraps all three for dependency-injection users.
- **Time-range helpers**
  - `toIso8601(value)` normalises `Date | string` to ISO-8601 UTC and drops invalid values.
  - `resolveTimeRange(filter)` maps `startDate`/`endDate` **or** the `from`/`to` aliases and
    `granularity` → `timeframe`.
  - `buildAnalyticsQuery(filter, metric?)` and `buildAnalyticsPath(...)` serialise a
    `URLSearchParams` with consistent ISO-8601 date encoding.
- **Filter types:** `TimeRangeFilter`, `AnalyticsGranularity`, `AnalyticsMetricType`,
  `TransactionVolumeFilter`, `FeeExpenditureFilter`, `AgentExecutionCountFilter`.
- The existing `AnalyticsResource` gains `transactionVolume`, `feeExpenditure`, and
  `agentExecutionCounts` methods that delegate to the standalone helpers.
- `packages/analytics/src/index.ts` now also re-exports the local aggregation helpers
  (`aggregateTransactionMetrics`) and the time-series query helpers, so consumers can
  import everything from the package root.

**Tests:** `packages/analytics/src/analytics.test.ts` (15 tests) mock the analytics API
responses and cover ISO-8601 serialisation, alias resolution, metric selection,
scope filters, and the resource wrapper.

## Issue #79 — client retry with exponential backoff & jitter (`@astroid/client`)

**New module:** `packages/client/src/retry.ts`

A single, modular entry point for the retry policy: `backoffDelay` (full-jitter
exponential backoff), `isRetryableStatus` (`429` + any `5xx`, never other `4xx`),
`computeRetryDelay` (honours `Retry-After` on `429`), and the
`createRetryMiddleware` factory. The transport-level retry loop stays in
`@astroid/core`; this module makes the policy independently unit-testable and
reusable outside the transport.

- `ClientOptions` type alias added for `AstroidClientConfig`, which already accepts
  `retry: { maxRetries, baseDelayMs, maxDelayMs }`, the `retries` / `retryDelay`
  shorthands, and `retry: false` to disable retries.
- Non-idempotent `POST`/`PATCH` requests remain non-retryable unless
  `retryAllMethods: true` or the request is explicitly marked `retryable`.
- `computeRetryDelay` and `RetryMiddlewareConfig` are now re-exported from the package root.

**Tests:** `packages/client/src/__tests__/retry-module.test.ts` pins the modular surface,
plus the existing `src/__tests__/retry.test.ts` suite covers `503`/`504`/`502 → success`,
`Retry-After`, retry exhaustion, and immediate non-retryal of `400`/`401`/`403`/`404`.

## Issue #82 — TanStack Query budget hooks (`@astroid/react`)

**New module:** `packages/react/src/hooks/use-budgets.ts`

- `useBudgets(params?)` — paginated budget list, cached under `queryKeys.budgets.list`.
- `useBudget(id)` — single budget, disabled until an id is supplied.
- `useBudgetUtilization(id)` — the budget's utilization snapshot.
- `useCreateBudget()` — creates a budget and invalidates every cached budget list.
- `useUpdateBudget()` — patches a budget and invalidates its detail, utilization, and
  all list queries.

All hooks carry TSDoc with usage examples, use the existing `queryKeys.budgets` key
factory, and are re-exported from `packages/react/src/index.ts`.

**Tests:** `packages/react/src/__tests__/use-budgets.test.tsx` renders the hooks inside a
`QueryClientProvider` + `AstroidProvider` and asserts client calls plus cache
invalidation on successful mutations.

## Issue #83 — typed error hierarchy & normalisation (`@astroid/core`)

**New module:** `packages/core/src/errors.ts`

Re-exports the shared `@astroid/errors` hierarchy from the core entry point and adds
the parsing utilities the issue asks for:

- `AstroidError` base plus `AstroidApiError`, `AuthenticationError`, `ValidationError`,
  `RateLimitError`, `ServerError`, and the rest of the domain classes, now exportable
  directly from `@astroid/core`.
- `parseErrorResponse(response)` safely reads a non-2xx `Response` **once**, tolerates
  malformed/non-JSON bodies, and returns the correct typed error with `statusCode`,
  `errorCode`, and parsed `details` (never throws).
- `toAstroidError(value)` normalises any caught value into a structured `AstroidError`.
- The base class gained `statusCode` / `errorCode` accessors (additive aliases for the
  existing `status` / `code`) in `@astroid/errors`.
- `isRetryable` is preserved on the transient classes (`RateLimitError`, `NetworkError`,
  `ServerError`).

**Tests:** `packages/core/src/errors.test.ts` (11 tests) covers status → class mapping
for `400`, `401`, `403`, `404`, `422`, `429`, `500`, `503`, request-id capture, malformed
bodies, serialisation, and unknown-value normalisation.

---

## Validation

Run from the repository root after `pnpm install`:

| Command | Result |
| --- | --- |
| `pnpm build` | pass (16 packages) |
| `pnpm typecheck` | pass (16/16 packages) |
| `pnpm test` | pass — **all suites green** |
| `pnpm lint` | pass |

Package-level counts for the touched suites:

| Package | Test files | Tests |
| --- | --- | --- |
| `@astroid/analytics` | 7 | 96 |
| `@astroid/client` | 16 | 225 |
| `@astroid/core` | 2 | 28 |
| `@astroid/react` | 9 | 78 |

All new code is written to the repository's strict TypeScript standard with **zero
`any`** and passes the ESLint configuration.
