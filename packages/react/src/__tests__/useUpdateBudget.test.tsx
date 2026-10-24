import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AstroidProvider, queryKeys, useUpdateBudget } from '../index.js';
import type { Budget } from '@astroid/types';

const BUDGET: Budget = {
  id: 'bud_1',
  organizationId: 'org_1',
  parentBudgetId: null,
  agentId: null,
  name: 'Marketing',
  currency: 'USDC',
  limitAmount: '1000.00',
  spent: '400.00',
  remaining: '600.00',
  period: 'MONTHLY',
  periodStart: '2026-01-01T00:00:00.000Z',
  rollover: false,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function createWrapper(client: Astroid, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AstroidProvider, { client, children }),
    );
  };
}

describe('useUpdateBudget', () => {
  it('updates a budget and invalidates its detail, utilization, and list queries', async () => {
    const client = new Astroid({ apiKey: 'sk_test_budgets', baseUrl: 'https://api.test' });
    const updateSpy = vi.spyOn(client.budgets, 'update').mockResolvedValue(BUDGET);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateBudget(), {
      wrapper: createWrapper(client, queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'bud_1', params: { limitAmount: '2500' } });
    });

    expect(updateSpy).toHaveBeenCalledWith('bud_1', { limitAmount: '2500' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.detail('bud_1') });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.budgets.utilization('bud_1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.all });
  });
});
