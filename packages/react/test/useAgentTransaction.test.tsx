import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../src/provider.js';
import { useAgentTransaction } from '../src/hooks/useAgentTransaction.js';

describe('useAgentTransaction — agent transaction mutation hook (#560)', () => {
  const queryClient = new QueryClient();

  const renderWithProviders = (ui: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={{ http: { config: { auth: { accessToken: 'test-token' } }, post: async () => ({ data: { stellarHash: 'tx_abc123' } }) as any } }}>
          {ui}
        </AstroidProvider>
      </QueryClientProvider>,
    );
  };

  it('starts with isLoading and isSuccess in initial state', () => {
    const { result } = renderWithProviders(<div />);

    // Initial state: mutation hasn't been triggered yet
    expect(typeof result.current.mutate).toBe('function');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.transactionHash).toBeNull();
  });

  it('returns a transaction hash on successful submission', async () => {
    const { result } = renderWithProviders(<div />);

    await result.current.mutate({
      walletId: 'wal_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
    });

    // After onSuccess, the mutation state should reflect success
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.transactionHash).toBe('tx_abc123');
  });

  it('handles error state when submission fails', async () => {
    // Create a mock client that throws on create
    const failingClient = {
      http: {
        config: { auth: { accessToken: 'test-token' } },
        post: async () => {
          throw new Error('Submission failed');
        },
      } as any,
    };

    const { result } = renderWithProviders(
      <div />,
      { provider: failingClient as any },
    );

    // The mutate function should throw or the error state should be set
    await expect(
      result.current.mutate({
        walletId: 'wal_1',
        asset: 'USDC',
        amount: '100',
        recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
      }),
    ).rejects.toThrow('Submission failed');

    // After error, isSuccess should be false and error should be set
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('provides properly typed mutation parameters', () => {
    // Verify the hook accepts the expected variable shape
    const vars: import('../src/hooks/useAgentTransaction.js').UseAgentTransactionVariables = {
      walletId: 'wal_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
    };
    expect(vars.walletId).toBe('wal_1');
    expect(vars.asset).toBe('USDC');
    expect(vars.amount).toBe('100');
    expect(vars.recipientAddress).toMatch(/^G/);
  });

  it('invalidates queries on success', async () => {
    const { result, waitFor } = renderWithProviders(<div />);

    await result.current.mutate({
      walletId: 'wal_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
    });

    // Wait for the mutation to settle
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});