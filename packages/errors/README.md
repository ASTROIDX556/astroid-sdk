# @astroid/errors

Typed error classes for the Astroid SDK. Every failure is an `AstroidError` (or
a subclass) — never a generic exception.

```ts
import { PolicyViolationError, BudgetExceededError, isAstroidError } from '@astroid/errors';

try {
  await astroid.transactions.create(input);
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.error('Blocked by policy:', err.details);
  } else if (err instanceof BudgetExceededError) {
    console.error('Out of budget:', err.message);
  } else if (isAstroidError(err)) {
    console.error(err.code, err.requestId);
  }
}
```

## Classes

**Base** · `AstroidError`

**HTTP/API** · `AuthenticationError` · `ForbiddenError` (alias
`AuthorizationError`) · `ValidationError` · `NotFoundError` · `ConflictError` ·
`RateLimitError` (alias `ApiRateLimitError`) · `InternalServerError` (alias
`ServerError`) · `NetworkError` · `AstroidTimeoutError`

**Domain** · `PolicyViolationError` · `BudgetExceededError` ·
`InsufficientFundsError` · `ApprovalRequiredError`

**Stellar** · `InsufficientBalanceError` · `TrustlineMissingError` ·
`StellarAuthError` · `SequenceConflictError` · `TransactionExpiredError` ·
`StellarMalformedError` · `StellarNetworkError`

Each carries `code`, `status`, `requestId`, and structured `details`.
`RateLimitError.retryAfter` and `ValidationError.fieldErrors` are typed
convenience accessors. `error.isRetryable` tells the core client whether a retry
is worthwhile. `AstroidTimeoutError extends NetworkError`, and
`ApiRateLimitError extends RateLimitError`, so the broader guard matches the
narrower class.

## Mapping helpers

From an HTTP response:

- `toAstroidError(response, body?)` — canonical: a non-2xx `Response` → typed
  error. Never throws, never returns a plain `Error`.
- `fromErrorResponse(response)` — `toAstroidError` that throws for you.
- `mapStatusToError(status, message?, ctx?)` — status + optional body.
- `errorClassForStatus(status)` / `statusCodeToCode(status)` — the two halves of
  status-only mapping, exported separately for reuse.
- `extractApiError(body)` — pull `{ code, message, details }` out of a response
  body. Understands the `{ error: { … } }` envelope and a flat `{ code, message }`.

From an API error object:

- `errorClassForCode(code)` — API error code → error class.
- `fromApiError(apiError, ctx)` — build a typed error from a response envelope.
- `fromStatus(status, message, ctx)` — build from a bare HTTP status.
- `codeForStatus(status)` — infer a code when the API supplied none.
- `toNetworkError(cause)` — wrap a transport failure.

## Stellar mapping

`mapStellarError(body, ctx?)` maps a Horizon/submit-transaction result code to
the hierarchy. `errorClassForStellarCode(code)`, `stellarCodeToApiError(code)`
and `extractStellarResultCodes(body)` are the lower-level pieces, with
`isStellarError(value)` as the matching guard.

## Guards

`isAstroidError` plus one per category: `isAuthenticationError`,
`isForbiddenError`, `isValidationError`, `isNotFoundError`, `isConflictError`,
`isPolicyViolationError`, `isInsufficientFundsError`, `isRateLimitError`,
`isApiRateLimitError`, `isNetworkError`, `isTimeoutError`, `isServerError`.
Each narrows `unknown` to its class, so they compose directly in `catch` blocks.

## Stack safety

`toJSON()` serializes to the API `ApiError` shape. Call
`setIncludeStackInErrors(false)` at the production entrypoint so internal paths
never reach logs or wire responses.
