import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCreateAgent, useUpdateAgent, useArchiveAgent, useDeleteAgent } from '../hooks/useAgents.js';
import { useAgentMutations } from '../hooks/useAgentMutations.js';
import { queryKeys } from '../hooks.js';
import { createMockClient, createWrapper, AGENT_A, AGENT_PAGE } from './test-utils.js';
import type { Agent, CreateAgentParams, Paginated } from '@astroid/types';
const CREATE_PARAMS: CreateAgentParams = { name: 'New Agent', capabilities: [], initialBudget: { currency: 'USD', amount: '100.00' } };
import type { UpdateAgentParams } from '@astroid/types';

describe('useCreateAgent', () => {
  it('calls agents.create with the correct params', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => { if (result.current.isError) console.error(result.current.error); expect(result.current.isSuccess).toBe(true); });
    expect(client.agents.create).toHaveBeenCalledWith(CREATE_PARAMS);
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });
    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

describe('useUpdateAgent', () => {
  it('calls agents.update with the correct id and params', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    const updateParams: UpdateAgentParams = { name: 'Renamed Agent' };
    result.current.mutate({ id: AGENT_A.id, params: updateParams });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, updateParams);
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });
    result.current.mutate({ id: AGENT_A.id, params: { name: 'Updated' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

describe('useArchiveAgent', () => {
  it('calls agents.deactivate with the correct id', async () => {
    const client = createMockClient();
    const archivedAgent = { ...AGENT_A, status: 'ARCHIVED' as const };
    client.agents.deactivate = vi.fn(async () => archivedAgent);
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useArchiveAgent(), { wrapper: Wrapper });

    result.current.mutate(AGENT_A.id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.deactivate).toHaveBeenCalledWith(AGENT_A.id);
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
    const archivedAgent = { ...AGENT_A, status: 'ARCHIVED' as const };
    client.agents.deactivate = vi.fn(async () => archivedAgent);
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useArchiveAgent(), { wrapper: Wrapper });
    result.current.mutate(AGENT_A.id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

describe('useDeleteAgent', () => {
  it('calls agents.delete with the correct id', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate('agent_to_delete');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.delete).toHaveBeenCalledWith('agent_to_delete');
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
    client.agents.update = vi.fn(async () => AGENT_A);
    client.agents.delete = vi.fn(async () => undefined);
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });
    result.current.mutate(AGENT_A.id);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* useAgentMutations — combined create/update/delete hook (issue #545)        */
/* -------------------------------------------------------------------------- */

describe('useAgentMutations', () => {
  it('create: calls agents.create with the correct params and invalidates agent queries', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.create.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    expect(client.agents.create).toHaveBeenCalledWith(CREATE_PARAMS);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('create: optimistically prepends the agent to the cached lists', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });
    queryClient.setQueryData<Paginated<Agent>>(queryKeys.agents.list(), AGENT_PAGE);

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.create.mutate(CREATE_PARAMS);

    await waitFor(() => {
      const data = queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list());
      expect(data?.data[0]?.name).toBe(CREATE_PARAMS.name);
    });
  });

  it('create: rolls back the optimistic entry after a network failure', async () => {
    const client = createMockClient();
    client.agents.create = vi.fn(async () => {
      throw new Error('network down');
    });
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });
    queryClient.setQueryData<Paginated<Agent>>(queryKeys.agents.list(), AGENT_PAGE);

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.create.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.create.isError).toBe(true));
    expect(result.current.create.error?.message).toBe('network down');
    expect(queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list())).toEqual(AGENT_PAGE);
  });

  it('update: calls agents.update with id and params and invalidates agent queries', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    const updateParams: UpdateAgentParams = { name: 'Renamed Agent' };
    result.current.update.mutate({ id: AGENT_A.id, params: updateParams });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, updateParams);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('update: optimistically patches detail + list and rolls back after a network failure', async () => {
    const client = createMockClient();
    let rejectMutation!: (err: Error) => void;
    client.agents.update = vi.fn(
      () => new Promise<Agent>((_resolve, reject) => { rejectMutation = reject; }),
    );
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });
    const detailKey = queryKeys.agents.detail(AGENT_A.id);
    queryClient.setQueryData<Agent>(detailKey, AGENT_A);
    queryClient.setQueryData<Paginated<Agent>>(queryKeys.agents.list(), AGENT_PAGE);

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.update.mutate({ id: AGENT_A.id, params: { name: 'Patched' } });

    // Optimistic write is visible while the mutation is in flight.
    await waitFor(() => expect(queryClient.getQueryData<Agent>(detailKey)?.name).toBe('Patched'));

    // Now fail the mutation: the optimistic changes are rolled back.
    rejectMutation(new Error('network down'));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error?.message).toBe('network down');
    await waitFor(() => expect(queryClient.getQueryData<Agent>(detailKey)).toEqual(AGENT_A));
    expect(
      queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list())?.data[0]?.name,
    ).toBe(AGENT_A.name);
  });

  it('delete: calls agents.delete with the id and invalidates agent queries', async () => {
    const client = createMockClient();
    const { queryClient, Wrapper } = createWrapper(client);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.delete.mutate(AGENT_A.id);

    await waitFor(() => expect(result.current.delete.isSuccess).toBe(true));
    expect(client.agents.delete).toHaveBeenCalledWith(AGENT_A.id);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['astroid', 'agents']),
      }),
    );
  });

  it('delete: optimistically removes the agent from lists and rolls back after a network failure', async () => {
    const client = createMockClient();
    let rejectMutation!: (err: Error) => void;
    client.agents.delete = vi.fn(
      () => new Promise<void>((_resolve, reject) => { rejectMutation = reject; }),
    );
    const { queryClient, Wrapper } = createWrapper(client, { gcTime: Infinity });
    queryClient.setQueryData<Paginated<Agent>>(queryKeys.agents.list(), AGENT_PAGE);

    const { result } = renderHook(() => useAgentMutations(), { wrapper: Wrapper });
    result.current.delete.mutate(AGENT_A.id);

    // Optimistic removal is visible while the mutation is in flight.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list())?.data,
      ).toHaveLength(1),
    );

    // Now fail the mutation: the optimistic removal is rolled back.
    rejectMutation(new Error('network down'));
    await waitFor(() => expect(result.current.delete.isError).toBe(true));
    await waitFor(() =>
      expect(queryClient.getQueryData<Paginated<Agent>>(queryKeys.agents.list())?.data).toHaveLength(2),
    );
  });
});
