/**
 * `@astroid/analytics` — time-series grouping and aggregation module.
 *
 * Provides utilities for grouping, sorting, and aggregating time-series data
 * with support for interval bucketing (hourly, daily, weekly), gap filling,
 * and zero-filling placeholders.
 *
 * @module
 */

import {
  aggregateTimeSeriesMetrics,
  type AggregateGranularity,
  type AggregateTimeSeriesOptions,
  type AggregatedTimeSeriesBucket,
  type AggregatedTimeSeriesResult,
  type TimeSeriesInputPoint,
  type TimeSeriesMetricsInput,
  type TimeSeriesResolution,
} from './aggregations.js';

export {
  aggregateTimeSeriesMetrics,
  type AggregateGranularity,
  type AggregateTimeSeriesOptions,
  type AggregatedTimeSeriesBucket,
  type AggregatedTimeSeriesResult,
  type TimeSeriesInputPoint,
  type TimeSeriesMetricsInput,
  type TimeSeriesResolution,
};

/**
 * Options for {@link aggregateTimeSeries} and time-series grouping helpers.
 */
export interface TimeSeriesAggregationOptions extends AggregateTimeSeriesOptions {
  /**
   * Sort direction for output buckets. Defaults to `'asc'` (chronological).
   */
  sortBy?: 'asc' | 'desc';
}

/**
 * Alias for {@link aggregateTimeSeriesMetrics} conforming to the time-series aggregation interface.
 *
 * Groups raw metric data points or transactions into configurable time buckets
 * (hourly, daily, weekly), fills missing intervals when zeroFill is enabled,
 * sorts buckets chronologically or reverse-chronologically, and calculates summary metrics.
 *
 * @param input Raw metrics, time-series points, or response object.
 * @param options Grouping, bucketing, sorting, and windowing options.
 * @returns Array of bucketed points with aggregated summary metrics.
 *
 * @example
 * ```ts
 * import { aggregateTimeSeries } from '@astroid/analytics';
 *
 * const result = aggregateTimeSeries([
 *   { timestamp: '2026-10-01T10:00:00Z', volume: '100.5' },
 *   { timestamp: '2026-10-01T11:00:00Z', volume: '250.0' }
 * ], { interval: 'hour', zeroFill: true });
 * ```
 */
export function aggregateTimeSeries(
  input: TimeSeriesMetricsInput,
  options: TimeSeriesAggregationOptions = {},
): AggregatedTimeSeriesResult {
  const result = aggregateTimeSeriesMetrics(input, options);

  if (options.sortBy === 'desc') {
    result.reverse();
    result.points = result;
    result.buckets = result;
  }

  return result;
}

/**
 * Groups and sorts time-series data points by bucket interval with gap filling.
 *
 * @param input Data points or metric response to group.
 * @param interval Bucket interval resolution ('hour' | 'day' | 'week'). Defaults to 'day'.
 * @param zeroFill Whether to fill missing intervals with zero values. Defaults to true.
 * @returns Bucketed and sorted time-series result.
 */
export function groupTimeSeriesData(
  input: TimeSeriesMetricsInput,
  interval: TimeSeriesResolution = 'day',
  zeroFill = true,
): AggregatedTimeSeriesResult {
  return aggregateTimeSeries(input, { interval, zeroFill });
}
