import type { HttpClient } from '@astroid/core';
import type { AnalyticsQueryParams, AnalyticsMetricsResponse, VolumeSummary } from '@astroid/types';

export class AnalyticsResource {
  constructor(private readonly client: HttpClient) {}

  /**
   * Fetch time-series analytics metrics matching the given parameters.
   */
  async getMetrics(params?: AnalyticsQueryParams): Promise<AnalyticsMetricsResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.startDate) searchParams.set('startDate', params.startDate);
      if (params.endDate) searchParams.set('endDate', params.endDate);
      if (params.timeframe) searchParams.set('timeframe', params.timeframe);
      if (params.asset) searchParams.set('asset', params.asset);
      if (params.walletId) searchParams.set('walletId', params.walletId);
      if (params.agentId) searchParams.set('agentId', params.agentId);
    }

    const query = searchParams.toString();
    const path = query ? `/analytics/metrics?${query}` : '/analytics/metrics';
    return this.client.get<AnalyticsMetricsResponse>(path);
  }

  /**
   * Fetch summary statistics for a given timeframe or query.
   */
  async getVolumeSummary(timeframeOrParams?: string | AnalyticsQueryParams): Promise<VolumeSummary> {
    const searchParams = new URLSearchParams();
    if (typeof timeframeOrParams === 'string') {
      searchParams.set('timeframe', timeframeOrParams);
    } else if (timeframeOrParams) {
      if (timeframeOrParams.startDate) searchParams.set('startDate', timeframeOrParams.startDate);
      if (timeframeOrParams.endDate) searchParams.set('endDate', timeframeOrParams.endDate);
      if (timeframeOrParams.timeframe) searchParams.set('timeframe', timeframeOrParams.timeframe);
      if (timeframeOrParams.asset) searchParams.set('asset', timeframeOrParams.asset);
      if (timeframeOrParams.walletId) searchParams.set('walletId', timeframeOrParams.walletId);
      if (timeframeOrParams.agentId) searchParams.set('agentId', timeframeOrParams.agentId);
    }

    const query = searchParams.toString();
    const path = query ? `/analytics/summary?${query}` : '/analytics/summary';
    return this.client.get<VolumeSummary>(path);
  }
}

/**
 * Helper function for backward compatibility with existing aggregateTransactionMetrics
 */
export { aggregateTransactionMetrics } from './aggregations.js';
