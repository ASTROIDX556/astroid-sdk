/**
 * Tests for the budget utilization threshold hook (issue: budget utilization
 * warning hooks): `useBudgetThreshold` in `hooks/use-budget.ts`.
 *
 * Covers the three required states — normal, near-limit and exceeded — plus
 * loading/error/disabled handling, threshold customization, the derived
 * status bucket and integration with the shared TanStack Query cache.
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { Astroid } from '@astroid/client';
import {
  AstroidProvider,
  queryKeys,
  useBudgetThreshold,
  type BudgetThresholdResult,
} from '../index.js';
import type { BudgetUtilization } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures & harness                                                          */
/* -------------------------------------------------------------------------- */

/** Build a utilization snapshot at the given percent consumed. */
function utilizationAt(percent: number): BudgetUtilization {
  const limit = 1000;
  const spent = (limit * percent) / 100;
  const utilization = spent / limit;
  return {
    budgetId: 'bud_42',
    period: 'MONTHLY',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    limit: limit.toFixed(2),
    spent: spent.toFixed(2),
    remaining: (limit - spent).toFixed(2),
    utilization,
    percent,
    state: percent >= 100 ? 'exhausted' : percent >= 80 ? 'warning' : 'healthy',
  };
}

function makeClient(): Astroid {
  return new Astroid({ apiKey: 'sk_test_use_budget_threshold', baseUrl: 'https://api.test' });
}

function renderInProviders(
  children: ReactNode,
  options: { client?: Astroid; queryClient?: QueryClient } = {},
): { unmount: () => void; queryClient: QueryClient } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = options.client ?? makeClient();
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
    queryClient,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

/**
 * Capture cell for the hook result. The component body re-assigns it on every
 * render, so assertions read the latest state after `waitFor` settles.
 */
function createCapture(): { current: BudgetThresholdResult | undefined } {
  return { current: undefined };
}

/* -------------------------------------------------------------------------- */
/* useBudgetThreshold                                                          */
/* -------------------------------------------------------------------------- */

describe('useBudgetThreshold — normal budget state', () => {
  it('reports healthy flags below the near-limit threshold', async () => {
    const client = makeClient();
    const utilization = utilizationAt(45);
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilization);

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.data?.budgetId).toBe('bud_42'));

    expect(captured.current!.isLoading).toBe(false);
    expect(captured.current!.isError).toBe(false);
    expect(captured.current!.utilizationPercent).toBe(45);
    expect(captured.current!.isNearLimit).toBe(false);
    expect(captured.current!.isExceeded).toBe(false);
    expect(captured.current!.status).toBe('healthy');
    expect(captured.current!.nearLimitPercent).toBe(80);
    expect(captured.current!.exceededPercent).toBe(100);
    unmount();
  });
});

describe('useBudgetThreshold — near-limit budget state', () => {
  it('sets isNearLimit at 90% utilization while isExceeded stays false', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(90));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.utilizationPercent).toBe(90));

    expect(captured.current!.isNearLimit).toBe(true);
    expect(captured.current!.isExceeded).toBe(false);
    expect(captured.current!.status).toBe('near-limit');
    unmount();
  });

  it('honors a custom nearLimitPercent (e.g. 70)', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(75));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42', { nearLimitPercent: 70 });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.utilizationPercent).toBe(75));

    expect(captured.current!.isNearLimit).toBe(true);
    expect(captured.current!.status).toBe('near-limit');
    unmount();
  });

  it('keeps isNearLimit true once the limit is exceeded (single warning zone)', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(120));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.utilizationPercent).toBe(120));

    expect(captured.current!.isNearLimit).toBe(true);
    expect(captured.current!.isExceeded).toBe(true);
    unmount();
  });
});

describe('useBudgetThreshold — exceeded budget state', () => {
  it('sets isExceeded at 100% utilization', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(100));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.utilizationPercent).toBe(100));

    expect(captured.current!.isExceeded).toBe(true);
    expect(captured.current!.isNearLimit).toBe(true);
    expect(captured.current!.status).toBe('exceeded');
    unmount();
  });

  it('honors a custom exceededPercent (e.g. 95)', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(96));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42', { exceededPercent: 95 });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.utilizationPercent).toBe(96));

    expect(captured.current!.isExceeded).toBe(true);
    expect(captured.current!.status).toBe('exceeded');
    unmount();
  });
});

describe('useBudgetThreshold — loading, error and disabled states', () => {
  it('stays in the unknown status with zero percent while loading', async () => {
    const client = makeClient();
    let resolveFetch: (value: BudgetUtilization) => void = () => {};
    vi.spyOn(client.budgets, 'utilization').mockImplementation(
      () =>
        new Promise<BudgetUtilization>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.isLoading).toBe(true));

    expect(captured.current!.data).toBeUndefined();
    expect(captured.current!.utilizationPercent).toBe(0);
    expect(captured.current!.isNearLimit).toBe(false);
    expect(captured.current!.isExceeded).toBe(false);
    expect(captured.current!.status).toBe('unknown');

    await act(async () => {
      resolveFetch(utilizationAt(50));
    });

    await waitFor(() => expect(captured.current?.status).toBe('healthy'));
    unmount();
  });

  it('surfaces the fetch error without flipping the warning flags', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockRejectedValue(new Error('budget offline'));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.isError).toBe(true));

    expect(captured.current!.error).toBeInstanceOf(Error);
    expect(captured.current!.error!.message).toBe('budget offline');
    expect(captured.current!.isNearLimit).toBe(false);
    expect(captured.current!.isExceeded).toBe(false);
    expect(captured.current!.status).toBe('unknown');
    unmount();
  });

  it('does not fetch when id is undefined and reports unknown status', async () => {
    const client = makeClient();
    const utilizationSpy = vi.spyOn(client.budgets, 'utilization');

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold(undefined);
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.isLoading).toBe(false));

    expect(utilizationSpy).not.toHaveBeenCalled();
    expect(captured.current!.data).toBeUndefined();
    expect(captured.current!.status).toBe('unknown');
    unmount();
  });

  it('skips the query entirely when enabled:false', async () => {
    const client = makeClient();
    const utilizationSpy = vi.spyOn(client.budgets, 'utilization');

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42', { enabled: false });
      return null;
    }

    const { unmount } = renderInProviders(createElement(TestComponent), { client });

    await waitFor(() => expect(captured.current?.isLoading).toBe(false));

    expect(utilizationSpy).not.toHaveBeenCalled();
    expect(captured.current!.status).toBe('unknown');
    unmount();
  });

  it('rejects non-positive thresholds immediately', () => {
    expect(() => useBudgetThreshold('bud_42', { nearLimitPercent: 0 })).toThrow(/nearLimitPercent/);
    expect(() => useBudgetThreshold('bud_42', { exceededPercent: -5 })).toThrow(/exceededPercent/);
    expect(() => useBudgetThreshold('bud_42', { nearLimitPercent: Number.NaN })).toThrow(
      /nearLimitPercent/,
    );
  });
});

describe('useBudgetThreshold — TanStack Query integration', () => {
  it('shares the budget utilization cache key with useBudgetUtilization', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(30));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42');
      return null;
    }

    const { queryClient, unmount } = renderInProviders(createElement(TestComponent), {
      client,
    });

    await waitFor(() => expect(captured.current?.data?.budgetId).toBe('bud_42'));

    const cached = queryClient.getQueryData<BudgetUtilization>(
      queryKeys.budgets.utilization('bud_42'),
    );
    expect(cached?.percent).toBe(30);
    unmount();
  });

  it('threads refetchInterval through for live polling dashboards', async () => {
    const client = makeClient();
    vi.spyOn(client.budgets, 'utilization').mockResolvedValue(utilizationAt(85));

    const captured = createCapture();
    function TestComponent() {
      captured.current = useBudgetThreshold('bud_42', { refetchInterval: 1000 });
      return null;
    }

    const { queryClient, unmount } = renderInProviders(createElement(TestComponent), {
      client,
    });

    await waitFor(() => expect(captured.current?.isNearLimit).toBe(true));

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.budgets.utilization('bud_42') });
    expect((query?.options as { refetchInterval?: number | false }).refetchInterval).toBe(1000);
    unmount();
  });
});
