/**
 * Transaction construction utilities.
 *
 * These functions assemble Stellar transactions with `@stellar/stellar-base`,
 * tailored for AI-agent workflows: build a payment transaction (or a generic
 * transaction from a list of operations), attach a memo, and serialise the
 * result to the base64 XDR envelope used by the Astroid API. No network or
 * backend interaction happens here — callers sign (see the wallet package's
 * offline signing) and submit via `submit.ts` or the transaction resource.
 *
 * Invalid input is surfaced as a structured {@link ValidationError} from
 * `@astroid/errors` rather than a bare `Error`.
 *
 * @module
 */

import { Account, Asset, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction, xdr } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Stellar public key (`G…`), the destination/source account format. */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/** Known Stellar network passphrases accepted by the builders. */
const KNOWN_PASSPHRASES = new Set<string>([
  Networks.PUBLIC,
  Networks.TESTNET,
  Networks.FUTURENET,
]);

/** Options common to every transaction built here. */
export interface BuildTransactionOptions {
  /** The source account (with a current sequence number). */
  source: Account;
  /** Stellar network passphrase (e.g. `StellarNetworkPassphrase.TESTNET`). */
  networkPassphrase: string;
  /** Base fee in stroops. Default `'100'`. */
  fee?: string | number;
  /** Time-Bound validity window in seconds from now. Default 300. */
  timeout?: number;
  /** Optional standard text memo (max 28 bytes). */
  memoText?: string;
}

/** Options for {@link buildPaymentTransaction}. */
export interface PaymentTransactionOptions extends BuildTransactionOptions {
  /** Destination Stellar account (`G…`). */
  destination: string;
  /**
   * Asset to transfer: `XLM`, an asset code only (e.g. `USDC`), or
   * `CODE:ISSUER` (e.g. `USDC:G…Issuer`).
   */
  asset: string;
  /** Amount to send (decimal string or number). */
  amount: string | number;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Throw a `ValidationError` unless `value` is a non-empty string. */
function requireField(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Missing required transaction field: ${field}.`, {
      code: 'MISSING_FIELD',
      details: { field },
    });
  }
}

/** Throw a `ValidationError` unless `value` is a positive finite amount. */
function assertPositiveAmount(value: string | number, field: string): void {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ValidationError(`${field} must be a positive finite amount.`, {
      code: 'INVALID_AMOUNT',
      details: { field },
    });
  }
}

/** Throw a `ValidationError` unless `address` looks like a Stellar public key. */
function assertPublicKey(address: string, field: string): void {
  requireField(address, field);
  if (!STELLAR_PUBLIC_KEY_PATTERN.test(address.trim())) {
    throw new ValidationError(`${field} must be a valid Stellar public key (G…).`, {
      code: 'INVALID_ADDRESS',
      details: { field },
    });
  }
}

/** Throw a `ValidationError` unless the network passphrase is non-empty. */
function assertPassphrase(networkPassphrase: string): void {
  requireField(networkPassphrase, 'networkPassphrase');
  if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    throw new ValidationError('networkPassphrase must be a known Stellar passphrase.', {
      code: 'INVALID_NETWORK_PASSPHRASE',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Asset parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse an asset identifier into a `@stellar/stellar-base` `Asset`.
 *
 * Accepts `XLM` (native), a bare asset code (e.g. `USDC`), or `CODE:ISSUER`
 * (e.g. `USDC:GBSTRH…`).
 *
 * @param asset The asset identifier to parse.
 * @returns The corresponding Stellar `Asset`.
 */
export function parseAsset(asset: string): Asset {
  requireField(asset, 'asset');
  const trimmed = asset.trim();
  const separator = trimmed.indexOf(':');
  if (separator === -1) {
    if (trimmed.toUpperCase() === 'XLM') return Asset.native();
    throw new ValidationError(
      `Not-native asset "${trimmed}" requires an issuer. Use CODE:ISSUER (e.g. USDC:G…).`,
      { code: 'INVALID_ASSET_ISSUER' },
    );
  }
  const code = trimmed.slice(0, separator);
  const issuer = trimmed.slice(separator + 1);
  assertPublicKey(issuer, 'asset issuer');
  return new Asset(code, issuer);
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

/** Shared construction of a `TransactionBuilder` primed with memo + timeout. */
function createBuilder(options: BuildTransactionOptions): TransactionBuilder {
  const { source, networkPassphrase } = options;
  if (!(source instanceof Account)) {
    throw new ValidationError('source must be a stellar-base Account instance.', {
      code: 'INVALID_SOURCE_ACCOUNT',
    });
  }
  assertPassphrase(networkPassphrase);

  const fee = options.fee ?? '100';
  const numericFee = typeof fee === 'number' ? fee : Number(fee);
  if (!Number.isFinite(numericFee) || numericFee < 0) {
    throw new ValidationError('fee must be a non-negative finite number of stroops.', {
      code: 'INVALID_FEE',
    });
  }

  let builder = new TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase,
  });
  if (options.memoText) {
    if (new TextEncoder().encode(options.memoText).byteLength > 28) {
      throw new ValidationError('Standard text memo must be 28 bytes or fewer.', {
        code: 'INVALID_MEMO',
      });
    }
    builder = builder.addMemo(Memo.text(options.memoText));
  }
  builder = builder.setTimeout(options.timeout ?? 300);
  return builder;
}

/**
 * Build a Stellar transaction from an explicit list of operations.
 *
 * Validates the source account, network passphrase and fee, then assembles the
 * transaction with the given operations, optional memo and a time-bound window.
 * The result is unsigned — sign it locally (e.g. with the wallet package's
 * offline signer) or submit the raw XDR for backend signing.
 *
 * @param options Build options (source, network, fee, timeout, memo).
 * @param operations The operations to include in the transaction.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For an invalid source, passphrase, fee, or memo.
 */
export function buildTransaction(
  options: BuildTransactionOptions,
  operations: xdr.Operation[],
): Transaction {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ValidationError('A transaction requires at least one operation.', {
      code: 'EMPTY_OPERATIONS',
    });
  }
  const builder = createBuilder(options);
  for (const op of operations) builder.addOperation(op);
  return builder.build();
}

/**
 * Build a single-payment Stellar transaction.
 *
 * Convenience wrapper over {@link buildTransaction} for the most common agent
 * action: pay an `amount` of `asset` to a `destination`. Validates the
 * destination address, amount and asset before building.
 *
 * @param options The payment to build, plus shared build options.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For an invalid destination, amount, asset, or account.
 *
 * @example
 * ```ts
 * const tx = buildPaymentTransaction({
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: 'USDC',
 *   amount: '10.5',
 *   memoText: 'reimburse',
 * });
 * ```
 */
export function buildPaymentTransaction(options: PaymentTransactionOptions): Transaction {
  const { destination, amount } = options;
  assertPublicKey(destination, 'destination');
  assertPositiveAmount(amount, 'amount');

  const asset = parseAsset(options.asset);
  return buildTransaction(options, [
    Operation.payment({
      destination: destination.trim(),
      asset,
      amount: String(amount),
    }),
  ]);
}

/**
 * Serialise a Stellar transaction to base64 XDR.
 *
 * Accepts a built `Transaction`, a `FeeBumpTransaction`, or an already-encoded
 * base64 XDR string (returned unchanged). The result is the envelope format used
 * by the Astroid API for simulation and submission.
 *
 * @param source The transaction to encode.
 * @returns The base64 XDR envelope.
 */
export function encodeTransaction(
  source: string | Transaction | FeeBumpTransaction,
): string {
  if (typeof source === 'string') {
    if (source.trim().length === 0) {
      throw new ValidationError('Transaction XDR must be a non-empty string.', {
        code: 'EMPTY_XDR',
      });
    }
    return source;
  }
  return source.toXDR();
}