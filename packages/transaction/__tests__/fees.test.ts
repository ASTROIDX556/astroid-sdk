import { describe, expect, it, vi } from 'vitest';

import type { TransactionFeeEstimationClient } from '../src/fees.js';
import { estimateTransactionFee } from '../src/fees.js';

function makeClient(data: unknown): {
  client: TransactionFeeEstimationClient;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async () => ({ data }));
  return { client: { post } as TransactionFeeEstimationClient, post };
}

describe('estimateTransactionFee', () => {
  it('posts transaction XDR and normalizes the backend fee recommendation', async () => {
    const { client, post } = makeClient({
      baseFee: 100,
      operationCount: 2,
      recommendedBaseFee: 250,
      recommendedFee: 500,
      minFee: 200,
      live: true,
      networkState: 'busy',
    });

    const estimate = await estimateTransactionFee({
      transaction: { toXDR: () => 'transaction-xdr' },
      network: 'testnet',
      client,
    });

    expect(post).toHaveBeenCalledWith('/transactions/estimate-fee', {
      transactionXdr: 'transaction-xdr',
      network: 'testnet',
    });
    expect(estimate).toEqual({
      baseFee: 100,
      surgeMultiplier: 2.5,
      recommendedMaxFeeBid: 500,
      operationCount: 2,
      recommendedBaseFee: 250,
      recommendedFee: 500,
      minFee: 200,
      live: true,
      networkState: 'busy',
      transactionXdr: 'transaction-xdr',
    });
  });

  it('supports operation metadata and direct backend surge metrics', async () => {
    const { client, post } = makeClient({
      baseFee: '100',
      surgeMultiplier: '3',
      recommendedMaxFeeBid: '900',
    });

    const estimate = await estimateTransactionFee({
      operationCount: 3,
      network: 'public',
      client,
    });

    expect(post).toHaveBeenCalledWith('/transactions/estimate-fee', {
      operationCount: 3,
      network: 'public',
    });
    expect(estimate).toEqual({
      baseFee: 100,
      surgeMultiplier: 3,
      recommendedMaxFeeBid: 900,
      operationCount: 3,
    });
  });

  it('rejects missing transaction metadata and malformed backend estimates', async () => {
    const { client } = makeClient({ recommendedFee: 500 });

    await expect(estimateTransactionFee({ client })).rejects.toMatchObject({
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
    await expect(estimateTransactionFee({ operationCount: 1, client })).rejects.toMatchObject({
      code: 'INVALID_FEE_ESTIMATE_RESPONSE',
    });
  });

  it('rejects invalid operation counts and empty XDR', async () => {
    const { client, post } = makeClient({});

    await expect(estimateTransactionFee({ operationCount: 0, client })).rejects.toMatchObject({
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
    await expect(estimateTransactionFee({ transactionXdr: '', client })).rejects.toMatchObject({
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
    expect(post).not.toHaveBeenCalled();
  });
});
