/**
 * Issue #403 — analytics aggregation time-range filtering and typed metrics
 * query helpers.
 *
 * Verifies that:
 * - time-range query DTOs (`startTime`, `endTime`, `interval`) serialise into
 *   the query string correctly (and invalid/undefined values are omitted),
 * - the metrics helpers append the range to the endpoint request,
 * - responses parse into strongly typed time-series metrics data.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildTimeRangePath,
  buildTimeRangeQuery,
  getMetricsInRange,
} from '../analytics.js';
import { AnalyticsResource } from '../index.js';
import type { HttpClient } from '@astroid/core';
import type { AnalyticsMetricsResponse } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const METRICS_RESPONSE: AnalyticsMetricsResponse = {
  points: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      volume: '1500.50',
      fee: '0.001',
      count: 12,
      successCount: 10,
      failureCount: 2,
    },
    {
      timestamp: '2026-01-02T00:00:00.000Z',
      volume: '2300.75',
      fee: '0.002',
      count: 18,
      successCount: 17,
      failureCount: 1,
    },
  ],
  summary: {
    timeframe: 'day',
    totalVolume: '3801.25',
    totalFees: '0.003',
    transactionCount: 30,
    successRate: 0.9,
    averageLatencyMs: 150,
  },
};

function createMockClient(response: AnalyticsMetricsResponse = METRICS_RESPONSE) {
  const get = vi.fn().mockResolvedValue({ data: response });
  const client = { get } as unknown as HttpClient;
  return { client, get };
}

/* -------------------------------------------------------------------------- */
/* Query string generation                                                     */
/* -------------------------------------------------------------------------- */

describe('buildTimeRangeQuery', () => {
  it('serializes startTime, endTime, and interval', () => {
    const params = buildTimeRangeQuery({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-08T00:00:00.000Z',
      interval: 'day',
    });

    expect(params.get('startTime')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endTime')).toBe('2026-01-08T00:00:00.000Z');
    expect(params.get('interval')).toBe('day');
  });

  it('serializes scope filters alongside the range', () => {
    const params = buildTimeRangeQuery({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
      interval: 'hour',
      asset: 'USDC',
      walletId: 'wal_1',
      agentId: 'agt_1',
    });

    expect(params.get('asset')).toBe('USDC');
    expect(params.get('walletId')).toBe('wal_1');
    expect(params.get('agentId')).toBe('agt_1');
  });

  it('omits undefined fields', () => {
    const params = buildTimeRangeQuery({});
    expect(params.toString()).toBe('');
  });

  it('omits unparseable dates instead of emitting Invalid Date', () => {
    const params = buildTimeRangeQuery({
      startTime: 'not-a-date',
      endTime: 'also-not-a-date',
      interval: 'day',
    });

    expect(params.has('startTime')).toBe(false);
    expect(params.has('endTime')).toBe(false);
    expect(params.get('interval')).toBe('day');
  });

  it('normalizes date strings to ISO-8601 UTC', () => {
    const params = buildTimeRangeQuery({ startTime: '2026-03-01' });
    expect(params.get('startTime')).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('buildTimeRangePath', () => {
  it('appends the time-range query to the metrics endpoint', () => {
    const path = buildTimeRangePath({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-08T00:00:00.000Z',
      interval: 'day',
    });

    expect(path.startsWith('/analytics/metrics?')).toBe(true);
    expect(path).toContain('startTime=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('endTime=2026-01-08T00%3A00%3A00.000Z');
    expect(path).toContain('interval=day');
  });

  it('includes metric selectors when supplied', () => {
    const path = buildTimeRangePath({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
      interval: 'hour',
      metric: 'transaction_volume',
      metrics: ['transaction_volume', 'fee_expenditure'],
    });

    expect(path).toContain('metric=transaction_volume');
    expect(path).toContain('metrics=transaction_volume%2Cfee_expenditure');
  });

  it('supports a custom base path and returns it bare without filters', () => {
    expect(buildTimeRangePath({}, '/analytics/custom')).toBe('/analytics/custom');
    expect(buildTimeRangePath()).toBe('/analytics/metrics');
  });
});

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

describe('getMetricsInRange', () => {
  it('requests the metrics endpoint with the range and returns typed data', async () => {
    const { client, get } = createMockClient();

    const result = await getMetricsInRange(client, {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-08T00:00:00.000Z',
      interval: 'day',
      metrics: ['transaction_volume'],
    });

    expect(get).toHaveBeenCalledOnce();
    const path = get.mock.calls[0]![0] as string;
    expect(path).toContain('/analytics/metrics?');
    expect(path).toContain('startTime=');
    expect(path).toContain('endTime=');
    expect(path).toContain('interval=day');
    expect(path).toContain('metrics=transaction_volume');

    // Strongly typed time-series metrics data.
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(result.points[0]!.volume).toBe('1500.50');
    expect(result.summary.totalVolume).toBe('3801.25');
    expect(result.summary.transactionCount).toBe(30);
  });

  it('works with no filters', async () => {
    const { client, get } = createMockClient();
    await getMetricsInRange(client);
    expect(get.mock.calls[0]![0]).toBe('/analytics/metrics');
  });
});

describe('AnalyticsResource#getMetrics', () => {
  it('serializes the range parameters and parses the response', async () => {
    const { client, get } = createMockClient();
    const resource = new AnalyticsResource(client);

    const report = await resource.getMetrics({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
      interval: 'hour',
      asset: 'XLM',
    });

    const path = get.mock.calls[0]![0] as string;
    expect(path).toContain('/analytics/metrics?');
    expect(path).toContain('startTime=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('endTime=2026-01-02T00%3A00%3A00.000Z');
    expect(path).toContain('interval=hour');
    expect(path).toContain('asset=XLM');

    expect(report.summary.totalFees).toBe('0.003');
    expect(report.points[1]!.count).toBe(18);
  });

  it('omits invalid range values from the request path', async () => {
    const { client, get } = createMockClient();
    const resource = new AnalyticsResource(client);

    await resource.getMetrics({ startTime: 'garbage', interval: 'day' });

    const path = get.mock.calls[0]![0] as string;
    expect(path).not.toContain('startTime');
    expect(path).toContain('interval=day');
  });
});
