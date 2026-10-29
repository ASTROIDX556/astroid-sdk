import { describe, it, expect } from 'vitest';
import { aggregateTimeSeries } from '../aggregation.js';
import { aggregateTimeSeries as aggregateTimeSeriesFromIndex } from '../index.js';

describe('aggregateTimeSeries helper (Issue #464)', () => {
  it('is exported from @astroid/analytics package entry point', () => {
    expect(typeof aggregateTimeSeriesFromIndex).toBe('function');
    expect(typeof aggregateTimeSeries).toBe('function');
  });

  it('aggregates hourly, daily, and weekly buckets', () => {
    const rawMetrics = [
      { timestamp: '2026-10-01T10:00:00Z', volume: '100.00', fee: '0.10', count: 1 },
      { timestamp: '2026-10-01T14:30:00Z', volume: '250.00', fee: '0.25', count: 2 },
      { timestamp: '2026-10-02T08:00:00Z', volume: '50.00', fee: '0.05', count: 1 },
    ];

    const dailyResult = aggregateTimeSeries(rawMetrics, { interval: 'day' });
    expect(dailyResult).toHaveLength(2);
    expect(dailyResult[0]!.timestamp).toBe('2026-10-01T00:00:00.000Z');
    expect(dailyResult[0]!.volume).toBe('350');
    expect(dailyResult[0]!.count).toBe(3);

    const weeklyResult = aggregateTimeSeries(rawMetrics, { interval: 'week' });
    expect(weeklyResult).toHaveLength(1);
    expect(weeklyResult.totalVolume).toBe('400');
  });

  it('fills missing intervals cleanly with zero values when zeroFill is true', () => {
    const rawMetrics = [
      { timestamp: '2026-10-01T00:00:00Z', volume: '100', count: 1 },
      { timestamp: '2026-10-03T00:00:00Z', volume: '200', count: 1 },
    ];

    const result = aggregateTimeSeries(rawMetrics, {
      interval: 'day',
      zeroFill: true,
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2026-10-04T00:00:00Z',
    });

    expect(result).toHaveLength(3);
    // Oct 1
    expect(result[0]!.volume).toBe('100');
    // Oct 2 zero-filled
    expect(result[1]!.timestamp).toBe('2026-10-02T00:00:00.000Z');
    expect(result[1]!.volume).toBe('0');
    expect(result[1]!.count).toBe(0);
    // Oct 3
    expect(result[2]!.volume).toBe('200');
  });

  it('handles edge cases: empty datasets and overlapping ranges', () => {
    const emptyResult = aggregateTimeSeries([], {
      interval: 'day',
      zeroFill: true,
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2026-10-03T00:00:00Z',
    });
    expect(emptyResult).toHaveLength(2);
    expect(emptyResult.totalCount).toBe(0);
    expect(emptyResult.totalVolume).toBe('0');

    // Overlapping points in identical time bucket
    const overlapping = [
      { timestamp: '2026-10-01T10:00:00.000Z', volume: '10', fee: '1' },
      { timestamp: '2026-10-01T10:00:00.000Z', volume: '20', fee: '2' },
      { timestamp: '2026-10-01T10:30:00.000Z', volume: '30', fee: '3' },
    ];
    const hourResult = aggregateTimeSeries(overlapping, { interval: 'hour' });
    expect(hourResult).toHaveLength(1);
    expect(hourResult[0]!.volume).toBe('60');
    expect(hourResult[0]!.fee).toBe('6');
    expect(hourResult[0]!.count).toBe(3);
  });
});
