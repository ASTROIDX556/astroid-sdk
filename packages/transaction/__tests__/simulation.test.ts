import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';

import { describe, expect, it } from 'vitest';

import { simulateTransactionFee } from '../src/simulation.js';

const TESTNET = Networks.TESTNET;

/** Build a payment transaction XDR with the given fee (stroops). */
function buildPaymentXdr(fee: number, networkPassphrase = TESTNET): string {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  const tx = new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

/** Build a Transaction instance with the given fee (stroops). */
function buildPaymentTransaction(fee: number, networkPassphrase = TESTNET) {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  return new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '5',
      }),
    )
    .setTimeout(30)
    .build();
}

describe('simulateTransactionFee', () => {
  it('returns baseFee, estimatedFee (default 15% buffer) and viability for a valid XDR', () => {
    const xdr = buildPaymentXdr(100);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.baseFee).toBe(100);
    expect(result.estimatedFee).toBe(115); // 100 * 1.15
    expect(result.feeBufferPercentage).toBe(15);
    expect(result.isViable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('applies a custom buffer percentage to the estimated fee', () => {
    const xdr = buildPaymentXdr(200);
    const result = simulateTransactionFee(xdr, {
      networkPassphrase: TESTNET,
      feeBufferPercentage: 50,
    });

    expect(result.baseFee).toBe(200);
    expect(result.estimatedFee).toBe(300); // 200 * 1.5
    expect(result.feeBufferPercentage).toBe(50);
  });

  it('accepts a Transaction instance instead of an XDR string', () => {
    const tx = buildPaymentTransaction(250);

    const result = simulateTransactionFee(tx);

    expect(result.baseFee).toBe(250);
    expect(result.estimatedFee).toBe(288); // 250 * 1.15 = 287.5 -> 288
    expect(result.isViable).toBe(true);
  });

  it('rounds fractional estimated fees', () => {
    const xdr = buildPaymentXdr(1);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.estimatedFee).toBe(1); // 1 * 1.15 = 1.15 -> 1
  });

  it('returns a structured error container for malformed XDR instead of throwing', () => {
    const result = simulateTransactionFee('not-a-valid-xdr', { networkPassphrase: TESTNET });

    expect(result.isViable).toBe(false);
    expect(result.error?.code).toBe('INVALID_XDR');
    expect(result.error?.message).toMatch(/parse/i);
  });

  it('flags a zero-fee transaction as non-viable', () => {
    const xdr = buildPaymentXdr(0);
    const result = simulateTransactionFee(xdr, { networkPassphrase: TESTNET });

    expect(result.isViable).toBe(false);
  });

  it('defaults to the public network passphrase', () => {
    const xdr = buildPaymentXdr(100, Networks.PUBLIC);
    const result = simulateTransactionFee(xdr);

    expect(result.baseFee).toBe(100);
    expect(result.isViable).toBe(true);
  });
});
