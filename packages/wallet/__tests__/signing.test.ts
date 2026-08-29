import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { describe, expect, it } from 'vitest';

import { signTransactionOffline, StellarNetworkPassphrase } from '../src/signing.js';

/** Build an unsigned payment transaction for the given network. */
function buildPaymentTransaction(networkPassphrase: string) {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  const tx = new TransactionBuilder(account, {
    fee: '100',
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
  return { tx, keypair };
}

describe('signTransactionOffline', () => {
  it('signs a transaction XDR with a secret key on Testnet', () => {
    const { tx, keypair } = buildPaymentTransaction(Networks.TESTNET);

    const result = signTransactionOffline(
      tx.toXDR(),
      keypair.secret(),
      StellarNetworkPassphrase.TESTNET,
    );

    expect(result.publicKey).toBe(keypair.publicKey());
    expect(result.xdr).toBeTruthy();

    // The returned XDR must decode back to a signed transaction.
    const signed = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    // The signature must be cryptographically valid over the transaction hash.
    const signature = signed.signatures[0]?.signature();
    expect(signature).toBeTruthy();
    expect(keypair.verify(signed.hash(), signature as Buffer)).toBe(true);
  });

  it('signs a Transaction instance directly', () => {
    const { tx, keypair } = buildPaymentTransaction(Networks.TESTNET);

    const result = signTransactionOffline(tx, keypair, StellarNetworkPassphrase.TESTNET);

    expect(result.transaction).toBe(tx);
    expect(result.xdr).toBe(tx.toXDR());
    expect(tx.signatures).toHaveLength(1);
  });

  it('signs on the Public network with a Keypair instance', () => {
    const { tx, keypair } = buildPaymentTransaction(Networks.PUBLIC);

    const result = signTransactionOffline(tx.toXDR(), keypair, StellarNetworkPassphrase.PUBLIC);

    const signed = TransactionBuilder.fromXDR(result.xdr, Networks.PUBLIC);
    expect(signed.signatures).toHaveLength(1);
    const signature = signed.signatures[0]?.signature();
    expect(keypair.verify(signed.hash(), signature as Buffer)).toBe(true);
  });

  it('throws a structured error when the passphrase is missing', () => {
    const { tx, keypair } = buildPaymentTransaction(Networks.TESTNET);

    expect(() => signTransactionOffline(tx.toXDR(), keypair.secret(), '')).toThrowError(
      ValidationError,
    );
    expect(() => signTransactionOffline(tx.toXDR(), keypair.secret(), '')).toThrowError(
      /passphrase/i,
    );
  });

  it('throws a structured error for an unknown passphrase', () => {
    const { tx, keypair } = buildPaymentTransaction(Networks.TESTNET);

    try {
      signTransactionOffline(tx.toXDR(), keypair.secret(), 'Not A Real Network');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_NETWORK_PASSPHRASE');
    }
  });

  it('throws a structured error for an invalid secret key', () => {
    const { tx } = buildPaymentTransaction(Networks.TESTNET);

    try {
      signTransactionOffline(tx.toXDR(), 'not-a-secret', StellarNetworkPassphrase.TESTNET);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_SECRET_KEY');
    }
  });

  it('throws a structured error for invalid XDR', () => {
    const { keypair } = buildPaymentTransaction(Networks.TESTNET);

    try {
      signTransactionOffline('not-an-xdr', keypair.secret(), StellarNetworkPassphrase.TESTNET);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_TRANSACTION_XDR');
    }
  });
});
