import { describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import type { CreatePolicyInput, Policy, UpdatePolicyInput } from '@astroid/types';

import {
  AstroidProvider,
  queryKeys,
  useCreatePolicy,
  useUpdatePolicy,
} from '../index.js';

const MOCK_POLICY: Policy = {
  id: 'pol_452',
  organizationId: 'org_1',
  agentId: null,
  name: 'Max Spend Policy',
  description: null,
  type: 'MAX_AMOUNT',
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid; queryClient?: QueryClient } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

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
    client,
    queryClient,
    unmount: () => {
      act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

describe('Policy mutation hooks — Issue #452', () => {
  describe('useCreatePolicy', () => {
    it('creates a policy and invalidates the policy domain query cache', async () => {
      const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
      const createSpy = vi.spyOn(client.policies, 'create').mockResolvedValue(MOCK_POLICY);

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      let createHook: ReturnType<typeof useCreatePolicy> | undefined;

      function TestComponent() {
        createHook = useCreatePolicy();
        return null;
      }

      const { unmount } = renderInProviders(createElement(TestComponent), {
        client,
        queryClient,
      });

      const input: CreatePolicyInput = {
        name: 'Max Spend Policy',
        type: 'MAX_AMOUNT',
        configuration: { maxAmount: 500 },
        priority: 1,
        enabled: true,
      };

      let createdResult: Policy | undefined;
      await act(async () => {
        createdResult = await createHook!.mutateAsync(input);
      });

      expect(createdResult).toEqual(MOCK_POLICY);
      expect(createSpy).toHaveBeenCalledWith(input);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.policies.all });

      unmount();
    });
  });

  describe('useUpdatePolicy', () => {
    it('updates a policy and invalidates both policy detail and policy domain query cache', async () => {
      const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
      const updatedPolicy: Policy = { ...MOCK_POLICY, priority: 2 };
      const updateSpy = vi.spyOn(client.policies, 'update').mockResolvedValue(updatedPolicy);

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      let updateHook: ReturnType<typeof useUpdatePolicy> | undefined;

      function TestComponent() {
        updateHook = useUpdatePolicy();
        return null;
      }

      const { unmount } = renderInProviders(createElement(TestComponent), {
        client,
        queryClient,
      });

      const updateParams: UpdatePolicyInput = { priority: 2 };

      let result: Policy | undefined;
      await act(async () => {
        result = await updateHook!.mutateAsync({
          id: 'pol_452',
          params: updateParams,
        });
      });

      expect(result).toEqual(updatedPolicy);
      expect(updateSpy).toHaveBeenCalledWith('pol_452', updateParams);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.policies.detail('pol_452') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.policies.all });

      unmount();
    });
  });
});
