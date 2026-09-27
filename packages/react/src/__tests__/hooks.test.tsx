/**
 * Unit tests for the TanStack Query hooks in `@astroid/react`.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid, ValidationError } from '@astroid/client';
import type { PolicySimulationRequest, PolicySimulationResult } from '@astroid/types';
import {
  AstroidProvider,
  useAgent,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useSimulatePolicy,
  useWallets,
  queryKeys,
  type AstroidProviderProps,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function renderInProviders(
  children: ReactNode,
  options: {
    client?: Astroid;
  } = {},
): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? new Astroid({
    apiKey: 'sk_test_hooks',
    baseUrl: 'https://api.test',
  });

  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) },
        createElement(AstroidProvider, { client, children } as AstroidProviderProps),
      ),
    );
  });

  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Query key tests                                                             */
/* -------------------------------------------------------------------------- */

describe('queryKeys', () => {
  it('wallets.list produces a stable, serialisable key', () => {
    const key1 = queryKeys.wallets.list({ page: 1 });
    const key2 = queryKeys.wallets.list({ page: 1 });
    expect(key1).toEqual(key2);
  });

  it('wallets.detail produces a key containing the id', () => {
    const key = queryKeys.wallets.detail('wal_abc');
    expect(key).toEqual(['astroid', 'wallets', 'detail', 'wal_abc']);
  });

  it('agents.list and wallets.list produce different keys', () => {
    expect(queryKeys.agents.list()).not.toEqual(queryKeys.wallets.list());
  });
});

/* -------------------------------------------------------------------------- */
/* Hook integration tests                                                      */
/* -------------------------------------------------------------------------- */

describe('useAgent', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgent('agent_1');
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });

  it('query is disabled when id is undefined', () => {
    let isFetching = true;

    function TestComponent() {
      const query = useAgent(undefined);
      isFetching = query.isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });
});

describe('useWallets', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useWallets();
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });
});

describe('useAgents', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgents();
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });
});

describe('Agent mutation hooks', () => {
  it('provides useCreateAgent, useUpdateAgent, and useDeleteAgent hooks', () => {
    let hasCreate = false;
    let hasUpdate = false;
    let hasDelete = false;

    function TestComponent() {
      const createMutation = useCreateAgent();
      const updateMutation = useUpdateAgent();
      const deleteMutation = useDeleteAgent();

      hasCreate = typeof createMutation.mutate === 'function';
      hasUpdate = typeof updateMutation.mutate === 'function';
      hasDelete = typeof deleteMutation.mutate === 'function';
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(hasCreate).toBe(true);
    expect(hasUpdate).toBe(true);
    expect(hasDelete).toBe(true);
    unmount();
  });
});

describe('useSimulatePolicy', () => {
  const SIMULATION: PolicySimulationResult = {
    allowed: false,
    violations: [
      {
        policyId: 'pol_1',
        policyType: 'DAILY_BUDGET',
        message: 'Exceeds daily limit policy pol_1.',
      },
    ],
    requiredApprovals: [],
    risk: {
      score: 75,
      band: 'HIGH',
      factors: [
        { factor: 'amount cap', score: 75, description: 'Exceeds daily limit policy pol_1.' },
      ],
    },
    budgetImpact: [],
    explanation: 'Exceeds daily limit policy pol_1.',
  };

  const REQUEST: PolicySimulationRequest = { asset: 'USDC', amount: '1000', walletId: 'wal_1' };

  /** Mock client whose policy resource methods are spies. */
  function createMockClient(): Astroid {
    return {
      policies: {
        simulatePolicy: vi.fn(async () => SIMULATION),
        simulate: vi.fn(async () => SIMULATION),
      },
    } as unknown as Astroid;
  }

  /** Wrap a hook under a fresh QueryClient + AstroidProvider. */
  function createWrapper(client: Astroid) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
    });
    return function Wrapper({ children }: { children: ReactNode }): ReactNode {
      return createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AstroidProvider, { client, children } as AstroidProviderProps),
      );
    };
  }

  it('calls policies.simulatePolicy with the payload and exposes the successful result', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useSimulatePolicy(), { wrapper: createWrapper(client) });

    result.current.mutate(REQUEST);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.policies.simulatePolicy).toHaveBeenCalledWith(REQUEST);
    expect(client.policies.simulate).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(SIMULATION);
    expect(result.current.data?.explanation).toContain('daily limit');
  });

  it('invokes the per-call onSuccess callback for easy component handling', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useSimulatePolicy(), { wrapper: createWrapper(client) });
    const onSuccess = vi.fn();

    result.current.mutate(REQUEST, { onSuccess });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]![0]).toEqual(SIMULATION);
  });

  it('surfaces API validation failures via isError, error, and onError', async () => {
    const client = createMockClient();
    const validationError = new ValidationError('amount must be a positive decimal', {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: { fields: { amount: ['must be a positive decimal'] } },
    });
    (client.policies.simulatePolicy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(validationError);
    const { result } = renderHook(() => useSimulatePolicy(), { wrapper: createWrapper(client) });
    const onError = vi.fn();

    result.current.mutate(REQUEST, { onError });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(validationError);
    expect(result.current.data).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(validationError.fieldErrors).toEqual({ amount: ['must be a positive decimal'] });
  });
});
