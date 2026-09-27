import { describe, expect, it } from 'vitest';

import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  buildPaymentTransaction,
  buildTransaction,
  encodeTransaction,
} from '../src/builder.js';
import {
  MAX_OPERATIONS,
  MAX_TOTAL_FEE_STROOPS,
  MIN_BASE_FEE_STROOPS,
} from '../src/validator.js';

function makeAccount(sequence: string): Account {
  return new Account(Keypair.random().publicKey(), sequence);
}

describe('buildTransaction / buildPaymentTransaction — fee bounds', () => {
  it('accepts the default fee and the exact network minimum', () => {
    const tx = buildPaymentTransaction({
      source: makeAccount('1'),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
    });
    expect(tx.fee).toBe(String(MIN_BASE_FEE_STROOPS));
  });

  it('accepts a custom fee within bounds and stamps it on the transaction', () => {
    const tx = buildPaymentTransaction({
      source: makeAccount('1'),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      fee: 5_000,
    });
    expect(tx.fee).toBe('5000');
  });

  it('rejects a fee below the network minimum (FEE_BELOW_MINIMUM)', () => {
    expect(() =>
      buildPaymentTransaction({
        source: makeAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        fee: MIN_BASE_FEE_STROOPS - 1,
      }),
    ).toThrowError(ValidationError);
    try {
      buildPaymentTransaction({
        source: makeAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        fee: 99,
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect((err as ValidationError).code).toBe('FEE_BELOW_MINIMUM');
    }
  });

  it('rejects a fee above the Astroid safety ceiling (FEE_BID_TOO_HIGH)', () => {
    try {
      buildPaymentTransaction({
        source: makeAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        fee: MAX_TOTAL_FEE_STROOPS + 1,
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('FEE_BID_TOO_HIGH');
    }
  });

  it('rejects a non-integer fee (INVALID_FEE)', () => {
    try {
      buildPaymentTransaction({
        source: makeAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        fee: '100.5',
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_FEE');
    }
  });

  it('requires the total fee to cover operations × base fee', () => {
    const account = makeAccount('1');
    const destination = Keypair.random().publicKey();
    // 2 operations × 100 stroops minimum = 200; a 150 stroop bid is too low
    // even though it is above the single-op floor.
    expect(() =>
      buildTransaction(
        { source: account, networkPassphrase: Networks.TESTNET, fee: 150 },
        [
          Operation.createAccount({ destination, startingBalance: '1' }),
          Operation.accountMerge({ destination }),
        ],
      ),
    ).toThrowError(ValidationError);
  });

  it('rejects more than MAX_OPERATIONS operations (TOO_MANY_OPERATIONS)', () => {
    const account = makeAccount('1');
    const destination = Keypair.random().publicKey();
    const ops = Array.from({ length: MAX_OPERATIONS + 1 }, () =>
      Operation.createAccount({ destination, startingBalance: '1' }),
    );
    try {
      buildTransaction({ source: account, networkPassphrase: Networks.TESTNET }, ops);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('TOO_MANY_OPERATIONS');
    }
  });

  it('accepts exactly MAX_OPERATIONS operations when the fee covers them', () => {
    const account = makeAccount('1');
    const destination = Keypair.random().publicKey();
    const ops = Array.from({ length: MAX_OPERATIONS }, () =>
      Operation.createAccount({ destination, startingBalance: '1' }),
    );
    const tx = buildTransaction(
      { source: account, networkPassphrase: Networks.TESTNET, fee: MAX_OPERATIONS * MIN_BASE_FEE_STROOPS },
      ops,
    );
    expect(tx.operations).toHaveLength(MAX_OPERATIONS);
  });
});

describe('buildPaymentTransaction — memo attachment', () => {
  it('attaches a text memo visible after serialization round-trip', () => {
    const tx = buildPaymentTransaction({
      source: makeAccount('1'),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '2',
      memoText: 'astroid-agent-tx',
    });
    const decoded = TransactionBuilder.fromXDR(encodeTransaction(tx), Networks.TESTNET);
    expect(String(decoded.memo.value)).toBe('astroid-agent-tx');
  });

  it('rejects a memo longer than 28 bytes with INVALID_MEMO', () => {
    try {
      buildPaymentTransaction({
        source: makeAccount('1'),
        networkPassphrase: Networks.TESTNET,
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        memoText: 'x'.repeat(29),
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_MEMO');
    }
  });
});

describe('buildPaymentTransaction — serialization output', () => {
  it('produces a base64 XDR envelope that decodes to the same transaction', () => {
    const source = makeAccount('7');
    const destination = Keypair.random().publicKey();
    const tx = buildPaymentTransaction({
      source,
      networkPassphrase: Networks.TESTNET,
      destination,
      asset: 'XLM',
      amount: '3.5',
      memoText: 'round-trip',
    });

    const xdr = encodeTransaction(tx);
    expect(typeof xdr).toBe('string');
    expect(xdr.length).toBeGreaterThan(0);

    const decoded = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    expect(decoded.source).toBe(source.accountId());
    expect(decoded.operations).toHaveLength(1);
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.amount).toBe('3.5000000');
    expect(op.asset.isNative()).toBe(true);
    expect(decoded.signatures).toHaveLength(0);
  });
});
