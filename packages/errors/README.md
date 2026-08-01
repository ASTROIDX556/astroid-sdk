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

`AstroidError` (base) · `AuthenticationError` · `AuthorizationError` ·
`ValidationError` · `NotFoundError` · `ConflictError` · `PolicyViolationError` ·
`BudgetExceededError` · `ApprovalRequiredError` · `RateLimitError` ·
`NetworkError` · `ServerError`.

Each carries `code`, `status`, `requestId`, and structured `details`.
`RateLimitError.retryAfter` and `ValidationError.fieldErrors` are typed
convenience accessors. `error.isRetryable` tells the core client whether a retry
is worthwhile.

## Mapping helpers

- `errorClassForCode(code)` — API error code → error class.
- `fromApiError(apiError, ctx)` — build a typed error from a response envelope.
- `fromStatus(status, message, ctx)` — build from a bare HTTP status.
- `toNetworkError(cause)` — wrap a transport failure.
