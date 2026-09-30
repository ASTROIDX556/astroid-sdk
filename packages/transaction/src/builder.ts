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

import {
  Account,
  Asset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction, xdr } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  MAX_OPERATIONS,
  MAX_TOTAL_FEE_STROOPS,
  MIN_BASE_FEE_STROOPS,
} from './validator.js';
import {
  assertValidMemoHash,
  assertValidMemoText,
  assertValidPositiveAmount,
  assertValidStellarPublicKey,
} from './validate.js';
import { bumpFee } from './feeBump.js';
import type { FeeBumpOptions } from './feeBump.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Known Stellar network passphrases accepted by the builders. */
const KNOWN_PASSPHRASES = new Set<string>([Networks.PUBLIC, Networks.TESTNET, Networks.FUTURENET]);

/** Options common to every transaction built here. */
export interface BuildTransactionOptions {
  /** The source account (with a current sequence number). */
  source: Account;
  /** Stellar network passphrase (e.g. `StellarNetworkPassphrase.TESTNET`). */
  networkPassphrase: string;
  /**
   * Total fee bid in stroops for the whole transaction.
   *
   * Bounds enforced by every builder in this module:
   * - must be a non-negative integer number of stroops,
   * - must be at least {@link MIN_BASE_FEE_STROOPS} (100) per operation,
   * - must not exceed {@link MAX_TOTAL_FEE_STROOPS} (10,000,000 — the Astroid
   *   safety ceiling against accidental multi-XLM fee bids).
   *
   * Default `'100'` (the network floor for a single-operation transaction).
   */
  fee?: string | number;
  /** Time-Bound validity window in seconds from now. Default 300. */
  timeout?: number;
  /** Optional standard text memo (max 28 bytes). */
  memoText?: string;
  /**
   * Optional `MEMO_HASH` value: 32 bytes encoded as 64 hexadecimal characters.
   * Mutually exclusive with the other memo options.
   */
  memoHash?: string;
  /**
   * Optional `MEMO_RETURN` value: 32 bytes encoded as 64 hexadecimal characters.
   * Mutually exclusive with the other memo options.
   */
  memoReturn?: string;
  /**
   * Optional `MEMO_ID` value: a non-negative 64-bit unsigned integer.
   * Mutually exclusive with the other memo options.
   */
  memoId?: string | number;
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

/** Options for an autonomous agent transfer, optionally wrapped in a fee bump. */
export interface AgentTransferTransactionOptions extends PaymentTransactionOptions {
  /** Sponsor the transaction fee with a Stellar fee-bump envelope. */
  feeBump?: Pick<FeeBumpOptions, 'feeSource' | 'baseFee' | 'feeBufferPercentage'>;
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

/** Throw a `ValidationError` unless the network passphrase is non-empty. */
function assertPassphrase(networkPassphrase: string): void {
  requireField(networkPassphrase, 'networkPassphrase');
  if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    throw new ValidationError('networkPassphrase must be a known Stellar passphrase.', {
      code: 'INVALID_NETWORK_PASSPHRASE',
    });
  }
}

/**
 * Validate a fee bid against the network and Astroid fee bounds.
 *
 * The fee must be a non-negative integer number of stroops within
 * `[MIN_BASE_FEE_STROOPS, MAX_TOTAL_FEE_STROOPS]`. A per-operation floor is
 * applied by {@link buildTransaction}, which knows the operation count.
 *
 * @param fee The fee value to validate.
 * @returns The fee as a numeric stroop count.
 * @throws {ValidationError} With codes `INVALID_FEE` or `FEE_BID_TOO_HIGH`.
 */
function assertFeeWithinBounds(fee: string | number): number {
  const numericFee = typeof fee === 'number' ? fee : Number(fee);
  if (!Number.isFinite(numericFee) || !Number.isInteger(numericFee) || numericFee < 0) {
    throw new ValidationError(
      'fee must be a non-negative integer number of stroops.',
      { code: 'INVALID_FEE' },
    );
  }
  if (numericFee < MIN_BASE_FEE_STROOPS) {
    throw new ValidationError(
      `fee ${numericFee} stroops is below the network minimum of ${MIN_BASE_FEE_STROOPS} stroops per operation.`,
      { code: 'FEE_BELOW_MINIMUM' },
    );
  }
  if (numericFee > MAX_TOTAL_FEE_STROOPS) {
    throw new ValidationError(
      `fee bid ${numericFee} stroops exceeds the Astroid safety ceiling of ${MAX_TOTAL_FEE_STROOPS} stroops.`,
      { code: 'FEE_BID_TOO_HIGH' },
    );
  }
  return numericFee;
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
  assertValidStellarPublicKey(issuer, 'asset issuer');
  return new Asset(code, issuer);
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

/** Resolve the configured memo (text/hash/return/id), enforcing at-most-one. */
function resolveMemo(options: BuildTransactionOptions): Memo | undefined {
  const configured = [
    options.memoText !== undefined,
    options.memoHash !== undefined,
    options.memoReturn !== undefined,
    options.memoId !== undefined,
  ].filter(Boolean).length;

  if (configured > 1) {
    throw new ValidationError(
      'At most one memo may be supplied (memoText, memoHash, memoReturn, or memoId).',
      { code: 'CONFLICTING_MEMO' },
    );
  }

  if (options.memoText !== undefined) {
    assertValidMemoText(options.memoText);
    return Memo.text(options.memoText);
  }
  if (options.memoHash !== undefined) {
    assertValidMemoHash(options.memoHash, 'memoHash');
    return Memo.hash(options.memoHash.trim());
  }
  if (options.memoReturn !== undefined) {
    assertValidMemoHash(options.memoReturn, 'memoReturn');
    return Memo.return(options.memoReturn.trim());
  }
  if (options.memoId !== undefined) {
    const id = String(options.memoId).trim();
    if (!/^\d{1,20}$/.test(id) || BigInt(id) > 18_446_744_073_709_551_615n) {
      throw new ValidationError('memoId must be a uint64 value.', {
        code: 'INVALID_MEMO',
        details: { field: 'memoId' },
      });
    }
    return Memo.id(id);
  }
  return undefined;
}

/**
 * Shared construction of a `TransactionBuilder` primed with memo + timeout.
 *
 * Exported for the multi-operation builders in `multi-operation.ts`, which
 * need to assemble a transaction from a declarative bundle before the final
 * fee bid is known (stellar-base treats the builder fee as a per-operation
 * base fee and multiplies it by the operation count on build).
 *
 * @internal
 */
export function createBuilder(options: BuildTransactionOptions): TransactionBuilder {
  const { source, networkPassphrase } = options;
  if (!(source instanceof Account)) {
    throw new ValidationError('source must be a stellar-base Account instance.', {
      code: 'INVALID_SOURCE_ACCOUNT',
    });
  }
  assertPassphrase(networkPassphrase);

  const numericFee = assertFeeWithinBounds(options.fee ?? '100');

  let builder = new TransactionBuilder(source, {
    fee: String(numericFee),
    networkPassphrase,
  });
  const memo = resolveMemo(options);
  if (memo) builder = builder.addMemo(memo);
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
  if (operations.length > MAX_OPERATIONS) {
    throw new ValidationError(
      `A transaction may contain at most ${MAX_OPERATIONS} operations (got ${operations.length}).`,
      { code: 'TOO_MANY_OPERATIONS' },
    );
  }

  // Per-operation fee floor: the total bid must cover ops × base fee.
  const opCount = operations.length;
  const fee = assertFeeWithinBounds(options.fee ?? '100');
  const minTotal = opCount * MIN_BASE_FEE_STROOPS;
  if (fee < minTotal) {
    throw new ValidationError(
      `fee ${fee} stroops is below the network minimum of ${minTotal} stroops ` +
        `(${opCount} op(s) × ${MIN_BASE_FEE_STROOPS}).`,
      { code: 'FEE_BELOW_MINIMUM' },
    );
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
 * destination address, amount, asset and fee bounds before building. Supports
 * native XLM (`asset: 'XLM'`) and issued assets (`'CODE:ISSUER'`).
 *
 * @param options The payment to build, plus shared build options.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For an invalid destination, amount, asset, account,
 *   memo, or a fee outside the accepted bounds.
 *
 * @example
 * ```ts
 * // Native XLM transfer with a memo:
 * const tx = buildPaymentTransaction({
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: 'XLM',
 *   amount: '10.5',
 *   memoText: 'reimburse',
 * });
 *
 * // Issued-asset transfer with an explicit fee bid (stroops):
 * const usdcTx = buildPaymentTransaction({
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: `USDC:${issuer}`,   // CODE:ISSUER
 *   amount: '25',
 *   fee: 500,                  // ≥ 100 stroops/op, ≤ 10,000,000 stroops
 * });
 * ```
 */
export function buildPaymentTransaction(options: PaymentTransactionOptions): Transaction {
  const { destination, amount } = options;
  assertValidStellarPublicKey(destination, 'destination');
  assertValidPositiveAmount(amount, 'amount');

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
 * Build an agent payment transaction, optionally wrapping it in a fee bump.
 * The `source` account sequence is managed by Stellar's `TransactionBuilder`;
 * when `feeBump` is supplied, the existing fee-bump validator enforces the
 * sponsor and network constraints.
 *
 * @param options Transfer details and optional fee sponsorship.
 * @returns The unsigned payment transaction or fee-bump envelope.
 */
export function buildAgentTransferTransaction(
  options: AgentTransferTransactionOptions,
): Transaction | FeeBumpTransaction {
  const transaction = buildPaymentTransaction(options);
  if (!options.feeBump) return transaction;

  return bumpFee({
    ...options.feeBump,
    transaction,
    networkPassphrase: options.networkPassphrase,
  }).transaction;
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
 * @throws {ValidationError} When an empty XDR string is passed.
 *
 * @example
 * ```ts
 * const xdr = encodeTransaction(tx);       // 'AAAAAG…==='
 * const same = encodeTransaction(xdr);     // returns the string unchanged
 * ```
 */
export function encodeTransaction(source: string | Transaction | FeeBumpTransaction): string {
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
