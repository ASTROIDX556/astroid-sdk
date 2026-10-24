import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { TrustlineMissingError, NotFoundError, NetworkError } from '@astroid/errors';

import { WalletResource } from '../src/index.js';
import { verifyAssetTrustline, hasAssetTrustline, TrustlineErrorCode } from '../src/trustline.js';

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

const WALLET_BALANCE = {
  walletId: 'w_1',
  stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  network: 'TESTNET',
  balances: [
    { asset: 'XLM', balance: '100.0000000', issuer: null },
    { asset: 'USDC', issuer: 'GABC123456789012345678901234567890123456789012345678901234', balance: '250.0000000' },
    { asset: 'EURC', issuer: 'GDEF123456789012345678901234567890123456789012345678901234', balance: '0.0000000' },
  ],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('verifyAssetTrustline', () => {
  it('returns verified result when trustline exists with non-zero balance', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    const result = await verifyAssetTrustline(resource, 'w_1', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234');

    expect(result.verified).toBe(true);
    expect(result.asset.code).toBe('USDC');
    expect(result.asset.issuer).toBe('GABC123456789012345678901234567890123456789012345678901234');
    expect(result.balance.asset).toBe('USDC');
    expect(result.balance.balance).toBe('250.0000000');
  });

  it('returns verified result when trustline exists with zero balance', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    const result = await verifyAssetTrustline(resource, 'w_1', 'EURC', 'GDEF123456789012345678901234567890123456789012345678901234');

    expect(result.verified).toBe(true);
    expect(result.asset.code).toBe('EURC');
    expect(result.balance.balance).toBe('0.0000000');
  });

  it('returns verified result for native XLM without calling the API', async () => {
    const { resource, fetch } = clientWith(async () => {
      throw new Error('should not be called for XLM');
    });

    const result = await verifyAssetTrustline(resource, 'w_1', 'XLM', '');

    expect(result.verified).toBe(true);
    expect(result.asset.code).toBe('XLM');
    expect(result.balance.asset).toBe('XLM');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws TrustlineMissingError when trustline does not exist', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    await expect(
      verifyAssetTrustline(resource, 'w_1', 'USDC', 'GDIFFERENTISSUER12345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(TrustlineMissingError);
  });

  it('throws TrustlineMissingError when asset is not in balances at all', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    await expect(
      verifyAssetTrustline(resource, 'w_1', 'BTC', 'GISSUER123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(TrustlineMissingError);
  });

  it('includes walletId, assetCode, and issuer in error details', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    try {
      await verifyAssetTrustline(resource, 'w_1', 'MISSING', 'GISSUER123456789012345678901234567890123456789012345678901234');
    } catch (error) {
      expect(error).toBeInstanceOf(TrustlineMissingError);
      const err = error as TrustlineMissingError;
      expect(err.details?.walletId).toBe('w_1');
      expect(err.details?.assetCode).toBe('MISSING');
      expect(err.details?.issuer).toBe('GISSUER123456789012345678901234567890123456789012345678901234');
    }
  });

  it('throws NotFoundError when wallet does not exist', async () => {
    const { resource } = clientWith(async () =>
      jsonResponse({ error: { message: 'Wallet not found', code: 'NOT_FOUND' } }, 404),
    );

    await expect(
      verifyAssetTrustline(resource, 'missing', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NetworkError on transport failure', async () => {
    const { resource } = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(
      verifyAssetTrustline(resource, 'w_1', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('uses case-sensitive matching for asset code and issuer', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    // Wrong case for asset code
    await expect(
      verifyAssetTrustline(resource, 'w_1', 'usdc', 'GABC123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(TrustlineMissingError);

    // Wrong case for issuer
    await expect(
      verifyAssetTrustline(resource, 'w_1', 'USDC', 'gabc123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(TrustlineMissingError);
  });
});

describe('hasAssetTrustline', () => {
  it('returns true when trustline exists', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    const result = await hasAssetTrustline(resource, 'w_1', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234');

    expect(result).toBe(true);
  });

  it('returns true for native XLM without calling the API', async () => {
    const { resource, fetch } = clientWith(async () => {
      throw new Error('should not be called for XLM');
    });

    const result = await hasAssetTrustline(resource, 'w_1', 'XLM', '');

    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns false when trustline does not exist', async () => {
    const { resource } = clientWith(async () => jsonResponse({ data: WALLET_BALANCE }));

    const result = await hasAssetTrustline(resource, 'w_1', 'MISSING', 'GISSUER123456789012345678901234567890123456789012345678901234');

    expect(result).toBe(false);
  });

  it('re-throws errors other than TrustlineMissingError', async () => {
    const { resource } = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(
      hasAssetTrustline(resource, 'w_1', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('re-throws NotFoundError when wallet does not exist', async () => {
    const { resource } = clientWith(async () =>
      jsonResponse({ error: { message: 'Wallet not found', code: 'NOT_FOUND' } }, 404),
    );

    await expect(
      hasAssetTrustline(resource, 'missing', 'USDC', 'GABC123456789012345678901234567890123456789012345678901234'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});