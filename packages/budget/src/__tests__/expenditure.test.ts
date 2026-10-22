import { describe, expect, it, vi } from 'vitest';

import { AstroidTimeoutError, NotFoundError } from '@astroid/errors';
import type { BudgetExpenditureSummary } from '@astroid/types';

import { BudgetResource } from '../index.js';
import {
  BudgetExpenditureValidationError,
  budgetExpenditurePath,
  getBudgetExpenditureSummary,
  isValidExpenditureThreshold,
} from '../expenditure.js';
import type { BudgetHttpClient } from '../budget.js';

const BUDGET_ID = 'bud_123';

const summary: BudgetExpenditureSummary = {
  budgetId: BUDGET_ID,
  currency: 'USDC',
  period: 'MONTHLY',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-22T00:00:00.000Z',
  limit: '1000.00',
  spent: '850.00',
  remaining: '150.00',
  utilization: 0.85,
  percent: 85,
  state: 'warning',
  thresholdPercent: 80,
  thresholdExceeded: true,
  thresholdWarning: 'Budget bud_123 has consumed 85% of its limit.',
  generatedAt: '2026-10-22T12:00:00.000Z',
};

/** Minimal transport mock exposing the `BudgetHttpClient` surface. */
function makeTransport() {
  const get = vi.fn(async (_path: string, _options?: { query?: unknown }) => summary);
  const transport = {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as BudgetHttpClient;
  return { transport, get };
}

describe('getBudgetExpenditureSummary', () => {
  it('fetches the summary and serializes the time range and threshold', async () => {
    const { transport, get } = makeTransport();

    const result = await getBudgetExpenditureSummary(transport, BUDGET_ID, {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-22T00:00:00.000Z',
      thresholdPercent: 80,
    });

    expect(result).toEqual(summary);
    expect(get).toHaveBeenCalledWith(budgetExpenditurePath(BUDGET_ID), {
      query: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-22T00:00:00.000Z',
        thresholdPercent: 80,
      },
    });
  });

  it('omits unset filters from the querystring', async () => {
    const { transport, get } = makeTransport();

    await getBudgetExpenditureSummary(transport, BUDGET_ID);

    expect(get).toHaveBeenCalledWith('/budgets/bud_123/expenditure', { query: {} });
  });

  it('percent-encodes the budget id in the path', async () => {
    const { transport, get } = makeTransport();

    await getBudgetExpenditureSummary(transport, 'bud/special');

    expect(get.mock.calls[0]?.[0]).toBe('/budgets/bud%2Fspecial/expenditure');
  });

  it('rejects invalid query parameters without issuing a request', async () => {
    const { transport, get } = makeTransport();

    await expect(
      getBudgetExpenditureSummary(transport, BUDGET_ID, { thresholdPercent: 0 }),
    ).rejects.toBeInstanceOf(BudgetExpenditureValidationError);
    await expect(
      getBudgetExpenditureSummary(transport, BUDGET_ID, { thresholdPercent: 101 }),
    ).rejects.toBeInstanceOf(BudgetExpenditureValidationError);
    await expect(
      getBudgetExpenditureSummary(transport, BUDGET_ID, { from: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BudgetExpenditureValidationError);
    await expect(
      getBudgetExpenditureSummary(transport, BUDGET_ID, {
        from: '2026-10-22T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BudgetExpenditureValidationError);
    await expect(getBudgetExpenditureSummary(transport, '   ')).rejects.toBeInstanceOf(
      BudgetExpenditureValidationError,
    );

    expect(get).not.toHaveBeenCalled();
  });

  it('propagates a budget-not-found error from the API', async () => {
    const { transport, get } = makeTransport();
    get.mockRejectedValueOnce(
      new NotFoundError('Budget not found', { code: 'NOT_FOUND', status: 404 }),
    );

    await expect(getBudgetExpenditureSummary(transport, 'bud_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('propagates network timeouts', async () => {
    const { transport, get } = makeTransport();
    get.mockRejectedValueOnce(new AstroidTimeoutError(30_000));

    await expect(getBudgetExpenditureSummary(transport, BUDGET_ID)).rejects.toBeInstanceOf(
      AstroidTimeoutError,
    );
  });
});

describe('isValidExpenditureThreshold', () => {
  it('accepts finite percentages in (0, 100] and rejects everything else', () => {
    expect(isValidExpenditureThreshold(80)).toBe(true);
    expect(isValidExpenditureThreshold(100)).toBe(true);
    expect(isValidExpenditureThreshold(0.5)).toBe(true);
    expect(isValidExpenditureThreshold(0)).toBe(false);
    expect(isValidExpenditureThreshold(100.1)).toBe(false);
    expect(isValidExpenditureThreshold(Number.NaN)).toBe(false);
    expect(isValidExpenditureThreshold('80')).toBe(false);
  });
});

describe('BudgetResource.getBudgetExpenditureSummary', () => {
  it('GETs /budgets/{id}/expenditure with the serialized query', async () => {
    const client = {
      get: vi.fn(async () => ({ data: summary })),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const resource = new BudgetResource(client as never);

    const result = await resource.getBudgetExpenditureSummary(BUDGET_ID, {
      from: '2026-10-01T00:00:00.000Z',
      thresholdPercent: 80,
    });

    expect(result).toEqual(summary);
    expect(client.get).toHaveBeenCalledWith('/budgets/bud_123/expenditure', {
      query: { from: '2026-10-01T00:00:00.000Z', thresholdPercent: 80 },
    });
  });

  it('validates locally before calling the HTTP client', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const resource = new BudgetResource(client as never);

    await expect(
      resource.getBudgetExpenditureSummary(BUDGET_ID, { thresholdPercent: -5 }),
    ).rejects.toBeInstanceOf(BudgetExpenditureValidationError);
    expect(client.get).not.toHaveBeenCalled();
  });
});
