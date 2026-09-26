# feat: paginated React hook factory, HTTP interceptors & pagination helpers

Closes #70
Closes #270
Closes #273
Closes #278

---

## Overview

This PR lands the reusable list/pagination infrastructure for the SDK and the
React data layer built on top of it. It touches three workspace packages:

| Package | What changed |
| --- | --- |
| `@astroid/react` | New generic infinite/paginated query hook + hook factory |
| `@astroid/client` | Pluggable request/response interceptors, built-in debug logger, pagination query builders |
| `@astroid/types` | Cursor pagination metadata now exposes a `prevCursor` |

All four issues target the same theme — clean, typed pagination navigation —
and are implemented together so the pieces compose (pagination types → client
query builders → React hooks).

---

## Issue #70 — React query hook factory for paginated resource lists (`@astroid/react`)

New module `packages/react/src/hooks/usePaginatedResource.ts`.

- **`useInfiniteResource<TItem, TParams>(config, options)`** — a generic
  TanStack Query hook for cursor-paginated list endpoints. It owns query-key
  management (appending resolved params), page state, and next-page fetching,
  with full type inference over `TItem` and `TParams`.
- **`createPaginatedResourceHook(config)`** — the hook factory. Bind a
  `PaginatedResourceConfig` (query key + page fetcher + defaults) once and get
  back a reusable hook, so components pass only per-instance options.
- **Caching & stale time** — `staleTime` can be set per-resource or per
  instance; `gcTime`, `retry`, `enabled`, `refetchOnWindowFocus`,
  `initialCursor`, and `limit` are exposed. Query keys include the resolved
  params so different filters cache independently.
- **States surfaced cleanly** — `isLoading`, `isError`, `error`,
  `isFetchingNextPage`, `hasNextPage`, plus `fetchNextPage()` / `refetch()`
  and a flattened `items` array (and raw `pages`, `total`).
- **Custom cursors** — `getNextPageParam` defaults to following
  `meta.nextCursor` while `meta.hasMore !== false`, but can be overridden.
- Exported from `packages/react/src/index.ts` alongside the existing provider,
  resource, and mutation hooks.

```tsx
import { createPaginatedResourceHook } from '@astroid/react';

const useWalletsPage = createPaginatedResourceHook({
  queryKey: ['astroid', 'wallets', 'list'],
  fetchPage: (params) => astroid.wallets.list(params),
  staleTime: 30_000,
});

const { items, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
  useWalletsPage();
```

**Acceptance criteria**
- [x] Implemented a paginated query hook factory in `packages/react`.
- [x] Exported the new hooks alongside existing provider/resource hooks.
- [x] Unit tests use `@testing-library/react` and `QueryClient` wrappers.
- [x] `pnpm build`, `pnpm lint`, `pnpm typecheck` all pass.

---

## Issue #270 — Request/response logging interceptor support (`@astroid/client`)

New module `packages/client/src/interceptors.ts`, wired into `AstroidClientConfig`
and the `Astroid` constructor.

- **`requestInterceptors` / `responseInterceptors`** arrays on the client
  config. Request interceptors run in array order before dispatch; response
  interceptors run in array order as responses arrive.
- **Lightweight, async-friendly signatures**:
  - `RequestInterceptor = (config: RequestConfig) => RequestConfig | void | Promise<...>`
  - `ResponseInterceptor = (response: ResponseConfig) => ResponseConfig | void | Promise<...>`
  - `RequestConfig` exposes `url`, `method`, `headers`, `body` (decoded), and
    the original `options`; `ResponseConfig` exposes `status`, `headers`,
    `body`, `requestId`, and an echo of the originating request.
- Return a replacement config to rewrite the URL/method/headers/body (tests
  cover URL rewriting, method/body transformation, and header injection); return
  nothing to observe only.
- **Built-in debug logger**: `createDebugLogger(options)` returns a
  `{ requestInterceptor, responseInterceptor }` pair that emits stable,
  greppable lines and redacts sensitive headers by default:

  ```
  [astroid] → GET https://api.astroid.finance/v1/wallets headers={...}
  [astroid] ← 200 GET https://api.astroid.finance/v1/wallets (42ms) body={...}
  ```

  It can also be enabled from config with `debug: true` / `debug: {...}`.
- TSDoc examples are included on the module, `createInterceptorMiddleware`, and
  `createDebugLogger`.

**Acceptance criteria**
- [x] Client options interface supports arrays of request/response interceptors.
- [x] Request interceptors execute in order before fetch; response interceptors
      execute upon receiving responses.
- [x] Unit tests verify interceptor execution order and payload propagation.
- [x] Interceptor usage documented with a TSDoc example.

---

## Issue #273 — Pagination parameters & meta types for list endpoints (`@astroid/client`, `@astroid/types`)

- `PaginationParams` (`page?`, `cursor?`, `limit?`, `order?`) and the generic
  `PaginatedResponse<T>` (`data: T[]`, `meta?: ResponseMeta`) are already
  exported from `@astroid/types` and re-exported from `@astroid/client`.
- `ResponseMeta` now also exposes `prevCursor?: string | null`, and
  `CursorPaginated<T>` gains the same optional field, so backwards cursor
  navigation is typed.
- `serializePaginationParams` now also handles `page` and defensively drops
  `null` / empty-string values, so serialization never produces literal `""`
  query segments.
- Pagination is wired into the client request layer: `Astroid.buildQuery(...)`
  merges pagination params with arbitrary query params.

**Acceptance criteria**
- [x] `PaginationParams` and `PaginatedResponse` exported from `@astroid/types`.
- [x] Client request utilities serialize optional pagination query strings.
- [x] Unit tests verify query-parameter encoding and response parsing.
- [x] `pnpm build` and `pnpm test` pass across the workspace.

---

## Issue #278 — Pagination response helpers & query parameter builders (`@astroid/client`)

- **`buildPaginationQuery(params?)`** — returns a populated `URLSearchParams`
  from `{ cursor, limit, order, page }`, safely omitting `undefined`, `null`,
  and empty-string values without producing `?`/`&` artifacts.
- **`buildPaginationQueryString(params?)`** — returns a leading-`?` query
  string (`'?limit=25'`) or `''`, safe to concatenate onto any path.
- Both are exported from `packages/client/src/index.ts`, alongside the existing
  `serializePaginationParams` / `unwrapPaginatedResponse` helpers and the
  generic `PaginatedResponse` re-export.
- New Vitest suite additions under
  `packages/client/src/__tests__/pagination.test.ts` verify serialization of
  cursors, limits, order, and page, including boundary/empty cases.

**Acceptance criteria**
- [x] `buildPaginationQuery` exported from `@astroid/client`.
- [x] Generic `PaginatedResponse` envelope exported for list results.
- [x] Tests in `packages/client/src/__tests__/pagination.test.ts` cover
      cursor/limit/order serialization.
- [x] `pnpm --filter @astroid/client build` and `pnpm typecheck` pass.

---

## Files changed

**Added**
- `packages/client/src/interceptors.ts`
- `packages/client/src/__tests__/interceptors.test.ts`
- `packages/react/src/hooks/usePaginatedResource.ts`
- `packages/react/src/__tests__/paginated-resource.test.tsx`

**Modified**
- `packages/client/src/index.ts` (config wiring + exports)
- `packages/client/src/pagination.ts` (`buildPaginationQuery`,
  `buildPaginationQueryString`, null-safe serialization)
- `packages/client/src/__tests__/pagination.test.ts`
- `packages/types/src/common.ts` (`prevCursor` on `ResponseMeta` /
  `CursorPaginated`)
- `packages/types/src/pagination.test.ts`
- `packages/react/src/index.ts`

---

## Validation

| package | command | result |
| --- | --- | --- |
| workspace | `pnpm build` | pass |
| workspace | `pnpm lint` | pass |
| workspace | `pnpm typecheck` | 16/16 packages pass |
| `@astroid/client` | `pnpm test` | 17 files / 254 tests pass |
| `@astroid/react` | `pnpm test` | 9 files / 79 tests pass |
| `@astroid/types` | `pnpm test` | 4 files / 63 tests pass |
| workspace | `pnpm test` | all packages pass |

---

## Notes / design decisions

- Interceptors intentionally layer on top of the existing middleware stack
  rather than replacing it: `createInterceptorMiddleware` simply adapts the
  `PreparedRequest`/`RawResponse` pipeline into the ergonomic
  `RequestConfig`/`ResponseConfig` shape, so existing middleware order and
  behaviour are unchanged.
- The React hook factory is deliberately resource-agnostic (it takes a query
  key and page fetcher) so it can be reused by every resource package without
  coupling `@astroid/react` to resource implementations.
- `prevCursor` was added as an optional field to keep the change non-breaking.
