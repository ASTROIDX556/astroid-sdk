/**
 * React mutation hook for budget creation in `@astroid/react`.
 *
 * Wraps `@astroid/budget` create method via TanStack Query so UI applications
 * can create budgets, track mutation state, display errors, and automatically
 * invalidate relevant budget query caches upon success.
 *
 * @module
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { Budget, CreateBudgetInput } from '@astroid/types';

/** TypeScript alias for budget creation mutation variables. */
export type CreateBudgetVariables = CreateBudgetInput;

/** TypeScript alias for budget creation response entity. */
export type CreateBudgetResponse = Budget;

/**
 * Options accepted by {@link useCreateBudget}.
 */
export interface UseCreateBudgetOptions
  extends Omit<UseMutationOptions<Budget, Error, CreateBudgetInput>, 'mutationFn'> {
  /**
   * Whether to invalidate only budget list queries rather than all budget queries.
   * Default: false (invalidates all queries under the budget domain).
   */
  invalidateListsOnly?: boolean;
}

/**
 * Result returned by {@link useCreateBudget}.
 */
export type UseCreateBudgetResult = UseMutationResult<Budget, Error, CreateBudgetInput>;

/**
 * Hook to create a new agent or organization budget using TanStack Query.
 *
 * Upon successful creation, cached budget list queries are automatically
 * invalidated to trigger responsive UI re-renders without manual refetches.
 *
 * @param options Optional TanStack Query mutation options (callbacks, context, etc.).
 * @returns TanStack Query mutation result with `mutate`, `mutateAsync`, `isPending`, `error`, etc.
 *
 * @example
 * ```tsx
 * import { useCreateBudget } from '@astroid/react';
 *
 * function CreateBudgetForm() {
 *   const { mutate, isPending, error, isSuccess } = useCreateBudget({
 *     onSuccess: (budget) => {
 *       console.log('Created budget:', budget.id);
 *     },
 *   });
 *
 *   const handleSubmit = (data) => {
 *     mutate({
 *       name: 'Operations Budget',
 *       currency: 'USDC',
 *       limitAmount: '5000.00',
 *       period: 'MONTHLY',
 *     });
 *   };
 *
 *   return (
 *     <button onClick={handleSubmit} disabled={isPending}>
 *       {isPending ? 'Creating...' : 'Create Budget'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useCreateBudget(options?: UseCreateBudgetOptions): UseCreateBudgetResult {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: (input: CreateBudgetInput) => astroid.budgets.create(input),
    onSuccess: async (data, variables, context) => {
      if (options?.invalidateListsOnly) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.budgets.list() });
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      }
      if (options?.onSuccess) {
        await options.onSuccess(data, variables, context);
      }
    },
  });
}
