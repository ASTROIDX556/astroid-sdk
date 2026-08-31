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
