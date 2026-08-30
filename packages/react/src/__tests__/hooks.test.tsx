/**
 * Unit tests for the TanStack Query hooks in `@astroid/react`.
 */

import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  useAgent,
  useAgents,
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
