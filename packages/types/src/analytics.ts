/**
 * Typed analytics result objects, ready to bind directly to charts.
 * Correspond to the `GET /analytics/*` endpoints (PRD Doc 5).
 *
 * @module
 */

import type { PaginationParams } from './common.js';
import type { DecimalString } from './entities.js';
import type { RiskBand } from './enums.js';

/** Bucket granularity for a time-series report. */
export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

/**
 * Shared analytics query filters: a time window plus optional scoping to a
 * particular asset, wallet, or agent. Both the `startDate`/`endDate` and the
 * shorthand `from`/`to` spellings are accepted.
 */
export interface AnalyticsQueryParams extends PaginationParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Shorthand alias for {@link startDate}. */
  from?: string;
  /** Shorthand alias for {@link endDate}. */
  to?: string;
  /** Bucket granularity for the report. */
  timeframe?: Timeframe;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single currency. */
  currency?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
}

/** Shared analytics query filters (alias of {@link AnalyticsQueryParams}). */
export type AnalyticsQuery = AnalyticsQueryParams;

/**
 * Analytics list queries: the shared analytics filters plus standard
 * pagination controls. Applied to the tabular analytics endpoints (per-agent
 * and per-budget rows) so clients can page through large historical result
 * sets without pulling the full payload into memory.
 */
export interface AnalyticsListParams extends AnalyticsQueryParams, PaginationParams {
  /** Field to sort the rows by. */
  sort?: string;
}

/**
 * Cursor-paginated analytics list query — the keyset counterpart to
 * {@link AnalyticsListParams}.
 *
 * Instead of a 1-based `page`, the caller passes back the opaque `cursor` from
 * the previous response's `meta.nextCursor`. Use this shape for the append-only
 * historical collections (metric rows, audit events), where offset pagination
 * can skip or duplicate entries as new rows land between requests. `limit` and
 * `order` behave identically to the offset form.
 *
 * @example
 * ```ts
 * let cursor: string | undefined;
 * do {
 *   const page = await astroid.analytics.listAgentsByCursor({ limit: 100, cursor });
 *   // ...
 *   cursor = page.nextCursor ?? undefined;
 * } while (cursor);
 * ```
 */
export interface AnalyticsCursorParams extends AnalyticsQueryParams {
  /** Field to sort the rows by. */
  sort?: string;
}

/** A single (timestamp, value) point in a chart-ready time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/** A single point in a transaction-metrics time series. */
export interface TimeSeriesMetricPoint {
  timestamp: string;
  volume: string;
  fee: string;
  count: number;
  successCount: number;
  failureCount: number;
}

/** Aggregate volume totals for a reporting window. */
export interface VolumeSummary {
  timeframe: string;
  totalVolume: string;
  totalFees: string;
  transactionCount: number;
  successRate: number;
  averageLatencyMs: number;
}

/** `GET /analytics/metrics` — a metrics time series plus its summary. */
export interface AnalyticsMetricsResponse {
  points: TimeSeriesMetricPoint[];
  summary: VolumeSummary;
}

/**
 * High-level aggregate overview for an organization, wallet, or agent.
 *
 * Returned by `analytics.overview`; the transaction/policy counters power the
 * real-time agent metric dashboards.
 */
export interface AnalyticsOverview {
  /** Total transactions in the window. */
  transactionCount: number;
  /** Transactions blocked by policy in the window. */
  policyViolations: number;
  /** Total volume moved, as a decimal string. */
  totalVolume: string;
  /** Total fees paid, as a decimal string. */
  totalFees: string;
  /** Success rate as a percentage `0`–`100`. */
  successRate: number;
}

/** `GET /analytics/spending` and `GET /analytics/cashflow`. */
export interface CashflowReport {
  currency: string;
  inflow: TimeSeriesPoint[];
  outflow: TimeSeriesPoint[];
  net: TimeSeriesPoint[];
  totalInflow: DecimalString;
  totalOutflow: DecimalString;
}

/** `GET /analytics/risk`. */
export interface RiskReport {
  distribution: Record<RiskBand, number>;
  averageScore: number;
  highRiskTransactions: number;
  trend: TimeSeriesPoint[];
}

/** One agent's line in the agent-performance report. */
export interface AgentSpendingRow {
  agentId: string;
  agentName: string;
  totalSpent: DecimalString;
  transactionCount: number;
  averageRisk: number;
}

/** `GET /analytics/agents`. */
export interface AgentAnalytics {
  currency: string;
  agents: AgentSpendingRow[];
}

/** One budget's line in the budget-utilization report. */
export interface BudgetUtilizationRow {
  budgetId: string;
  budgetName: string;
  limit: DecimalString;
  spent: DecimalString;
  remaining: DecimalString;
  utilization: number;
}

/** `GET /analytics/budgets`. */
export interface BudgetAnalytics {
  currency: string;
  budgets: BudgetUtilizationRow[];
}

/* -------------------------------------------------------------------------- */
/* Metrics aggregation query DTOs (issue #86)                                  */
/* -------------------------------------------------------------------------- */

/** Bucket granularity accepted by the metrics aggregation endpoints. */
export type MetricsInterval = 'hour' | 'day' | 'week' | 'month';

/**
 * Query DTO for `GET /analytics/agents/metrics`.
 *
 * Time range filters (`startDate`/`endDate`) plus an `interval` bucket
 * granularity, optionally scoped to a single agent or wallet. `undefined`
 * fields are omitted from the query string during serialisation.
 */
export interface AgentMetricsParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single agent. */
  agentId?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/**
 * Query DTO for `GET /analytics/spending/summary`.
 *
 * Aggregated spending totals over a time window, bucketed by `interval`.
 */
export interface SpendingSummaryParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single currency (e.g. `USD`). */
  currency?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/**
 * Query DTO for `GET /analytics/volume`.
 *
 * Transaction volume and counts over a time window, bucketed by `interval`.
 */
export interface TransactionVolumeParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
}

/** One agent's aggregated metrics row. */
export interface AgentMetricsRow {
  agentId: string;
  agentName: string;
  transactionCount: number;
  totalVolume: DecimalString;
  averageRisk: number;
}

/** `GET /analytics/agents/metrics` — per-agent metrics over a time window. */
export interface AgentMetricsReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  agents: AgentMetricsRow[];
}

/** `GET /analytics/spending/summary` — aggregated spending over a time window. */
export interface SpendingSummaryReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  currency: string;
  totalSpent: DecimalString;
  transactionCount: number;
  trend: TimeSeriesPoint[];
}

/** `GET /analytics/volume` — transaction volume over a time window. */
export interface TransactionVolumeReport {
  interval: MetricsInterval;
  startDate?: string;
  endDate?: string;
  totalVolume: DecimalString;
  transactionCount: number;
  points: TimeSeriesPoint[];
}

/* -------------------------------------------------------------------------- */
/* Time-series query DTOs (issue #227)                                          */
/* -------------------------------------------------------------------------- */

/** The metric families the analytics service can aggregate over time. */
export type TimeSeriesMetric = 'transaction_volume' | 'fee_expenditure' | 'agent_execution_count';

/**
 * Query DTO for `GET /analytics/time-series`.
 *
 * Time range filters (`startDate`/`endDate`) plus an `interval` bucket
 * granularity and one or more `metric` families. Scoping filters (`agentId`,
 * `walletId`, `asset`) are all optional and omitted from the query string when
 * undefined.
 */
export interface TimeSeriesDataParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  interval?: MetricsInterval;
  /** A single metric family to aggregate. */
  metric?: TimeSeriesMetric;
  /** Several metric families to aggregate in one request. */
  metrics?: TimeSeriesMetric[];
  /** Filter results to a single agent. */
  agentId?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
}

/** A single (timestamp, metric, value) point in a time series. */
export interface TimeSeriesDataPoint {
  /** Bucket start (ISO-8601). */
  timestamp: string;
  /** Which metric family this point belongs to. */
  metric: TimeSeriesMetric;
  /** Numeric metric value (count for execution metrics). */
  value: number;
  /** Decimal-string amount for monetary metrics (volume / fee). */
  amount?: DecimalString;
}

/** `GET /analytics/time-series` — a multi-metric time series response. */
export interface TimeSeriesDataResponse {
  /** The bucket granularity the series was grouped by. */
  interval: MetricsInterval;
  /** Inclusive start of the reporting window, echoed back by the API. */
  startDate?: string;
  /** Exclusive end of the reporting window, echoed back by the API. */
  endDate?: string;
  /** Metric families included in `points`. */
  metrics: TimeSeriesMetric[];
  /** The bucketed data points, sorted chronologically. */
  points: TimeSeriesDataPoint[];
}

/* -------------------------------------------------------------------------- */
/* Time-range query DTOs (issue #403)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Query DTO for analytics requests filtered by explicit time bounds.
 *\ * `startTime`/`endTime` bound the reporting window (ISO-8601) and `interval`
 * selects the aggregation bucket granularity, so dashboards can ask for views
 * such as "last 24 hours, hourly" or "last 30 days, daily". Optional scope
 * filters narrow the window to a single asset, wallet, or agent. `undefined`
 * fields are omitted from the query string during serialisation.
 */
export interface TimeRangeQueryParams {
  /** Inclusive start of the reporting window (ISO-8601). */
  startTime?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endTime?: string;
  /** Aggregation interval (bucket granularity) for the response. */
  interval?: MetricsInterval;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
}

/**
 * Query DTO for `GET /analytics/metrics` — a time-range filtered request for
 * one or more metric families, returned as strongly typed time-series data
 * ({@link AnalyticsMetricsResponse}).
 */
export interface MetricsQueryParams extends TimeRangeQueryParams {
  /** A single metric family to aggregate. */
  metric?: TimeSeriesMetric;
  /** Several metric families to aggregate in one request. */
  metrics?: TimeSeriesMetric[];
}

/* -------------------------------------------------------------------------- */
/* Time-series aggregation DTOs (issue #442)                                   */
/* -------------------------------------------------------------------------- */

/** Supported interval resolutions for time-series aggregation. */
export type TimeSeriesResolution =
  | 'hour'
  | 'day'
  | 'week'
  | 'hourly'
  | 'daily'
  | 'weekly';

/** Options for aggregating time-series metrics. */
export interface AggregateTimeSeriesOptions {
  /** Bucket interval resolution. Defaults to `'day'`. */
  interval?: TimeSeriesResolution;
  /** When true, generates zero-value buckets for periods with no data. Defaults to false. */
  zeroFill?: boolean;
  /** Inclusive start of the reporting window (ISO-8601 string or Date). */
  startDate?: string | Date;
  /** Alias for {@link startDate}. */
  startTime?: string | Date;
  /** Shorthand alias for {@link startDate}. */
  from?: string | Date;
  /** Exclusive end of the reporting window (ISO-8601 string or Date). */
  endDate?: string | Date;
  /** Alias for {@link endDate}. */
  endTime?: string | Date;
  /** Shorthand alias for {@link endDate}. */
  to?: string | Date;
  /** Custom formatter for chart x-axis labels. */
  formatDate?: (date: Date, interval: 'hour' | 'day' | 'week') => string;
}

/** Formatted, aggregated time-series metric bucket ready for charts and reports. */
export interface AggregatedTimeSeriesBucket extends TimeSeriesMetricPoint {
  /** ISO-8601 UTC timestamp marking the start of this interval bucket (inclusive). */
  timestamp: string;
  /** ISO-8601 UTC timestamp marking the end of this interval bucket (exclusive). */
  endTimestamp: string;
  /** Sum of transaction/spending volume in this bucket (decimal string). */
  volume: string;
  /** Sum of network/gas fees in this bucket (decimal string). */
  fee: string;
  /** Total transaction count in this bucket. */
  count: number;
  /** Total successful transactions in this bucket. */
  successCount: number;
  /** Total failed transactions in this bucket. */
  failureCount: number;
  /** Success rate between 0 and 1: `successCount / (successCount + failureCount)`. */
  successRate: number;
  /** Volume as a floating-point number for charting axes. */
  volumeNumeric: number;
  /** Fee as a floating-point number for charting axes. */
  feeNumeric: number;
  /** Human-friendly formatted date string suitable for chart x-axis labels. */
  formattedDate: string;
  /** Chart-compatible date label (alias of formattedDate). */
  date: string;
  /** Chart-compatible metric value (alias of volumeNumeric). */
  value: number;
}

/**
 * Result returned by time-series metrics aggregation.
 * Extends `Array<AggregatedTimeSeriesBucket>` for array operations, with summary totals attached.
 */
export interface AggregatedTimeSeriesResult extends Array<AggregatedTimeSeriesBucket> {
  /** Bucket granularity used for aggregation. */
  interval: 'hour' | 'day' | 'week';
  /** Resolution requested in options. */
  resolution: TimeSeriesResolution;
  /** Array of bucketed points (reference to this array). */
  points: AggregatedTimeSeriesBucket[];
  /** Per-bucket breakdown (alias of points). */
  buckets: AggregatedTimeSeriesBucket[];
  /** Summary statistics across all buckets. */
  summary: VolumeSummary;
  /** Sum of volume across all buckets (decimal string). */
  totalVolume: string;
  /** Sum of fees across all buckets (decimal string). */
  totalFees: string;
  /** Total transaction count across all buckets. */
  totalCount: number;
  /** Total successful transactions across all buckets. */
  successCount: number;
  /** Total failed transactions across all buckets. */
  failureCount: number;
  /** Global success rate across all buckets. */
  successRate: number;
}

