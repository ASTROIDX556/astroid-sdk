import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { BudgetListParams } from '@astroid/client';
import type { Budget, CreateBudgetInput, Paginated } from '@astroid/types';

// `useBudget` / `useBudgetUtilization` live in their own module (issue #74);
// re-exported here so the long-standing `use-budgets.ts` import path keeps
// working for existing consumers.
export { useBudget, useBudgetUtilization, type UseBudgetQueryOptions } from './use-budget.js';

/**
 * Fetch a paginated list of budgets.
 *
 * Backed by `budgets.list` and cached under the shared `queryKeys.budgets.list`
 * key so mutations that invalidate the budget domain automatically refresh it.
 *
 * @param params Optional pagination, period, scope, and sort filters.
 * @returns A TanStack Query result with `data` (a {@link Paginated} of
 *   {@link Budget}), `isLoading`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useBudgets({ limit: 25, period: 'MONTHLY' });
 * if (isLoading) return <p>Loading…</p>;
 * return <ul>{data?.data.map((b) => <li key={b.id}>{b.name}: {b.spent}/{b.limitAmount}</li>)}</ul>;
 * ```
 */
export function useBudgets(params?: BudgetListParams): UseQueryResult<Paginated<Budget>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.budgets.list(params),
    queryFn: () => astroid.budgets.list(params),
  });
}

/**
 * Mutation hook to create a budget.
 *
 * On success every cached budget list is invalidated so the new budget appears
 * without a manual refetch.
 *
 * @returns A TanStack Query mutation with `mutate(input)`, `isPending`, `error`,
 *   etc.
 *
 * @example
 * ```tsx
 * const createBudget = useCreateBudget();
 * createBudget.mutate({ name: 'Marketing', limitAmount: '1000', period: 'MONTHLY' });
 * ```
 */
export function useCreateBudget(): UseMutationResult<Budget, Error, CreateBudgetInput> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBudgetInput) => astroid.budgets.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    },
  });
}
