import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@astroid/core';
import type { AgentMetricsReport, AnalyticsOverview } from '@astroid/types';
import { AnalyticsResource } from '../index.js';

const AGENT_METRICS: AgentMetricsReport = {
  interval: 'day',
  agents: [],
};

const GLOBAL_ANALYTICS: AnalyticsOverview = {
  transactionCount: 42,
  policyViolations: 2,
  totalVolume: '12500.75',
  totalFees: '12.50',
  successRate: 95,
};

function createClient() {
  const get = vi.fn();
  return { client: { get } as unknown as HttpClient, get };
}

describe('AnalyticsResource metrics', () => {
  it('fetches per-agent metrics with the requested time range and resolution', async () => {
    const { client, get } = createClient();
    get.mockResolvedValue({ data: AGENT_METRICS });
    const analytics = new AnalyticsResource(client);

    const result = await analytics.getAgentMetrics({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      resolution: 'day',
    });

    expect(get).toHaveBeenCalledWith('/analytics/agents/metrics', {
      query: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
        resolution: 'day',
      },
    });
    expect(result).toEqual(AGENT_METRICS);
  });

  it('fetches global analytics for the requested time range and resolution', async () => {
    const { client, get } = createClient();
    get.mockResolvedValue({ data: GLOBAL_ANALYTICS });
    const analytics = new AnalyticsResource(client);

    const result = await analytics.getGlobalAnalytics({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      resolution: 'day',
    });

    expect(get).toHaveBeenCalledWith('/analytics/overview', {
      query: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
        resolution: 'day',
      },
    });
    expect(result).toEqual(GLOBAL_ANALYTICS);
  });
});