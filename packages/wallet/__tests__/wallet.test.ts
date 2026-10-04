import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError, NotFoundError } from '@astroid/errors';

import { WalletResource } from '../src/index.js';

/** A HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build a `WalletResource` whose transport is the given fetch mock. */
function clientWith(fetchImpl: typeof fetch): { resource: WalletResource; fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new WalletResource(http), fetch: fetchMock };
}

const WALLET = {
  id: 'w_1',
  organizationId: 'org_1',
  name: 'Ops',
  walletType: 'TREASURY',
  status: 'ACTIVE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('WalletResource — fetching, creating, listing', () => {
  it('create POSTs the input to /wallets and returns the created wallet', async () => {
    const { resource, fetch } = clientWith(async () =>
      jsonResponse({ data: WALLET }),
    );

    const created = await resource.create({ label: 'Ops', walletType: 'TREASURY' });

    expect(created).toEqual(WALLET);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/wallets');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      label: 'Ops',
      walletType: 'TREASURY',
    });
  });

  it('get fetches a single wallet by id', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: WALLET }));

    const wallet = await resource.get('w_1');

    expect(wallet).toEqual(WALLET);
    expect(String(fetch.mock.calls[0]![0])).toContain('/wallets/w_1');
  });

  it('getWallet fetches a wallet by id', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: WALLET }));

    await expect(resource.getWallet('w_1')).resolves.toEqual(WALLET);
    expect(String(fetch.mock.calls[0]![0])).toContain('/wallets/w_1');
  });

  it('list returns a paginated set of wallets', async () => {
    const { resource } = clientWith(async () =>
      jsonResponse({
        data: [WALLET],
        meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
      }),
    );

    const result = await resource.list({ status: 'ACTIVE' });

    expect(result.data).toEqual([WALLET]);
    expect(result.meta?.total).toBe(1);
  });

  it('listWallets lists wallets and returns pagination metadata', async () => {
    const { resource, fetch } = clientWith(async () =>
      jsonResponse({
        data: [WALLET],
        meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
      }),
    );

    const result = await resource.listWallets({ status: 'ACTIVE' });

    expect(result.data).toEqual([WALLET]);
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe('/v1/wallets');
  });

  it('getWalletBalances filters an asset and preserves decimal strings', async () => {
    const balance = {
      walletId: 'w_1',
      stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      network: 'TESTNET',
      balances: [{ asset: 'USDC', issuer: 'GISSUER', balance: '0.0000001' }],
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: balance }));

    const result = await resource.getWalletBalances('w_1', {
      assetCode: 'USDC',
      issuer: 'GISSUER',
    });

    expect(result.balances[0]?.balance).toBe('0.0000001');
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe('/v1/wallets/w_1/balance');
    expect(url.searchParams.get('assetCode')).toBe('USDC');
    expect(url.searchParams.get('issuer')).toBe('GISSUER');
  });

  it('fundWallet posts an exact decimal amount to the wallet funding endpoint', async () => {
    const balance = {
      walletId: 'w_1',
      stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      network: 'TESTNET',
      balances: [{ asset: 'USDC', issuer: 'GISSUER', balance: '25.0000001' }],
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: balance }));

    await expect(
      resource.fundWallet('w_1', {
        assetCode: 'USDC',
        issuer: 'GISSUER',
        amount: '25.0000001',
      }),
    ).resolves.toEqual(balance);

    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/v1/wallets/w_1/fund');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      assetCode: 'USDC',
      issuer: 'GISSUER',
      amount: '25.0000001',
    });
  });

  it('handles network failures as a structured NetworkError', async () => {
    const { resource } = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(resource.get('w_1')).rejects.toBeInstanceOf(NetworkError);
  });

  it('surfaces API errors as typed errors (404 -> NotFoundError)', async () => {
    const { resource } = clientWith(async () =>
      jsonResponse({ error: { message: 'Wallet not found', code: 'NOT_FOUND' } }, 404),
    );

    await expect(resource.get('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
