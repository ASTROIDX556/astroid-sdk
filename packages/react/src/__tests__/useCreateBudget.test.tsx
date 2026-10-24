/**
 * Unit and hook tests for `useCreateBudget` in `@astroid/react` (issue #367).
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import { useCreateBudget } from '../hooks/useCreateBudget.js';
import { queryKeys } from '../hooks.js';
import type { Astroid } from '@astroid/client';
import type { Budget, CreateBudgetInput } from '@astroid/types';

const CREATED_BUDGET: Budget = {
  id: 'bud_new_123',
  organizationId: 'org_1',
  parentBudgetId: null,
  agentId: 'agt_alpha',
  name: 'Autonomous Operations',
  currency: 'USDC',
  limitAmount: '5000.00',
  spent: '0.00',
  remaining: '5000.00',
  period: 'MONTHLY',
  periodStart: '2026-10-01T00:00:00.000Z',
  rollover: true,
  enabled: true,
  createdAt: '2026-10-22T08:00:00.000Z',
  updatedAt: '2026-10-22T08:00:00.000Z',
  deletedAt: null,
};

const VALID_INPUT: CreateBudgetInput = {
  name: 'Autonomous Operations',
  limitAmount: '5000.00',
  period: 'MONTHLY',
};

function createMockClient(overrides: { createBudget?: Mock } = {}): Astroid {
  return {
    budgets: {
      create: overrides.createBudget ?? vi.fn(async () => CREATED_BUDGET),
      createBudget: overrides.createBudget ?? vi.fn(async () => CREATED_BUDGET),
    },
  } as unknown as Astroid;
}

function createWrapper(client: Astroid, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={client}>{children}</AstroidProvider>
      </QueryClientProvider>
    );
  };
}

describe('useCreateBudget — React mutation hook for budget creation (#367)', () => {
  it('exports mutation state, mutate and mutateAsync functions', () => {
    const client = createMockClient();
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useCreateBudget(), {
      wrapper: createWrapper(client, queryClient),
    });

    expect(typeof result.current.mutate).toBe('function');
    expect(typeof result.current.mutateAsync).toBe('function');
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('triggers budget creation and invalidates budget queries cache on success', async () => {
    const createMock = vi.fn(async () => CREATED_BUDGET);
    const client = createMockClient({ createBudget: createMock });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateBudget(), {
      wrapper: createWrapper(client, queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });

    expect(createMock).toHaveBeenCalledWith(VALID_INPUT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CREATED_BUDGET);

    // Verify cache invalidation
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.budgets.all,
    });
  });

  it('invalidates list queries specifically when invalidateListsOnly is enabled', async () => {
    const client = createMockClient();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateBudget({ invalidateListsOnly: true }), {
      wrapper: createWrapper(client, queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.budgets.list(),
    });
  });

  it('exposes error state and calls onError when mutation rejects', async () => {
    const expectedError = new Error('Budget limit exceeds allocated parent ceiling.');
    const createMock = vi.fn().mockRejectedValue(expectedError);
    const client = createMockClient({ createBudget: createMock });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const onErrorMock = vi.fn();

    const { result } = renderHook(
      () =>
        useCreateBudget({
          onError: onErrorMock,
        }),
      {
        wrapper: createWrapper(client, queryClient),
      },
    );

    await act(async () => {
      try {
        await result.current.mutateAsync(VALID_INPUT);
      } catch {
        // expected error in mutateAsync
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(expectedError);
    expect(onErrorMock).toHaveBeenCalledWith(expectedError, VALID_INPUT, undefined);
  });

  it('forwards custom onSuccess callback alongside automatic cache invalidation', async () => {
    const client = createMockClient();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const onSuccessMock = vi.fn();

    const { result } = renderHook(
      () =>
        useCreateBudget({
          onSuccess: onSuccessMock,
        }),
      {
        wrapper: createWrapper(client, queryClient),
      },
    );

    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.budgets.all,
    });
    expect(onSuccessMock).toHaveBeenCalledWith(CREATED_BUDGET, VALID_INPUT, undefined);
  });
});
