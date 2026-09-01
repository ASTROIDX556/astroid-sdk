export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

import type { DecimalString } from './entities.js';
import type { RiskBand } from './enums.js';
import type { Paginated, PaginationParams } from './common.js';

/** Query parameters accepted by analytics endpoints. */
export interface AnalyticsQuery {
  from?: string;
  to?: string;
  agentId?: string;
}

/**
 * Analytics list queries: the shared {@link AnalyticsQuery} filters plus
 * standard pagination controls (`page`, `limit`, `sort`, `order`, `search`).
 *
 * Applied to the tabular analytics endpoints (per-agent and per-budget rows) so
 * clients can page through large historical result sets without pulling the
 * full payload into memory.
 */
export interface AnalyticsListParams extends AnalyticsQuery, PaginationParams {}

/**
 * Alias for a paginated analytics results payload. Keeps the narrow, row-level
 * item type explicit at call sites (e.g. {@link AgentSpendingRow}).
 */
export type PaginatedResponse<TItem> = Paginated<TItem>;

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
