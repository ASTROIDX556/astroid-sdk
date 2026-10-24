/**
 * Memo and fee-bump coverage for the transaction builders.
 *
 * Every case builds a real envelope and decodes it again, so the assertions
 * check the serialized transaction (the bytes that reach the network), not the
 * in-memory options that produced it.
 */

import { describe, expect, it } from 'vitest';

import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  buildAgentTransferTransaction,
  buildPaymentTransaction,
  buildTransaction,
  encodeTransaction,
} from '../src/builder.js';
import { bumpFee } from '../src/feeBump.js';
import { buildMultiOperationTransaction } from '../src/multi-operation.js';
import { assertValidMemoId, isValidMemoId } from '../src/validate.js';

const UINT64_MAX = '18446744073709551615';
const HASH_HEX = 'a1'.repeat(32);

function makeAccount(sequence = '1'): Account {
  return new Account(Keypair.random().publicKey(), sequence);
}

function buildPayment(memo: Record<string, unknown>) {
  const account = makeAccount();
  return buildPaymentTransaction({
    source: account,
    networkPassphrase: Networks.TESTNET,
    destination: Keypair.random().publicKey(),
    asset: 'XLM',
    amount: '1',
    ...memo,
  });
}

/** Decode an envelope and narrow it to a plain (non-fee-bump) transaction. */
function decodeTransaction(xdr: string) {
  const decoded = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  if (decoded instanceof FeeBumpTransaction) {
    throw new Error('expected a plain transaction envelope');
  }
  return decoded;
}

function decodeFeeBump(xdr: string): FeeBumpTransaction {
  const decoded = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  if (!(decoded instanceof FeeBumpTransaction)) {
    throw new Error('expected a fee-bump envelope');
  }
  return decoded;
}

/* -------------------------------------------------------------------------- */
/* Text memos                                                                  */
/* -------------------------------------------------------------------------- */

describe('text memos', () => {
  it('round-trips a text memo through base64 XDR', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoText: 'agent-op-42' })));

    expect(decoded.memo.type).toBe('text');
    expect(String(decoded.memo.value)).toBe('agent-op-42');
  });

  it('accepts exactly 28 UTF-8 bytes, including multi-byte characters', () => {
    const memo = 'é'.repeat(14); // 14 × 2 bytes = 28
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoText: memo })));

    expect(decoded.memo.type).toBe('text');
    expect(Buffer.from(decoded.memo.value as Buffer).toString('utf8')).toBe(memo);
  });

  it('rejects a 30-byte memo with INVALID_MEMO', () => {
    try {
      buildPayment({ memoText: 'é'.repeat(15) });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_MEMO');
      expect((err as ValidationError).details).toMatchObject({ field: 'memo' });
    }
  });

  it('omits the memo entirely when none is configured', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({})));

    expect(decoded.memo.type).toBe('none');
  });
});

/* -------------------------------------------------------------------------- */
/* Hash and return memos                                                       */
/* -------------------------------------------------------------------------- */

describe('hash and return memos', () => {
  it('serializes a hash memo as the exact 32 bytes', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoHash: HASH_HEX })));

    expect(decoded.memo.type).toBe('hash');
    expect(Buffer.from(decoded.memo.value as Buffer).toString('hex')).toBe(HASH_HEX);
  });

  it('serializes a return memo as the exact 32 bytes', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoReturn: HASH_HEX })));

    expect(decoded.memo.type).toBe('return');
    expect(Buffer.from(decoded.memo.value as Buffer).toString('hex')).toBe(HASH_HEX);
  });

  it('accepts upper-case hex and keeps the byte value', () => {
    const decoded = decodeTransaction(
      encodeTransaction(buildPayment({ memoHash: HASH_HEX.toUpperCase() })),
    );

    expect(Buffer.from(decoded.memo.value as Buffer).toString('hex')).toBe(HASH_HEX);
  });

  it('rejects a hash memo that is not 32 bytes', () => {
    expect(() => buildPayment({ memoHash: 'ab'.repeat(31) })).toThrowError(ValidationError);
    expect(() => buildPayment({ memoReturn: 'not-hex' })).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Id memos                                                                    */
/* -------------------------------------------------------------------------- */

describe('id memos', () => {
  it('round-trips a numeric id', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoId: 42 })));

    expect(decoded.memo.type).toBe('id');
    expect(String(decoded.memo.value)).toBe('42');
  });

  it('round-trips the maximum uint64 id as a string', () => {
    const decoded = decodeTransaction(encodeTransaction(buildPayment({ memoId: UINT64_MAX })));

    expect(decoded.memo.type).toBe('id');
    expect(String(decoded.memo.value)).toBe(UINT64_MAX);
  });

  it('round-trips a bigint id above Number.MAX_SAFE_INTEGER without rounding', () => {
    const decoded = decodeTransaction(
      encodeTransaction(buildPayment({ memoId: 9_223_372_036_854_775_809n })),
    );

    expect(decoded.memo.type).toBe('id');
    expect(String(decoded.memo.value)).toBe('9223372036854775809');
  });

  it.each(['-1', '1.5', '1e3', '18446744073709551616', 1.5, -1, 2n ** 64n])(
    'rejects %s with INVALID_MEMO',
    (memoId) => {
      try {
        buildPayment({ memoId });
        expect.unreachable('expected a ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe('INVALID_MEMO');
        expect((err as ValidationError).details).toMatchObject({ field: 'memoId' });
      }
    },
  );
});

describe('isValidMemoId / assertValidMemoId', () => {
  it('accepts uint64 strings, safe integers and bigints', () => {
    expect(isValidMemoId('0')).toBe(true);
    expect(isValidMemoId(UINT64_MAX)).toBe(true);
    expect(isValidMemoId(0)).toBe(true);
    expect(isValidMemoId(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidMemoId(18_446_744_073_709_551_615n)).toBe(true);
  });

  it('rejects malformed or out-of-range ids', () => {
    expect(isValidMemoId('')).toBe(false);
    expect(isValidMemoId('  ')).toBe(false);
    expect(isValidMemoId('-0')).toBe(false);
    expect(isValidMemoId('0x10')).toBe(false);
    expect(isValidMemoId(Infinity)).toBe(false);
    expect(isValidMemoId(NaN)).toBe(false);
    expect(isValidMemoId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidMemoId(-1n)).toBe(false);
    expect(isValidMemoId(2n ** 64n)).toBe(false);
    expect(isValidMemoId(null as unknown as string)).toBe(false);
  });

  it('throws a structured ValidationError from the assert companion', () => {
    expect(() => assertValidMemoId('7')).not.toThrow();
    expect(() => assertValidMemoId('nope')).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Memo exclusivity                                                            */
/* -------------------------------------------------------------------------- */

describe('memo exclusivity', () => {
  it('rejects two memo options with CONFLICTING_MEMO', () => {
    try {
      buildPayment({ memoText: 'one', memoId: '2' });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('CONFLICTING_MEMO');
    }
  });

  it('rejects hash and return memos together', () => {
    expect(() => buildPayment({ memoHash: HASH_HEX, memoReturn: HASH_HEX })).toThrowError(
      /At most one memo/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Memos on the other builders                                                 */
/* -------------------------------------------------------------------------- */

describe('memos on every builder', () => {
  it('keeps a hash memo on a multi-operation transaction', () => {
    const tx = buildMultiOperationTransaction({
      source: makeAccount(),
      networkPassphrase: Networks.TESTNET,
      fee: 200,
      memoHash: HASH_HEX,
      operations: [
        { type: 'payment', destination: Keypair.random().publicKey(), asset: 'XLM', amount: '1' },
        { type: 'payment', destination: Keypair.random().publicKey(), asset: 'XLM', amount: '2' },
      ],
    });

    const decoded = decodeTransaction(encodeTransaction(tx));
    expect(decoded.operations).toHaveLength(2);
    expect(decoded.memo.type).toBe('hash');
    expect(Buffer.from(decoded.memo.value as Buffer).toString('hex')).toBe(HASH_HEX);
  });

  it('keeps an id memo on a generic operation list', () => {
    const tx = buildTransaction(
      {
        source: makeAccount(),
        networkPassphrase: Networks.TESTNET,
        memoId: UINT64_MAX,
      },
      [
        Operation.createAccount({
          destination: Keypair.random().publicKey(),
          startingBalance: '2',
        }),
      ],
    );

    expect(tx.memo.type).toBe('id');
    expect(String(tx.memo.value)).toBe(UINT64_MAX);
  });
});

/* -------------------------------------------------------------------------- */
/* Fee bumps                                                                   */
/* -------------------------------------------------------------------------- */

describe('fee-bump configuration', () => {
  it('preserves the memo on the inner transaction', () => {
    const sponsor = Keypair.random();
    const tx = buildAgentTransferTransaction({
      source: makeAccount(),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      memoText: 'congestion-memo',
      feeBump: { feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() } },
    });

    expect(tx).toBeInstanceOf(FeeBumpTransaction);
    const decoded = decodeFeeBump(encodeTransaction(tx));
    expect(decoded.innerTransaction.memo.type).toBe('text');
    expect(String(decoded.innerTransaction.memo.value)).toBe('congestion-memo');
    expect(decoded.feeSource).toBe(sponsor.publicKey());
  });

  it('honours an explicit baseFee and signs with the sponsor credentials', () => {
    const sponsor = Keypair.random();
    const inner = buildPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      memoId: '7',
    });

    const result = bumpFee({
      transaction: inner,
      feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
      networkPassphrase: Networks.TESTNET,
      baseFee: 500,
    });

    expect(result.signed).toBe(true);
    expect(result.baseFee).toBe('500');
    // baseFee × (operations + 1)
    expect(result.fee).toBe('1000');
    expect(result.innerXdr).toBe(inner.toXDR());
    expect(decodeFeeBump(result.xdr).innerTransaction.memo.type).toBe('id');
  });

  it('returns an unsigned fee-bump envelope when only a public key is supplied', () => {
    const sponsor = Keypair.random();
    const inner = buildPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
    });

    const result = bumpFee({
      transaction: inner,
      feeSource: { publicKey: sponsor.publicKey() },
      networkPassphrase: Networks.TESTNET,
      baseFee: 200,
    });

    expect(result.signed).toBe(false);
    expect(result.transaction.signatures).toHaveLength(0);
  });

  it('applies the fee buffer to the inner inclusion fee when baseFee is omitted', () => {
    const sponsor = Keypair.random();
    const inner = buildPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
    }); // 100 stroops per operation

    const result = bumpFee({
      transaction: inner,
      feeSource: { publicKey: sponsor.publicKey() },
      networkPassphrase: Networks.TESTNET,
      feeBufferPercentage: 100,
    });

    expect(result.baseFee).toBe('200');
    expect(result.fee).toBe('400');
  });
});
