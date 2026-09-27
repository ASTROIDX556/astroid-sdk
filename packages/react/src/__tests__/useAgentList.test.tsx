/**
 * Unit tests for the `useAgentList` hook in `@astroid/react` (issue #266).
 *
 * Covered behaviour:
 * - Loading → success exposes flattened `items` plus the standard TanStack
 *   Query result (`data`, `isLoading`, `error`, `fetchNextPage`, …)
 * - Filter parameters and pagination options (`limit`, `cursor`) are forwarded
 *   to `agents.list` on every page
 * - Cursor pagination appends pages via `fetchNextPage` until exhausted
 * - Offset-style metadata falls back to page-number continuation
 * - Client errors surface in the query error state
 * - Results are cached under the shared `queryKeys.agents.list` namespace
 * - `enabled: false` and `initialCursor` resume semantics
 *
 * The client is mocked via the shared harness; no live API is contacted.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAgentList } from '../hooks/useAgentList.js';
import { queryKeys } from '../hooks.js';
import {
  AGENT_A,
  AGENT_B,
  createMockClient,
  createWrapper,
} from './test-utils.js';
import type { Astroid } from '@astroid/client';
import type { Agent, Paginated } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures and helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Cursor-style pages (as a cursor-paginated API would return them). */
const CURSOR_PAGE_ONE = {
  data: [AGENT_A],
  meta: {
    page: 1,
    limit: 1,
    total: 2,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
    nextCursor: 'cur_2',
    hasMore: true,
  },
} as Paginated<Agent>;

const CURSOR_PAGE_TWO = {
  data: [AGENT_B],
  meta: {
    page: 2,
    limit: 1,
    total: 2,
    totalPages: 2,
    hasNextPage: false,
    hasPreviousPage: true,
    nextCursor: null,
    hasMore: false,
  },
} as Paginated<Agent>;

/** Offset-style pages (as `AgentResource.list` normalizes them). */
const OFFSET_PAGE_ONE: Paginated<Agent> = {
  data: [AGENT_A],
  meta: {
    page: 1,
    limit: 1,
    total: 2,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
  },
};

const OFFSET_PAGE_TWO: Paginated<Agent> = {
  data: [AGENT_B],
  meta: {
    page: 2,
    limit: 1,
    total: 2,
    totalPages: 2,
    hasNextPage: false,
    hasPreviousPage: true,
  },
};

type ListMock = ReturnType<typeof vi.fn>;

/** Mock client whose `agents.list` routes on the incoming cursor/page. */
function createPagingClient(route: (params: Record<string, unknown>) => Paginated<Agent>): {
  client: Astroid;
  list: ListMock;
} {
  const list = vi.fn(async (params?: Record<string, unknown>): Promise<Paginated<Agent>> =>
    route(params ?? {}),
  );
  const client = { agents: { list } } as unknown as Astroid;
  return { client, list };
}

/* -------------------------------------------------------------------------- */
/* Loading / success / error states                                            */
/* -------------------------------------------------------------------------- */

describe('useAgentList — loading, success, and error states', () => {
  it('starts loading and exposes flattened items plus the standard query result', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList(), { wrapper: Wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.items).toEqual([]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items.map((agent) => agent.id)).toEqual(['agent_001', 'agent_002']);
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0]?.data).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.fetchNextPage).toBe('function');
    expect(typeof result.current.refetch).toBe('function');
  });

  it('surfaces client errors in the query error state', async () => {
    const client = createMockClient();
    (client.agents.list as unknown as ListMock).mockRejectedValueOnce(new Error('List failed'));
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('List failed');
    expect(result.current.items).toEqual([]);
    expect(result.current.data).toBeUndefined();
  });

  it('stays idle without fetching when enabled is false', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ enabled: false }), {
      wrapper: Wrapper,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.agents.list).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Filtering and pagination parameters                                         */
/* -------------------------------------------------------------------------- */

describe('useAgentList — filters and pagination options', () => {
  it('forwards filters and limit to agents.list', async () => {
    const { client, list } = createPagingClient(() => OFFSET_PAGE_ONE);
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(
      () => useAgentList({ params: { status: 'ACTIVE', search: 'ledger', limit: 10 } }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(list).toHaveBeenCalledWith({ status: 'ACTIVE', search: 'ledger', limit: 10 });
  });

  it('honours a per-instance limit override over params.limit', async () => {
    const { client, list } = createPagingClient(() => OFFSET_PAGE_ONE);
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ params: { limit: 5 }, limit: 25 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(list).toHaveBeenCalledWith({ limit: 25 });
  });

  it('starts from params.cursor on the first page', async () => {
    const { client, list } = createPagingClient(() => CURSOR_PAGE_TWO);
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ params: { cursor: 'cur_9' } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(list).toHaveBeenCalledWith({ cursor: 'cur_9' });
  });

  it('initialCursor resumes from a captured position and wins over params.cursor', async () => {
    const { client, list } = createPagingClient(() => CURSOR_PAGE_TWO);
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(
      () => useAgentList({ params: { cursor: 'cur_old' }, initialCursor: 'cur_9' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(list).toHaveBeenCalledWith({ cursor: 'cur_9' });
  });

  it('caches results under the shared agents.list query key', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ params: { limit: 5 } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(queryKeys.agents.list({ limit: 5 }))?.status).toBe(
      'success',
    );
    expect(result.current.data).toEqual(
      queryClient.getQueryData(queryKeys.agents.list({ limit: 5 })),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Cursor pagination                                                           */
/* -------------------------------------------------------------------------- */

describe('useAgentList — cursor pagination', () => {
  it('appends the next cursor page via fetchNextPage without losing the first', async () => {
    const { client, list } = createPagingClient((params) =>
      params['cursor'] === 'cur_2' ? CURSOR_PAGE_TWO : CURSOR_PAGE_ONE,
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ params: { limit: 1 } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.items.map((agent: Agent) => agent.id)).toEqual(['agent_001']);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((agent: Agent) => agent.id)).toEqual([
      'agent_001',
      'agent_002',
    ]);
    expect(result.current.hasNextPage).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(2, { limit: 1, cursor: 'cur_2' });
  });

  it('forwards filters on every subsequent page', async () => {
    const { client, list } = createPagingClient((params) =>
      params['cursor'] === 'cur_2' ? CURSOR_PAGE_TWO : CURSOR_PAGE_ONE,
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(
      () => useAgentList({ params: { status: 'ACTIVE', limit: 1 } }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(list).toHaveBeenNthCalledWith(2, { status: 'ACTIVE', limit: 1, cursor: 'cur_2' });
  });
});

/* -------------------------------------------------------------------------- */
/* Offset fallback                                                             */
/* -------------------------------------------------------------------------- */

describe('useAgentList — offset metadata fallback', () => {
  it('continues with the next page number when only offset metadata is present', async () => {
    const { client, list } = createPagingClient((params) =>
      params['page'] === 2 ? OFFSET_PAGE_TWO : OFFSET_PAGE_ONE,
    );
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => useAgentList({ params: { limit: 1 } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(list).toHaveBeenNthCalledWith(2, { limit: 1, page: 2 });
    expect(result.current.hasNextPage).toBe(false);
  });
});
