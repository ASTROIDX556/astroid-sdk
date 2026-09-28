/**
 * Tests for the options-aware budget hooks (issue #74):
 * `useBudget` and `useBudgetUtilization` in `hooks/use-budget.ts`.
 *
 * Covers successful fetches, error states, the `enabled` / `refetchInterval` /
 * `staleTime` options, query-key usage and cache invalidation.
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  invalidateQueries,
  queryKeys,
  useBudget,
  useBudgetUtilization,
} from '../index.js';
import type { Budget, BudgetUtilization } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures & harness                                                          */
/* -------------------------------------------------------------------------- */

const BUDGET: Budget = {
  id: 'bud_42',
  organizationId: 'org_1',
  parentBudgetId: null,
  agentId: null,
  name: 'Agent Ops',
  currency: 'USDC',
  limitAmount: '5000.00',
  spent: '1250.00',
  remaining: '3750.00',
  period: 'MONTHLY',
  periodStart: '2026-09-01T00:00:00.000Z',
  rollover: false,
  enabled: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
};

const UTILIZATION: BudgetUtilization = {
  budgetId: 'bud_42',
  period: 'MONTHLY',
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  limit: '5000.00',
  spent: '1250.00',
  remaining: '3750.00',
  utilization: 0.25,
  percent: 25,
  state: 'healthy',
};

function makeClient() {
  return new Astroid({ apiKey: 'sk_test_use_budget', baseUrl: 'https://api.test' });
}

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid; queryClient?: QueryClient } = {},
): { unmount: () => void; queryClient: QueryClient } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? makeClient();
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AstroidProvider, { client, children }),
      ),
    );
  });

  return {
    queryClient,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* useBudget                                                                   */
/* -------------------------------------------------------------------------- */

describe('useBudget', () => {
  it('fetches a budget by id through the budgets resource', async () => {
    const client = makeClient();
    const getSpy = vi.spyOn(client.budgets, 'get').mockResolvedValue(BUDGET);

    let data: Budget | undefined;
    let isLoading = true;
    function TestComponent() {
      const result = useBudget('bud_42');
      data = result.data;
      isLoading = result.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(data?.id).toBe('bud_42'));
    await waitFor(() => expect(isLoading).toBe(false));
    expect(getSpy).toHaveBeenCalledWith('bud_42');
    expect(data?.name).toBe('Agent Ops');
    unmount();
  });

  it('surfaces error states from a failing fetch', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'get').mockRejectedValue(new Error('budget not found'));

    let error: Error | null = null;
    let isError = false;
    function TestComponent() {
      const result = useBudget('bud_missing');
      error = result.error;
      isError = result.isError;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(isError).toBe(true));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error | null)?.message).toBe('budget not found');
    unmount();
  });

  it('does not fetch when id is undefined', () => {
    const client = makeClient();
    const getSpy = vi.spyOn(client.budgets, 'get');

    function TestComponent() {
      useBudget(undefined);
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });
    expect(getSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('honours enabled: false and skips the fetch', () => {
    const client = makeClient();
    const getSpy = vi.spyOn(client.budgets, 'get');

    let isIdle = true;
    function TestComponent() {
      const result = useBudget('bud_42', { enabled: false });
      isIdle = result.fetchStatus === 'idle';
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });
    expect(getSpy).not.toHaveBeenCalled();
    expect(isIdle).toBe(true);
    unmount();
  });

  it('applies staleTime to the query options', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'get').mockResolvedValue(BUDGET);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function TestComponent() {
      useBudget('bud_42', { staleTime: 60_000 });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.detail('bud_42'))).toBeDefined(),
    );
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.budgets.detail('bud_42') });
    expect((query?.options as { staleTime?: number }).staleTime).toBe(60_000);
    unmount();
  });

  it('sets a numeric refetchInterval for live polling', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'get').mockResolvedValue(BUDGET);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function TestComponent() {
      useBudget('bud_42', { refetchInterval: 15_000 });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.detail('bud_42'))).toBeDefined(),
    );
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.budgets.detail('bud_42') });
    expect((query?.options as { refetchInterval?: number | false }).refetchInterval).toBe(15_000);
    unmount();
  });

  it('caches under the shared budgets detail key', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'get').mockResolvedValue(BUDGET);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function TestComponent() {
      useBudget('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.detail('bud_42'))).toEqual(BUDGET),
    );
    unmount();
  });

  it('is invalidated by budget-domain invalidation helpers', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'get').mockResolvedValue(BUDGET);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function TestComponent() {
      useBudget('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.detail('bud_42'))).toEqual(BUDGET),
    );
    // Without an active observer the invalidation mark is not immediately
    // cleared by a refetch, so unmount before invalidating.
    unmount();
    await act(async () => {
      await invalidateQueries.all(queryClient, 'budgets');
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.all });
    expect(queryClient.getQueryState(queryKeys.budgets.detail('bud_42'))?.isInvalidated).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* useBudgetUtilization                                                        */
/* -------------------------------------------------------------------------- */

describe('useBudgetUtilization', () => {
  it('fetches the utilization snapshot for a budget', async () => {
    const client = makeClient();
    const utilSpy = vi.spyOn(client.budgets, 'utilization').mockResolvedValue(UTILIZATION);

    let data: BudgetUtilization | undefined;
    function TestComponent() {
      data = useBudgetUtilization('bud_42').data;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(data?.percent).toBe(25));
    expect(utilSpy).toHaveBeenCalledWith('bud_42');
    expect(data?.state).toBe('healthy');
    unmount();
  });

  it('surfaces error states from a failing fetch', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockRejectedValue(new Error('boom'));

    let error: Error | null = null;
    function TestComponent() {
      error = useBudgetUtilization('bud_42').error;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(error?.message).toBe('boom'));
    unmount();
  });

  it('is disabled until an id is provided', () => {
    const client = makeClient();
    const utilSpy = vi.spyOn(client.budgets, 'utilization');

    let isIdle = false;
    function TestComponent() {
      const result = useBudgetUtilization(undefined);
      isIdle = result.fetchStatus === 'idle';
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });
    expect(isIdle).toBe(true);
    expect(utilSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('supports polling through refetchInterval', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(UTILIZATION);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function TestComponent() {
      useBudgetUtilization('bud_42', { refetchInterval: 5_000 });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.utilization('bud_42'))).toBeDefined(),
    );
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.budgets.utilization('bud_42') });
    expect((query?.options as { refetchInterval?: number | false }).refetchInterval).toBe(5_000);
    unmount();
  });

  it('caches under the budgets utilization key', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(UTILIZATION);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function TestComponent() {
      useBudgetUtilization('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), {
      client,
      queryClient,
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.budgets.utilization('bud_42'))).toEqual(
        UTILIZATION,
      ),
    );
    unmount();
  });

  it('exposes the loading state until the utilization resolves, then the data', async () => {
    const client = makeClient();
    let resolveUtilization!: (value: BudgetUtilization) => void;
    const pending = new Promise<BudgetUtilization>((resolve) => {
      resolveUtilization = resolve;
    });
    vi.spyOn(client.budgets, 'utilization').mockReturnValue(pending);

    let isLoading = false;
    let data: BudgetUtilization | undefined;
    function TestComponent() {
      const result = useBudgetUtilization('bud_42');
      isLoading = result.isLoading;
      data = result.data;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(isLoading).toBe(true));
    expect(data).toBeUndefined();

    await act(async () => {
      resolveUtilization(UTILIZATION);
    });

    await waitFor(() => expect(data?.percent).toBe(25));
    expect(isLoading).toBe(false);
    expect(data?.state).toBe('healthy');
    unmount();
  });
});
