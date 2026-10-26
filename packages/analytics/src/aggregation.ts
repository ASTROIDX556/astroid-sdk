/**
 * `@astroid/analytics` — time-series aggregation helper.
 *
 * Provides pure functional time-series data aggregation and formatting helpers
 * for agent performance dashboards, with configurable time buckets (hourly, daily, weekly),
 * zero-filling of missing intervals, and decimal-safe numeric calculations.
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
 * Aggregates raw time-series metrics into chart-ready data points.
 *
 * Supports configurable time buckets ('hour' | 'day' | 'week' or 'hourly' | 'daily' | 'weekly'),
 * missing bucket zero-filling, and window bounds.
 *
 * @param input Raw metrics, time-series points, or response object.
 * @param options Bucketing, interval resolution, and zero-filling configuration.
 * @returns Strongly typed, chart-ready aggregated time-series result array.
 *
 * @example
 * ```ts
 * import { aggregateTimeSeries } from '@astroid/analytics';
 *
 * const chartData = aggregateTimeSeries(rawMetrics, {
 *   interval: 'day',
 *   zeroFill: true,
 *   startDate: '2026-10-01T00:00:00Z',
 *   endDate: '2026-10-07T00:00:00Z',
 * });
 * ```
 */
export function aggregateTimeSeries(
  input: TimeSeriesMetricsInput,
  options?: AggregateTimeSeriesOptions,
): AggregatedTimeSeriesResult {
  return aggregateTimeSeriesMetrics(input, options);
}
