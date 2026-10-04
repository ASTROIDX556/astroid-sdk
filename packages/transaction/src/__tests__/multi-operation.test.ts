/**
 * Tests for the multi-operation transaction builders (issue #75):
 * `buildMultiOperationTransaction`, `buildTransactionFromOperations` and
 * `validateOperationSequence`.
 */

import { describe, expect, it } from 'vitest';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  Asset,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  buildMultiOperationTransaction,
  buildTransactionFromOperations,
  validateOperationSequence,
} from '../multi-operation.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const KEYPAIR = Keypair.random();
const ACCOUNT = new Account(KEYPAIR.publicKey(), '100');
const DEST_A = Keypair.random().publicKey();
const DEST_B = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const PASSPHRASE = Networks.TESTNET;

const payment = (destination: string, amount: string, asset = 'XLM') => ({
  type: 'payment' as const,
  destination,
  asset,
  amount,
});

/** Decode an unsigned envelope to inspect its wire structure. */
function decode(tx: { toXDR(): string }): Transaction {
  const decoded = TransactionBuilder.fromXDR(tx.toXDR(), PASSPHRASE);
  if (decoded instanceof Transaction) return decoded;
  return decoded.innerTransaction;
}

/* -------------------------------------------------------------------------- */
/* validateOperationSequence                                                   */
/* -------------------------------------------------------------------------- */

describe('validateOperationSequence', () => {
  it('accepts a valid bundle with sufficient fee', () => {
    expect(() =>
      validateOperationSequence([payment(DEST_A, '10'), payment(DEST_B, '5')], 300),
    ).not.toThrow();
  });

  it('accepts the exact fee floor (count × 100 stroops)', () => {
    expect(() =>
      validateOperationSequence([payment(DEST_A, '1'), payment(DEST_B, '1')], 200),
    ).not.toThrow();
  });

  it('rejects an empty bundle (EMPTY_OPERATIONS)', () => {
    try {
      validateOperationSequence([], 100);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('EMPTY_OPERATIONS');
    }
  });

  it('rejects more than MAX_OPERATIONS operations (TOO_MANY_OPERATIONS)', () => {
    const ops = Array.from({ length: 101 }, () => payment(DEST_A, '1'));
    try {
      validateOperationSequence(ops, 101 * 100);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ValidationError).code).toBe('TOO_MANY_OPERATIONS');
    }
  });

  it('rejects a fee below count × base fee (FEE_BELOW_MINIMUM)', () => {
    try {
      validateOperationSequence([payment(DEST_A, '1'), payment(DEST_B, '1')], 150);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ValidationError).code).toBe('FEE_BELOW_MINIMUM');
    }
  });

  it('rejects a fee above the Astroid ceiling (FEE_BID_TOO_HIGH)', () => {
    try {
      validateOperationSequence([payment(DEST_A, '1')], 10_000_001);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ValidationError).code).toBe('FEE_BID_TOO_HIGH');
    }
  });

  it('rejects a non-integer or negative fee (INVALID_FEE)', () => {
    for (const fee of [-5, 10.5]) {
      try {
        validateOperationSequence([payment(DEST_A, '1')], fee);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as ValidationError).code).toBe('INVALID_FEE');
      }
    }
  });

  it('rejects an invalid destination address', () => {
    expect(() => validateOperationSequence([payment('not-an-address', '1')], 100)).toThrowError(
      ValidationError,
    );
  });

  it('rejects a non-positive amount', () => {
    expect(() => validateOperationSequence([payment(DEST_A, '0')], 100)).toThrowError(
      ValidationError,
    );
    expect(() => validateOperationSequence([payment(DEST_A, '-3')], 100)).toThrowError(
      ValidationError,
    );
  });

  it('rejects an invalid per-operation source (INVALID_OPERATION_SOURCE path)', () => {
    expect(() =>
      validateOperationSequence(
        [
          {
            type: 'payment' as const,
            destination: DEST_A,
            asset: 'XLM',
            amount: '1',
            source: 'GARBAGE',
          },
        ],
        100,
      ),
    ).toThrowError(ValidationError);
  });

  it('rejects an unknown operation type (INVALID_OPERATION_TYPE)', () => {
    expect(() =>
      validateOperationSequence(
        [
          {
            type: 'demolish',
          } as unknown as { type: 'payment'; destination: string; asset: string; amount: string },
        ],
        100,
      ),
    ).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* buildMultiOperationTransaction                                              */
/* -------------------------------------------------------------------------- */

describe('buildMultiOperationTransaction', () => {
  it('assembles a valid multi-payment envelope with the exact total fee bid', () => {
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      fee: 400,
      operations: [payment(DEST_A, '10'), payment(DEST_B, '2.5', `USDC:${ISSUER}`)],
    });

    const decoded = decode(tx);
    expect(decoded.operations).toHaveLength(2);
    expect(decoded.fee).toBe('400');
    expect(decoded.source).toBe(KEYPAIR.publicKey());
  });

  it('preserves operation order in the envelope', () => {
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      fee: 200,
      operations: [payment(DEST_A, '1'), payment(DEST_B, '2')],
    });

    const decoded = decode(tx);
    expect(decoded.operations[0]?.type).toBe('payment');
    const destinations = decoded.operations.map(
      (op) => (op as unknown as { destination: string }).destination,
    );
    expect(destinations[0]).toBe(DEST_A);
    expect(destinations[1]).toBe(DEST_B);
  });

  it('attaches a memo to the multi-operation envelope', () => {
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      fee: 300,
      memoText: 'batch-42',
      operations: [payment(DEST_A, '1'), payment(DEST_B, '2'), payment(DEST_A, '3')],
    });

    const decoded = decode(tx);
    expect(decoded.memo.type).toBe('text');
    // stellar-base v15 exposes text memo values as Buffers.
    const memoValue = (decoded.memo as unknown as { value: Buffer | string }).value;
    expect(memoValue.toString('utf8')).toBe('batch-42');
  });

  it('supports createAccount and changeTrust specs', () => {
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      fee: 200,
      operations: [
        { type: 'changeTrust', asset: `USDC:${ISSUER}`, limit: '1000' },
        { type: 'createAccount', destination: DEST_B, startingBalance: '5' },
      ],
    });

    const decoded = decode(tx);
    expect(decoded.operations.map((op) => op.type)).toEqual(['changeTrust', 'createAccount']);
  });

  it('supports per-operation source accounts', () => {
    const altSource = Keypair.random().publicKey();
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      operations: [
        { type: 'payment', destination: DEST_A, asset: 'XLM', amount: '1', source: altSource },
      ],
    });

    const decoded = decode(tx);
    const opSource = (decoded.operations[0] as unknown as { source?: string }).source;
    expect(opSource).toBe(altSource);
  });

  it('splits an indivisible total bid across operations without losing stroops', () => {
    // 250 total across 2 ops → 125 base fee per op → 250 total on the wire.
    const tx = buildMultiOperationTransaction({
      source: ACCOUNT,
      networkPassphrase: PASSPHRASE,
      fee: 250,
      operations: [payment(DEST_A, '1'), payment(DEST_B, '1')],
    });

    expect(decode(tx).fee).toBe('250');
  });

  it('rejects a bundle with an invalid amount before building', () => {
    expect(() =>
      buildMultiOperationTransaction({
        source: ACCOUNT,
        networkPassphrase: PASSPHRASE,
        operations: [payment(DEST_A, 'zero' as unknown as string)],
      }),
    ).toThrowError(ValidationError);
  });

  it('rejects a missing source account (INVALID_SOURCE_ACCOUNT)', () => {
    try {
      buildMultiOperationTransaction({
        source: undefined as unknown as Account,
        networkPassphrase: PASSPHRASE,
        operations: [payment(DEST_A, '1')],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_SOURCE_ACCOUNT');
    }
  });

  it('rejects more than one memo (CONFLICTING_MEMO)', () => {
    try {
      buildMultiOperationTransaction({
        source: ACCOUNT,
        networkPassphrase: PASSPHRASE,
        memoText: 'one',
        memoId: '2',
        operations: [payment(DEST_A, '1')],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ValidationError).code).toBe('CONFLICTING_MEMO');
    }
  });

  it('rejects an empty operation bundle', () => {
    expect(() =>
      buildMultiOperationTransaction({
        source: ACCOUNT,
        networkPassphrase: PASSPHRASE,
        operations: [],
      }),
    ).toThrowError(/at least one operation/);
  });
});

/* -------------------------------------------------------------------------- */
/* buildTransactionFromOperations                                              */
/* -------------------------------------------------------------------------- */

describe('buildTransactionFromOperations', () => {
  it('builds from raw xdr.Operation values', () => {
    const tx = buildTransactionFromOperations(
      { source: ACCOUNT, networkPassphrase: PASSPHRASE, fee: 200 },
      [
        Operation.payment({ destination: DEST_A, asset: Asset.native(), amount: '1' }),
        Operation.payment({ destination: DEST_B, asset: Asset.native(), amount: '2' }),
      ],
    );

    const decoded = decode(tx);
    expect(decoded.operations).toHaveLength(2);
    expect(decoded.fee).toBe('200');
  });

  it('accepts an account merge as the final operation', () => {
    const tx = buildTransactionFromOperations(
      { source: ACCOUNT, networkPassphrase: PASSPHRASE, fee: 200 },
      [
        Operation.payment({ destination: DEST_A, asset: Asset.native(), amount: '1' }),
        Operation.accountMerge({ destination: DEST_B }),
      ],
    );

    const decoded = decode(tx);
    expect(decoded.operations.map((op) => op.type)).toEqual(['payment', 'accountMerge']);
  });

  it('rejects an account merge that is not the final operation (INVALID_OPERATION_SEQUENCE)', () => {
    try {
      buildTransactionFromOperations({ source: ACCOUNT, networkPassphrase: PASSPHRASE, fee: 300 }, [
        Operation.accountMerge({ destination: DEST_B }),
        Operation.payment({ destination: DEST_A, asset: Asset.native(), amount: '1' }),
      ]);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_OPERATION_SEQUENCE');
    }
  });

  it('rejects empty and oversized raw bundles', () => {
    expect(() =>
      buildTransactionFromOperations({ source: ACCOUNT, networkPassphrase: PASSPHRASE }, []),
    ).toThrowError(ValidationError);
  });
});
