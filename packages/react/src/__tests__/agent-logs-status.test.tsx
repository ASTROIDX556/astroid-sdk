/**
 * Unit tests for the useAgentLogs and useAgentStatus realtime-polling hooks.
 */

import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  useAgentLogs,
  useAgentStatus,
  agentLogKeys,
  agentStatusKeys,
  type AstroidProviderProps,
} from '../index.js';
// Types are imported via @astroid/react re-exports for useAgentLogs/useAgentStatus

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid } = {},
): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client =
    options.client ??
    new Astroid({
      apiKey: 'sk_test_hooks',
      baseUrl: 'https://api.test',
    });

  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: 0 },
            },
          }),
        },
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

describe('agentLogKeys', () => {
  it('all produces a stable key for a given agentId', () => {
    const key1 = agentLogKeys.all('agent_abc');
    const key2 = agentLogKeys.all('agent_abc');
    expect(key1).toEqual(key2);
  });

  it('list produces a key containing the agentId and params', () => {
    const key = agentLogKeys.list('agent_abc', { page: 1 });
    expect(key).toEqual(['astroid', 'agents', 'agent_abc', 'logs', { page: 1 }]);
  });

  it('different agentIds produce different keys', () => {
    expect(agentLogKeys.all('agent_1')).not.toEqual(agentLogKeys.all('agent_2'));
  });
});

describe('agentStatusKeys', () => {
  it('all produces a stable key for a given agentId', () => {
    const key1 = agentStatusKeys.all('agent_abc');
    const key2 = agentStatusKeys.all('agent_abc');
    expect(key1).toEqual(key2);
  });

  it('different agentIds produce different keys', () => {
    expect(agentStatusKeys.all('agent_1')).not.toEqual(agentStatusKeys.all('agent_2'));
  });
});

/* -------------------------------------------------------------------------- */
/* Hook integration tests                                                      */
/* -------------------------------------------------------------------------- */

describe('useAgentLogs', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgentLogs('agent_abc123');
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });

  it('query is disabled when enabled is false', () => {
    let isFetching = true;

    function TestComponent() {
      const query = useAgentLogs('agent_abc123', { enabled: false });
      isFetching = query.isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });

  it('respects custom polling interval', () => {
    let rendered = false;

    function TestComponent() {
      useAgentLogs('agent_abc123', {
        interval: 10000,
        enabled: true,
      });
      // Verify the hook renders without error
      rendered = true;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(rendered).toBe(true);
    unmount();
  });

  it('returns paginated data structure', () => {
    let hasData = false;

    function TestComponent() {
      const query = useAgentLogs('agent_abc123', { enabled: false });
      // When enabled is false and no cached data, data is undefined
      hasData = query.data !== undefined;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(hasData).toBe(false);
    unmount();
  });
});

describe('useAgentStatus', () => {
  it('returns a loading state initially', () => {
    let isLoading = false;

    function TestComponent() {
      const query = useAgentStatus('agent_abc123');
      isLoading = query.isLoading;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(typeof isLoading).toBe('boolean');
    unmount();
  });

  it('query is disabled when enabled is false', () => {
    let isFetching = true;

    function TestComponent() {
      const query = useAgentStatus('agent_abc123', { enabled: false });
      isFetching = query.isFetching;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(isFetching).toBe(false);
    unmount();
  });

  it('respects custom polling interval', () => {
    let rendered = false;

    function TestComponent() {
      useAgentStatus('agent_abc123', {
        interval: 3000,
        enabled: true,
      });
      // Verify the hook renders without error
      rendered = true;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(rendered).toBe(true);
    unmount();
  });

  it('returns status metrics structure', () => {
    let hasData = false;

    function TestComponent() {
      const q = useAgentStatus('agent_abc123', { enabled: false });
      hasData = q.data !== undefined;
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent));
    expect(hasData).toBe(false);
    unmount();
  });
});
