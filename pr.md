# feat(policy, agent, react, transaction): local policy pre-flight engine and rule/approval helpers

Closes #17
Closes #104
Closes #105
Closes #106

This PR delivers the four assigned issues as one coherent change set. It adds
the new local authorization pre-flight engine in `@astroid/policy` (issue #17)
and completes/extends the three companion acceptance criteria across
`@astroid/agent` (#104), `@astroid/react` (#105) and `@astroid/transaction`
(#106). Every package's test suite, `pnpm typecheck`, `pnpm lint` and
`pnpm build` pass.

---

## Issue #17 — local policy validation engine (policy)

### Background

Before an agent's action is dispatched for online authorization, it should be
validated against local policy rules offline — no network, no blockchain, no
side effects. The package had a client-side simulation engine
(`simulatePolicy`), but no evaluator exposing the issue's
`evaluatePolicy(policySet, tx)` contract, no destination-list handling that
tolerated case/federation variations, no time-of-day (allowed-hours) rule, and
no signature-weight threshold check.

### Changes

- **`packages/policy/src/evaluation.ts`** (new) — the offline engine:
  - `evaluatePolicy(policySet: PolicySet, tx: TransactionDetails, options?)`
    returns a `PolicyEvaluationResult`. It is pure and total: malformed or
    missing input is treated as an empty set that passes, and a breach resolves
    to `allowed: false` instead of throwing.
  - **Address restrictions** — destination allowlists and denylists are matched
    through `normalizeAddress`, which upper-cases Stellar strkeys, lower-cases
    both halves of federated addresses (`name*domain`, per SEP-0002), and trims
    whitespace. An allowlist with no recipient supplied fails; a denylist with
    no recipient passes.
  - **Timing restrictions** — `isActionWithinAllowedHours` supports inclusive
    start / exclusive end hours, wrap-around windows (`22` → `6`), a full-day
    window (`start === end`), IANA timezones (defaulting to UTC, with an invalid
    zone degrading to UTC instead of throwing) and optional weekday
    restrictions. The clock comes from `tx.timestamp`, falling back to
    `options.now` then the current time.
  - **Signature thresholds** — `resolveSignedWeight` sums `tx.signatures`
    weights (default `1`, matching Stellar low-threshold signers), honours an
    explicit `tx.signedWeight`, and grants no weight for malformed values so a
    bad weight cannot silently satisfy a threshold.
  - **Detailed reporting** — one `PolicyRuleEvaluation` per evaluated check with
    `{ rule, check, success, explanation? }`, plus `evaluatedRules`,
    `failedRules` and de-duplicated `failedRuleNames`.
  - `policySetFromPolicies(policies)` adapts server `Policy` records into a
    `PolicySet` (enabled policies only), so the existing
    `listPolicies()` workflow feeds straight into the engine.
- **`packages/policy/src/index.ts`** — exports `evaluatePolicy`,
  `policySetFromPolicies`, `normalizeAddress`, `addressesMatch`,
  `isActionWithinAllowedHours`, `resolveSignedWeight`, the
  `EvaluatePolicyOptions` type and the evaluation types.
- **`packages/types/src/policy.ts`** — adds the strict schemas
  `PolicyAllowedHours`, `TransactionSignature`, `TransactionDetails`,
  `PolicyRule`, `PolicySet`, `PolicyRuleCheck`, `PolicyRuleEvaluation` and
  `PolicyEvaluationResult`, all re-exported from `@astroid/types`.
- **`packages/types/src/entities.ts`** — `PolicyConfiguration` gains typed
  `allowedHours` and `requiredSignatures` fields.
- **`packages/types/src/schemas.ts`** — zod mirrors of every new type plus
  `validatePolicySet` / `validateTransactionDetails` helpers, and the two new
  `PolicyConfiguration` fields.

### Acceptance criteria

- [x] `evaluatePolicy(policySet: PolicySet, tx: TransactionDetails):
PolicyEvaluationResult` exposed from `@astroid/policy`.
- [x] Address restrictions validated (allowlist membership and denylist
      avoidance) with case- and federation-safe comparison.
- [x] Timing restrictions validated against configured allowed hours.
- [x] Required signing thresholds validated against the payload's collected
      signature weight.
- [x] Detailed execution reporting per rule name, success state and failure
      explanation.

### Tests

New `packages/policy/__tests__/evaluation.test.ts` (45 tests): allow/deny list
membership including case and federated variants and a missing recipient; time
windows including boundaries, wrap-around, timezones, weekdays and
`options.now`; signature thresholds at, above and below the limit; the
per-check reporting contract, disabled rules, determinism, malformed-input
totals, and the `Policy` → `PolicySet` adapter. New schema tests in
`packages/types/src/schemas.test.ts` (8 tests).

---

## Issue #104 — typed input validation for agent creation (agent)

### Background

`validateCreateAgentParams` already checked `name`, `capabilities` and
`initialBudget`, but not the Stellar public keys the issue calls out.

### Changes

- **`packages/agent/src/validation.ts`** — adds `isValidStellarPublicKey`
  (`G` + 55 base-32 characters, the same check as the policy builder) and
  validates optional addresses carried by the payload: the top-level
  `stellarAddress` and `metadata.stellarAddress`. It also validates that
  `metadata`, when present, is a plain object and that `primaryWalletId`, when
  present, is a non-empty string — each failure throwing a descriptive
  `AstroidValidationError` naming the offending field.
- **`packages/agent/src/index.ts`** — exports `isValidStellarPublicKey`.
- **`packages/types/src/agent.ts`** — documents the conventional
  `metadata.stellarAddress` key on `AgentMetadata`.

### Acceptance criteria

- [x] Validation for the agent creation input extended in `@astroid/agent`.
- [x] Descriptive validation errors for missing required fields and invalid
      Stellar public keys.
- [x] Full test coverage for valid and invalid agent payloads.

### Tests

`packages/agent/src/__tests__/validation.test.ts` (+8 tests): valid key shapes
and every malformed variant, valid top-level and metadata addresses, invalid
addresses by field, non-object metadata, and optional `primaryWalletId`.

---

## Issue #105 — `useBudgetUtilization` polling hook (react)

### Background

The hook and its options (`enabled`, `refetchInterval`, `staleTime`) already
existed in `packages/react/src/hooks/use-budget.ts` and was exported from
`@astroid/react`, but loading-state behaviour was not explicitly asserted.

### Changes

No production change was required — the acceptance criteria were already met.
This PR adds the missing **loading → success** test so the hook's state
contract is pinned.

### Acceptance criteria

- [x] `useBudgetUtilization` exported from `@astroid/react`.
- [x] Configurable refetch interval and budget-id parameter.
- [x] Fully typed return values (loading, error, data).
- [x] Unit tests verify loading and success states.

### Tests

`packages/react/src/__tests__/use-budget.test.tsx` (+1 test): the hook reports
`isLoading: true` with no data until the deferred request resolves, then
exposes the utilization snapshot with `isLoading: false`.

---

## Issue #106 — transaction fee estimation helper (transaction)

### Background

`estimateFee` in `packages/transaction/src/fee-estimation.ts` already decoded
XDR envelopes, handled multi-operation transactions, sampled mocked Horizon
`fee_stats` with a configurable buffer, and degraded gracefully offline. The
exported `formatFeeAsXlm` / `parseFeeInStroops` helpers, however, had no test
coverage.

### Changes

No production change was required. This PR closes the coverage gap on the unit
conversion helpers that underpin the estimate.

### Acceptance criteria

- [x] Fee estimation function exported from `@astroid/transaction`.
- [x] Handles standard transaction envelopes and multi-operation transactions.
- [x] Comprehensive unit tests verifying fee calculations against mock Stellar
      ledger data.

### Tests

`packages/transaction/__tests__/estimate-fee.test.ts` (+5 tests): stroop → XLM
formatting, XLM → stroop parsing, invalid/negative handling and a drift-free
round trip.

---

## Validation

| Scope | Command | Result |
| --- | --- | --- |
| workspace | `pnpm build` | all packages build |
| workspace | `pnpm typecheck` | 16/16 packages pass |
| workspace | `pnpm lint` | 0 errors |
| workspace | `pnpm test` | **1,703 passed**, 0 failed (15 packages) |
| `@astroid/policy` | `pnpm test` | 160 passed (was 115) |
| `@astroid/agent` | `pnpm test` | 46 passed (was 38) |
| `@astroid/react` | `pnpm test` | 169 passed (was 168) |
| `@astroid/transaction` | `pnpm test` | 231 passed (was 226) |
| `@astroid/types` | `pnpm test` | 71 passed (was 63) |

Prettier formatting is clean on every changed file. No merge conflicts — the
branch is up to date with `upstream/main`.
