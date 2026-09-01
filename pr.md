# feat: budget resources, transaction validation, and agent DTOs

Implements four tracked issues across `@astroid/types`, `@astroid/transaction`,
and `@astroid/budget`.

Closes #55
Closes #51
Closes #60
Closes #50

---

## #55 — Core types and DTO definitions for agent resource management

- **New `packages/types/src/agent.ts`**
  - `AgentEntity` (alias of the `Agent` model), `AgentMetadata`, `AgentInitialBudget`
  - `CreateAgentDto` / `UpdateAgentDto`, with `CreateAgentParams` / `UpdateAgentParams`
    aliases so `@astroid/agent` and `@astroid/react` compile against one name set
  - `ListAgentsParams`; `AgentStatus` / `AgentRole` re-exported from `./enums.ts`
  - Runtime helpers: `isAgentStatus`, `isAgentRole`, `isAgentEntity`,
    `parseAgentEntity`, `normalizeCreateAgentDto`, `AGENT_STATUS_VALUES`,
    `AGENT_ROLE_VALUES`
  - Full TSDoc on every export; strict types, no `any`
- **New `packages/types/src/agent.test.ts`** — type-level and runtime
  serialization/guard tests
- **Fixes that unblocked the package build/typecheck**
  - `policy.ts` re-declared `Policy` and `PolicyType` (already defined in
    `entities.ts` / `enums.ts`), which made `export *` ambiguous and failed the
    DTS build — removed the duplicates, kept the simulation types
  - `common.ts` was missing exports that the workspace already imports:
    `ApiErrorCode`, `ApiSuccessResponse` / `ApiErrorResponse` / `ApiResponse`,
    and the `PaginationMeta` / `Paginated` / `CursorPaginationParams` /
    `CursorPaginated` shapes
- **New `packages/types/src/budget.ts`** — allocation + alert types shared with
  `@astroid/budget` (see #60 / #50)

## #51 — Automatic transaction payload validation helpers

- **New `packages/transaction/src/validator.ts`** — pure functions, no network,
  no signing, input never mutated
  - `validateTransactionEnvelope(input, options?)` accepts a base64 XDR envelope
    (including fee-bump envelopes) **or** a `TransactionJson` object and returns a
    structured `TransactionValidationReport` (`valid`, `issues`, `errors`,
    `warnings`, `normalized`)
  - Checks against Astroid protocol requirements: missing / malformed source
    account, fee below the network minimum, **excessive fee bids**
    (`MAX_TOTAL_FEE_STROOPS`), operation count bounds, memo type/value
    (`MEMO_TEXT` ≤ 28 bytes, uint64 `MEMO_ID`, 32-byte `MEMO_HASH` / `MEMO_RETURN`),
    and time-bounds (inverted window, expired window → warning)
  - `assertValidTransactionEnvelope()` throws `TransactionEnvelopeValidationError`
    with the full report attached on `.report`
  - `sanitizeTransactionJson()` returns a cleaned copy (trimmed source, integer
    stroop fee, normalized/ truncated memo, zeroed time bounds removed)
  - Exported from `packages/transaction/src/index.ts`
- **New `packages/transaction/src/__tests__/validator.test.ts`** — 20 tests
  covering valid and invalid XDR and JSON payloads
- **Incidental fixes** to pre-existing `tsc` errors that blocked the package
  typecheck: `errors.ts` (optional-options / `details` typing), `simulation.ts`
  (unused import, `FeeBumpTransaction` union), `submit.ts` (unused parameter)

## #60 — Budget resource methods and allocation tracking

- **New `packages/budget/src/budget.ts`**
  - `BudgetClient` over a minimal injected `BudgetHttpClient` transport
    (satisfied by `@astroid/client`; keeps the dependency graph acyclic and makes
    every method unit-testable with a mock)
  - `create`, `get`, `list`, `update`, `delete`, `consume`, `metrics`
  - `history(budgetId, params?)` — cursor **or** offset pagination plus
    `from` / `to` / `transactionId` / `minAmount` / `maxAmount` filters
  - `allocationStatus(budgetId, options?)` — fetches the budget and derives a
    `BudgetAllocationStatus`; `prospectiveSpend` reports `wouldExceed`
  - Pure helpers: `deriveAllocationStatus`, `classifyAllocation`,
    `isAllocationExhausted`, `toBudgetQuery`
- **New `packages/budget/src/__tests__/budget.test.ts`** — 16 tests, mocked HTTP

## #50 — Budget threshold alert subscription hooks

- **New `packages/budget/src/alerts.ts`**
  - `createBudgetAlert`, `listBudgetAlerts`, `getBudgetAlert`,
    `updateBudgetAlert`, `deleteBudgetAlert` (each takes the `BudgetHttpClient`
    transport)
  - `BudgetAlertValidationError`, `isValidBudgetAlertChannel`,
    `assertValidThresholdPercent`, `BUDGET_ALERT_THRESHOLDS` (`[50, 80, 100]`)
  - Alert config types (`BudgetAlert`, `BudgetAlertChannel`,
    `CreateBudgetAlertInput`, `UpdateBudgetAlertInput`, `ListBudgetAlertsParams`)
    live in `@astroid/types` and are re-exported here
- **New `packages/budget/src/__tests__/alerts.test.ts`** — 13 tests, mocked HTTP
- `packages/budget/src/index.ts` now re-exports `budget.ts` / `alerts.ts` and
  resolves a pre-existing duplicate `SpendRequest` export

---

## Validation

| package | `typecheck` | `build` | `test` |
| --- | --- | --- | --- |
| `@astroid/types` | pass | pass | 12 / 12 |
| `@astroid/transaction` | pass | pass | 65 pass, 4 pre-existing failures |
| `@astroid/budget` | pass | pass | 81 / 81 |

The 4 `@astroid/transaction` failures pre-date this branch (`fee-estimation`
assertions, `error-normalization`, and `submit.test.ts` which resolves
`@astroid/core`). Verified against a clean tree; this branch net-fixes one
previously failing `simulation` test.

## Out of scope / known issue

`pnpm build` and `pnpm typecheck` at the repo root still fail because
`@astroid/core` is a partially-merged rewrite: `index.ts` / `resource.ts` /
`middleware.ts` / `pagination.ts` / `offline-queue.ts` expect a transport layer
(`QueryValue`, `AstroidResponse`, `RequestOptions`, `PreparedRequest`,
`RawResponse`, `ErrorPayload`, `Middleware`, `MiddlewareStack`, `SDK_VERSION`,
`buildUrl`) that `http-types.ts` / `http-client.ts` / `url.ts` do not provide.
This blocks `client`, `agent`, `wallet`, `policy`, `analytics`, `auth`,
`webhook`, `notification`, `react`, and `cli`, and needs a dedicated fix.
