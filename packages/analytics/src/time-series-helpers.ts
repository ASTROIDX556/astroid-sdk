/**
 * `@astroid/analytics` — time-series grouping and chart-formatting helpers.
 *
 * Pure, immutable transformations for raw analytics events and metric DTOs.
 * Buckets are aligned to UTC boundaries and can be zero-filled when a reporting
 * window contains no data.
 *
 * @module
 */

import type { TimeSeriesAggregationOptions } from './aggregation.js';
import { aggregateTimeSeriesMetrics } from './aggregations.js';
import type {
  AggregateGranularity,
  AggregatedTimeSeriesBucket,
  AggregatedTimeSeriesResult,
  TimeSeriesInputPoint,
  TimeSeriesMetricsInput,
} from './aggregations.js';
import type { TimeSeriesResolution } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Sort direction for grouped time-series buckets. */
export type TimeSeriesSortDirection = 'asc' | 'desc';

/** Configuration for {@link groupTimeSeriesByInterval}. */
export interface TimeSeriesGroupingOptions extends TimeSeriesAggregationOptions {
  /**
   * Number of interval units in each output bucket. For example, `{ interval:
   * 'hour', step: 6 }` produces six-hour buckets aligned to `00:00`, `06:00`,
   * `12:00`, and `18:00` UTC. Defaults to `1`.
   */
  step?: number;
  /** Sort order for the resulting buckets. Defaults to `'asc'`. */
  sortBy?: TimeSeriesSortDirection;
}

/** Bucket field used as the y-axis value in {@link formatTimeSeriesForChart}. */
export type TimeSeriesChartValue =
  | 'value'
  | 'volume'
  | 'volumeNumeric'
  | 'fee'
  | 'feeNumeric'
  | 'count'
  | 'successCount'
  | 'failureCount'
  | 'successRate';

/** Bucket field used as the x-axis label in {@link formatTimeSeriesForChart}. */
export type TimeSeriesChartLabel = 'formattedDate' | 'date' | 'timestamp';

/** Minimal chart-ready point produced by {@link formatTimeSeriesForChart}. */
export interface TimeSeriesChartPoint {
  /** X-axis label (ISO date, human-friendly label, or full timestamp). */
  date: string;
  /** Y-axis number for the selected {@link TimeSeriesChartValue}. */
  value: number;
  /** ISO-8601 UTC timestamp marking the start of the bucket. */
  timestamp: string;
  /** Same value as {@link date}, kept as a separate field for chart APIs. */
  label: string;
  /** Number of underlying events in the bucket. */
  count: number;
}

/** Options for {@link formatTimeSeriesForChart}. */
export interface TimeSeriesChartFormatOptions {
  /** Bucket field to chart. Defaults to `'value'` (numeric volume). */
  valueKey?: TimeSeriesChartValue;
  /** Bucket field used for the x-axis label. Defaults to `'formattedDate'`. */
  labelKey?: TimeSeriesChartLabel;
  /** Custom label formatter, called with each bucket and its original index. */
  formatLabel?: (bucket: AggregatedTimeSeriesBucket, index: number) => string;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const WEEK_EPOCH_MS = Date.UTC(1970, 0, 5);

type Decimal = { n: bigint; scale: number };

function toGranularity(interval: TimeSeriesResolution | undefined): AggregateGranularity {
  switch (interval) {
    case 'hour':
    case 'hourly':
      return 'hour';
    case 'week':
    case 'weekly':
      return 'week';
    default:
      return 'day';
  }
}

function intervalMs(granularity: AggregateGranularity): number {
  if (granularity === 'hour') return HOUR_MS;
  if (granularity === 'day') return DAY_MS;
  return WEEK_MS;
}

function alignToStep(date: Date, granularity: AggregateGranularity, step: number): Date {
  const size = intervalMs(granularity) * step;
  if (granularity === 'week') {
    const weekIndex = Math.floor((date.getTime() - WEEK_EPOCH_MS) / WEEK_MS);
    return new Date(WEEK_EPOCH_MS + Math.floor(weekIndex / step) * size);
  }
  return new Date(Math.floor(date.getTime() / size) * size);
}

function advanceByStep(date: Date, granularity: AggregateGranularity, step: number): Date {
  const result = new Date(date);
  if (granularity === 'hour') {
    result.setUTCHours(result.getUTCHours() + step);
  } else if (granularity === 'day') {
    result.setUTCDate(result.getUTCDate() + step);
  } else {
    result.setUTCDate(result.getUTCDate() + 7 * step);
  }
  return result;
}

function parseDecimal(value: string): Decimal | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined;
  const text = value.trim();
  const sign = text.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  return { n: sign * BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
}

function addDecimal(a: string, b: string): string {
  const left = parseDecimal(a) ?? { n: 0n, scale: 0 };
  const right = parseDecimal(b) ?? { n: 0n, scale: 0 };
  const scale = Math.max(left.scale, right.scale);
  const n =
    left.n * 10n ** BigInt(scale - left.scale) + right.n * 10n ** BigInt(scale - right.scale);
  const negative = n < 0n;
  let digits = (negative ? -n : n).toString().padStart(scale + 1, '0');
  if (scale) {
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
  }
  return `${negative ? '-' : ''}${digits || '0'}`;
}

function toValidDate(value: string | Date | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

interface StepAccumulator {
  timestamp: string;
  volume: string;
  fee: string;
  count: number;
  successCount: number;
  failureCount: number;
}

function createAccumulator(timestamp: string): StepAccumulator {
  return {
    timestamp,
    volume: '0',
    fee: '0',
    count: 0,
    successCount: 0,
    failureCount: 0,
  };
}

function toInputPoint(acc: StepAccumulator): TimeSeriesInputPoint {
  return {
    timestamp: acc.timestamp,
    volume: acc.volume,
    fee: acc.fee,
    count: acc.count,
    successCount: acc.successCount,
    failureCount: acc.failureCount,
  };
}

function withSortedBuckets(
  result: AggregatedTimeSeriesResult,
  direction: TimeSeriesSortDirection,
  resolution: TimeSeriesResolution,
): AggregatedTimeSeriesResult {
  const sorted = [...result].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (direction === 'desc') sorted.reverse();
  return Object.assign(sorted, {
    interval: result.interval,
    resolution,
    points: sorted,
    buckets: sorted,
    summary: result.summary,
    totalVolume: result.totalVolume,
    totalFees: result.totalFees,
    totalCount: result.totalCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    successRate: result.successRate,
  }) as AggregatedTimeSeriesResult;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Group raw analytics events or metric points into configurable UTC time
 * buckets and return a chart-ready aggregated result.
 *
 * Buckets are aligned to hour/day/week boundaries (weeks start on Monday) and
 * sorted chronologically unless `sortBy: 'desc'` is requested. When `zeroFill`
 * is enabled, missing buckets are inserted across the requested window (or
 * between the first and last data points when no window is supplied). The
 * `step` option creates wider buckets such as six-hour or two-week intervals.
 * Input is never mutated.
 *
 * @param input Raw metric points, a metrics response DTO, or telemetry events.
 * @param options Bucket interval, step, window, zero-fill, and sort settings.
 * @returns A {@link AggregatedTimeSeriesResult} array with attached summaries.
 * @throws {RangeError} When `step` is not a positive integer.
 *
 * @example
 * ```ts
 * import { groupTimeSeriesByInterval } from '@astroid/analytics';
 *
 * const daily = groupTimeSeriesByInterval(
 *   [{ timestamp: '2026-04-01T08:00:00Z', volume: '10' }],
 *   { interval: 'day', zeroFill: true, startDate: '2026-04-01T00:00:00Z', endDate: '2026-04-04T00:00:00Z' },
 * );
 * console.log(daily.length); // 3
 *
 * const sixHourly = groupTimeSeriesByInterval(points, { interval: 'hour', step: 6 });
 * ```
 */
export function groupTimeSeriesByInterval(
  input: TimeSeriesMetricsInput,
  options: TimeSeriesGroupingOptions = {},
): AggregatedTimeSeriesResult {
  const step = options.step ?? 1;
  if (!Number.isInteger(step) || step < 1) {
    throw new RangeError('step must be a positive integer');
  }

  const granularity = toGranularity(options.interval);
  const { step: _step, sortBy: _sortBy, ...aggregationOptions } = options;
  const base = aggregateTimeSeriesMetrics(input, { ...aggregationOptions, zeroFill: false });

  const grouped = new Map<string, StepAccumulator>();
  for (const bucket of base) {
    const start = alignToStep(new Date(bucket.timestamp), granularity, step).toISOString();
    let acc = grouped.get(start);
    if (!acc) {
      acc = createAccumulator(start);
      grouped.set(start, acc);
    }
    acc.volume = addDecimal(acc.volume, bucket.volume);
    acc.fee = addDecimal(acc.fee, bucket.fee);
    acc.count += bucket.count;
    acc.successCount += bucket.successCount;
    acc.failureCount += bucket.failureCount;
  }

  if (options.zeroFill) {
    const startBound = toValidDate(options.startDate ?? options.startTime ?? options.from);
    const endBound = toValidDate(options.endDate ?? options.endTime ?? options.to);

    if (grouped.size === 0) {
      if (startBound && endBound && startBound.getTime() < endBound.getTime()) {
        for (
          let cursor = alignToStep(startBound, granularity, step);
          cursor.getTime() < endBound.getTime();
          cursor = advanceByStep(cursor, granularity, step)
        ) {
          const key = cursor.toISOString();
          if (!grouped.has(key)) grouped.set(key, createAccumulator(key));
        }
      }
    } else {
      const keys = [...grouped.keys()].sort();
      const fallbackStart = new Date(keys[0]!);
      const fallbackEnd = advanceByStep(new Date(keys[keys.length - 1]!), granularity, step);
      const rangeStart = startBound ? alignToStep(startBound, granularity, step) : fallbackStart;
      const rangeEnd = endBound ?? fallbackEnd;

      for (
        let cursor = rangeStart;
        cursor.getTime() < rangeEnd.getTime();
        cursor = advanceByStep(cursor, granularity, step)
      ) {
        const key = cursor.toISOString();
        if (!grouped.has(key)) grouped.set(key, createAccumulator(key));
      }
    }
  }

  const points = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, acc]) => toInputPoint(acc));

  const result = aggregateTimeSeriesMetrics(points, {
    interval: options.interval,
    zeroFill: false,
    formatDate: options.formatDate,
  });
  return withSortedBuckets(result, options.sortBy ?? 'asc', options.interval ?? 'day');
}

/**
 * Group data and force zero-filled buckets so dashboards render a continuous
 * axis when a window contains no events.
 *
 * @param input Raw metric points, response DTO, or telemetry events.
 * @param options Grouping options; `zeroFill` is always enabled.
 * @returns A chronologically sorted, zero-filled {@link AggregatedTimeSeriesResult}.
 *
 * @example
 * ```ts
 * import { fillMissingTimeBuckets } from '@astroid/analytics';
 *
 * const series = fillMissingTimeBuckets(events, {
 *   interval: 'hour',
 *   startDate: '2026-05-01T00:00:00Z',
 *   endDate: '2026-05-01T06:00:00Z',
 * });
 * console.log(series.length); // 6
 * ```
 */
export function fillMissingTimeBuckets(
  input: TimeSeriesMetricsInput,
  options: TimeSeriesGroupingOptions = {},
): AggregatedTimeSeriesResult {
  return groupTimeSeriesByInterval(input, { ...options, zeroFill: true });
}

/**
 * Sort grouped buckets by their start timestamp without mutating the input.
 *
 * @param buckets Buckets returned by an aggregation helper.
 * @param direction `'asc'` for chronological (default) or `'desc'` for newest first.
 * @returns A new sorted array of buckets.
 *
 * @example
 * ```ts
 * import { sortTimeSeriesByTimestamp } from '@astroid/analytics';
 *
 * const newestFirst = sortTimeSeriesByTimestamp(series.buckets, 'desc');
 * ```
 */
export function sortTimeSeriesByTimestamp(
  buckets: readonly AggregatedTimeSeriesBucket[],
  direction: TimeSeriesSortDirection = 'asc',
): AggregatedTimeSeriesBucket[] {
  const sorted = [...buckets].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return direction === 'desc' ? sorted.reverse() : sorted;
}

/**
 * Project aggregated buckets into a minimal `{ date, value }` chart series.
 *
 * @param buckets Buckets to project (an aggregation result is an array of buckets).
 * @param options Which bucket fields to use for the label and value.
 * @returns A new array of immutable chart points; the input is untouched.
 *
 * @example
 * ```ts
 * import { formatTimeSeriesForChart } from '@astroid/analytics';
 *
 * const chart = formatTimeSeriesForChart(series, { valueKey: 'volumeNumeric' });
 * // [{ date: '2026-04-01', value: 150.25, ... }]
 * ```
 */
export function formatTimeSeriesForChart(
  buckets: readonly AggregatedTimeSeriesBucket[],
  options: TimeSeriesChartFormatOptions = {},
): TimeSeriesChartPoint[] {
  const valueKey = options.valueKey ?? 'value';
  const labelKey = options.labelKey ?? 'formattedDate';

  return buckets.map((bucket, index) => {
    const label = options.formatLabel ? options.formatLabel(bucket, index) : bucket[labelKey];
    const rawValue = bucket[valueKey];
    const value = typeof rawValue === 'string' ? Number(rawValue) || 0 : rawValue;

    return {
      date: label,
      value,
      timestamp: bucket.timestamp,
      label,
      count: bucket.count,
    };
  });
}

/**
 * Alias of {@link groupTimeSeriesByInterval} for callers that prefer binning
 * terminology.
 *
 * @example
 * ```ts
 * import { binTimeSeries } from '@astroid/analytics';
 * const hourly = binTimeSeries(events, { interval: 'hour' });
 * ```
 */
export const binTimeSeries = groupTimeSeriesByInterval;

/**
 * Alias of {@link formatTimeSeriesForChart}.
 *
 * @example
 * ```ts
 * import { formatTimeSeries } from '@astroid/analytics';
 * const chart = formatTimeSeries(buckets);
 * ```
 */
export const formatTimeSeries = formatTimeSeriesForChart;
