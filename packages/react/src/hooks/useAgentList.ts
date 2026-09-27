/**
 * `useAgentList` — reactive agent listing with filtering and cursor pagination.
 *
 * Developers building agent interfaces need a straightforward hook to list,
 * filter, and paginate autonomous agents. `useAgentList` wraps TanStack
 * Query's `useInfiniteQuery` around `astroid.agents.list` (from `@astroid/agent`
 * via the {@link AstroidProvider} client context), so list views get loading,
 * error, and next-page fetching states with full type inference.
 *
 * ```tsx
 * import { useAgentList } from '@astroid/react';
 *
 * function AgentList() {
 *   const { items, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
 *     useAgentList({ params: { status: 'ACTIVE', limit: 25 } });
 *
 *   if (isLoading) return <p>Loading agents…</p>;
 *   if (isError) return <p>{error?.message}</p>;
 *
 *   return (
 *     <>
 *       <ul>
 *         {items.map((agent) => (
 *           <li key={agent.id}>{agent.name}</li>
 *         ))}
 *       </ul>
 *       {hasNextPage && (
 *         <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
 *           {isFetchingNextPage ? 'Loading…' : 'Load more'}
 *         </button>
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * Cache keys reuse the shared `queryKeys.agents.list` namespace, so
 * invalidating `queryKeys.agents.all` refreshes agent lists exactly like the
 * single-page {@link useAgents} hook.
 *
 * @module
 */

import { useMemo } from 'react';
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type {
  Agent,
  CursorPaginationParams,
  ListAgentsParams,
  Paginated,
  PaginationMeta,
  ResponseMeta,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Filters and cursor-pagination options accepted by {@link useAgentList}.
 *
 * Agent filters (`status`, `role`, `search`) from {@link ListAgentsParams} —
 * without the page-number field — plus cursor pagination (`cursor`, `limit`,
 * `order`) from {@link CursorPaginationParams}. All fields are optional and
 * strictly typed via the shared `@astroid/types` shapes.
 */
export interface UseAgentListParams
  extends Omit<ListAgentsParams, 'page'>,
    CursorPaginationParams {}

/** Page parameter: an opaque cursor, an offset page number, or the first page. */
export type AgentListPageParam = string | number | undefined;

/** Options for {@link useAgentList}. */
export interface UseAgentListOptions {
  /**
   * Agent filters and pagination merged into the query key and every request.
   * A `cursor` here sets the starting position (same as `initialCursor`).
   */
  params?: UseAgentListParams;
  /** Page-size override for this instance (wins over `params.limit`). */
  limit?: number;
  /**
   * Cursor to start from — resume a previously captured position. Wins over
   * `params.cursor` when both are provided.
   */
  initialCursor?: string;
  /** Enable/disable the query. Defaults to `true`. */
  enabled?: boolean;
  /** Stale time in milliseconds. */
  staleTime?: number;
  /** Cache retention time in milliseconds. */
  gcTime?: number;
  /** Refetch when the window regains focus. Defaults to `false`. */
  refetchOnWindowFocus?: boolean;
  /** Retry policy for failed pages. Defaults to `false`. */
  retry?: number | boolean;
}

/**
 * Result of {@link useAgentList}: the standard TanStack Query infinite result
 * (`data`, `isLoading`, `error`, `fetchNextPage`, `hasNextPage`, …) plus
 * flattened `items` and a `total` convenience.
 */
export type UseAgentListResult = UseInfiniteQueryResult<
  InfiniteData<Paginated<Agent>, AgentListPageParam>,
  Error
> & {
  /** Flattened agents across every loaded page, in fetch order. */
  items: Agent[];
  /** Total matching agents from the latest page metadata, when reported. */
  total: number | undefined;
};

/* -------------------------------------------------------------------------- */
/* Next-page extraction (cursor-first, offset fallback)                        */
/* -------------------------------------------------------------------------- */

/** Page metadata with the optional cursor fields a cursor-paginated API adds. */
type AgentListPageMeta = PaginationMeta &
  Partial<Pick<ResponseMeta, 'nextCursor' | 'cursor' | 'prevCursor' | 'hasMore'>>;

function readMeta(page: Paginated<Agent>): AgentListPageMeta {
  return (page.meta ?? {}) as AgentListPageMeta;
}

/**
 * Resolve the next page parameter from a loaded page.
 *
 * Cursor-style responses win: a non-empty `meta.nextCursor` (or legacy
 * `meta.cursor`) is followed while `meta.hasMore` is not `false`. Otherwise
 * offset-style metadata falls back to the next page number. Returns
 * `undefined` when the page is the last one — or when the cursor did not
 * advance, which would otherwise loop forever.
 */
function getAgentListNextPageParam(
  lastPage: Paginated<Agent>,
  lastPageParam: AgentListPageParam,
): AgentListPageParam {
  const meta = readMeta(lastPage);

  const rawNext = meta.nextCursor ?? meta.cursor;
  if (typeof rawNext === 'string' && rawNext.length > 0) {
    if (meta.hasMore === false || rawNext === lastPageParam) return undefined;
    return rawNext;
  }

  if (meta.hasNextPage === true) {
    const nextPage = (typeof meta.page === 'number' ? meta.page : 1) + 1;
    if (nextPage === lastPageParam) return undefined;
    return nextPage;
  }
  if (
    typeof meta.page === 'number' &&
    typeof meta.totalPages === 'number' &&
    meta.page < meta.totalPages
  ) {
    return meta.page + 1;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * List, filter, and paginate autonomous agents reactively.
 *
 * Leverages the `agents` resource of the {@link Astroid} client from context
 * (provided by {@link AstroidProvider}) and must therefore be called inside
 * the provider tree.
 *
 * @param options Filters, pagination, and query tuning (all optional).
 * @returns The standard TanStack Query infinite result (`data`, `isLoading`,
 *   `error`, `fetchNextPage`, …) plus flattened `items` and `total`.
 */
export function useAgentList(options: UseAgentListOptions = {}): UseAgentListResult {
  const astroid = useAstroidClient();
  const {
    params,
    limit,
    initialCursor,
    enabled = true,
    staleTime,
    gcTime,
    refetchOnWindowFocus = false,
    retry = false,
  } = options;

  const { cursor: paramsCursor, ...restParams } = params ?? {};
  const firstCursor = initialCursor ?? paramsCursor;
  const effectiveLimit = limit ?? restParams.limit;

  const keyParams: UseAgentListParams = {
    ...restParams,
    ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
    ...(firstCursor !== undefined ? { cursor: firstCursor } : {}),
  };
  const baseRequest = {
    ...restParams,
    ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
  };

  const query = useInfiniteQuery<
    Paginated<Agent>,
    Error,
    InfiniteData<Paginated<Agent>, AgentListPageParam>,
    readonly unknown[],
    AgentListPageParam
  >({
    queryKey: queryKeys.agents.list(keyParams),
    initialPageParam: firstCursor,
    queryFn: ({ pageParam }) => {
      if (typeof pageParam === 'string') {
        return astroid.agents.list({ ...baseRequest, cursor: pageParam } as ListAgentsParams);
      }
      if (typeof pageParam === 'number') {
        // Offset continuation carries a page number only (`cursor` was already
        // separated out of `baseRequest` above).
        return astroid.agents.list({ ...baseRequest, page: pageParam } as ListAgentsParams);
      }
      return astroid.agents.list(baseRequest as ListAgentsParams);
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      getAgentListNextPageParam(lastPage, lastPageParam),
    enabled,
    staleTime,
    gcTime,
    refetchOnWindowFocus,
    retry,
  });

  const pages = query.data?.pages ?? [];
  const items = useMemo<Agent[]>(() => pages.flatMap((page) => page.data), [pages]);
  const total = pages.length > 0 ? readMeta(pages[pages.length - 1] as Paginated<Agent>).total : undefined;

  return { ...query, items, total };
}
