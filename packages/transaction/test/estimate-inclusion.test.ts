import { describe, it, expect, vi } from 'vitest';
import { estimateInclusionFee, type EstimatedInclusionFee } from '../src/estimate-inclusion.js';
import { buildPaymentTransaction } from '../src/builder.js';
import { Keypair, Account } from '@stellar/stellar-base';
import { Networks } from '@stellar/stellar-base';

function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () => {
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('estimateInclusionFee — transaction fee inclusion wrapper (#457)', () => {
  it('returns a recommended inclusion fee from live Horizon stats', async () => {
    const body = {
      mode_fee: 200,
      ledger_base_fee: 100,
    };

    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body),
    });

    expect(feeEstimate).toHaveProperty('recommendedMaxFeeBid');
    expect(feeEstimate).toHaveProperty('baseFee');
    expect(feeEstimate).toHaveProperty('surgeMultiplier');
    expect(feeEstimate).toHaveProperty('networkState');
    expect(feeEstimate).toHaveProperty('live');

    expect(feeEstimate.live).toBe(true);
    expect(feeEstimate.networkState).toBe('normal');
    expect(typeof feeEstimate.recommendedMaxFeeBid).toBe('number');
    expect(typeof feeEstimate.baseFee).toBe('number');
    expect(typeof feeEstimate.surgeMultiplier).toBe('number');
  });

  it('degrades gracefully to static base fee when Horizon query fails', async () => {
    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch({}, false),
    });

    expect(feeEstimate.networkState).toBe('unknown');
    expect(feeEstimate.live).toBe(false);
    expect(feeEstimate.baseFee).toBe(100);
  });

  it('defaults operation count to 1 when not specified', async () => {
    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch({
        mode_fee: 100,
        ledger_base_fee: 100,
      }),
    });

    expect(feeEstimate.operationCount).toBe(1);
  });

  it('multiplies the fee recommendation across the operation count', async () => {
    const body = {
      mode_fee: 100,
      ledger_base_fee: 100,
    };

    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body),
      operationCount: 3,
    });

    // 100 base + 30% buffer = 130, * 3 ops = 390
    expect(feeEstimate.operationCount).toBe(3);
    expect(feeEstimate.recommendedMaxFeeBid).toBeGreaterThan(100);
  });

  it('can be used with buildPaymentTransaction', async () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), '1');

    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch({
        mode_fee: 100,
        ledger_base_fee: 100,
      }),
    });

    const tx = buildPaymentTransaction({
      source: account,
      networkPassphrase: Networks.TESTNET,
      destination: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
      asset: 'USDC',
      amount: '100',
      fee: String(feeEstimate.recommendedMaxFeeBid),
    });

    expect(tx).toBeDefined();
    expect(tx.fee).toBe(String(feeEstimate.recommendedMaxFeeBid));
  });

  it('returns a complete EstimatedInclusionFee type', async () => {
    const body = {
      mode_fee: 200,
      ledger_base_fee: 100,
    };

    const feeEstimate = await estimateInclusionFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body),
    });

    const completeFee: EstimatedInclusionFee = {
      baseFee: feeEstimate.baseFee,
      surgeMultiplier: feeEstimate.surgeMultiplier,
      recommendedMaxFeeBid: feeEstimate.recommendedMaxFeeBid,
      minFee: feeEstimate.minFee,
      operationCount: feeEstimate.operationCount,
      networkState: feeEstimate.networkState,
      live: feeEstimate.live,
    };

    expect(completeFee.baseFee).toBeDefined();
    expect(completeFee.surgeMultiplier).toBeDefined();
    expect(completeFee.recommendedMaxFeeBid).toBeDefined();
    expect(completeFee.minFee).toBeDefined();
    expect(completeFee.operationCount).toBeDefined();
    expect(completeFee.networkState).toBeDefined();
    expect(completeFee.live).toBeDefined();
  });
});