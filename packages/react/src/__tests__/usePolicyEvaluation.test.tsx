/**
 * Unit tests for `usePolicyEvaluation` hook (#444).
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import {
  usePolicyEvaluation,
  policyEvaluationKeys,
} from '../hooks/usePolicyEvaluation.js';
import type { Astroid } from '@astroid/client';
import type { Policy, PolicySimulationEvaluation, PolicySimulationInput } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const MOCK_POLICY: Policy = {
  id: 'pol_123',
  organizationId: 'org_1',
  agentId: null,
  name: 'Max Spend Limit',
  description: 'Caps transaction amounts at 500 USDC',
  type: 'MAX_AMOUNT',
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const MOCK_INPUT: PolicySimulationInput = {
  asset: 'USDC',
  amount: '150.00',
  recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
};

const MOCK_EVALUATION: PolicySimulationEvaluation = {
  policyId: 'pol_123',
  allowed: true,
  passed: true,
  violatedRules: [],
  riskScore: 0.1,
  risk: {
    score: 0.1,
    band: 'LOW',
    factors: [],
  },
  requiredApprovals: [],
  budgetImpact: [],
  explanation: 'Transaction complies with the policy.',
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function createMockClient(overrides: { get?: Mock; simulatePolicy?: Mock } = {}): Astroid {
  return {
    policies: {
      get: overrides.get ?? vi.fn(async () => MOCK_POLICY),
      simulatePolicy: overrides.simulatePolicy ?? vi.fn(async () => MOCK_EVALUATION),
    },
  } as unknown as Astroid;
}

function createWrapper(client: Astroid, options: { gcTime?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: options.gcTime ?? 0 } },
  });
  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }): ReactNode {
      return (
        <QueryClientProvider client={queryClient}>
          <AstroidProvider client={client}>{children}</AstroidProvider>
        </QueryClientProvider>
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('usePolicyEvaluation', () => {
  it('1 & 2. retrieves policy evaluation data and exposes correct data and query states', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => usePolicyEvaluation('pol_123'), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(MOCK_POLICY);
    expect(client.policies.get).toHaveBeenCalledWith('pol_123');

    // Also verify simulation evaluation when input is provided
    const { result: simResult } = renderHook(
      () => usePolicyEvaluation('pol_123', { input: MOCK_INPUT }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(simResult.current.isLoading).toBe(false);
    });

    expect(simResult.current.data).toEqual(MOCK_EVALUATION);
    expect(client.policies.simulatePolicy).toHaveBeenCalledWith('pol_123', MOCK_INPUT);
  });

  it('3. surfaces policy evaluation errors through the query result', async () => {
    const failureError = new Error('Policy evaluation service unavailable');
    const client = createMockClient({
      get: vi.fn().mockRejectedValue(failureError),
    });
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => usePolicyEvaluation('pol_123'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(failureError);
    expect(result.current.data).toBeUndefined();
  });

  it('4. uses distinct query keys for different policy IDs and inputs to prevent cached data sharing', () => {
    const key1 = policyEvaluationKeys.detail('pol_123');
    const key2 = policyEvaluationKeys.detail('pol_456');
    const keyWithInput = policyEvaluationKeys.detail('pol_123', MOCK_INPUT);

    expect(key1).toEqual(['astroid', 'policies', 'evaluation', 'pol_123', {}]);
    expect(key2).toEqual(['astroid', 'policies', 'evaluation', 'pol_456', {}]);
    expect(keyWithInput).toEqual(['astroid', 'policies', 'evaluation', 'pol_123', MOCK_INPUT]);

    expect(key1).not.toEqual(key2);
    expect(key1).not.toEqual(keyWithInput);
  });

  it('5. polling causes subsequent evaluation fetches at the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      const { Wrapper } = createWrapper(client);

      const { result } = renderHook(
        () => usePolicyEvaluation('pol_123', { refetchInterval: 5000 }),
        { wrapper: Wrapper },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect((client.policies.get as Mock).mock.calls.length).toBe(1);

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(result.current.data).toBeDefined();
      expect((client.policies.get as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('6. respects caller-provided staleTime', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result, unmount } = renderHook(
      () => usePolicyEvaluation('pol_123', { staleTime: 60000 }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect((client.policies.get as Mock).mock.calls.length).toBe(1);
    unmount();
  });

  it('7. respects polling interval options and disabled polling', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      const { Wrapper } = createWrapper(client);

      // Disabled polling (refetchInterval: false)
      renderHook(() => usePolicyEvaluation('pol_123', { refetchInterval: false }), {
        wrapper: Wrapper,
      });

      await vi.advanceTimersByTimeAsync(20000);
      expect((client.policies.get as Mock).mock.calls.length).toBe(1);

      // Polling via interval option shorthand
      renderHook(() => usePolicyEvaluation('pol_123', { interval: 3000 }), {
        wrapper: Wrapper,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000);
      expect((client.policies.get as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('8. setting enabled: false or missing policy ID prevents evaluation from running', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const disabledHook = renderHook(() => usePolicyEvaluation('pol_123', { enabled: false }), {
      wrapper: Wrapper,
    });
    const undefinedHook = renderHook(() => usePolicyEvaluation(undefined), {
      wrapper: Wrapper,
    });
    const emptyHook = renderHook(() => usePolicyEvaluation(''), {
      wrapper: Wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(disabledHook.result.current.isFetching).toBe(false);
    expect(undefinedHook.result.current.isFetching).toBe(false);
    expect(emptyHook.result.current.isFetching).toBe(false);
    expect(client.policies.get).not.toHaveBeenCalled();
  });

  it('9. refetching works through the returned query result', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => usePolicyEvaluation('pol_123'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const callsCount = (client.policies.get as Mock).mock.calls.length;

    await result.current.refetch();

    expect((client.policies.get as Mock).mock.calls.length).toBeGreaterThan(callsCount);
  });

  it('10. loading, pending, and fetching states are consistent', async () => {
    const client = createMockClient();
    const { Wrapper } = createWrapper(client);

    const { result } = renderHook(() => usePolicyEvaluation('pol_123'), { wrapper: Wrapper });

    // Initial state: loading & fetching & pending
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Resolved state
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(true);
  });
});
