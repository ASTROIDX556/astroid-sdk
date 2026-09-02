import type { PaginationParams } from './common.js';

export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

/**
 * Shared analytics query filters: a time window plus optional scoping to a
 * particular asset, wallet, or agent.
 */
export interface AnalyticsQuery {
  /** Inclusive start of the reporting window (ISO-8601). */
  startDate?: string;
  /** Exclusive end of the reporting window (ISO-8601). */
  endDate?: string;
  /** Bucket granularity for the report. */
  timeframe?: Timeframe;
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
}

export interface AnalyticsQueryParams extends AnalyticsQuery, PaginationParams {}

/**
 * Analytics list queries: the shared {@link AnalyticsQuery} filters plus
 * standard pagination controls (`page`, `limit`, `sort`, `order`, `search`).
 *
 * Applied to the tabular analytics endpoints (per-agent and per-budget rows) so
 * clients can page through large historical result sets without pulling the
 * full payload into memory.
 */
export interface AnalyticsListParams extends AnalyticsQuery, PaginationParams {}

/** A single (timestamp, value) point in a time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/** A bucketed metric point returned by the analytics time-series endpoint. */
export interface TimeSeriesMetricPoint {
  /** ISO-8601 timestamp of the bucket start. */
  timestamp: string;
  /** Total transaction volume in the bucket, as a decimal string. */
  volume: string;
  /** Total fees in the bucket, as a decimal string. */
  fees: string;
  /** Number of transactions in the bucket. */
  count: number;
  /** Success rate as a value `0`–`1` in the bucket. */
  successRate: number;
}

export interface VolumeSummary {
  timeframe: string;
  totalVolume: string;
  totalFees: string;
  transactionCount: number;
  successRate: number;
  averageLatencyMs: number;
}

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
