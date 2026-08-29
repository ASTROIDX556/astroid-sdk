/**
 * Offline transaction signing for air-gapped agent setups.
 *
 * Signs a Stellar transaction locally with a `Keypair` — no network access
 * required. Decouples transaction construction and signing from the submission
 * lifecycle, so an agent can build and sign offline, then broadcast later.
 *
 * Secret keys are never logged, cached, or persisted: the keypair is derived
 * in memory, used to sign, and dropped.
 *
 * @module
 */

import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

/** Known Stellar network passphrases. */
export const StellarNetworkPassphrase = {
  PUBLIC: Networks.PUBLIC,
  TESTNET: Networks.TESTNET,
  FUTURENET: Networks.FUTURENET,
} as const;

const KNOWN_PASSPHRASES = new Set<string>([Networks.PUBLIC, Networks.TESTNET, Networks.FUTURENET]);

/** A raw transaction envelope (base64 XDR) or an already-built transaction. */
export type TransactionLike = string | Transaction | FeeBumpTransaction;

/** The signer: a base32 secret key string or a `Keypair` instance. */
export type SignerLike = string | Keypair;

/** The result of an offline signing operation. */
export interface OfflineSigningResult {
  /** The signed transaction instance. */
  transaction: Transaction | FeeBumpTransaction;
  /** Base64-encoded XDR of the signed transaction envelope. */
  xdr: string;
  /** The public key (G...) that signed the transaction. */
  publicKey: string;
}

/**
 * Validate that a network passphrase is one of the known Stellar passphrases.
 * Throws a structured {@link ValidationError} when missing or unknown.
 */
function assertKnownPassphrase(networkPassphrase: string): void {
  if (!networkPassphrase || networkPassphrase.trim().length === 0) {
    throw new ValidationError('A Stellar network passphrase is required for offline signing.', {
      code: 'MISSING_NETWORK_PASSPHRASE',
    });
  }
  if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    throw new ValidationError(
      `Unknown Stellar network passphrase "${networkPassphrase}". ` +
        `Use one of the known passphrases (e.g. ${Networks.TESTNET}).`,
      { code: 'INVALID_NETWORK_PASSPHRASE' },
    );
  }
}

/** Derive a `Keypair` from a secret key string, wrapping derivation errors. */
function keypairFromSecret(secretKey: string): Keypair {
  try {
    return Keypair.fromSecret(secretKey);
  } catch (cause) {
    throw new ValidationError('Invalid Stellar secret key: unable to derive a keypair.', {
      code: 'INVALID_SECRET_KEY',
      cause,
    });
  }
}

/** Parse a transaction from a base64 XDR string, wrapping parse errors. */
function transactionFromXdr(
  xdr: string,
  networkPassphrase: string,
): Transaction | FeeBumpTransaction {
  try {
    return TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (cause) {
    throw new ValidationError('Invalid transaction XDR: unable to parse the envelope.', {
      code: 'INVALID_TRANSACTION_XDR',
      cause,
    });
  }
}

/**
 * Sign a Stellar transaction locally, offline.
 *
 * Accepts either a base64 XDR envelope string or an already-built
 * `Transaction` instance, plus a secret key (or `Keypair`) and the target
 * network passphrase. The passphrase is validated against the known Stellar
 * networks before parsing/signing; invalid input throws a structured
 * {@link ValidationError}.
 *
 * The returned transaction is signed in place; call `toXDR()` on it or use the
 * returned `xdr` to submit later.
 *
 * @param transaction       Base64 XDR string or `Transaction` instance.
 * @param signer            Secret key string or `Keypair` instance.
 * @param networkPassphrase Target network passphrase (e.g. `StellarNetworkPassphrase.TESTNET`).
 * @returns                 The signed transaction and its base64 XDR.
 * @throws {ValidationError} When the passphrase is missing/unknown, the secret
 *                           key is invalid, or the XDR cannot be parsed.
 *
 * @example
 * ```ts
 * const { xdr } = signTransactionOffline(rawXdr, secretKey, StellarNetworkPassphrase.TESTNET);
 * ```
 */
export function signTransactionOffline(
  transaction: TransactionLike,
  signer: SignerLike,
  networkPassphrase: string,
): OfflineSigningResult {
  assertKnownPassphrase(networkPassphrase);

  const keypair = typeof signer === 'string' ? keypairFromSecret(signer) : signer;
  const tx =
    typeof transaction === 'string'
      ? transactionFromXdr(transaction, networkPassphrase)
      : transaction;

  tx.sign(keypair);

  return {
    transaction: tx,
    xdr: tx.toXDR(),
    publicKey: keypair.publicKey(),
  };
}
