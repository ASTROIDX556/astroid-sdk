import { describe, expect, it, vi } from 'vitest';

import { AnalyticsResource } from '../index.js';

import type { HttpClient } from '@astroid/core';
import type { AgentSpendingRow, BudgetUtilizationRow } from '@astroid/types';

/** Minimal HttpClient stand-in that records GET calls and returns stubbed data. */
function makeClient() {
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const handler = vi.fn();

  const client = {
    get: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      calls.push({ path, query: opts?.query });
      const data = await handler(path, opts?.query);
      return {
        data,
        meta: {
          page: 1,
          limit: 20,
          total: data.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;

  return { client, calls, handler };
}

/**
 * Client stand-in whose handler controls both `data` and the raw `meta`
 * envelope, so tests can reproduce the cursor-based shape the API returns
 * (`meta.nextCursor` / `meta.hasMore`) instead of the offset shape above.
 */
function makeCursorClient() {
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const handler = vi.fn();

  const client = {
    get: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      calls.push({ path, query: opts?.query });
      return await handler(path, opts?.query);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;

  return { client, calls, handler };
}

describe('AnalyticsResource pagination', () => {
  const agentRow: AgentSpendingRow = {
    agentId: 'agt_1',
    agentName: 'Payment Bot',
    totalSpent: '120.50',
    transactionCount: 7,
    averageRisk: 12,
  };

  const budgetRow: BudgetUtilizationRow = {
    budgetId: 'bud_1',
    budgetName: 'Marketing',
    limit: '1000.00',
    spent: '400.00',
    remaining: '600.00',
    utilization: 0.4,
  };

  it('listAgents serializes analytics filters and pagination into the querystring', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([agentRow]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listAgents({
      from: '2026-01-01',
      to: '2026-01-31',
      currency: 'USDC',
      page: 2,
      limit: 25,
      order: 'desc',
      sort: 'totalSpent',
    });

    expect(calls).toEqual([
      {
        path: '/analytics/agents',
        query: {
          from: '2026-01-01',
          to: '2026-01-31',
          currency: 'USDC',
          page: 2,
          limit: 25,
          order: 'desc',
          sort: 'totalSpent',
        },
      },
    ]);
    expect(result.data).toEqual([agentRow]);
    expect(result.meta.page).toBe(1);
  });

  it('listAgents returns an empty page when there are no rows', async () => {
    const { client, handler } = makeClient();
    handler.mockResolvedValueOnce([]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listAgents({});
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('listBudgets serializes pagination and parses utilization rows', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([budgetRow]);
    const resource = new AnalyticsResource(client);

    const result = await resource.listBudgets({
      from: '2026-01-01',
      page: 1,
      limit: 50,
      order: 'asc',
    });

    expect(calls).toEqual([
      {
        path: '/analytics/budgets',
        query: { from: '2026-01-01', page: 1, limit: 50, order: 'asc' },
      },
    ]);
    expect(result.data).toEqual([budgetRow]);
    expect(result.data[0]!.utilization).toBe(0.4);
  });
});

describe('AnalyticsResource cursor pagination', () => {
  const agentRow: AgentSpendingRow = {
    agentId: 'agt_1',
    agentName: 'Payment Bot',
    totalSpent: '120.50',
    transactionCount: 7,
    averageRisk: 12,
  };

  const budgetRow: BudgetUtilizationRow = {
    budgetId: 'bud_1',
    budgetName: 'Marketing',
    limit: '1000.00',
    spent: '400.00',
    remaining: '600.00',
    utilization: 0.4,
  };

  it('listAgentsByCursor forwards cursor, limit and order into the querystring', async () => {
    const { client, calls, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({
      data: [agentRow],
      meta: { nextCursor: 'cur_page2', hasMore: true, limit: 1 },
    });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({
      startDate: '2026-01-01',
      limit: 1,
      order: 'desc',
      cursor: 'cur_page1',
    });

    expect(calls).toEqual([
      {
        path: '/analytics/agents',
        query: {
          startDate: '2026-01-01',
          limit: 1,
          order: 'desc',
          cursor: 'cur_page1',
        },
      },
    ]);
    expect(result.items).toEqual([agentRow]);
    expect(result.nextCursor).toBe('cur_page2');
    expect(result.hasMore).toBe(true);
  });

  it('listAgentsByCursor pages to the final page and reports exhaustion', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({
      data: [agentRow],
      meta: { nextCursor: null, hasMore: false },
    });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({ cursor: 'cur_page2' });

    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('falls back to meta.cursor when the API omits meta.nextCursor', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({
      data: [agentRow],
      meta: { cursor: 'cur_legacy', hasMore: true },
    });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({});

    expect(result.nextCursor).toBe('cur_legacy');
    expect(result.hasMore).toBe(true);
  });

  it('derives hasMore from cursor presence when meta omits it', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({
      data: [agentRow],
      meta: { nextCursor: 'cur_next' },
    });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({});

    expect(result.nextCursor).toBe('cur_next');
    expect(result.hasMore).toBe(true);
  });

  it('normalizes an empty or missing cursor to null', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({ data: [agentRow], meta: { nextCursor: '' } });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({});

    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('tolerates a missing meta envelope entirely', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({ data: [agentRow] });

    const resource = new AnalyticsResource(client);
    const result = await resource.listAgentsByCursor({});

    expect(result.items).toEqual([agentRow]);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('listBudgetsByCursor parses budget rows across pages', async () => {
    const { client, handler } = makeCursorClient();
    handler
      .mockResolvedValueOnce({
        data: [budgetRow],
        meta: { nextCursor: 'bud_2', hasMore: true },
      })
      .mockResolvedValueOnce({ data: [], meta: { nextCursor: null, hasMore: false } });

    const resource = new AnalyticsResource(client);

    const first = await resource.listBudgetsByCursor({ limit: 1 });
    expect(first.items[0]!.budgetId).toBe('bud_1');
    expect(first.items[0]!.utilization).toBe(0.4);
    expect(first.nextCursor).toBe('bud_2');

    const second = await resource.listBudgetsByCursor({
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toEqual([]);
    expect(second.hasMore).toBe(false);
  });

  it('listBudgetsByCursor returns an empty page for an exhausted set', async () => {
    const { client, handler } = makeCursorClient();
    handler.mockResolvedValueOnce({ data: [], meta: {} });

    const resource = new AnalyticsResource(client);
    const result = await resource.listBudgetsByCursor({});

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });
});
