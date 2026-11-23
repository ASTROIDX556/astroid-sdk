/**
 * @astroid/react — useAgentTransaction hook.
 *
 * A TanStack Query mutation hook for building and submitting agent transactions.
 * Integrates with the {@link AstroidProvider} client context, uses
 * {@astroid/transaction} for transaction construction, and
 * {@astroid/client} for submission.
 *
 * @module
 */

import { useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AstroidClientContext } from '../provider.js';
import type { CreateTransactionInput } from '@astroid/types';

/**
 * Mutation variables for the {@link useAgentTransaction} hook.
 * Matches the {@link @astroid/types CreateTransactionInput} shape.
 */
export interface UseAgentTransactionVariables {
  /** Wallet id the transaction is scoped to. */
  walletId: string;
  /** Asset identifier (e.g. `XLM`, `USDC`, `USDC:G...Issuer`). */
  asset: string;
  /** Amount to transfer (decimal string or number). */
  amount: string | number;
  /** Destination Stellar account (`G...`). */
  recipientAddress: string;
  /** Optional agent id the transaction is scoped to. */
  agentId?: string;
  /** Optional policy id the transaction is being simulated against. */
  policyId?: string;
  /** Optional budget id the transaction is being evaluated against. */
  budgetId?: string;
  /** Optional memo text/ hash/ return/ id. */
  memo?: string;
  /** Optional purpose string for the transaction. */
  purpose?: string;
  /** Optional idempotency key for deduplication. */
  idempotencyKey?: string;
}

/**
 * Result returned by the {@link useAgentTransaction} hook.
 */
export interface UseAgentTransactionResult {
  /** Whether the mutation is currently pending. */
  isLoading: boolean;
  /** Whether the mutation completed successfully. */
  isSuccess: boolean;
  /** The most recent error, if any. */
  error: Error | null;
  /** The transaction hash (stellarHash) returned by the backend, if successful. */
  transactionHash: string | null;
  /** Mutate function to trigger the transaction submission. */
  mutate: (
    variables: UseAgentTransactionVariables,
    options?: {
      onSuccess?: (hash: string) => void;
      onError?: (error: Error) => void;
    },
  ) => Promise<void>;
}

/**
 * Executes a transaction build-and-submit mutation.
 *
 * - Builds a transaction envelope via the Astroid backend (`/transactions`)
 * - Returns the transaction hash (`stellarHash`) on success
 * - Invalidates transaction queries on success
 * - Exposes `isLoading`, `isSuccess`, `error`, and `transactionHash` state
 *
 * Must be used within an {@link AstroidProvider}.
 *
 * @example
 * ```tsx
 * const {
 *   isLoading,
 *   isSuccess,
 *   error,
 *   transactionHash,
 *   mutate,
 * } = useAgentTransaction();
 *
 * if (isLoading) return <div>Submitting...</div>;
 * if (isSuccess) return <div>Tx submitted: {transactionHash}</div>;
 *
 * return (
 *   <button onClick={() =>
 *     mutate({
 *       walletId: 'wal_1',
 *       asset: 'USDC',
 *       amount: '100',
 *       recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
 *     })}
 *   >
 *     Submit
 *   </button>
 * );
 * ```
 */
export function useAgentTransaction(): UseAgentTransactionResult {
  const client = useContext(AstroidClientContext);

  if (!client) {
    throw new Error(
      'useAgentTransaction must be used within an <AstroidProvider client={client}>.',
    );
  }

  const queryClient = useQueryClient();

  const mutation = useMutation<string, Error, UseAgentTransactionVariables, string>({
    mutationFn: async (variables: UseAgentTransactionVariables) => {
      // Submit the transaction via the Astroid client.
      // The CreateTransactionInput shape is compatible with the backend `/transactions` endpoint.
      const res = await client.transactions.create(
        variables as unknown as CreateTransactionInput,
      );

      // The backend returns a Transaction; stellarHash is the transaction hash.
      const _hash = res.stellarHash ?? res.id;

      if (!_hash) {
        throw new Error('Transaction submission did not return a hash.');
      }

      return _hash;
    },
    onSuccess: (_hash: string) => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  return {
    isLoading: (mutation as any).isLoading,
    isSuccess: (mutation as any).isSuccess,
    error: (mutation as any).error ?? null,
    transactionHash: (mutation as any).data ?? null,
    mutate: (mutation as any).mutate,
  } as UseAgentTransactionResult;
}