import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type {
  CreateTransactionInput,
  Paginated,
  Transaction,
  TransactionListParams,
} from '@astroid/types';

/**
 * Fetch a paginated transaction history.
 *
 * @param params Optional status/asset/wallet/agent filters and pagination.
 */
export function useTransactions(
  params?: TransactionListParams,
): UseQueryResult<Paginated<Transaction>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.transactions.list(params),
    queryFn: () => astroid.transactions.list(params),
  });
}

/**
 * Fetch a single transaction by id. Disabled until a non-empty id is provided.
 */
export function useTransaction(id: string | undefined): UseQueryResult<Transaction, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? ''),
    queryFn: () => astroid.transactions.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Create a transaction envelope. Invalidates the transaction domain on success.
 */
export function useCreateTransaction(): UseMutationResult<
  Transaction,
  Error,
  CreateTransactionInput
> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) => astroid.transactions.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
    },
  });
}
