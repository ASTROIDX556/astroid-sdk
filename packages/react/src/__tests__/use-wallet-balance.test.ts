import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWalletBalance } from '../hooks/use-wallet-balance.js';
import { AstroidProvider } from '../provider.js';
import { Astroid } from '@astroid/client';

describe('useWalletBalance', () => {
  it('fetches balance and calculates isLowBalance with threshold', async () => {
    const client = new Astroid({ apiKey: 'test_key' });
    vi.spyOn(client.wallets, 'balance').mockResolvedValue({
      walletId: 'wlt_123',
      stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      balances: [
        { asset: 'XLM', balance: '5.0' },
      ],
    } as any);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const onLowBalance = vi.fn();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(AstroidProvider, { client: client }, children)
      )
    );

    const { result } = renderHook(() => useWalletBalance('wlt_123', {
      lowBalanceThreshold: 10.0,
      onLowBalance,
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.isLowBalance).toBe(true);
    expect(onLowBalance).toHaveBeenCalledTimes(1);
  });
});
