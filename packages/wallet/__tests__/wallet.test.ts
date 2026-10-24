import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError, NotFoundError, ValidationError } from '@astroid/errors';

import {
  formatWalletBalances,
  WalletResource,
  fetchWalletBalancesBatch,
  parseBatchBalancesResponse,
  resolveHttpClient,
} from '../src/index.js';

/** A HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build a `WalletResource` whose transport is the given fetch mock. */
function clientWith(fetchImpl: typeof fetch): {
  resource: WalletResource;
  fetch: ReturnType<typeof vi.fn>;
  http: HttpClient;
} {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new WalletResource(http), fetch: fetchMock, http };
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
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: WALLET }));

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

  it('getWalletBalances returns all assets when no filter is provided', async () => {
    const balance = {
      walletId: 'w_1',
      stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      network: 'TESTNET',
      balances: [
        { asset: 'XLM', balance: '1200.0000000' },
        { asset: 'USDC', issuer: 'GISSUER', balance: '0.0000001' },
      ],
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: balance }));

    const result = await resource.getWalletBalances('w_1');

    expect(result.balances).toHaveLength(2);
    expect(result.balances.map(({ balance: amount }) => amount)).toEqual([
      '1200.0000000',
      '0.0000001',
    ]);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.has('assetCode')).toBe(false);
    expect(url.searchParams.has('issuer')).toBe(false);
  });

  it('formats wallet balances without losing decimal precision and handles empty balances', () => {
    const balance = {
      walletId: 'w_1',
      stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      network: 'TESTNET',
      balances: [
        { asset: 'XLM', balance: '12345678901234567890.0000001' },
        { asset: 'USDC', issuer: 'GISSUER', balance: '0.0000000' },
      ],
      updatedAt: '2026-08-01T00:00:00.000Z',
    };

    const formatted = formatWalletBalances(balance);

    expect(formatted.balances.map(({ formattedBalance }) => formattedBalance)).toEqual([
      '12,345,678,901,234,567,890.0000001',
      '0.0000000',
    ]);
    expect(formatWalletBalances({ ...balance, balances: [] }).balances).toEqual([]);
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

describe('fetchWalletBalancesBatch — batch balance querying (issue #461)', () => {
  const ADDRESS_1 = 'GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA';
  const ADDRESS_2 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const ISSUER_1 = 'GCI73HG56OABOF2QDF2J2BXZN2K45MOGZ6EHYGBUAKQ27MFLF74EILUS';

  const MOCK_MAPPING = {
    [ADDRESS_1]: [
      { asset: 'XLM', balance: '150.0000000' },
      { asset: 'USDC', balance: '42.5000000', issuer: ISSUER_1 },
    ],
    [ADDRESS_2]: [{ asset: 'XLM', balance: '10.2500000' }],
  };

  it('fetchWalletBalancesBatch() POSTs to /wallets/balances/batch by default and parses response', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_1', 'wlt_2']);

    expect(result).toEqual(MOCK_MAPPING);
    expect(result[ADDRESS_1]?.[0]?.balance).toBe('150.0000000');
    expect(result[ADDRESS_1]?.[1]?.asset).toBe('USDC');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/v1/wallets/balances/batch');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      walletIds: ['wlt_1', 'wlt_2'],
    });
  });

  it('serializes single asset filter (assetCode and issuer)', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_1', 'wlt_2'], {
      assetCode: 'USDC',
      issuer: ISSUER_1,
    });

    expect(result).toEqual(MOCK_MAPPING);
    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      walletIds: ['wlt_1', 'wlt_2'],
      assetCode: 'USDC',
      issuer: ISSUER_1,
    });
  });

  it('serializes asset list filter array (assets)', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    await resource.fetchWalletBalancesBatch(['wlt_1'], { assets: ['XLM', `USDC:${ISSUER_1}`] });

    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      walletIds: ['wlt_1'],
      assets: ['XLM', `USDC:${ISSUER_1}`],
    });
  });

  it('deduplicates duplicate walletIds before serialization', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    await resource.fetchWalletBalancesBatch(['wlt_1', 'wlt_1', 'wlt_2', 'wlt_1']);

    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      walletIds: ['wlt_1', 'wlt_2'],
    });
  });

  it('returns an empty mapping without performing network request when walletIds is empty', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: {} }));

    const result = await resource.fetchWalletBalancesBatch([]);

    expect(result).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports custom path override', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    await resource.fetchWalletBalancesBatch(['wlt_1'], undefined, {
      path: '/wallets/custom-batch-route',
    });

    const [url] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/v1/wallets/custom-batch-route');
  });

  it('supports GET method with query parameter serialization', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    await resource.fetchWalletBalancesBatch(
      ['wlt_1', 'wlt_2'],
      { assetCode: 'USDC', issuer: ISSUER_1, assets: ['XLM', 'USDC'] },
      { method: 'GET' },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    const parsedUrl = new URL(String(url));
    expect((init as RequestInit).method).toBe('GET');
    expect(parsedUrl.pathname).toBe('/v1/wallets/balances/batch');
    expect(parsedUrl.searchParams.get('walletIds')).toBe('wlt_1,wlt_2');
    expect(parsedUrl.searchParams.get('assetCode')).toBe('USDC');
    expect(parsedUrl.searchParams.get('issuer')).toBe(ISSUER_1);
    expect(parsedUrl.searchParams.get('assets')).toBe('XLM,USDC');
  });

  it('parses array of WalletBalance entity objects into a mapping keyed by stellarAddress', async () => {
    const arrayPayload = [
      {
        walletId: 'wlt_1',
        stellarAddress: ADDRESS_1,
        network: 'TESTNET',
        balances: [{ asset: 'XLM', balance: '150.0000000' }],
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        walletId: 'wlt_2',
        stellarAddress: ADDRESS_2,
        network: 'TESTNET',
        balances: [{ asset: 'USDC', balance: '99.0000000', issuer: ISSUER_1 }],
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];

    const { resource } = clientWith(async () => jsonResponse({ data: arrayPayload }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_1', 'wlt_2']);

    expect(result).toEqual({
      [ADDRESS_1]: [{ asset: 'XLM', balance: '150.0000000' }],
      [ADDRESS_2]: [{ asset: 'USDC', balance: '99.0000000', issuer: ISSUER_1 }],
    });
  });

  it('parses array items falling back to walletId when stellarAddress is missing', async () => {
    const arrayPayload = [
      {
        walletId: 'wlt_without_addr',
        balances: [{ asset: 'XLM', balance: '5.0000000' }],
      },
    ];

    const { resource } = clientWith(async () => jsonResponse({ data: arrayPayload }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_without_addr']);

    expect(result).toEqual({
      wlt_without_addr: [{ asset: 'XLM', balance: '5.0000000' }],
    });
  });

  it('parses nested balances dictionary in response payload', async () => {
    const nestedPayload = {
      balances: {
        [ADDRESS_1]: [{ asset: 'XLM', balance: '77.0' }],
      },
    };

    const { resource } = clientWith(async () => jsonResponse({ data: nestedPayload }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_1']);

    expect(result).toEqual({
      [ADDRESS_1]: [{ asset: 'XLM', balance: '77.0' }],
    });
  });

  it('parses nested wallets array in response payload', async () => {
    const nestedWalletsPayload = {
      wallets: [
        {
          stellarAddress: ADDRESS_1,
          balances: [{ asset: 'XLM', balance: '33.0' }],
        },
      ],
    };

    const { resource } = clientWith(async () => jsonResponse({ data: nestedWalletsPayload }));

    const result = await resource.fetchWalletBalancesBatch(['wlt_1']);

    expect(result).toEqual({
      [ADDRESS_1]: [{ asset: 'XLM', balance: '33.0' }],
    });
  });

  it('parseBatchBalancesResponse returns empty object for malformed/null/undefined inputs', () => {
    expect(parseBatchBalancesResponse(null)).toEqual({});
    expect(parseBatchBalancesResponse(undefined)).toEqual({});
    expect(parseBatchBalancesResponse('not an object')).toEqual({});
    expect(parseBatchBalancesResponse(12345)).toEqual({});
  });

  it('standalone fetchWalletBalancesBatch works with HttpClient as first argument', async () => {
    const { http, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    const result = await fetchWalletBalancesBatch(http, ['wlt_1', 'wlt_2']);

    expect(result).toEqual(MOCK_MAPPING);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('standalone fetchWalletBalancesBatch works with client in options', async () => {
    const { http, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    const result = await fetchWalletBalancesBatch(['wlt_1', 'wlt_2'], undefined, { client: http });

    expect(result).toEqual(MOCK_MAPPING);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('standalone fetchWalletBalancesBatch works with client container having .http property', async () => {
    const { http, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));
    const clientContainer = { http };

    const result = await fetchWalletBalancesBatch(clientContainer, ['wlt_1']);

    expect(result).toEqual(MOCK_MAPPING);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('standalone fetchWalletBalancesBatch works with client container having .wallets property', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));
    const clientContainer = { wallets: resource };

    const result = await fetchWalletBalancesBatch(clientContainer, ['wlt_1']);

    expect(result).toEqual(MOCK_MAPPING);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolveHttpClient throws ValidationError when input is not a recognized client', () => {
    expect(() => resolveHttpClient(null)).toThrow(ValidationError);
    expect(() => resolveHttpClient({})).toThrow(ValidationError);
    expect(() => resolveHttpClient('invalid')).toThrow(ValidationError);
  });

  it('throws ValidationError with CLIENT_REQUIRED when standalone helper called without client', async () => {
    await expect(fetchWalletBalancesBatch(['wlt_1'])).rejects.toMatchObject({
      code: 'CLIENT_REQUIRED',
    });
  });

  it('throws ValidationError when walletIds is not an array', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: {} }));

    await expect(
      // @ts-expect-error test non-array input
      resource.fetchWalletBalancesBatch('wlt_1'),
    ).rejects.toMatchObject({
      code: 'INVALID_WALLET_BATCH',
    });
  });

  it('throws ValidationError when walletIds contains empty or whitespace string', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: {} }));

    await expect(resource.fetchWalletBalancesBatch(['wlt_1', '   '])).rejects.toMatchObject({
      code: 'INVALID_WALLET_BATCH',
    });
  });

  it('throws ValidationError when walletIds contains non-string elements', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: {} }));

    await expect(
      // @ts-expect-error test non-string element in array
      resource.fetchWalletBalancesBatch(['wlt_1', 12345]),
    ).rejects.toMatchObject({
      code: 'INVALID_WALLET_BATCH',
    });
  });

  it('getWalletBalancesBatch is an alias of fetchWalletBalancesBatch on WalletResource', async () => {
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: MOCK_MAPPING }));

    const result = await resource.getWalletBalancesBatch(['wlt_1', 'wlt_2']);

    expect(result).toEqual(MOCK_MAPPING);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates API errors as typed AstroidError', async () => {
    const { resource } = clientWith(async () =>
      jsonResponse({ error: { message: 'Wallet not found', code: 'NOT_FOUND' } }, 404),
    );

    await expect(resource.fetchWalletBalancesBatch(['missing_wallet'])).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
