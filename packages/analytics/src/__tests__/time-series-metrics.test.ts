import { describe, expect, it } from 'vitest';
import {
  aggregateTimeSeriesMetrics,
  type AggregatedTimeSeriesBucket,
  type AggregateTimeSeriesOptions,
} from '../index.js';
import type {
  AnalyticsMetricsResponse,
  TimeSeriesDataResponse,
  TimeSeriesMetricPoint,
} from '@astroid/types';

describe('aggregateTimeSeriesMetrics', () => {
  describe('empty datasets', () => {
    it('returns an empty array result for an empty array', () => {
      const result = aggregateTimeSeriesMetrics([]);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
      expect(result.points).toHaveLength(0);
      expect(result.buckets).toHaveLength(0);
      expect(result.totalVolume).toBe('0');
      expect(result.totalFees).toBe('0');
      expect(result.totalCount).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.summary.totalVolume).toBe('0');
      expect(result.summary.transactionCount).toBe(0);
    });

    it('handles null and undefined gracefully', () => {
      const fromNull = aggregateTimeSeriesMetrics(null);
      expect(fromNull).toHaveLength(0);
      expect(fromNull.totalVolume).toBe('0');

      const fromUndefined = aggregateTimeSeriesMetrics(undefined);
      expect(fromUndefined).toHaveLength(0);
      expect(fromUndefined.totalVolume).toBe('0');
    });

    it('returns an empty result when response DTO contains empty points', () => {
      const response: AnalyticsMetricsResponse = {
        points: [],
        summary: {
          timeframe: 'day',
          totalVolume: '0',
          totalFees: '0',
          transactionCount: 0,
          successRate: 0,
          averageLatencyMs: 0,
        },
      };

      const result = aggregateTimeSeriesMetrics(response);
      expect(result).toHaveLength(0);
      expect(result.totalVolume).toBe('0');
    });

    it('generates zero-filled buckets for empty dataset when start and end bounds are provided', () => {
      const result = aggregateTimeSeriesMetrics([], {
        interval: 'hourly',
        zeroFill: true,
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-03-01T04:00:00.000Z',
      });

      expect(result).toHaveLength(4);
      expect(result[0]!.timestamp).toBe('2026-03-01T00:00:00.000Z');
      expect(result[0]!.endTimestamp).toBe('2026-03-01T01:00:00.000Z');
      expect(result[0]!.formattedDate).toBe('2026-03-01 00:00');
      expect(result[0]!.volume).toBe('0');
      expect(result[0]!.fee).toBe('0');
      expect(result[0]!.count).toBe(0);
      expect(result[0]!.volumeNumeric).toBe(0);

      expect(result[3]!.timestamp).toBe('2026-03-01T03:00:00.000Z');
      expect(result[3]!.endTimestamp).toBe('2026-03-01T04:00:00.000Z');
      expect(result.totalVolume).toBe('0');
      expect(result.totalCount).toBe(0);
    });
  });

  describe('interval resolutions', () => {
    const rawPoints: TimeSeriesMetricPoint[] = [
      {
        timestamp: '2026-01-05T08:15:00.000Z', // Monday
        volume: '100.50',
        fee: '0.01',
        count: 2,
        successCount: 2,
        failureCount: 0,
      },
      {
        timestamp: '2026-01-05T14:30:00.000Z', // Monday (same day, different hour)
        volume: '50.25',
        fee: '0.005',
        count: 1,
        successCount: 1,
        failureCount: 0,
      },
      {
        timestamp: '2026-01-06T10:00:00.000Z', // Tuesday (same week, different day)
        volume: '200.00',
        fee: '0.02',
        count: 3,
        successCount: 2,
        failureCount: 1,
      },
    ];

    it('defaults to daily interval resolution when unspecified', () => {
      const result = aggregateTimeSeriesMetrics(rawPoints);

      expect(result.interval).toBe('day');
      expect(result.resolution).toBe('day');
      expect(result).toHaveLength(2); // 2026-01-05 and 2026-01-06

      expect(result[0]!.timestamp).toBe('2026-01-05T00:00:00.000Z');
      expect(result[0]!.endTimestamp).toBe('2026-01-06T00:00:00.000Z');
      expect(result[0]!.formattedDate).toBe('2026-01-05');
      expect(result[0]!.date).toBe('2026-01-05');
      expect(result[0]!.volume).toBe('150.75');
      expect(result[0]!.fee).toBe('0.015');
      expect(result[0]!.count).toBe(3);
      expect(result[0]!.successCount).toBe(3);
      expect(result[0]!.failureCount).toBe(0);
      expect(result[0]!.successRate).toBe(1);

      expect(result[1]!.timestamp).toBe('2026-01-06T00:00:00.000Z');
      expect(result[1]!.volume).toBe('200');
      expect(result[1]!.count).toBe(3);
      expect(result[1]!.successRate).toBeCloseTo(2 / 3);

      expect(result.totalVolume).toBe('350.75');
      expect(result.totalFees).toBe('0.035');
      expect(result.totalCount).toBe(6);
      expect(result.successCount).toBe(5);
      expect(result.failureCount).toBe(1);
      expect(result.successRate).toBeCloseTo(5 / 6);
    });

    it('supports hourly resolution using "hour" or "hourly"', () => {
      for (const resolution of ['hour', 'hourly'] as const) {
        const result = aggregateTimeSeriesMetrics(rawPoints, { interval: resolution });

        expect(result.interval).toBe('hour');
        expect(result.resolution).toBe(resolution);
        expect(result).toHaveLength(3); // 08:00, 14:00, and next day 10:00

        expect(result[0]!.timestamp).toBe('2026-01-05T08:00:00.000Z');
        expect(result[0]!.endTimestamp).toBe('2026-01-05T09:00:00.000Z');
        expect(result[0]!.formattedDate).toBe('2026-01-05 08:00');
        expect(result[0]!.volume).toBe('100.5');

        expect(result[1]!.timestamp).toBe('2026-01-05T14:00:00.000Z');
        expect(result[1]!.endTimestamp).toBe('2026-01-05T15:00:00.000Z');
        expect(result[1]!.formattedDate).toBe('2026-01-05 14:00');
        expect(result[1]!.volume).toBe('50.25');

        expect(result[2]!.timestamp).toBe('2026-01-06T10:00:00.000Z');
        expect(result[2]!.formattedDate).toBe('2026-01-06 10:00');
        expect(result[2]!.volume).toBe('200');
      }
    });

    it('supports weekly resolution using "week" or "weekly"', () => {
      for (const resolution of ['week', 'weekly'] as const) {
        const result = aggregateTimeSeriesMetrics(rawPoints, { interval: resolution });

        expect(result.interval).toBe('week');
        expect(result.resolution).toBe(resolution);
        expect(result).toHaveLength(1); // Monday Jan 5 to Sunday Jan 11

        expect(result[0]!.timestamp).toBe('2026-01-05T00:00:00.000Z');
        expect(result[0]!.endTimestamp).toBe('2026-01-12T00:00:00.000Z');
        expect(result[0]!.formattedDate).toBe('2026-01-05');
        expect(result[0]!.volume).toBe('350.75');
        expect(result[0]!.fee).toBe('0.035');
        expect(result[0]!.count).toBe(6);
        expect(result.totalVolume).toBe('350.75');
      }
    });
  });

  describe('overlapping timestamps aggregation', () => {
    it('aggregates multiple points falling into the exact same bucket', () => {
      const overlappingPoints: TimeSeriesMetricPoint[] = [
        {
          timestamp: '2026-02-10T12:05:00.000Z',
          volume: '120.40',
          fee: '0.002',
          count: 5,
          successCount: 4,
          failureCount: 1,
        },
        {
          timestamp: '2026-02-10T12:20:00.000Z',
          volume: '80.60',
          fee: '0.003',
          count: 3,
          successCount: 3,
          failureCount: 0,
        },
        {
          timestamp: '2026-02-10T12:55:00.000Z',
          volume: '50.00',
          fee: '0.001',
          count: 2,
          successCount: 1,
          failureCount: 1,
        },
      ];

      const result = aggregateTimeSeriesMetrics(overlappingPoints, { interval: 'hourly' });

      expect(result).toHaveLength(1);
      const bucket = result[0]!;
      expect(bucket.timestamp).toBe('2026-02-10T12:00:00.000Z');
      expect(bucket.endTimestamp).toBe('2026-02-10T13:00:00.000Z');
      expect(bucket.formattedDate).toBe('2026-02-10 12:00');

      // Exact decimal addition: 120.40 + 80.60 + 50.00 = 251
      expect(bucket.volume).toBe('251');
      expect(bucket.volumeNumeric).toBe(251);
      expect(bucket.fee).toBe('0.006');
      expect(bucket.feeNumeric).toBe(0.006);

      expect(bucket.count).toBe(10);
      expect(bucket.successCount).toBe(8);
      expect(bucket.failureCount).toBe(2);
      expect(bucket.successRate).toBe(0.8);
    });

    it('preserves high decimal precision without floating point errors', () => {
      const precisionPoints: TimeSeriesMetricPoint[] = [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          volume: '0.1',
          fee: '0.00000001',
          count: 1,
          successCount: 1,
          failureCount: 0,
        },
        {
          timestamp: '2026-01-01T01:00:00.000Z',
          volume: '0.2',
          fee: '0.00000002',
          count: 1,
          successCount: 1,
          failureCount: 0,
        },
      ];

      const result = aggregateTimeSeriesMetrics(precisionPoints, { interval: 'daily' });

      expect(result).toHaveLength(1);
      // 0.1 + 0.2 in JS float is 0.30000000000000004, but decimal string math gives exact '0.3'
      expect(result[0]!.volume).toBe('0.3');
      expect(result[0]!.fee).toBe('0.00000003');
    });
  });

  describe('zero-filling missing periods', () => {
    const pointsWithGaps: TimeSeriesMetricPoint[] = [
      {
        timestamp: '2026-04-01T00:00:00.000Z',
        volume: '100',
        fee: '0.01',
        count: 1,
        successCount: 1,
        failureCount: 0,
      },
      {
        timestamp: '2026-04-04T00:00:00.000Z',
        volume: '300',
        fee: '0.03',
        count: 2,
        successCount: 2,
        failureCount: 0,
      },
    ];

    it('does not zero-fill when zeroFill is false', () => {
      const result = aggregateTimeSeriesMetrics(pointsWithGaps, { zeroFill: false });

      expect(result).toHaveLength(2);
      expect(result[0]!.date).toBe('2026-04-01');
      expect(result[1]!.date).toBe('2026-04-04');
    });

    it('zero-fills missing periods between earliest and latest data points', () => {
      const result = aggregateTimeSeriesMetrics(pointsWithGaps, {
        interval: 'day',
        zeroFill: true,
      });

      expect(result).toHaveLength(4);
      expect(result.map((b) => b.date)).toEqual([
        '2026-04-01',
        '2026-04-02',
        '2026-04-03',
        '2026-04-04',
      ]);

      // Apr 1: has data
      expect(result[0]!.volume).toBe('100');
      expect(result[0]!.count).toBe(1);

      // Apr 2: zero-filled
      expect(result[1]!.volume).toBe('0');
      expect(result[1]!.fee).toBe('0');
      expect(result[1]!.count).toBe(0);
      expect(result[1]!.successCount).toBe(0);
      expect(result[1]!.failureCount).toBe(0);
      expect(result[1]!.successRate).toBe(0);
      expect(result[1]!.volumeNumeric).toBe(0);

      // Apr 3: zero-filled
      expect(result[2]!.volume).toBe('0');
      expect(result[2]!.count).toBe(0);

      // Apr 4: has data
      expect(result[3]!.volume).toBe('300');
      expect(result[3]!.count).toBe(2);

      // Global totals match actual data
      expect(result.totalVolume).toBe('400');
      expect(result.totalFees).toBe('0.04');
      expect(result.totalCount).toBe(3);
    });

    it('zero-fills leading and trailing buckets when explicit bounds are provided', () => {
      const result = aggregateTimeSeriesMetrics(pointsWithGaps, {
        interval: 'day',
        zeroFill: true,
        startDate: '2026-03-30T00:00:00.000Z',
        endDate: '2026-04-06T00:00:00.000Z',
      });

      expect(result).toHaveLength(7); // Mar 30, Mar 31, Apr 1, Apr 2, Apr 3, Apr 4, Apr 5
      expect(result.map((b) => b.date)).toEqual([
        '2026-03-30',
        '2026-03-31',
        '2026-04-01',
        '2026-04-02',
        '2026-04-03',
        '2026-04-04',
        '2026-04-05',
      ]);

      expect(result[0]!.volume).toBe('0'); // Mar 30
      expect(result[1]!.volume).toBe('0'); // Mar 31
      expect(result[2]!.volume).toBe('100'); // Apr 1
      expect(result[3]!.volume).toBe('0'); // Apr 2
      expect(result[4]!.volume).toBe('0'); // Apr 3
      expect(result[5]!.volume).toBe('300'); // Apr 4
      expect(result[6]!.volume).toBe('0'); // Apr 5
    });
  });

  describe('input formats and DTO unwrapping', () => {
    it('unwraps AnalyticsMetricsResponse objects', () => {
      const response: AnalyticsMetricsResponse = {
        points: [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            volume: '500',
            fee: '0.05',
            count: 5,
            successCount: 4,
            failureCount: 1,
          },
        ],
        summary: {
          timeframe: 'day',
          totalVolume: '500',
          totalFees: '0.05',
          transactionCount: 5,
          successRate: 0.8,
          averageLatencyMs: 120,
        },
      };

      const result = aggregateTimeSeriesMetrics(response);
      expect(result).toHaveLength(1);
      expect(result[0]!.volume).toBe('500');
      expect(result.totalVolume).toBe('500');
      expect(result.totalCount).toBe(5);
    });

    it('unwraps TimeSeriesDataResponse objects with TimeSeriesDataPoint entries', () => {
      const response: TimeSeriesDataResponse = {
        interval: 'day',
        metrics: ['transaction_volume'],
        points: [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            metric: 'transaction_volume',
            value: 750,
            amount: '750.00',
          },
          {
            timestamp: '2026-01-01T12:00:00.000Z',
            metric: 'transaction_volume',
            value: 250,
            amount: '250.00',
          },
        ],
      };

      const result = aggregateTimeSeriesMetrics(response, { interval: 'day' });
      expect(result).toHaveLength(1);
      expect(result[0]!.volume).toBe('1000');
      expect(result.totalVolume).toBe('1000');
    });

    it('handles points with status field when successCount/failureCount omitted', () => {
      const points = [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          amount: '100',
          status: 'COMPLETED',
        },
        {
          timestamp: '2026-01-01T01:00:00.000Z',
          amount: '50',
          status: 'FAILED',
        },
      ];

      const result = aggregateTimeSeriesMetrics(points, { interval: 'day' });
      expect(result).toHaveLength(1);
      expect(result[0]!.volume).toBe('150');
      expect(result[0]!.successCount).toBe(1);
      expect(result[0]!.failureCount).toBe(1);
      expect(result[0]!.successRate).toBe(0.5);
    });

    it('skips items with invalid timestamps without throwing', () => {
      const points = [
        {
          timestamp: 'not-a-valid-date',
          volume: '100',
        },
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          volume: '50',
        },
      ];

      const result = aggregateTimeSeriesMetrics(points);
      expect(result).toHaveLength(1);
      expect(result[0]!.volume).toBe('50');
      expect(result.totalVolume).toBe('50');
    });
  });

  describe('custom date formatting', () => {
    it('applies custom formatDate function when provided', () => {
      const points: TimeSeriesMetricPoint[] = [
        {
          timestamp: '2026-05-15T00:00:00.000Z',
          volume: '100',
          fee: '0.01',
          count: 1,
          successCount: 1,
          failureCount: 0,
        },
      ];

      const customFormatter: AggregateTimeSeriesOptions['formatDate'] = (date) =>
        `Day ${date.getUTCDate()}`;

      const result = aggregateTimeSeriesMetrics(points, {
        formatDate: customFormatter,
      });

      expect(result[0]!.formattedDate).toBe('Day 15');
      // date field still provides ISO YYYY-MM-DD
      expect(result[0]!.date).toBe('2026-05-15');
    });
  });

  describe('ergonomics and chart compatibility', () => {
    it('provides chart-compatible date and value fields on every bucket', () => {
      const points: TimeSeriesMetricPoint[] = [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          volume: '150.25',
          fee: '0.05',
          count: 2,
          successCount: 2,
          failureCount: 0,
        },
      ];

      const result = aggregateTimeSeriesMetrics(points);
      const bucket: AggregatedTimeSeriesBucket = result[0]!;

      // TimeSeriesPoint compatibility: { date: string, value: number }
      expect(bucket.date).toBe('2026-01-01');
      expect(bucket.value).toBe(150.25);

      // TimeSeriesMetricPoint compatibility
      expect(bucket.timestamp).toBe('2026-01-01T00:00:00.000Z');
      expect(bucket.volume).toBe('150.25');
      expect(bucket.fee).toBe('0.05');
      expect(bucket.count).toBe(2);
      expect(bucket.successCount).toBe(2);
      expect(bucket.failureCount).toBe(0);

      // Extended formatting properties
      expect(bucket.formattedDate).toBe('2026-01-01');
      expect(bucket.volumeNumeric).toBe(150.25);
      expect(bucket.feeNumeric).toBe(0.05);
      expect(bucket.successRate).toBe(1);
    });

    it('supports array iteration and indexing as well as property access', () => {
      const points: TimeSeriesMetricPoint[] = [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          volume: '10',
          fee: '0',
          count: 1,
          successCount: 1,
          failureCount: 0,
        },
        {
          timestamp: '2026-01-02T00:00:00.000Z',
          volume: '20',
          fee: '0',
          count: 1,
          successCount: 1,
          failureCount: 0,
        },
      ];

      const result = aggregateTimeSeriesMetrics(points);

      // Array methods
      const mapped = result.map((b) => b.volume);
      expect(mapped).toEqual(['10', '20']);

      const filtered = result.filter((b) => b.volumeNumeric > 15);
      expect(filtered).toHaveLength(1);

      // Properties
      expect(result.points).toBe(result);
      expect(result.buckets).toBe(result);
      expect(result.totalVolume).toBe('30');
      expect(result.interval).toBe('day');
      expect(result.summary.totalVolume).toBe('30');
    });
  });
});
