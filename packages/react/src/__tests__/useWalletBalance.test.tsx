/**
 * Unit tests for the `useWalletBalance` hook (issue #400).
 *
 * The hook is rendered with `@testing-library/react` inside a QueryClient
 * wrapper plus the AstroidProvider context — the same harness the other
 * `@astroid/react` hook tests use — with the wallet resource mocked so no
 * network calls are made.
 *
 * Covered: the loading/success/error states, the disabled state, resolving a
 * Stellar address to its wallet, the asset-filtered balance reader, the
 * polling interval, manual refetch, the query-key namespace, and the
 * invalidation wiring that keeps the balance fresh after a transfer.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AstroidProvider } from '../provider.js';
import {
  isStellarPublicKey,
  useWalletBalance,
  walletBalanceKeys,
} from '../hooks/useWalletBalance.js';
import { useTransfer } from '../hooks/useWallets.js';
import type { Astroid } from '@astroid/client';
import type { Wallet, WalletBalance } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PUBLIC_KEY = 'GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA';

const WALLET: Wallet = {
  id: 'wal_abc123',
  organizationId: 'org_1',
  stellarAddress: PUBLIC_KEY,
  walletType: 'AGENT',
  network: 'TESTNET',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const BALANCE: WalletBalance = {
  walletId: WALLET.id,
  stellarAddress: PUBLIC_KEY,
  network: 'TESTNET',
  balances: [
    { asset: 'XLM', balance: '1000.5000000' },
    { asset: 'USDC', balance: '250.0000000' },
  ],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

/** A fake Astroid client whose wallet methods are vi.fn() mocks. */
function createMockClient(
  overrides: {
    get?: Mock;
    getByAddress?: Mock;
    balance?: Mock;
    getWalletBalances?: Mock;
    transfer?: Mock;
  } = {},
): Astroid {
  return {
    wallets: {
      get: overrides.get ?? vi.fn(async () => WALLET),
      getByAddress: overrides.getByAddress ?? vi.fn(async () => WALLET),
      balance: overrides.balance ?? vi.fn(async () => BALANCE),
      getWalletBalances: overrides.getWalletBalances ?? vi.fn(async () => BALANCE),
      transfer:
        overrides.transfer ??
        vi.fn(async () => ({
          id: 'tx_1',
          walletId: WALLET.id,
          status: 'PENDING',
        })),
    },
  } as unknown as Astroid;
}

/** A fresh QueryClient + AstroidProvider wrapper for each hook render. */
function createWrapper(client: Astroid) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={client}>{children}</AstroidProvider>
      </QueryClientProvider>
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Loading / success / error states                                            */
/* -------------------------------------------------------------------------- */

describe('useWalletBalance — states (issue #400)', () => {
  it('starts loading and resolves the typed balance snapshot', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.walletId).toBe('wal_abc123');
    expect(result.current.data?.balances).toHaveLength(2);
    expect(client.wallets.balance).toHaveBeenCalledWith('wal_abc123');
  });

  it('exposes an error state when the balance request fails', async () => {
    const failure = new Error('balance fetch failed');
    const client = createMockClient({ balance: vi.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useWalletBalance('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it('is disabled when no wallet reference is provided', async () => {
    const client = createMockClient();

    const undefinedRef = renderHook(() => useWalletBalance(undefined), {
      wrapper: createWrapper(client),
    });
    const emptyRef = renderHook(() => useWalletBalance(''), {
      wrapper: createWrapper(client),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(undefinedRef.result.current.isLoading).toBe(false);
    expect(undefinedRef.result.current.data).toBeUndefined();
    expect(emptyRef.result.current.isLoading).toBe(false);
    expect(client.wallets.balance).not.toHaveBeenCalled();
  });

  it('respects the enabled option', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123', { enabled: false }), {
      wrapper: createWrapper(client),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.isFetching).toBe(false);
    expect(client.wallets.balance).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Address resolution                                                          */
/* -------------------------------------------------------------------------- */

describe('useWalletBalance — address resolution (issue #400)', () => {
  it('resolves a Stellar address to its wallet and reads that wallet balance', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance(PUBLIC_KEY), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.getByAddress).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(client.wallets.get).not.toHaveBeenCalled();
    expect(client.wallets.balance).toHaveBeenCalledWith('wal_abc123');
  });

  it('errors when the address resolves to no wallet', async () => {
    const client = createMockClient({ getByAddress: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useWalletBalance(PUBLIC_KEY), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('Wallet not found');
  });

  it('treats a non-address reference as a wallet id', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.get).not.toHaveBeenCalled();
    expect(client.wallets.getByAddress).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Asset filters                                                               */
/* -------------------------------------------------------------------------- */

describe('useWalletBalance — asset filters (issue #400)', () => {
  it('reads through the asset-filtered balance reader when an asset code is given', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123', { assetCode: 'USDC' }), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.getWalletBalances).toHaveBeenCalledWith('wal_abc123', {
      assetCode: 'USDC',
    });
    expect(client.wallets.balance).not.toHaveBeenCalled();
  });

  it('forwards the issuer filter alongside the asset code', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () =>
        useWalletBalance('wal_abc123', {
          assetCode: 'USDC',
          issuer: PUBLIC_KEY,
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(client.wallets.getWalletBalances).toHaveBeenCalledWith('wal_abc123', {
      assetCode: 'USDC',
      issuer: PUBLIC_KEY,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Polling, refetch and cache keys                                             */
/* -------------------------------------------------------------------------- */

describe('useWalletBalance — polling and cache (issue #400)', () => {
  it('polls at the configured interval to keep the balance stream current', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      const { result } = renderHook(
        () => useWalletBalance('wal_abc123', { refetchInterval: 10_000 }),
        { wrapper: createWrapper(client) },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect((client.wallets.balance as Mock).mock.calls.length).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(result.current.data).toBeDefined();
      expect((client.wallets.balance as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll when no interval is configured', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockClient();
      renderHook(() => useWalletBalance('wal_abc123'), { wrapper: createWrapper(client) });

      await vi.advanceTimersByTimeAsync(60_000);

      expect((client.wallets.balance as Mock).mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports a manual refetch', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useWalletBalance('wal_abc123'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    const callsAfterMount = (client.wallets.balance as Mock).mock.calls.length;

    await result.current.refetch();

    expect((client.wallets.balance as Mock).mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('scopes the cache keys under the wallets namespace', () => {
    expect(walletBalanceKeys.all).toEqual(['astroid', 'wallets', 'balance']);
    expect(walletBalanceKeys.byId('wal_1')).toEqual([
      'astroid',
      'wallets',
      'balance',
      'id',
      'wal_1',
    ]);
    expect(walletBalanceKeys.byAddress(PUBLIC_KEY)).toEqual([
      'astroid',
      'wallets',
      'balance',
      'address',
      PUBLIC_KEY,
    ]);
    // An id reference and an address reference are distinct cache entries.
    expect(walletBalanceKeys.byId('wal_1')).not.toEqual(walletBalanceKeys.byAddress('wal_1'));
  });

  it('is invalidated by a transfer submitted through useTransfer', async () => {
    const client = createMockClient();
    const { result } = renderHook(
      () => ({
        balance: useWalletBalance('wal_abc123'),
        transfer: useTransfer(),
      }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.balance.data).toBeDefined();
    });
    const balanceCalls = (client.wallets.balance as Mock).mock.calls.length;

    result.current.transfer.mutate({
      walletId: 'wal_abc123',
      input: {
        recipientAddress: PUBLIC_KEY,
        asset: 'USDC',
        amount: '10',
      },
    });

    await waitFor(() => {
      expect(result.current.transfer.isSuccess).toBe(true);
    });
    await waitFor(() => {
      expect((client.wallets.balance as Mock).mock.calls.length).toBeGreaterThan(balanceCalls);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Public helpers                                                              */
/* -------------------------------------------------------------------------- */

describe('isStellarPublicKey', () => {
  it('recognises a Stellar public key', () => {
    expect(isStellarPublicKey(PUBLIC_KEY)).toBe(true);
  });

  it('rejects wallet ids and malformed addresses', () => {
    expect(isStellarPublicKey('wal_abc123')).toBe(false);
    expect(isStellarPublicKey('G')).toBe(false);
    expect(isStellarPublicKey('GTOO SHORT')).toBe(false);
    expect(isStellarPublicKey('0'.repeat(56))).toBe(false);
  });
});
