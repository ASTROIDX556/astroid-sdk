import { describe, it, expect } from 'vitest';
import { aggregateTimeSeries, groupTimeSeriesData } from '../aggregation.js';
import { aggregateTimeSeries as aggregateTimeSeriesFromIndex } from '../index.js';

describe('aggregateTimeSeries and groupTimeSeriesData (Issue #456)', () => {
  it('is exported from package entry point', () => {
    expect(typeof aggregateTimeSeriesFromIndex).toBe('function');
  });

  it('groups hourly time-series data and fills gaps when zeroFill is enabled', () => {
    const data = [
      { timestamp: '2026-10-20T10:15:00Z', volume: '100.5', fee: '0.01', count: 2 },
      { timestamp: '2026-10-20T12:05:00Z', volume: '50.25', fee: '0.005', count: 1 },
    ];

    const result = aggregateTimeSeries(data, {
      interval: 'hour',
      zeroFill: true,
      startDate: '2026-10-20T10:00:00Z',
      endDate: '2026-10-20T13:00:00Z',
    });

    expect(result).toHaveLength(3);
    expect(result[0]!.timestamp).toBe('2026-10-20T10:00:00.000Z');
    expect(result[0]!.volume).toBe('100.5');

    // Missing bucket at 11:00 zero-filled
    expect(result[1]!.timestamp).toBe('2026-10-20T11:00:00.000Z');
    expect(result[1]!.volume).toBe('0');
    expect(result[1]!.count).toBe(0);

    expect(result[2]!.timestamp).toBe('2026-10-20T12:00:00.000Z');
    expect(result[2]!.volume).toBe('50.25');

    expect(result.totalVolume).toBe('150.75');
  });

  it('supports sorting in descending order', () => {
    const data = [
      { timestamp: '2026-10-20T10:00:00Z', volume: '10' },
      { timestamp: '2026-10-21T10:00:00Z', volume: '20' },
    ];

    const result = aggregateTimeSeries(data, {
      interval: 'day',
      sortBy: 'desc',
    });

    expect(result[0]!.timestamp).toBe('2026-10-21T00:00:00.000Z');
    expect(result[1]!.timestamp).toBe('2026-10-20T00:00:00.000Z');
  });

  it('handles empty datasets cleanly with zeroFill', () => {
    const result = aggregateTimeSeries([], {
      interval: 'day',
      zeroFill: true,
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2026-10-04T00:00:00Z',
    });

    expect(result).toHaveLength(3);
    expect(result.totalCount).toBe(0);
    expect(result.totalVolume).toBe('0');
  });

  it('works with groupTimeSeriesData helper shortcut', () => {
    const data = [
      { timestamp: '2026-10-01T00:00:00Z', volume: '10' },
      { timestamp: '2026-10-03T00:00:00Z', volume: '30' },
    ];

    const result = groupTimeSeriesData(data, 'day', true);
    expect(result).toHaveLength(3);
    expect(result[1]!.volume).toBe('0'); // Oct 2 zero filled
  });
});
