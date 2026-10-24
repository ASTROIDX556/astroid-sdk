import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Astroid } from '@astroid/client';
import { useAgentBudget, agentBudgetKeys } from '../src/hooks/useAgentBudget.js';
import { useAgentBudget as useAgentBudgetExport } from '../src/index.js';
import { AstroidProvider } from '../src/provider.js';

/** A budget allocation shaped for the wire (only fields tests assert on). */
function budgetFixture(id: string, limitAmount: string, spent: string): object {
  return {
    id,
    name: `Budget ${id}`,
    limitAmount,
    spent,
    period: 'MONTHLY',
    enabled: true,
  };
}

/** Build a client whose transport routes `/budgets` lists to the handler. */
function createClient(handler: (url: string) => Promise<Response>): Astroid {
  return new Astroid({
    apiKey: 'test',
    fetch: handler as unknown as typeof fetch,
  });
}

/** Render the hook inside both required providers. */
function createWrapper(client: Astroid, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={client}>{children}</AstroidProvider>
      </QueryClientProvider>
    );
  };
}

function paginatedEnvelope(data: object[]): string {
  return JSON.stringify({ success: true, data });
}

describe('useAgentBudget (Issue #384)', () => {
  it('is exported as a callable function', () => {
    expect(typeof useAgentBudgetExport).toBe('function');
  });

  it('fetches the budgets allocated to the agent', async () => {
    const requests: string[] = [];
    const client = createClient(async (url) => {
      requests.push(url);
      return new Response(paginatedEnvelope([budgetFixture('bud_1', '5000.00', '1250.50')]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useAgentBudget('agent_abc123'), {
      wrapper: createWrapper(client, queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('/budgets');
    expect(requests[0]).toContain('agentId=agent_abc123');

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.id).toBe('bud_1');
    expect(result.current.data?.data[0]?.limitAmount).toBe('5000.00');
    expect(result.current.data?.data[0]?.spent).toBe('1250.50');
  });

  it('does not fetch before an agent id is provided', async () => {
    const fetchHandler = vi.fn(async () =>
      new Response(paginatedEnvelope([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createClient(fetchHandler);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useAgentBudget(undefined), {
      wrapper: createWrapper(client, queryClient),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(fetchHandler).not.toHaveBeenCalled();
  });

  it('surfaces failed fetches through the error state', async () => {
    const client = createClient(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'Agent not found' },
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useAgentBudget('agent_missing'), {
      wrapper: createWrapper(client, queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Agent not found/i);
  });

  it('re-validates allocations on the configured refetch interval', async () => {
    let callCount = 0;
    const client = createClient(async () => {
      callCount += 1;
      return new Response(paginatedEnvelope([budgetFixture('bud_2', '1000.00', '10.00')]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => useAgentBudget('agent_abc123', { refetchInterval: 50 }),
      { wrapper: createWrapper(client, queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2), { timeout: 5_000 });

    if (!result.current.data) throw new Error('expected data to be loaded');
    const snapshot = result.current.data;
    expect(snapshot.data[0]?.spent).toBe('10.00');
  });

  it('honours staleTime and skips a refetch while data is fresh', async () => {
    let callCount = 0;
    const client = createClient(async () => {
      callCount += 1;
      return new Response(paginatedEnvelope([budgetFixture('bud_3', '250.00', '0.00')]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = createWrapper(client, queryClient);

    const mount = renderHook(() => useAgentBudget('agent_abc123', { staleTime: 60_000 }), {
      wrapper,
    });

    await waitFor(() => expect(mount.result.current.isSuccess).toBe(true));
    mount.unmount();

    const remount = renderHook(() => useAgentBudget('agent_abc123', { staleTime: 60_000 }), {
      wrapper,
    });

    await waitFor(() => expect(remount.result.current.isSuccess).toBe(true));
    expect(callCount).toBe(1);
  });

  it('produces stable query keys per agent', () => {
    expect(agentBudgetKeys.all('agent_abc123')).toEqual([
      'astroid',
      'agents',
      'budget',
      'agent_abc123',
    ]);
    expect(agentBudgetKeys.all('agent_abc123')).toEqual(agentBudgetKeys.all('agent_abc123'));
    expect(agentBudgetKeys.all('agent_x')).not.toEqual(agentBudgetKeys.all('agent_y'));
  });
});
