import { describe, it, expect, vi } from 'vitest';
import { AnalyticsResource } from '../src/metrics.js';
import type { HttpClient } from '@astroid/core';

describe('AnalyticsResource', () => {
  it('calls getMetrics with serialized query parameters', async () => {
    const mockGet = vi.fn().mockResolvedValue({ points: [], summary: { timeframe: 'day', totalVolume: '0', totalFees: '0', transactionCount: 0, successRate: 0, averageLatencyMs: 0 } });
    const client = { get: mockGet } as unknown as HttpClient;
    const resource = new AnalyticsResource(client);

    await resource.getMetrics({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T00:00:00.000Z',
      timeframe: 'day',
      asset: 'USDC',
      walletId: 'w_1',
    });

    expect(mockGet).toHaveBeenCalledOnce();
    const calledUrl = mockGet.mock.calls[0]![0];
    expect(calledUrl).toContain('/analytics/metrics?');
    expect(calledUrl).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
    expect(calledUrl).toContain('timeframe=day');
    expect(calledUrl).toContain('asset=USDC');
    expect(calledUrl).toContain('walletId=w_1');
  });

  it('calls getVolumeSummary with string timeframe', async () => {
    const mockGet = vi.fn().mockResolvedValue({ timeframe: 'month', totalVolume: '100', totalFees: '1', transactionCount: 10, successRate: 1, averageLatencyMs: 150 });
    const client = { get: mockGet } as unknown as HttpClient;
    const resource = new AnalyticsResource(client);

    const summary = await resource.getVolumeSummary('month');

    expect(mockGet).toHaveBeenCalledWith('/analytics/summary?timeframe=month');
    expect(summary.totalVolume).toBe('100');
  });

  it('calls getVolumeSummary with query params object', async () => {
    const mockGet = vi.fn().mockResolvedValue({ timeframe: 'day', totalVolume: '50', totalFees: '0.5', transactionCount: 5, successRate: 0.8, averageLatencyMs: 200 });
    const client = { get: mockGet } as unknown as HttpClient;
    const resource = new AnalyticsResource(client);

    await resource.getVolumeSummary({ timeframe: 'day', asset: 'XLM' });

    expect(mockGet).toHaveBeenCalledWith('/analytics/summary?timeframe=day&asset=XLM');
  });
});
