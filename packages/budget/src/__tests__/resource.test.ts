import { describe, expect, it, vi } from 'vitest';

import { BudgetResource } from '../index.js';

import type { HttpClient } from '@astroid/core';
import type { Budget, BudgetSimulationResult, BudgetUtilization } from '@astroid/types';

/**
 * Minimal HttpClient stand-in. Only the methods the resource uses on the wire
 * are stubbed; each call records its arguments so tests can assert the exact
 * path and query/body that were serialized.
 */
function makeClient() {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const handler = vi.fn();

  const client = {
    get: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      calls.push({ method: 'get', path, query: opts?.query });
      const data = await handler('get', path, opts?.query);
      return { data };
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: 'post', path, body });
      const data = await handler('post', path, undefined, body);
      return { data };
    }),
    patch: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: 'patch', path, body });
      const data = await handler('patch', path, undefined, body);
      return { data };
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: 'delete', path });
      const data = await handler('delete', path);
      return { data };
    }),
  } as unknown as HttpClient;

  return { client, calls, handler };
}

const BUDGET_ID = 'bud_123';
const budget: Budget = {
  id: BUDGET_ID,
  organizationId: 'org_1',
  name: 'Marketing',
  currency: 'USDC',
  period: 'MONTHLY',
  periodStart: '2026-08-01T00:00:00.000Z',
  limitAmount: '1000.00',
  spent: '0.00',
  remaining: '1000.00',
  enabled: true,
  rollover: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('BudgetResource', () => {
  it('getBudget requests /budgets/{id}', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce(budget);
    const resource = new BudgetResource(client);

    const result = await resource.getBudget(BUDGET_ID);

    expect(calls).toEqual([
      { method: 'get', path: `/budgets/${BUDGET_ID}`, query: undefined },
    ]);
    expect(result).toEqual(budget);
  });

  it('listBudgets serializes filters and pagination into a GET querystring', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce([budget]);
    const resource = new BudgetResource(client);

    const result = await resource.listBudgets({
      period: 'MONTHLY',
      enabled: true,
      limit: 25,
      page: 2,
      order: 'desc',
      sort: 'spent',
    });

    expect(calls).toEqual([
      {
        method: 'get',
        path: '/budgets',
        query: { period: 'MONTHLY', enabled: true, limit: 25, page: 2, order: 'desc', sort: 'spent' },
      },
    ]);
    expect(result.data).toEqual([budget]);
  });

  it('simulateBudgetCheck posts the draw to /budgets/{id}/simulate for an allowed spend', async () => {
    const { client, calls, handler } = makeClient();
    const resultData: BudgetSimulationResult = {
      budget,
      allowed: true,
      wouldExceed: false,
      remainingAfter: '975.00',
      restriction: null,
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-09-01T00:00:00.000Z',
    };
    handler.mockResolvedValueOnce(resultData);
    const resource = new BudgetResource(client);

    const result = await resource.simulateBudgetCheck(BUDGET_ID, { asset: 'USDC', amount: '25.00' });

    expect(calls).toEqual([
      {
        method: 'post',
        path: `/budgets/${BUDGET_ID}/simulate`,
        body: { asset: 'USDC', amount: '25.00' },
      },
    ]);
    expect(result).toEqual(resultData);
  });

  it('simulateBudgetCheck surfaces a limit breach', async () => {
    const { client, handler } = makeClient();
    const breach: BudgetSimulationResult = {
      budget,
      allowed: false,
      wouldExceed: true,
      remainingAfter: '10.00',
      restriction: 'Spend of 9999.00 USDC would exceed the monthly budget limit of 1000.00 (remaining: 10.00).',
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-09-01T00:00:00.000Z',
    };
    handler.mockResolvedValueOnce(breach);
    const resource = new BudgetResource(client);

    const result = await resource.simulateBudgetCheck(BUDGET_ID, { asset: 'USDC', amount: '9999.00' });

    expect(result.allowed).toBe(false);
    expect(result.wouldExceed).toBe(true);
    expect(result.restriction).toContain('would exceed');
  });

  it('utilization fetches the utilization snapshot from /budgets/{id}/utilization', async () => {
    const { client, calls, handler } = makeClient();
    const utilization: BudgetUtilization = {
      budgetId: BUDGET_ID,
      period: 'MONTHLY',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      limit: '1000.00',
      spent: '400.00',
      remaining: '600.00',
      utilization: 0.4,
      percent: 40,
      state: 'healthy',
    };
    handler.mockResolvedValueOnce(utilization);
    const resource = new BudgetResource(client);

    const result = await resource.utilization(BUDGET_ID);

    expect(calls).toEqual([
      { method: 'get', path: `/budgets/${BUDGET_ID}/utilization`, query: undefined },
    ]);
    expect(result.utilization).toBe(0.4);
    expect(result.remaining).toBe('600.00');
  });

  it('createAlert posts to /budgets/{id}/alerts and validates threshold', async () => {
    const { client, calls, handler } = makeClient();
    const mockAlert = {
      id: 'alt_1',
      budgetId: BUDGET_ID,
      organizationId: 'org_1',
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/alerts',
      status: 'ACTIVE',
      recurring: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    handler.mockResolvedValueOnce(mockAlert);
    const resource = new BudgetResource(client);

    const result = await resource.createAlert(BUDGET_ID, {
      thresholdPercent: 80,
      channel: 'WEBHOOK',
      target: 'https://example.com/alerts',
    });

    expect(calls).toEqual([
      {
        method: 'post',
        path: `/budgets/${BUDGET_ID}/alerts`,
        body: {
          thresholdPercent: 80,
          channel: 'WEBHOOK',
          target: 'https://example.com/alerts',
        },
      },
    ]);
    expect(result).toEqual(mockAlert);
  });

  it('createAlert validates invalid threshold percentage and channel', async () => {
    const { client } = makeClient();
    const resource = new BudgetResource(client);

    await expect(
      resource.createAlert(BUDGET_ID, {
        thresholdPercent: 0,
        channel: 'WEBHOOK',
        target: 'https://example.com/alerts',
      }),
    ).rejects.toThrow('thresholdPercent must be a finite number greater than 0 and at most 1000');

    await expect(
      resource.createAlert(BUDGET_ID, {
        thresholdPercent: 80,
        channel: 'INVALID_CHANNEL' as never,
        target: 'https://example.com/alerts',
      }),
    ).rejects.toThrow('Unknown budget alert channel "INVALID_CHANNEL"');
  });

  it('listAlerts requests /budgets/{id}/alerts with pagination and filters', async () => {
    const { client, calls, handler } = makeClient();
    const mockAlerts = [{ id: 'alt_1', thresholdPercent: 50 }];
    handler.mockResolvedValueOnce(mockAlerts);
    const resource = new BudgetResource(client);

    const result = await resource.listAlerts(BUDGET_ID, { status: 'ACTIVE', limit: 10 });

    expect(calls).toEqual([
      {
        method: 'get',
        path: `/budgets/${BUDGET_ID}/alerts`,
        query: { status: 'ACTIVE', limit: 10 },
      },
    ]);
    expect(result.data).toEqual(mockAlerts);
  });

  it('getAlert requests /budgets/{id}/alerts/{alertId}', async () => {
    const { client, calls, handler } = makeClient();
    const mockAlert = { id: 'alt_1', thresholdPercent: 50 };
    handler.mockResolvedValueOnce(mockAlert);
    const resource = new BudgetResource(client);

    const result = await resource.getAlert(BUDGET_ID, 'alt_1');

    expect(calls).toEqual([
      {
        method: 'get',
        path: `/budgets/${BUDGET_ID}/alerts/alt_1`,
        query: undefined,
      },
    ]);
    expect(result).toEqual(mockAlert);
  });

  it('updateAlert patches /budgets/{id}/alerts/{alertId}', async () => {
    const { client, calls, handler } = makeClient();
    const mockAlert = { id: 'alt_1', thresholdPercent: 90 };
    handler.mockResolvedValueOnce(mockAlert);
    const resource = new BudgetResource(client);

    const result = await resource.updateAlert(BUDGET_ID, 'alt_1', { thresholdPercent: 90 });

    expect(calls).toEqual([
      {
        method: 'patch',
        path: `/budgets/${BUDGET_ID}/alerts/alt_1`,
        body: { thresholdPercent: 90 },
      },
    ]);
    expect(result).toEqual(mockAlert);
  });

  it('deleteAlert deletes /budgets/{id}/alerts/{alertId}', async () => {
    const { client, calls, handler } = makeClient();
    handler.mockResolvedValueOnce(undefined);
    const resource = new BudgetResource(client);

    await resource.deleteAlert(BUDGET_ID, 'alt_1');

    expect(calls).toEqual([
      {
        method: 'delete',
        path: `/budgets/${BUDGET_ID}/alerts/alt_1`,
      },
    ]);
  });
});