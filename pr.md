# feat(core,client,policy): configurable retry backoff multiplier & policy simulation coverage

Closes #254
Closes #258

---

## Overview

This PR delivers the two agent-reliability capabilities requested in #254 and #258.
They share a theme: keeping an autonomous agent's money-moving path safe and
predictable when the network (or the policy engine) says "no".

| Package | What changed |
| --- | --- |
| `@astroid/core` | Optional `RetryConfig.multiplier` — the exponential growth factor is now configurable (default `2`), and `backoffDelay` uses it instead of a hard-coded `2`. New `backoff.test.ts`. |
| `@astroid/client` | The retry middleware and client-init shorthand surface the multiplier end-to-end (`retry.multiplier`, `retryMultiplier`), and shorthand options now *merge* with an explicit `retry` object. Regression tests added. |
| `@astroid/policy` | Verified and locked down the already-shipped `simulatePolicy` resource method + local engine with a new test suite for the decoded-transaction simulation path. |

---

## Issue #254 — Request retry mechanism with exponential backoff (`@astroid/core`, `@astroid/client`)

The client already had a retry loop with full-jitter exponential backoff and a
transient-status predicate. The one acceptance-criteria gap was **configurable
backoff multipliers**: the growth factor was hard-coded to `2` (`baseDelayMs * 2^(attempt-1)`),
so callers could tune the base delay and cap but not the growth curve.

### What was implemented

- **`RetryConfig.multiplier`** (`@astroid/core`) — governs the uncapped delay for
  retry `n`: `baseDelayMs * multiplier^(n-1)`. Defaults to `2` (classic doubling);
  `1` yields a constant delay and values above `2` back off more aggressively.
  The field is **optional**, so hand-written `RetryConfig` literals that predate
  it keep compiling and behave exactly as before.
- **`backoffDelay(attempt, config, random?)`** now reads
  `config.multiplier ?? 2` while keeping full jitter
  (`random() * min(exponential, maxDelayMs)`), so tests stay deterministic via the
  injected RNG.
- **Retry middleware** (`@astroid/core/src/middleware.ts` and
  `@astroid/client/src/middleware/retry.ts`) forwards `multiplier` into the
  per-request `_retryConfig` context consumed by `HttpClient.request`.
- **Client initialisation options** — `new Astroid({ retry: { multiplier: 1.5 } })`
  works directly, and a new `retryMultiplier` shorthand joins `retries` /
  `retryDelay`. Shorthand options now merge with (instead of replacing) an explicit
  `retry` object, so combinations like `{ retries: 5, retry: { multiplier: 3 } }`
  are preserved.
- Existing safe defaults are unchanged: only idempotent verbs (GET/PUT/DELETE),
  requests with an `Idempotency-Key`, or requests explicitly marked `retryable`
  are retried; `retryAllMethods` remains opt-in. `429` and all `5xx` are
  retryable, every other `4xx` fails immediately. `Retry-After` is still honoured
  on `429`.

### Acceptance criteria

- [x] Retry configuration options are exposed on client initialisation
      (`retry`, `retries`, `retryDelay`, `retryMultiplier`).
- [x] Exponential backoff delay calculation with jitter and a configurable
      multiplier.
- [x] Unit tests mock `fetch` to verify retry attempts on `5xx`/`429`/network
      errors and a successful return on a subsequent try.
- [x] Non-retryable errors (`400`, `401`, `403`, `404`, `408`, `422`, `425`)
      fail immediately without retrying.
- [x] `@astroid/core` unit tests cover the delay curve, jitter bounds, cap, and
      the retryable-status predicate.

---

## Issue #258 — Policy simulation method (`@astroid/policy`)

The strongly-typed simulation surface requested by this issue is present on
`main` (the resource method from #203 and the local engine from #36). This PR
verifies that it meets every acceptance criterion and adds the missing test
coverage for the decoded-transaction path so the behaviour cannot silently
regress.

### What exists and is now covered

- **`PolicyResource.simulatePolicy(input)`** (and its `simulate` alias) POSTs to
  `/policies/simulate` and returns a typed `PolicySimulationResult`
  (`allowed`, `violations`, `requiredApprovals`, `risk`, `budgetImpact`,
  `explanation`) — i.e. allowed/denied **with reasons**.
- **`PolicyResource.simulateTransaction({ agentId | walletId, transaction })`**
  fetches the active policies and evaluates a proposed transaction locally,
  returning `{ passed, violations }` without spending a network round-trip on a
  doomed transaction.
- **`simulatePolicy(policies, tx)`** — the decimal-safe (BigInt-scaled) local
  evaluation engine covering max/min amount, daily/weekly/monthly budgets,
  allowed/blocked assets, and allowed/blocked recipients.
- **DTOs in `@astroid/types`** — `PolicySimulationRequest`,
  `PolicySimulationResult`, `PolicyViolation`/`PolicyViolationDetail`,
  `SimulatePolicyRequest`, plus the risk/budget-impact shapes.

### Acceptance criteria

- [x] `simulatePolicy` API method on `@astroid/policy` (plus the local engine and
      the `simulateTransaction` pre-flight wrapper).
- [x] Input and output DTOs defined in `@astroid/types`.
- [x] Unit tests mock the API client response for both **passing** and **failing**
      simulations (`packages/policy/__tests__/policy.test.ts`).
- [x] New tests cover the decoded-transaction `simulatePolicyLocal` path for
      passing, failing, multi-violation, disabled-policy, and malformed-input
      cases (`packages/policy/__tests__/simulate-policy-local.test.ts`).

---

## Files changed

**Added**
- `packages/core/src/backoff.test.ts`
- `packages/policy/__tests__/simulate-policy-local.test.ts`

**Modified**
- `packages/core/src/config.ts` — `multiplier` on `RetryConfig` + default.
- `packages/core/src/backoff.ts` — use `config.multiplier` in the delay curve.
- `packages/core/src/middleware.ts` — forward `multiplier` into retry context.
- `packages/client/src/middleware/retry.ts` — `multiplier` option + default.
- `packages/client/src/index.ts` — `retryMultiplier` shorthand and merging
  shorthand normalisation.
- `packages/client/src/retry.test.ts`,
  `packages/client/src/__tests__/retry.test.ts`,
  `packages/client/src/__tests__/retry-module.test.ts` — `multiplier` coverage
  and updated fixtures.

---

## Validation

| package | command | result |
| --- | --- | --- |
| workspace | `pnpm build` | pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |
| workspace | `pnpm test` | 1225 tests pass |
| `@astroid/core` | `pnpm test` | 3 files / 38 tests pass |
| `@astroid/client` | `pnpm test` | 19 files / 272 tests pass |
| `@astroid/policy` | `pnpm test` | 5 files / 105 tests pass |
| `@astroid/react` | `pnpm test` | 17 files / 127 tests pass |

No breaking changes: `multiplier` is optional and defaults to `2`, so existing
retry timing is unchanged. The only source edits outside tests are the new field,
the `?? 2` fallback in `backoffDelay`, and threading the value through the retry
middleware; a regression test pins the omitted-field fallback.

---

## Notes / design decisions

- **Multiplier, not just delay**: the issue asked specifically for configurable
  backoff multipliers, so the growth factor is a first-class config value rather
  than a hard-coded constant. Full jitter is preserved, so agents still avoid
  thunder-herding a recovering backend.
- **Merging shorthand**: `retries`/`retryDelay`/`retryMultiplier` are convenience
  shorthands; they now overlay an explicit `retry` object instead of discarding
  it.
- **Policy work was verified, not duplicated**: rather than re-implement the
  simulation surface that already satisfies #258, this PR pins the contract with
  tests — including the previously untested `simulatePolicyLocal` helper — and
  documents the DTO/engine split.
