content = """import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCreateAgent, useUpdateAgent, useDeleteAgent } from '../hooks/useAgents.js';
import { createMockClient, createWrapper, AGENT_A, CREATE_PARAMS } from './test-utils.js';
import type { UpdateAgentParams } from '@astroid/types';

describe('useCreateAgent', () => {
  it('calls agents.create with the correct params', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    result.current.mutate(CREATE_PARAMS);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.create).toHaveBeenCalledWith(CREATE_PARAMS);
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
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
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    const updateParams: UpdateAgentParams = { name: 'Renamed Agent' };
    result.current.mutate({ id: AGENT_A.id, params: updateParams });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.update).toHaveBeenCalledWith(AGENT_A.id, updateParams);
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
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

describe('useDeleteAgent', () => {
  it('calls agents.delete with the correct id', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    result.current.mutate('agent_to_delete');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.agents.delete).toHaveBeenCalledWith('agent_to_delete');
  });

  it('invalidates agent queries on success', async () => {
    const client = createMockClient();
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
"""

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)

