import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAgentAnalytics } from '../src/hooks/useAgentAnalytics.js';
import { AstroidContext } from '../src/provider.js';

describe('useAgentAnalytics', () => {
  let queryClient: QueryClient;
  let mockClient: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    mockClient = {
      analytics: {
        getAgentAnalytics: vi.fn().mockResolvedValue({
          agentId: 'agent_123',
          transactionVolume: '1500.00',
          successRate: 0.95,
          costMetrics: { totalFees: '5.50' },
        }),
      },
    };
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AstroidContext.Provider value={mockClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </AstroidContext.Provider>
  );

  it('fetches agent analytics successfully', async () => {
    const { result } = renderHook(() => useAgentAnalytics('agent_123', { params: { timeframe: '7d' } }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.analytics.getAgentAnalytics).toHaveBeenCalledWith('agent_123', { timeframe: '7d' });
    expect(result.current.data).toEqual({
      agentId: 'agent_123',
      transactionVolume: '1500.00',
      successRate: 0.95,
      costMetrics: { totalFees: '5.50' },
    });
  });

  it('does not fetch when agentId is undefined', () => {
    renderHook(() => useAgentAnalytics(undefined), {
      wrapper,
    });

    expect(mockClient.analytics.getAgentAnalytics).not.toHaveBeenCalled();
  });
});
