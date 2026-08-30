import { useContext, useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Astroid } from '@astroid/client';
import { AstroidClientContext } from './provider.js';

// ─── Client hook ───────────────────────────────────────────────────────────

/** Return the active Astroid client from the nearest provider. */
export function useAstroidClient(): Astroid {
  const client = useContext(AstroidClientContext);
  if (!client) {
    throw new Error(
      'useAstroidClient must be used within an <AstroidProvider>. Wrap your component tree with <AstroidProvider client={client}>.',
    );
  }
  return client;
}

/** Backwards-compatible alias for the client hook. */
export const useAstroid = useAstroidClient;

// ─── Query-key factories ───────────────────────────────────────────────────

/** Stable query-key helpers so consumers never hard-code arrays. */
export const queryKeys = {
  agents: {
    all: ['agents'] as const,
    detail: (id: string) => ['agents', id] as const,
  },
  wallets: {
    all: ['wallets'] as const,
    detail: (id: string) => ['wallets', id] as const,
  },
  policies: {
    all: ['policies'] as const,
    detail: (id: string) => ['policies', id] as const,
  },
  budgets: {
    all: ['budgets'] as const,
    detail: (agentId: string) => ['budgets', agentId] as const,
  },
} as const;

// ─── Invalidation hooks ────────────────────────────────────────────────────

/**
 * Return a stable `invalidate` callback that refetches the given query keys.
 * Designed to be called in mutation `onSuccess` handlers.
 *
 * ```ts
 * const invalidateAgents = useInvalidateAgents();
 * // …on success:
 * invalidateAgents();
 * ```
 */
function useInvalidateQueries(keys: QueryKey) {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: keys }), [queryClient, keys]);
}

/** Invalidate all agent-related queries. */
export function useInvalidateAgents() {
  return useInvalidateQueries(queryKeys.agents.all);
}

/** Invalidate all wallet-related queries. */
export function useInvalidateWallets() {
  return useInvalidateQueries(queryKeys.wallets.all);
}

/** Invalidate all policy-related queries. */
export function useInvalidatePolicies() {
  return useInvalidateQueries(queryKeys.policies.all);
}

/** Invalidate budget queries for a specific agent. */
export function useInvalidateBudgets(agentId?: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (agentId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.detail(agentId) });
    } else {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    }
  }, [queryClient, agentId]);
}
