/**
 * Issue #563 — analytics time-series aggregation query parameters.
 *
 * Verifies that `@astroid/analytics` accepts a `startDate` / `endDate` range
 * plus an `interval` of `'hour' | 'day' | 'week'`, normalises dates to
 * ISO-8601 UTC, omits absent/invalid values, and serialises the parameters
 * into the `/analytics/metrics` query string exactly as the API expects.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildTimeRangePath, buildTimeRangeQuery, getMetricsInRange } from '../src/analytics.js';
import { AnalyticsResource } from '../src/index.js';
import type { AnalyticsMetricsQuery } from '../src/types.js';
import type { HttpClient } from '@astroid/core';
import type { AnalyticsMetricsResponse } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const METRICS_RESPONSE: AnalyticsMetricsResponse = {
  points: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      volume: '1000.00',
      fee: '0.001',
      count: 10,
      successCount: 10,
      failureCount: 0,
    },
  ],
  summary: {
    timeframe: 'day',
    totalVolume: '1000.00',
    totalFees: '0.001',
    transactionCount: 10,
    successRate: 1,
    averageLatencyMs: 120,
  },
};

function createMockClient(response: AnalyticsMetricsResponse = METRICS_RESPONSE) {
  const get = vi.fn().mockResolvedValue({ data: response });
  return { client: { get } as unknown as HttpClient, get };
}

/* -------------------------------------------------------------------------- */
/* Query string generation                                                    */
/* -------------------------------------------------------------------------- */

describe('time-series query serialization (#563)', () => {
  it('serializes startDate, endDate, and interval', () => {
    const params = buildTimeRangeQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      interval: 'week',
    });

    expect(params.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endDate')).toBe('2026-02-01T00:00:00.000Z');
    expect(params.get('interval')).toBe('week');
  });

  it('accepts Date instances and normalises them to ISO-8601 UTC', () => {
    const params = buildTimeRangeQuery({
      startDate: new Date('2026-03-01T12:30:00.000Z'),
      endDate: new Date('2026-03-02T00:00:00.000Z'),
      interval: 'hour',
    });

    expect(params.get('startDate')).toBe('2026-03-01T12:30:00.000Z');
    expect(params.get('endDate')).toBe('2026-03-02T00:00:00.000Z');
    expect(params.get('interval')).toBe('hour');
  });

  it('omits undefined and unparseable values', () => {
    const params = buildTimeRangeQuery({
      startDate: 'not-a-date',
      interval: 'day',
    });

    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
    expect(params.get('interval')).toBe('day');
  });

  it('prefers startDate/endDate over startTime/endTime aliases', () => {
    const params = buildTimeRangeQuery({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T00:00:00.000Z',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-01-02T00:00:00.000Z',
      interval: 'day',
    });

    expect(params.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('endDate')).toBe('2026-01-02T00:00:00.000Z');
    expect(params.has('startTime')).toBe(false);
    expect(params.has('endTime')).toBe(false);
  });

  it('builds the full /analytics/metrics path with encoded parameters', () => {
    const path = buildTimeRangePath({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      interval: 'week',
      metrics: ['transaction_volume', 'fee_expenditure'],
    });

    expect(path).toContain('/analytics/metrics?');
    expect(path).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
    expect(path).toContain('endDate=2026-02-01T00%3A00%3A00.000Z');
    expect(path).toContain('interval=week');
    expect(path).toContain('metrics=transaction_volume%2Cfee_expenditure');
  });
});

/* -------------------------------------------------------------------------- */
/* Resource integration                                                       */
/* -------------------------------------------------------------------------- */

describe('AnalyticsResource.getMetrics (#563)', () => {
  it('sends the date range and interval to the mocked API', async () => {
    const { client, get } = createMockClient();
    const analytics = new AnalyticsResource(client);

    const query: AnalyticsMetricsQuery = {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-08T00:00:00.000Z',
      interval: 'day',
    };

    const report = await analytics.getMetrics(query);

    expect(report).toBe(METRICS_RESPONSE);
    expect(get).toHaveBeenCalledOnce();
    const calledPath = get.mock.calls[0]![0] as string;
    expect(calledPath).toContain('/analytics/metrics?');
    expect(calledPath).toContain('startDate=2026-01-01T00%3A00%3A00.000Z');
    expect(calledPath).toContain('endDate=2026-01-08T00%3A00%3A00.000Z');
    expect(calledPath).toContain('interval=day');
  });

  it('keeps the legacy startTime/endTime parameters working', async () => {
    const { client, get } = createMockClient();
    const analytics = new AnalyticsResource(client);

    await analytics.getMetrics({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-02T00:00:00.000Z',
      interval: 'hour',
    });

    const calledPath = get.mock.calls[0]![0] as string;
    expect(calledPath).toContain('startTime=2026-01-01T00%3A00%3A00.000Z');
    expect(calledPath).toContain('endTime=2026-01-02T00%3A00%3A00.000Z');
    expect(calledPath).toContain('interval=hour');
  });

  it('omits the range when only the interval is supplied', async () => {
    const { client, get } = createMockClient();

    await getMetricsInRange(client, { interval: 'week' });

    const calledPath = get.mock.calls[0]![0] as string;
    expect(calledPath).toContain('interval=week');
    expect(calledPath).not.toContain('startDate');
    expect(calledPath).not.toContain('startTime');
  });
});
