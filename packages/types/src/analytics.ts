import type { PaginationParams } from './common.js';

export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

export interface AnalyticsQueryParams extends PaginationParams {
  startDate?: string;
  endDate?: string;
  timeframe?: Timeframe;
  asset?: string;
  walletId?: string;
  agentId?: string;
}

/**
 * Analytics list queries: the shared analytics filters plus standard
 * pagination controls (`page`, `limit`, `order`, `cursor`).
 *
 * Applied to the tabular analytics endpoints (per-agent and per-budget rows) so
 * clients can page through large historical result sets without pulling the
 * full payload into memory.
 */
export type AnalyticsListParams = AnalyticsQueryParams;

/** A single (timestamp, value) point in a time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
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
  points: TimeSeriesPoint[];
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
