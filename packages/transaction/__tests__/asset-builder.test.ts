/**
 * Tests for the asset-descriptor-aware transaction builder (issue #106):
 * `buildAssetPaymentTransaction` and `resolveAsset`.
 */

import { describe, expect, it } from 'vitest';

import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { AssetDescriptor } from '@astroid/types';

import { buildAssetPaymentTransaction, resolveAsset } from '../src/asset-builder.js';
import { buildPaymentTransaction } from '../src/builder.js';

const PASSPHRASE = Networks.TESTNET;

function makeAccount(sequence = '1'): Account {
  return new Account(Keypair.random().publicKey(), sequence);
}

function randomKey(): string {
  return Keypair.random().publicKey();
}

/** Decode an envelope to inspect its wire structure. */
function decode(xdr: string): Transaction | FeeBumpTransaction {
  return TransactionBuilder.fromXDR(xdr, PASSPHRASE);
}

/* -------------------------------------------------------------------------- */
/* resolveAsset                                                                */
/* -------------------------------------------------------------------------- */

describe('resolveAsset', () => {
  it('resolves the native descriptor to Asset.native()', () => {
    const { asset, stellarAsset } = resolveAsset({ type: 'native' });
    expect(asset).toEqual({ type: 'native' });
    expect(stellarAsset.isNative()).toBe(true);
  });

  it('resolves an issued descriptor to a stellar-base Asset', () => {
    const issuer = randomKey();
    const { asset, stellarAsset } = resolveAsset({ type: 'issued', code: 'USDC', issuer });
    expect(asset).toEqual({ type: 'issued', code: 'USDC', issuer });
    expect(stellarAsset.code).toBe('USDC');
    expect(stellarAsset.issuer).toBe(issuer);
    expect(stellarAsset.isNative()).toBe(false);
  });

  it('resolves the loose string convention to the canonical descriptor', () => {
    const issuer = randomKey();
    const { asset, stellarAsset } = resolveAsset(`USDC:${issuer}`);
    expect(asset).toEqual({ type: 'issued', code: 'USDC', issuer });
    expect(stellarAsset.code).toBe('USDC');
  });

  it('accepts XLM in any casing', () => {
    expect(resolveAsset('XLM').asset).toEqual({ type: 'native' });
    expect(resolveAsset('xlm').asset).toEqual({ type: 'native' });
  });

  it('rejects a bare non-native code without an issuer (INVALID_ASSET_ISSUER)', () => {
    try {
      resolveAsset('USDC');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ASSET_ISSUER');
    }
  });

  it('rejects an issued descriptor with an invalid issuer (INVALID_ADDRESS)', () => {
    try {
      resolveAsset({ type: 'issued', code: 'USDC', issuer: 'not-an-address' });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ADDRESS');
    }
  });

  it('rejects an unknown descriptor discriminator', () => {
    expect(() =>
      resolveAsset({ type: 'liquidity', code: 'POOL' } as unknown as AssetDescriptor),
    ).toThrowError(ValidationError);
  });

  it('rejects null, undefined and empty identifiers', () => {
    expect(() => resolveAsset(null as unknown as string)).toThrowError(ValidationError);
    expect(() => resolveAsset(undefined as unknown as string)).toThrowError(ValidationError);
    expect(() => resolveAsset('   ')).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* buildAssetPaymentTransaction                                                */
/* -------------------------------------------------------------------------- */

describe('buildAssetPaymentTransaction', () => {
  it('builds a native XLM payment from the typed descriptor', () => {
    const source = makeAccount('100');
    const destination = randomKey();

    const result = buildAssetPaymentTransaction({
      source,
      networkPassphrase: PASSPHRASE,
      destination,
      asset: { type: 'native' },
      amount: '10.5',
      memoText: 'payout-42',
    });

    expect(result.asset).toEqual({ type: 'native' });
    expect(result.destination).toBe(destination);
    expect(result.amount).toBe('10.5');

    const decoded = decode(result.xdr);
    expect(decoded).toBeInstanceOf(Transaction);
    if (!(decoded instanceof Transaction)) throw new Error('expected a plain Transaction');
    expect(decoded.source).toBe(source.accountId());
    expect(decoded.sequence).toBe('101');
    expect(decoded.operations).toHaveLength(1);
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.destination).toBe(destination);
    expect(op.amount).toBe('10.5000000');
    expect(op.asset.isNative()).toBe(true);
    expect(String(decoded.memo.value)).toBe('payout-42');
    expect(decoded.signatures).toHaveLength(0);
  });

  it('builds a custom trustline-asset payment from the typed descriptor', () => {
    const issuer = randomKey();
    const destination = randomKey();

    const result = buildAssetPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: PASSPHRASE,
      destination,
      asset: { type: 'issued', code: 'USDC', issuer },
      amount: '25',
    });

    const decoded = decode(result.xdr);
    if (!(decoded instanceof Transaction)) throw new Error('expected a plain Transaction');
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.asset.code).toBe('USDC');
    expect(op.asset.issuer).toBe(issuer);
    expect(op.amount).toBe('25.0000000');
  });

  it('accepts the loose string convention for parity with buildPaymentTransaction', () => {
    const issuer = randomKey();
    const result = buildAssetPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: PASSPHRASE,
      destination: randomKey(),
      asset: `USDC:${issuer}`,
      amount: '5',
    });
    expect(result.stellarAsset).toBeInstanceOf(Asset);
    expect(result.stellarAsset.issuer).toBe(issuer);

    const decoded = decode(result.xdr);
    if (!(decoded instanceof Transaction)) throw new Error('expected a plain Transaction');
    const op = decoded.operations[0]!;
    if (op.type !== 'payment') throw new Error('expected a payment operation');
    expect(op.asset.code).toBe('USDC');
  });

  it('produces the same wire envelope as the string-based builder for equal inputs', () => {
    const sourceKey = Keypair.random();
    const destination = randomKey();
    const issuer = randomKey();

    const fromDescriptor = buildAssetPaymentTransaction({
      source: new Account(sourceKey.publicKey(), '7'),
      networkPassphrase: PASSPHRASE,
      destination,
      asset: { type: 'issued', code: 'EURC', issuer },
      amount: '3',
    });

    const fromString = buildPaymentTransaction({
      // A fresh Account instance: TransactionBuilder.build() mutates (bumps)
      // the sequence of the Account passed to it, so the two builds must not
      // share one instance.
      source: new Account(sourceKey.publicKey(), '7'),
      networkPassphrase: PASSPHRASE,
      destination,
      asset: `EURC:${issuer}`,
      amount: '3',
    });

    // Signatures are empty and every other field is identical, so the XDR must match.
    expect(fromDescriptor.xdr).toBe(fromString.toXDR());
  });

  it('wraps the payment in a fee-bump envelope when a sponsor is provided', () => {
    const sponsor = Keypair.random();
    const result = buildAssetPaymentTransaction({
      source: makeAccount(),
      networkPassphrase: PASSPHRASE,
      destination: randomKey(),
      asset: { type: 'native' },
      amount: '1',
      feeBump: {
        feeSource: { publicKey: sponsor.publicKey(), secretKey: sponsor.secret() },
      },
    });

    expect(result.transaction).toBeInstanceOf(FeeBumpTransaction);
    expect(result.xdr).toBe(result.transaction.toXDR());
    const decoded = decode(result.xdr);
    expect(decoded).toBeInstanceOf(FeeBumpTransaction);
  });

  it('rejects an invalid destination before building (INVALID_ADDRESS)', () => {
    try {
      buildAssetPaymentTransaction({
        source: makeAccount(),
        networkPassphrase: PASSPHRASE,
        destination: 'not-an-address',
        asset: { type: 'native' },
        amount: '1',
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_ADDRESS');
      expect((err as ValidationError).details).toMatchObject({ field: 'destination' });
    }
  });

  it('rejects a non-positive amount (INVALID_AMOUNT)', () => {
    for (const amount of ['0', '-3', 'abc']) {
      try {
        buildAssetPaymentTransaction({
          source: makeAccount(),
          networkPassphrase: PASSPHRASE,
          destination: randomKey(),
          asset: { type: 'native' },
          amount,
        });
        expect.unreachable(`expected a ValidationError for ${String(amount)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
      }
    }
  });

  it('rejects a malformed asset before building', () => {
    const options = {
      source: makeAccount(),
      networkPassphrase: PASSPHRASE,
      destination: randomKey(),
      asset: { type: 'issued', code: 'USDC', issuer: 'GARBAGE' },
      amount: '1',
    };
    expect(() => buildAssetPaymentTransaction(options)).toThrowError(ValidationError);
  });

  it('rejects a fee outside the accepted bounds', () => {
    expect(() =>
      buildAssetPaymentTransaction({
        source: makeAccount(),
        networkPassphrase: PASSPHRASE,
        destination: randomKey(),
        asset: { type: 'native' },
        amount: '1',
        fee: 99,
      }),
    ).toThrowError(/FEE_BELOW_MINIMUM|network minimum/);
  });

  it('rejects an invalid source account', () => {
    expect(() =>
      buildAssetPaymentTransaction({
        source: 'G-not-an-account' as unknown as Account,
        networkPassphrase: PASSPHRASE,
        destination: randomKey(),
        asset: { type: 'native' },
        amount: '1',
      }),
    ).toThrowError(ValidationError);
  });
});
