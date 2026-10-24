import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@astroid/errors';
import type { BudgetAdjustmentResponse } from '@astroid/types';
import {
  BudgetClient,
  requestBudgetAdjustment,
  type BudgetHttpClient,
} from '../src/index.js';

describe('requestBudgetAdjustment — budget allocation adjustment helper (#466)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const successfulResponse: BudgetAdjustmentResponse = {
    id: 'adj_123',
    budgetId: 'bud_1',
    amount: '500.00',
    status: 'APPROVED',
    state: 'approved',
    allocationState: 'healthy',
    currentLimit: '1000.00',
    adjustedLimit: '1500.00',
    justification: 'High transaction volume for seasonal campaign',
    metadata: { reason: 'campaign_q4', priority: 'high' },
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:01Z',
  };

  const pendingResponse: BudgetAdjustmentResponse = {
    id: 'adj_456',
    budgetId: 'bud_1',
    amount: '2000.00',
    status: 'PENDING',
    state: 'pending',
    allocationState: 'warning',
    currentLimit: '1000.00',
    justification: 'Unbudgeted large liquidity operation',
    createdAt: '2026-10-22T08:05:00Z',
  };

  const rejectedResponse: BudgetAdjustmentResponse = {
    id: 'adj_789',
    budgetId: 'bud_1',
    amount: '50000.00',
    status: 'REJECTED',
    state: 'rejected',
    allocationState: 'exhausted',
    currentLimit: '1000.00',
    rejectionReason: 'Requested adjustment exceeds organization maximum cap policy limit.',
    justification: 'Excessive expansion request',
    createdAt: '2026-10-22T08:10:00Z',
  };

  it('successfully requests budget adjustment using mocked HTTP transport', async () => {
    const mockTransport: BudgetHttpClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(successfulResponse),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const result = await requestBudgetAdjustment(
      mockTransport,
      'bud_1',
      '500.00',
      'High transaction volume for seasonal campaign',
    );

    expect(mockTransport.post).toHaveBeenCalledWith(
      '/budgets/bud_1/adjustments',
      {
        amount: '500.00',
        justification: 'High transaction volume for seasonal campaign',
      },
      undefined,
    );
    expect(result.id).toBe('adj_123');
    expect(result.status).toBe('APPROVED');
    expect(result.state).toBe('approved');
    expect(result.adjustedLimit).toBe('1500.00');
  });

  it('handles pending allocation adjustment proposals with metadata and targetBudgetId', async () => {
    const mockTransport: BudgetHttpClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(pendingResponse),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const result = await requestBudgetAdjustment(
      mockTransport,
      'bud_1',
      2000,
      {
        reason: 'Unbudgeted large liquidity operation',
        targetBudgetId: 'bud_sub_2',
        metadata: { op: 'reallocate' },
      },
    );

    expect(mockTransport.post).toHaveBeenCalledWith(
      '/budgets/bud_1/adjustments',
      {
        amount: '2000',
        justification: 'Unbudgeted large liquidity operation',
        targetBudgetId: 'bud_sub_2',
        metadata: { op: 'reallocate' },
      },
      undefined,
    );
    expect(result.id).toBe('adj_456');
    expect(result.status).toBe('PENDING');
    expect(result.state).toBe('pending');
  });

  it('handles rejected adjustment response with rejectionReason', async () => {
    const mockTransport: BudgetHttpClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(rejectedResponse),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const result = await requestBudgetAdjustment(
      mockTransport,
      'bud_1',
      '50000.00',
      'Excessive expansion request',
    );

    expect(result.status).toBe('REJECTED');
    expect(result.state).toBe('rejected');
    expect(result.rejectionReason).toContain('exceeds organization maximum cap policy limit');
  });

  it('supports invocation directly via default client when transport is in options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await requestBudgetAdjustment('bud_1', '500.00', 'Marketing expansion');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/budgets/bud_1/adjustments');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body as string)).toEqual({
      amount: '500.00',
      justification: 'Marketing expansion',
    });
    expect(result.status).toBe('APPROVED');
  });

  it('invokes via BudgetClient.prototype.requestAdjustment', async () => {
    const mockTransport: BudgetHttpClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(successfulResponse),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const client = new BudgetClient(mockTransport);
    const result = await client.requestAdjustment('bud_1', '500.00', 'Client wrapper call');

    expect(mockTransport.post).toHaveBeenCalledWith(
      '/budgets/bud_1/adjustments',
      {
        amount: '500.00',
        justification: 'Client wrapper call',
      },
      undefined,
    );
    expect(result.id).toBe('adj_123');
  });

  it('throws ValidationError when budgetId is missing or blank', async () => {
    await expect(requestBudgetAdjustment('', '100.00')).rejects.toThrow(ValidationError);
    await expect(requestBudgetAdjustment('   ', '100.00')).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when adjustment amount is not a positive finite number or decimal string', async () => {
    await expect(requestBudgetAdjustment('bud_1', 0)).rejects.toThrow(ValidationError);
    await expect(requestBudgetAdjustment('bud_1', -50)).rejects.toThrow(ValidationError);
    await expect(requestBudgetAdjustment('bud_1', '0')).rejects.toThrow(ValidationError);
    await expect(requestBudgetAdjustment('bud_1', '-100.00')).rejects.toThrow(ValidationError);
    await expect(requestBudgetAdjustment('bud_1', 'abc')).rejects.toThrow(ValidationError);
  });
});
