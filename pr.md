# feat(policy, budget, transaction, react): simulation, utilization, payment & wallet-balance APIs

Completes four agent-safety issues across the SDK in one PR:

- **`@astroid/policy`** — pre-flight policy simulation (`simulate` / `simulatePolicy`)
  with strongly-typed request/response DTOs and fetch-mocked tests covering both
  approved **and** rejected evaluations.
- **`@astroid/budget`** — allocation & utilization query methods
  (`getBudget`, `listBudgets`, `getBudgetUtilization`) with exported DTOs and
  success/error tests.
- **`@astroid/transaction`** — the `buildPaymentTransaction` helper (native XLM
  and issued assets) with `PaymentTransactionOptions` and payload/validation
  tests in the canonical location.
- **`@astroid/react`** — the `useAgentWalletBalance` TanStack Query hook with
  loading/error/data states, disabled-on-`undefined`, and a dedicated test suite.

Closes #280
Closes #281
Closes #282
Closes #283

---

## Background

Autonomous agents on Stellar must be able to evaluate a proposed transfer
against active safety policies, inspect live budget headroom, assemble a
ready-to-sign payment envelope, and render balances in a React dashboard — all
without first spending network fees on a doomed transaction. These four issues
fill the remaining gaps in that developer loop, following the repository's
**thin-client** convention: resource packages forward parameters over REST and
never encode business decisions (the backend owns policy, risk and budget
authority).

All four packages already had a partial surface on `main`. This PR closes the
specific gaps against each issue's acceptance criteria and adds the missing
tests, rather than duplicating what already existed.

## Changes

### `@astroid/policy` — simulation types & rejected-path coverage (#280)

- `PolicySimulationRequest` and `PolicySimulationResult` are exported from
  `@astroid/types` (re-exported package-wide), with
  `PolicyViolationDetail`, `PolicyRiskAssessment` and `PolicyBudgetImpact`
  shapes.
- `PolicyResource.simulate` POSTs the request to `/policies/simulate`;
  `PolicyResource.simulatePolicy` is the dry-run alias, and the exported
  `simulatePolicy(policies, tx)` engine evaluates a decoded transaction locally
  against fetched active rules.
- **Added** a fetch-mocked test proving a **rejected** simulation
  (`allowed: false`) round-trips its violations, limit/actual values, and
  required approvals — the file previously only asserted the approved path.

### `@astroid/budget` — allocation & utilization queries (#281)

- **Added** `BudgetResource.getBudgetUtilization(budgetId)` (alias of the
  existing `utilization`) and `BudgetClient.getBudgetUtilization(budgetId, {
  signal })`, both against `GET /budgets/:id/utilization`.
- `getBudget` / `listBudgets` remain the fully-qualified resource aliases.
- **Added** explicit DTO re-exports from `@astroid/budget`
  (`Budget`, `BudgetUtilization`, `BudgetAllocationStatus`,
  `BudgetAllocationThresholds`, `BudgetSimulationResult`, `BudgetMetrics`, …)
  so consumers need no second import.
- **Added** unit tests for successful utilization retrieval, id encoding +
  abort-signal forwarding, and error propagation.

### `@astroid/transaction` — payment builder & validation (#282)

- `buildPaymentTransaction(options)` constructs an **unsigned** single-payment
  Stellar transaction for native `XLM` or `CODE:ISSUER` assets, validating the
  destination (`G…` + checksum), positive finite amount, asset issuer and
  network passphrase up front via structured `ValidationError`s from
  `@astroid/errors`.
- **Added** `src/__tests__/transaction.test.ts` covering payload generation
  (source, destination, asset code/issuer, 7-dp amount, memo, zero signatures)
  and every rejection path (invalid/missing destination, zero/negative amount,
  issuer-less non-native asset, unknown passphrase).

### `@astroid/react` — `useAgentWalletBalance` (#283)

- **Added** `useAgentWalletBalance(walletId, options)` in
  `packages/react/src/hooks/useAgentWalletBalance.ts`, built on `useQuery` and
  the `AstroidProvider` client context. It accepts `enabled`, `refetchInterval`
  and `staleTime`, disables itself when `walletId` is `undefined`, and exposes
  a typed `UseQueryResult<WalletBalance, Error>`.
- Exported from both `@astroid/react`'s `index.ts` and `hooks.ts`, together
  with the `agentWalletBalanceKeys` query-key factory.
- **Added** `src/__tests__/useAgentWalletBalance.test.tsx` (Testing Library +
  mock QueryClient) asserting data/loading state, disabled-on-`undefined`,
  the `enabled` flag, option acceptance, and error state.

## Files changed

- [x] `PolicySimulationRequest` / `PolicySimulationResult` exported; simulation
      method implemented; fetch-mocked tests for **approved and rejected**
      responses.
- [x] Budget `getBudget`, `listBudgets` and `getBudgetUtilization` methods;
      DTO types exported from `@astroid/types` and `@astroid/budget`; tests
      cover successful retrieval and error handling.
- [x] `buildPaymentTransaction` + `PaymentTransactionOptions` with tests for
      correct payload generation and input validation.
- [x] `useAgentWalletBalance` exported with loading/error/data handling and a
      test file; query disables when the wallet id is missing.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm lint` all pass.

## Validation

| scope | command | result |
| --- | --- | --- |
| workspace | `pnpm build` | 16/16 packages build |
| workspace | `pnpm typecheck` | 16/16 packages pass, zero errors |
| workspace | `pnpm lint` | clean |
| `@astroid/policy` | `pnpm --filter @astroid/policy test` | 82 passed (3 files) |
| `@astroid/budget` | `pnpm --filter @astroid/budget test` | 95 passed (7 files) |
| `@astroid/transaction` | `pnpm --filter @astroid/transaction test` | 155 passed (14 files) |
| `@astroid/react` | `pnpm --filter @astroid/react test` | 76 passed (9 files) |
| workspace | `pnpm test` | all packages pass |

Manual checks: simulation request bodies are asserted to serialize to the exact
JSON payloads sent to `/policies/simulate` and `/budgets/:id/utilization`; the
payment builder is asserted to produce an unsigned envelope with the expected
destination/asset/amount decoded from its XDR.
