import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { Budget, UpdateBudgetInput } from '@astroid/types';

/** Variables for the `useUpdateBudget` mutation. */
export interface UpdateBudgetVariables {
  /** The budget to update. */
  id: string;
  /** The fields to patch. */
  params: UpdateBudgetInput;
}

/**
 * Mutation hook to update a budget's limit, period, rollover, or enabled state.
 *
 * On success the budget's detail and utilization queries, plus every cached
 * list, are invalidated so the UI converges on the authoritative state.
 *
 * @returns A TanStack Query mutation with `mutate({ id, params })`, `isPending`,
 *   `error`, etc.
 *
 * @example
 * ```tsx
 * const updateBudget = useUpdateBudget();
 * updateBudget.mutate({ id: 'bud_abc123', params: { limitAmount: '2500' } });
 * ```
 */
export function useUpdateBudget(): UseMutationResult<Budget, Error, UpdateBudgetVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: UpdateBudgetVariables) => astroid.budgets.update(id, params),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.utilization(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    },
  });
}
