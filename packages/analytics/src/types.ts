/**
 * `@astroid/analytics` — public query types for time-series aggregation.
 *
 * Developers monitoring agent spending velocity and transaction volume need
 * time-series data grouped by custom intervals (hourly, daily, weekly) and
 * bounded by an explicit date range (issue #563). These types describe that
 * query surface:
 *
 * - {@link AnalyticsInterval} — the supported aggregation granularities.
 * - {@link AnalyticsDateRange} — an inclusive/exclusive date window, accepting
 *   ISO-8601 strings or `Date` instances (normalised to ISO-8601 UTC before
 *   serialisation).
 * - {@link AnalyticsMetricsQuery} — the full query accepted by
 *   `getMetrics`: date range, interval, metric families, and scope filters.
 *
 * @module
 */

import type { MetricsQueryParams, TimeSeriesMetric } from '@astroid/types';

export type {
  MetricsInterval,
  MetricsQueryParams,
  TimeRangeQueryParams,
  TimeSeriesMetric,
} from '@astroid/types';

/**
 * Bucket granularities supported by the time-series aggregation endpoints.
 *
 * Mirrors the API's accepted values: `'hour'`, `'day'`, and `'week'`.
 */
export type AnalyticsInterval = 'hour' | 'day' | 'week';

/**
 * A reporting date range for time-series aggregation.
 *
 * Both bounds are optional and may be supplied as an ISO-8601 string or a
 * `Date`; values are converted to ISO-8601 UTC strings so query encoding is
 * identical across runtimes. Unparseable dates are omitted rather than sent as
 * `Invalid Date`.
 */
export interface AnalyticsDateRange {
  /** Inclusive start of the reporting window (ISO-8601 string or `Date`). */
  startDate?: string | Date;
  /** Exclusive end of the reporting window (ISO-8601 string or `Date`). */
  endDate?: string | Date;
}

/**
 * Query accepted by `analytics.getMetrics(...)`.
 *
 * Extends the core {@link MetricsQueryParams} (`startTime`/`endTime`, metric
 * selection, and scope filters) with the `startDate`/`endDate` range aliases
 * and the `'hour' | 'day' | 'week'` interval granularity. When both spellings
 * are present, `startDate`/`endDate` win and serialise under those names.
 *
 * @example
 * ```ts
 * const query: AnalyticsMetricsQuery = {
 *   startDate: '2026-01-01T00:00:00.000Z',
 *   endDate: '2026-02-01T00:00:00.000Z',
 *   interval: 'week',
 *   metrics: ['transaction_volume', 'fee_expenditure'],
 * };
 * ```
 */
export interface AnalyticsMetricsQuery extends MetricsQueryParams, AnalyticsDateRange {
  /** Aggregation interval (bucket granularity) for the response. */
  interval?: AnalyticsInterval;
  /** A single metric family to aggregate. */
  metric?: TimeSeriesMetric;
  /** Several metric families to aggregate in one request. */
  metrics?: TimeSeriesMetric[];
}
