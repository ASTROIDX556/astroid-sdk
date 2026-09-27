/**
 * Optimistic-update tests for the agent mutation hooks (issue #231):
 * `useUpdateAgent`, `useUpdateAgentStatus`, `useUpdateAgentMetadata`, and
 * `useDeleteAgent`.
 *
 * Coverage:
 * - The cache reflects the optimistic value immediately after `mutate`, before
 *   the mocked request resolves (detail + every cached list).
 * - On a simulated API error the cache rolls back to the exact pre-mutation
 *   snapshot.
 * - On success the affected query keys are invalidated and refetched, so the
 *   cache converges to server truth instead of retaining a stale optimistic
 *   value.
 * - A race case: an in-flight `agents.get` refetch that resolves *after* the
 *   optimistic write cannot clobber it, because `onMutate` awaits
 *   `queryClient.cancelQueries` before snapshotting and writing.
 *
 * Pattern: caches are primed via `setQueryData` and observed either through
 * mounted hooks (for refetch assertions) or through direct `getQueryData`
 * reads with `gcTime: Infinity` (for deterministic mid-flight assertions),
 * mirroring `use-create-agent-optimistic.test.tsx`.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdateAgent, useUpdateAgentStatus, useUpdateAgentMetadata, useDeleteAgent } from '../hooks/useAgents.js';
import { useAgent, useAgents, queryKeys } from '../hooks.js';
import { createWrapper, AGENT_A, AGENT_B, AGENT_PAGE } from './test-utils.js';
import type { Agent, Paginated, UpdateAgentParams } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** The agent the server returns after a successful update. */
const UPDATED_AGENT: Agent = {
  ...AGENT_A,
  name: 'Server Truth',
  status: 'PAUSED',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** A stale agent payload an in-flight (cancelled) refetch would deliver. */
const STALE_AGENT: Agent = { ...AGENT_A, name: 'Stale Pre-Mutation Name' };

/** A page the server returns for the agents list after the update. */
const UPDATED_PAGE: Paginated<Agent> = {
  data: [UPDATED_AGENT, AGENT_B],
  meta: AGENT_PAGE.meta,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Mock Astroid client exposing spies for every agents-resource method used. */
function createClient() {
  return {
    agents: {
      get: vi.fn(async (): Promise<Agent> => AGENT_A),
      list: vi.fn(async (): Promise<Paginated<Agent>> => AGENT_PAGE),
      update: vi.fn(async (_id: string, _params: UpdateAgentParams): Promise<Agent> => UPDATED_AGENT),
      delete: vi.fn(async (): Promise<void> => undefined),
    },
  } as unknown as {
    agents: {
      get: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  } & import('@astroid/client').Astroid;
}

/** Read the primed agents-list entry from the cache. */
function listCache(queryClient: ReturnType<typeof createWrapper>['queryClient']) {
  return queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list({}));
}

/** Read the agent detail entry from the cache. */
function detailCache(queryClient: ReturnType<typeof createWrapper>['queryClient'], id = AGENT_A.id) {
  return queryClient.getQueryData<Agent>(queryKeys.agents.detail(id));
}

/** Create a promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* -------------------------------------------------------------------------- */
/* useUpdateAgent                                                              */
/* -------------------------------------------------------------------------- */

describe('useUpdateAgent — optimistic updates', () => {
  it('writes the optimistic value into the detail and list caches before the request resolves', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let resolveUpdate!: (agent: Agent) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, params: { name: 'Optimistic Name' } });

    // Optimistic detail: patched immediately, before the server responds.
    await waitFor(() => expect(detailCache(queryClient)?.name).toBe('Optimistic Name'));
    expect(detailCache(queryClient)?.id).toBe(AGENT_A.id);
    expect(detailCache(queryClient)?.metadata).toEqual(AGENT_A.metadata);

    // Optimistic list: only the matching entry is patched.
    expect(listCache(queryClient)?.data).toHaveLength(2);
    expect(listCache(queryClient)?.data[0]?.name).toBe('Optimistic Name');
    expect(listCache(queryClient)?.data[1]?.id).toBe(AGENT_B.id);

    // The API call went out with the exact variables.
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, { name: 'Optimistic Name' });

    resolveUpdate(UPDATED_AGENT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the detail and list caches back to the exact pre-mutation snapshot on error', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let rejectUpdate!: (err: Error) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, params: { name: 'Optimistic Name' } });
    await waitFor(() => expect(detailCache(queryClient)?.name).toBe('Optimistic Name'));

    rejectUpdate(new Error('Update rejected'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Exact rollback — structurally equal to the pre-mutation values.
    expect(detailCache(queryClient)).toEqual(AGENT_A);
    expect(listCache(queryClient)?.data).toEqual(AGENT_PAGE.data);
    expect(listCache(queryClient)?.meta).toEqual(AGENT_PAGE.meta);
    expect(result.current.error?.message).toBe('Update rejected');
  });

  it('reconciles the cache with server truth by refetching after a successful settle', async () => {
    const client = createClient();
    const { Wrapper } = createWrapper(client);

    // Mount observers for the detail and list keys so onSettled invalidation
    // triggers a real refetch.
    const { result } = renderHook(
      () => ({
        detail: useAgent(AGENT_A.id).data,
        list: useAgents({}).data,
      }),
      { wrapper: Wrapper },
    );

    // Wait for the initial server state to land.
    await waitFor(() => expect(result.current.detail?.id).toBe(AGENT_A.id));
    await waitFor(() => expect(result.current.list?.data).toHaveLength(2));

    // Hold the update in flight.
    let resolveUpdate!: (agent: Agent) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    client.agents.update.mockResolvedValue(UPDATED_AGENT);
    client.agents.get.mockResolvedValue(UPDATED_AGENT);
    client.agents.list.mockResolvedValue(UPDATED_PAGE);

    const { result: mutation } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });
    mutation.current.mutate({ id: AGENT_A.id, params: { name: 'Optimistic Name' } });

    // Optimistic state is visible while the request is pending…
    await waitFor(() => expect(result.current.detail?.name).toBe('Optimistic Name'));

    // …then the server responds with the authoritative entity.
    resolveUpdate(UPDATED_AGENT);

    // The settled invalidation refetches both keys; the cache must converge to
    // server truth, not retain the optimistic value.
    await waitFor(() => expect(result.current.detail?.name).toBe('Server Truth'));
    await waitFor(() => expect(result.current.list?.data[0]?.name).toBe('Server Truth'));
    expect(client.agents.get).toHaveBeenCalledTimes(2);
    expect(client.agents.list).toHaveBeenCalledTimes(2);
  });

  it('an in-flight refetch resolving after the optimistic write cannot clobber it (cancelQueries race)', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    // The first `agents.get` (the observer's initial fetch) is held open —
    // simulating a refetch that would resolve *after* the optimistic write.
    const pendingGet = deferred<Agent>();
    client.agents.get.mockImplementationOnce(() => pendingGet.promise);
    // Subsequent gets (post-settle refetch) return server truth.
    client.agents.get.mockResolvedValue(UPDATED_AGENT);

    renderHook(() => useAgent(AGENT_A.id), { wrapper: Wrapper });
    await waitFor(() => expect(client.agents.get).toHaveBeenCalledTimes(1));

    let resolveUpdate!: (agent: Agent) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });
    result.current.mutate({ id: AGENT_A.id, params: { name: 'Optimistic Name' } });

    // onMutate awaits cancelQueries, cancelling the in-flight get before the
    // optimistic write lands.
    await waitFor(() => expect(detailCache(queryClient)?.name).toBe('Optimistic Name'));

    // The stale response arrives late — after the optimistic write.
    pendingGet.resolve(STALE_AGENT);
    await waitFor(() => expect(result.current.isPending).toBe(true));

    // The optimistic value survived the late-arriving response.
    expect(detailCache(queryClient)?.name).toBe('Optimistic Name');
    expect(listCache(queryClient)?.data[0]?.name).toBe('Optimistic Name');

    // Settle the mutation; the post-settle refetch delivers server truth.
    resolveUpdate(UPDATED_AGENT);
    await waitFor(() => expect(detailCache(queryClient)?.name).toBe('Server Truth'));
  });
});

/* -------------------------------------------------------------------------- */
/* useUpdateAgentStatus                                                        */
/* -------------------------------------------------------------------------- */

describe('useUpdateAgentStatus — optimistic updates', () => {
  it('flips the status optimistically in the detail and list caches before the request resolves', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let resolveStatus!: (agent: Agent) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveStatus = resolve;
      }),
    );

    const { result } = renderHook(() => useUpdateAgentStatus(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, status: 'PAUSED' });

    await waitFor(() => expect(detailCache(queryClient)?.status).toBe('PAUSED'));
    expect(listCache(queryClient)?.data[0]?.status).toBe('PAUSED');
    // Only the status (and updatedAt) changed — every other field is intact.
    expect(detailCache(queryClient)?.name).toBe(AGENT_A.name);
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, { status: 'PAUSED' });

    resolveStatus(UPDATED_AGENT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back the status change on error and invalidates the agent keys on settle', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let rejectStatus!: (err: Error) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectStatus = reject;
      }),
    );

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateAgentStatus(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, status: 'PAUSED' });
    await waitFor(() => expect(detailCache(queryClient)?.status).toBe('PAUSED'));

    rejectStatus(new Error('Status transition rejected'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Exact rollback to the pre-mutation status.
    expect(detailCache(queryClient)?.status).toBe('ACTIVE');
    expect(listCache(queryClient)?.data[0]?.status).toBe('ACTIVE');

    // onSettled invalidated the specific detail key, the list key, and the
    // whole agents domain.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.agents.detail(AGENT_A.id) }),
      ),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.agents.list() }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.agents.all }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* useUpdateAgentMetadata                                                      */
/* -------------------------------------------------------------------------- */

describe('useUpdateAgentMetadata — optimistic updates', () => {
  it('optimistically merges metadata into the detail and list caches, preserving keys that were not sent', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let resolveMetadata!: (agent: Agent) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveMetadata = resolve;
      }),
    );

    const { result } = renderHook(() => useUpdateAgentMetadata(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, metadata: { team: 'platform', costCenter: 'cc-42' } });

    // Merged optimistically: new + updated keys present, unsent keys intact.
    await waitFor(() =>
      expect(detailCache(queryClient)?.metadata).toEqual({
        team: 'platform',
        costCenter: 'cc-42',
      }),
    );
    expect(listCache(queryClient)?.data[0]?.metadata).toEqual({
      team: 'platform',
      costCenter: 'cc-42',
    });
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, {
      metadata: { team: 'platform', costCenter: 'cc-42' },
    });

    resolveMetadata(UPDATED_AGENT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back to the exact pre-mutation metadata on error', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.detail(AGENT_A.id), AGENT_A);
    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let rejectMetadata!: (err: Error) => void;
    client.agents.update.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectMetadata = reject;
      }),
    );

    const { result } = renderHook(() => useUpdateAgentMetadata(), { wrapper: Wrapper });

    result.current.mutate({ id: AGENT_A.id, metadata: { team: 'platform' } });
    await waitFor(() => expect(detailCache(queryClient)?.metadata).toEqual({ team: 'platform' }));

    rejectMetadata(new Error('Metadata rejected'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Exact pre-mutation metadata, in both the detail and list caches.
    expect(detailCache(queryClient)?.metadata).toEqual(AGENT_A.metadata);
    expect(listCache(queryClient)?.data[0]?.metadata).toEqual(AGENT_A.metadata);
  });
});

/* -------------------------------------------------------------------------- */
/* useDeleteAgent                                                              */
/* -------------------------------------------------------------------------- */

describe('useDeleteAgent — optimistic updates', () => {
  it('removes the agent from the list cache optimistically and rolls back on error', async () => {
    const client = createClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });

    queryClient.setQueryData(queryKeys.agents.list({}), AGENT_PAGE);

    let rejectDelete!: (err: Error) => void;
    client.agents.delete.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate(AGENT_A.id);

    // The agent disappears from every cached list immediately.
    await waitFor(() => expect(listCache(queryClient)?.data).toHaveLength(1));
    expect(listCache(queryClient)?.data[0]?.id).toBe(AGENT_B.id);

    rejectDelete(new Error('Delete rejected'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Exact rollback — the agent is back in its original position.
    expect(listCache(queryClient)?.data).toEqual(AGENT_PAGE.data);
  });
});
