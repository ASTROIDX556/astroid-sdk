import { describe, expect, it } from 'vitest';

import {
  aggregateTimeSeries,
  binTimeSeries,
  fillMissingTimeBuckets,
  formatTimeSeries,
  formatTimeSeriesForChart,
  groupTimeSeriesByInterval,
  sortTimeSeriesByTimestamp,
} from '../index.js';
import { groupTimeSeriesByInterval as groupedFromTimeSeriesModule } from '../time-series.js';

describe('time-series grouping helpers (issue #432)', () => {
  it('is exported from the package entry point and time-series module', () => {
    expect(typeof groupTimeSeriesByInterval).toBe('function');
    expect(typeof groupedFromTimeSeriesModule).toBe('function');
    expect(typeof binTimeSeries).toBe('function');
    expect(typeof fillMissingTimeBuckets).toBe('function');
  });

  it('groups raw points into hourly, daily, and weekly UTC buckets', () => {
    const points = [
      { timestamp: '2026-04-06T08:15:00Z', volume: '100.10', fee: '0.01', count: 2 },
      { timestamp: '2026-04-06T08:45:00Z', volume: '50.25', fee: '0.02', count: 1 },
      { timestamp: '2026-04-07T09:00:00Z', volume: '25', fee: '0.005', count: 1 },
    ];

    const hourly = groupTimeSeriesByInterval(points, { interval: 'hour' });
    expect(hourly.map((bucket) => bucket.timestamp)).toEqual([
      '2026-04-06T08:00:00.000Z',
      '2026-04-07T09:00:00.000Z',
    ]);
    expect(hourly[0]!.volume).toBe('150.35');
    expect(hourly[0]!.fee).toBe('0.03');
    expect(hourly[0]!.count).toBe(3);

    const daily = groupTimeSeriesByInterval(points, { interval: 'day' });
    expect(daily).toHaveLength(2);
    expect(daily[0]!.formattedDate).toBe('2026-04-06');
    expect(daily.totalVolume).toBe('175.35');

    const weekly = groupTimeSeriesByInterval(points, { interval: 'week' });
    expect(weekly).toHaveLength(1);
    expect(weekly[0]!.timestamp).toBe('2026-04-06T00:00:00.000Z');
    expect(weekly[0]!.endTimestamp).toBe('2026-04-13T00:00:00.000Z');
  });

  it('zero-fills missing intervals across explicit bounds', () => {
    const points = [
      { timestamp: '2026-04-01T00:00:00Z', volume: '10', count: 1 },
      { timestamp: '2026-04-03T00:00:00Z', volume: '30', count: 1 },
    ];

    const result = fillMissingTimeBuckets(points, {
      interval: 'day',
      startDate: '2026-03-30T12:00:00Z',
      endDate: '2026-04-05T00:00:00Z',
    });

    expect(result.map((bucket) => bucket.date)).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
    ]);
    expect(result[0]!.volume).toBe('0');
    expect(result[2]!.volume).toBe('10');
    expect(result[3]!.count).toBe(0);
    expect(result[4]!.volume).toBe('30');
    expect(result.totalVolume).toBe('40');
  });

  it('supports multi-unit interval steps aligned to UTC boundaries', () => {
    const points = [
      { timestamp: '2026-04-06T01:00:00Z', volume: '5' },
      { timestamp: '2026-04-06T07:00:00Z', volume: '7' },
      { timestamp: '2026-04-06T13:00:00Z', volume: '11' },
    ];

    const sixHourly = groupTimeSeriesByInterval(points, {
      interval: 'hour',
      step: 6,
      zeroFill: true,
      startDate: '2026-04-06T00:00:00Z',
      endDate: '2026-04-07T00:00:00Z',
    });

    expect(sixHourly.map((bucket) => bucket.timestamp)).toEqual([
      '2026-04-06T00:00:00.000Z',
      '2026-04-06T06:00:00.000Z',
      '2026-04-06T12:00:00.000Z',
      '2026-04-06T18:00:00.000Z',
    ]);
    expect(sixHourly.map((bucket) => bucket.volume)).toEqual(['5', '7', '11', '0']);
    expect(sixHourly.totalVolume).toBe('23');
    expect(
      aggregateTimeSeries(points, {
        interval: 'hour',
        step: 6,
        zeroFill: true,
        startDate: '2026-04-06T00:00:00Z',
        endDate: '2026-04-07T00:00:00Z',
      }).length,
    ).toBe(4);

    expect(() => groupTimeSeriesByInterval(points, { step: 0 })).toThrow(RangeError);
  });

  it('groups two-week steps from Monday boundaries', () => {
    const result = groupTimeSeriesByInterval(
      [
        { timestamp: '2026-04-06T00:00:00Z', volume: '1' },
        { timestamp: '2026-04-20T00:00:00Z', volume: '2' },
      ],
      { interval: 'week', step: 2 },
    );

    expect(result.map((bucket) => bucket.timestamp)).toEqual([
      '2026-03-30T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z',
    ]);
  });

  it('supports descending sort and never mutates the input array', () => {
    const points = [
      { timestamp: '2026-04-01T00:00:00Z', volume: '1' },
      { timestamp: '2026-04-02T00:00:00Z', volume: '2' },
    ];
    const input = Object.freeze(points.slice());

    const result = groupTimeSeriesByInterval(input, { interval: 'day', sortBy: 'desc' });
    expect(result.map((bucket) => bucket.volume)).toEqual(['2', '1']);
    expect(input).toEqual(points);
    expect(sortTimeSeriesByTimestamp(result, 'asc').map((bucket) => bucket.volume)).toEqual([
      '1',
      '2',
    ]);
  });

  it('applies custom date formatting and projects chart-ready points', () => {
    const points = [
      { timestamp: '2026-05-01T08:00:00Z', volume: '150.25', fee: '0.05', count: 2 },
      { timestamp: '2026-05-02T08:00:00Z', volume: '75', fee: '0.01', count: 1 },
    ];

    const grouped = groupTimeSeriesByInterval(points, {
      interval: 'day',
      formatDate: (date) => `Day ${date.getUTCDate()}`,
    });
    const chart = formatTimeSeriesForChart(grouped, {
      valueKey: 'volumeNumeric',
      labelKey: 'formattedDate',
    });

    expect(chart).toEqual([
      {
        date: 'Day 1',
        label: 'Day 1',
        value: 150.25,
        timestamp: '2026-05-01T00:00:00.000Z',
        count: 2,
      },
      {
        date: 'Day 2',
        label: 'Day 2',
        value: 75,
        timestamp: '2026-05-02T00:00:00.000Z',
        count: 1,
      },
    ]);
    expect(formatTimeSeries).toBe(formatTimeSeriesForChart);
  });

  it('handles normalized analytics events and malformed values safely', () => {
    const events = [
      {
        name: 'agent.executed',
        timestamp: '2026-06-01T10:00:00Z',
        properties: { amount: '12.5', fee: '0.25', count: 2, status: 'COMPLETED' },
      },
      {
        name: 'agent.executed',
        timestamp: '2026-06-01T11:00:00Z',
        properties: { amount: 'not-a-number', status: 'FAILED' },
      },
      { name: 'agent.executed', timestamp: 'invalid-date', properties: { amount: '99' } },
    ];

    const result = groupTimeSeriesByInterval(events, { interval: 'hour' });
    expect(result).toHaveLength(2);
    expect(result[0]!.volume).toBe('12.5');
    expect(result[0]!.fee).toBe('0.25');
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.successCount).toBe(1);
    expect(result[1]!.volume).toBe('0');
    expect(result[1]!.count).toBe(1);
    expect(result[1]!.failureCount).toBe(1);
    expect(result.totalVolume).toBe('12.5');
  });

  it('accepts scientific notation and ignores malformed decimal values', () => {
    const result = groupTimeSeriesByInterval(
      [
        { timestamp: '2026-07-01T00:00:00Z', volume: '1e2', fee: '5e-2' },
        { timestamp: '2026-07-01T01:00:00Z', volume: 'not-a-number', fee: 'NaN' },
      ],
      { interval: 'day' },
    );

    expect(result[0]!.volume).toBe('100');
    expect(result[0]!.fee).toBe('0.05');
  });

  it('returns an empty result for empty input without bounds', () => {
    const result = groupTimeSeriesByInterval([], { interval: 'day' });
    expect(result).toHaveLength(0);
    expect(result.totalVolume).toBe('0');
    expect(result.points).toBe(result);
    expect(result.buckets).toBe(result);
  });
});
