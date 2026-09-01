export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | string;

export interface AnalyticsQueryParams {
  startDate?: string;
  endDate?: string;
  timeframe?: Timeframe;
  asset?: string;
  walletId?: string;
  agentId?: string;
}

export interface TimeSeriesMetricPoint {
  timestamp: string;
  volume: string;
  fee: string;
  count: number;
  successCount: number;
  failureCount: number;
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
