import { describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  queryKeys,
  usePolicies,
  usePolicy,
  useCreatePolicy,
  useUpdatePolicy,
  useTransactions,
  useTransaction,
  useCreateTransaction,
} from '../index.js';
import type { Paginated, Policy, Transaction } from '@astroid/types';

const POLICY: Policy = {
  id: 'pol_1',
  organizationId: 'org_1',
  agentId: null,
  name: 'Cap',
  description: null,
  type: 'MAX_AMOUNT',
  configuration: { maxAmount: 100 },
  priority: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const TX = {
  id: 'tx_1',
  organizationId: 'org_1',
  walletId: 'wal_1',
  agentId: null,
  policyId: null,
  budgetId: null,
  asset: 'USDC',
  amount: '10.00',
  recipientAddress: 'GABC',
  status: 'PENDING',
  riskScore: 5,
  riskBand: 'LOW',
  requiresApproval: false,
  confirmationCount: 0,
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
} as unknown as Transaction;

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid; queryClient?: QueryClient } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
      act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

describe('usePolicies', () => {
  it('fetches the policy list and uses the policies list key', async () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const page: Paginated<Policy> = {
      data: [POLICY],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    };
    const listSpy = vi.spyOn(client.policies, 'list').mockResolvedValue(page);
    let result: Paginated<Policy> | undefined;
    function TestComponent() {
      result = usePolicies().data;
      return null;
    }
    const { unmount } = renderInProviders(createElement(TestComponent), { client });
    await waitFor(() => expect(result?.data[0]?.id).toBe('pol_1'));
    expect(listSpy).toHaveBeenCalled();
    expect(queryKeys.policies.list()).toEqual(['astroid', 'policies', 'list', {}]);
    unmount();
  });

  it('disables usePolicy when id is undefined', () => {
    let isFetching = true;
    function TestComponent() {
      isFetching = usePolicy(undefined).isFetching;
      return null;
    }
    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });

  it('create/update invalidate the policy domain', async () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    vi.spyOn(client.policies, 'create').mockResolvedValue(POLICY);
    vi.spyOn(client.policies, 'update').mockResolvedValue(POLICY);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    let create: ReturnType<typeof useCreatePolicy> | undefined;
    let update: ReturnType<typeof useUpdatePolicy> | undefined;
    function TestComponent() {
      create = useCreatePolicy();
      update = useUpdatePolicy();
      return null;
    }
    const { unmount } = renderInProviders(createElement(TestComponent), { client, queryClient });
    await act(async () => {
      await create!.mutateAsync({
        name: 'Cap',
        type: 'MAX_AMOUNT',
        configuration: { maxAmount: 100 },
        priority: 1,
        enabled: true,
      });
      await update!.mutateAsync({ id: 'pol_1', params: { priority: 2 } });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.policies.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.policies.detail('pol_1') });
    unmount();
  });
});

describe('useTransactions', () => {
  it('fetches transaction history and disables detail without id', async () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const page: Paginated<Transaction> = {
      data: [TX],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    };
    vi.spyOn(client.transactions, 'list').mockResolvedValue(page);
    let result: Paginated<Transaction> | undefined;
    let isFetching = true;
    function ListComponent() {
      result = useTransactions({ walletId: 'wal_1' }).data;
      return null;
    }
    function DetailComponent() {
      isFetching = useTransaction(undefined).isFetching;
      return null;
    }
    const r1 = renderInProviders(createElement(ListComponent), { client });
    await waitFor(() => expect(result?.data[0]?.id).toBe('tx_1'));
    r1.unmount();
    const r2 = renderInProviders(createElement(DetailComponent), { client });
    expect(isFetching).toBe(false);
    r2.unmount();
  });

  it('useCreateTransaction invalidates the transaction domain', async () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    vi.spyOn(client.transactions, 'create').mockResolvedValue(TX);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    let mutation: ReturnType<typeof useCreateTransaction> | undefined;
    function TestComponent() {
      mutation = useCreateTransaction();
      return null;
    }
    const { unmount } = renderInProviders(createElement(TestComponent), { client, queryClient });
    await act(async () => {
      await mutation!.mutateAsync({ walletId: 'wal_1', asset: 'USDC', amount: '10', recipientAddress: 'GABC' });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transactions.all });
    unmount();
  });
});
