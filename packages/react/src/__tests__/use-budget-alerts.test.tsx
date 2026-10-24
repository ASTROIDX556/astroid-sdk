import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBudgetAlerts } from '../hooks/useBudgetAlerts.js';
import { createMockClient, createWrapper } from './test-utils.js';
import type { BudgetAlert, Paginated } from '@astroid/types';

const MOCK_ALERT: BudgetAlert = {
  id: 'alt_123',
  budgetId: 'bud_123',
  organizationId: 'org_123',
  thresholdPercent: 80,
  channel: 'EMAIL',
  target: 'admin@example.com',
  status: 'ACTIVE',
  recurring: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const MOCK_PAGINATED_ALERTS: Paginated<BudgetAlert> = {
  data: [MOCK_ALERT],
  meta: {
    page: 1,
    limit: 25,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

describe('useBudgetAlerts', () => {
  it('fetches budget alerts for a given budgetId', async () => {
    const client = createMockClient();
    client.budgets.listAlerts = vi.fn(async () => MOCK_PAGINATED_ALERTS);

    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useBudgetAlerts('bud_123'), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_PAGINATED_ALERTS);
    expect(client.budgets.listAlerts).toHaveBeenCalledWith('bud_123', undefined);
  });

  it('passes list params through to budgets.listAlerts', async () => {
    const client = createMockClient();
    client.budgets.listAlerts = vi.fn(async () => MOCK_PAGINATED_ALERTS);

    const { Wrapper } = createWrapper(client);
    const params = { limit: 5, cursor: 'cur_1' };
    const { result } = renderHook(() => useBudgetAlerts('bud_123', params), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.budgets.listAlerts).toHaveBeenCalledWith('bud_123', params);
  });

  it('is disabled when budgetId is undefined or empty', () => {
    const client = createMockClient();
    client.budgets.listAlerts = vi.fn(async () => MOCK_PAGINATED_ALERTS);

    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useBudgetAlerts(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(client.budgets.listAlerts).not.toHaveBeenCalled();
  });

  it('is disabled when enabled: false option is passed', () => {
    const client = createMockClient();
    client.budgets.listAlerts = vi.fn(async () => MOCK_PAGINATED_ALERTS);

    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useBudgetAlerts('bud_123', undefined, { enabled: false }), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(client.budgets.listAlerts).not.toHaveBeenCalled();
  });

  it('handles query errors correctly', async () => {
    const client = createMockClient();
    const mockError = new Error('Failed to fetch budget alerts');
    client.budgets.listAlerts = vi.fn(async () => {
      throw mockError;
    });

    const { Wrapper } = createWrapper(client);
    const { result } = renderHook(() => useBudgetAlerts('bud_123'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
  });
});
