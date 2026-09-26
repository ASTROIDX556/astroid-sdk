# feat(policy,react): policy simulation method and useSimulatePolicy hook

Implements the policy-simulation workflow from the issue: a canonical
`simulatePolicy` resource method in `@astroid/policy` and a
`useSimulatePolicy` mutation hook in `@astroid/react` with success/error
handling, both covered by unit and hook tests.

Closes #268

---

## Background

Before an agent executes a transaction, applications need to dry-run it against
the account's spending and security policies. The policy simulation endpoint
(`POST /policies/simulate`) returns the server's decision — allowed flag,
violations, required approvals, risk assessment, budget impact and a
human-readable explanation — without creating anything.

The plumbing for this issue was largely present but inverted/under-tested:

- `PolicyResource` exposed `simulate()` as the method that actually posted, with
  `simulatePolicy()` merely delegating to it — the reverse of what the issue
  specifies.
- `useSimulatePolicy` called `astroid.policies.simulate()` rather than
  `simulatePolicy()`, and its only test asserted that the client object
  existed ("wired") instead of verifying a real success or failure path.

This PR makes `simulatePolicy` the canonical method, points the hook at it, and
replaces the placeholder test with real mutation tests.

---

## Changes

### `packages/policy/src/index.ts` — canonical `simulatePolicy`

- `simulatePolicy(input)` now performs the `POST /policies/simulate` call and
  returns the `PolicySimulationResult`.
- `simulate(input)` is retained as a thin, documented backwards-compatible alias
  that delegates to `simulatePolicy`, so existing callers keep working.
- Full TSDoc describing the request/response contract.

### `packages/react/src/hooks.ts` — `useSimulatePolicy`

- `mutationFn` now calls `astroid.policies.simulatePolicy(params)`, matching the
  resource method the issue names.
- Expanded TSDoc documenting TanStack Query state (`isPending` / `isSuccess` /
  `isError`, `data`, `error`) and per-call `onSuccess` / `onError` callbacks for
  component-level handling, with a usage example.

### Tests

`packages/policy/__tests__/policy.test.ts`
- **New:** `simulatePolicy` surfaces an API `400 VALIDATION_ERROR` as a typed
  `ValidationError`, exposing `fieldErrors` and posting exactly once to
  `/policies/simulate`.
- Existing coverage retained: successful `simulate` / `simulatePolicy`
  responses, payload/method assertions, and network-failure propagation.

`packages/react/src/__tests__/hooks.test.tsx`
- Replaced the placeholder `useSimulatePolicy` test with three real hook tests
  (using `renderHook` + `waitFor`, matching
  `use-agent-mutations.test.tsx`):
  1. calls `policies.simulatePolicy` with the payload (and **not** `simulate`),
     and exposes the resolved `data`;
  2. invokes the per-call `onSuccess` callback with the simulation result;
  3. surfaces a `ValidationError` through `isError` / `error`, leaves `data`
     undefined, and fires `onError`.

---

## Acceptance criteria

- [x] `simulatePolicy` method available in `@astroid/policy` (canonical; sends
      the simulation payload to the API).
- [x] `useSimulatePolicy` mutation hook exported from `@astroid/react`.
- [x] Unit tests verify successful simulation responses and validation
      failures.
- [x] Hook tests verify successful simulation responses and validation
      failures, including `onSuccess` / `onError` handling.

---

## Validation

| package | command | result |
| --- | --- | --- |
| `@astroid/policy` | `pnpm test` | 82 passed (3 files) |
| `@astroid/react` | `pnpm test` | 73 passed (8 files) |
| workspace | `pnpm test` | all packages pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |
