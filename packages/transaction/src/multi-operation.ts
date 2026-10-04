/**
 * Multi-operation transaction builders.
 *
 * The single-payment builder in `builder.ts` covers the common "pay one
 * destination" case. Autonomous agents frequently need more: batch payouts to
 * several destinations, a payment combined with an allowance update, or any
 * other bundle of operations that must settle atomically in **one** Stellar
 * transaction.
 *
 * {@link buildMultiOperationTransaction} assembles such bundles from a
 * declarative operation spec, and {@link validateOperationSequence} checks a
 * bundle **before** anything is built: operation count bounds, per-operation
 * fee coverage, at-most-one memo, and sequencing constraints (an account-merge
 * must come last — it consumes the source account).
 *
 * Everything here uses standard `@stellar/stellar-base` structures and throws
 * typed {@link ValidationError}s from `@astroid/errors` with machine-readable
 * codes, matching the conventions of `builder.ts`.
 *
 * @module
 */

import { Asset, Operation, xdr, type Transaction } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { MAX_OPERATIONS, MAX_TOTAL_FEE_STROOPS, MIN_BASE_FEE_STROOPS } from './validator.js';
import { assertValidPositiveAmount, assertValidStellarPublicKey } from './validate.js';
import { createBuilder, parseAsset, type BuildTransactionOptions } from './builder.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** A payment of a specific amount of an asset to a destination account. */
export interface PaymentOperationSpec {
  /** Discriminator for a payment operation. */
  type: 'payment';
  /** Destination Stellar account (`G…`). */
  destination: string;
  /**
   * Asset to transfer: `XLM`, a bare asset code that the source account
   *trusts, or `CODE:ISSUER` (e.g. `USDC:G…Issuer`).
   */
  asset: string;
  /** Amount to send (decimal string or number). */
  amount: string | number;
  /**
   * Optional per-operation source account (`G…`). When omitted the
   * transaction's source account is used. Note: every distinct operation
   * source requires a matching signature.
   */
  source?: string;
}

/** Flags an account to create and fund it in one stroke. */
export interface CreateAccountOperationSpec {
  /** Discriminator for a create-account operation. */
  type: 'createAccount';
  /** The new account's Stellar address (`G…`). */
  destination: string;
  /** Starting balance in XLM, at or above the network minimum reserve. */
  startingBalance: string | number;
  /** Optional per-operation source account (`G…`). */
  source?: string;
}

/**
 * Bump an account's trustline limit for a issued asset, or add the
 * trustline (with a non-zero limit). Cannot hold native XLM.
 */
export interface ChangeTrustOperationSpec {
  /** Discriminator for a change-trust operation. */
  type: 'changeTrust';
  /** The asset to trust, `CODE:ISSUER` (e.g. `USDC:G…Issuer`). */
  asset: string;
  /**
   * Trustline limit (decimal string or number). Omit for the maximum
   * (`i64::MAX`) limit.
   */
  limit?: string | number;
  /** Optional per-operation source account (`G…`). */
  source?: string;
}

/**
 * A union of the declarative operation specs accepted by
 * {@link buildMultiOperationTransaction}.
 */
export type OperationSpec =
  | PaymentOperationSpec
  | CreateAccountOperationSpec
  | ChangeTrustOperationSpec;

/** Options for {@link buildMultiOperationTransaction}. */
export interface MultiOperationTransactionOptions extends BuildTransactionOptions {
  /**
   * The operation bundle, in the order it must execute.
   *
   * Constraints:
   * - 1–{@link MAX_OPERATIONS} operations;
   * - an `accountMerge`-class operation must be last (none of the specs
   *   above produce one, but the sequencing rule is enforced for callers
   *   passing raw `xdr.Operation`s to {@link buildTransactionFromOperations});
   * - the total fee bid must cover every operation at
   *   {@link MIN_BASE_FEE_STROOPS} stroops.
   */
  operations: OperationSpec[];
}

/**
 * Validate the declarative fields of a single {@link OperationSpec}:
 * addresses, amounts and asset identifiers.
 *
 * @param spec The operation spec to check.
 * @param index Position in the bundle, used in error messages.
 * @throws {ValidationError} With codes `INVALID_DESTINATION`,
 *   `INVALID_AMOUNT`, `INVALID_ASSET` or `INVALID_OPERATION_SOURCE`.
 */
function assertValidSpec(spec: OperationSpec, index: number): void {
  const where = `operations[${index}]`;

  switch (spec.type) {
    case 'payment':
      assertValidStellarPublicKey(spec.destination, `${where}.destination`);
      assertValidPositiveAmount(spec.amount, `${where}.amount`);
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;
    case 'createAccount':
      assertValidStellarPublicKey(spec.destination, `${where}.destination`);
      assertValidPositiveAmount(spec.startingBalance, `${where}.startingBalance`);
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;
    case 'changeTrust':
      // changeTrust requires CODE:ISSUER (cannot trust native XLM); parseAsset
      // rejects a bare `XLM`/code-only identifier, surfacing INVALID_ASSET.
      parseAsset(spec.asset);
      if (spec.limit !== undefined) {
        assertValidPositiveAmount(spec.limit, `${where}.limit`);
      }
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;
    default:
      // Exhaustiveness guard — a new spec kind must be handled here and in
      // toStellarOperation.
      throw new ValidationError(`Unknown operation spec at ${where}.`, {
        code: 'INVALID_OPERATION_TYPE',
        details: { index },
      });
  }
}

/** Convert a validated {@link OperationSpec} into a stellar-base operation. */
function toStellarOperation(spec: OperationSpec, index: number): xdr.Operation {
  switch (spec.type) {
    case 'payment': {
      const asset = parseAsset(spec.asset);
      return Operation.payment({
        destination: spec.destination.trim(),
        asset,
        amount: String(spec.amount),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });
    }
    case 'createAccount':
      return Operation.createAccount({
        destination: spec.destination.trim(),
        startingBalance: String(spec.startingBalance),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });
    case 'changeTrust': {
      // parseAsset was already validated in assertValidSpec; narrow here.
      const code = spec.asset;
      const separator = code.indexOf(':');
      const asset = new Asset(code.slice(0, separator), code.slice(separator + 1));
      return Operation.changeTrust({
        asset,
        ...(spec.limit !== undefined ? { limit: String(spec.limit) } : {}),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });
    }
    default:
      throw new ValidationError(`Unknown operation spec at operations[${index}].`, {
        code: 'INVALID_OPERATION_TYPE',
        details: { index },
      });
  }
}

/**
 * Validate an operation bundle for sequencing, count and fee constraints
 * **before** assembling the transaction.
 *
 * Checks performed:
 * 1. `operations` is a non-empty array of at most {@link MAX_OPERATIONS}
 *    specs (`EMPTY_OPERATIONS` / `TOO_MANY_OPERATIONS` otherwise);
 * 2. every spec has valid fields (`INVALID_DESTINATION`, `INVALID_AMOUNT`,
 *    `INVALID_ASSET`, `INVALID_OPERATION_SOURCE`, `INVALID_OPERATION_TYPE`);
 * 3. the total fee bid covers `count × {@link MIN_BASE_FEE_STROOPS}` stroops
 *    and does not exceed {@link MAX_TOTAL_FEE_STROOPS}
 *    (`FEE_BELOW_MINIMUM` / `FEE_BID_TOO_HIGH`).
 *
 * Memo constraints are enforced by the underlying builder (at most one memo).
 *
 * @param operations The declarative bundle to check.
 * @param fee        The intended total fee bid in stroops.
 * @throws {ValidationError} With machine-readable `code`s as listed above.
 *
 * @example
 * ```ts
 * validateOperationSequence(
 *   [
 *     { type: 'payment', destination: 'G…A', asset: 'XLM', amount: '10' },
 *     { type: 'payment', destination: 'G…B', asset: 'XLM', amount: '5' },
 *   ],
 *   300,
 * );
 * // OK — 2 operations, 300 ≥ 2 × 100 stroops.
 * ```
 */
export function validateOperationSequence(operations: OperationSpec[], fee: string | number): void {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ValidationError('A multi-operation transaction requires at least one operation.', {
      code: 'EMPTY_OPERATIONS',
      details: { field: 'operations' },
    });
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new ValidationError(
      `A transaction may contain at most ${MAX_OPERATIONS} operations (got ${operations.length}).`,
      { code: 'TOO_MANY_OPERATIONS', details: { field: 'operations', count: operations.length } },
    );
  }

  operations.forEach((spec, index) => assertValidSpec(spec, index));

  const numericFee = typeof fee === 'number' ? fee : Number(fee);
  if (!Number.isFinite(numericFee) || !Number.isInteger(numericFee) || numericFee < 0) {
    throw new ValidationError('fee must be a non-negative integer number of stroops.', {
      code: 'INVALID_FEE',
    });
  }
  const minTotal = operations.length * MIN_BASE_FEE_STROOPS;
  if (numericFee < minTotal) {
    throw new ValidationError(
      `fee ${numericFee} stroops is below the network minimum of ${minTotal} stroops ` +
        `(${operations.length} op(s) × ${MIN_BASE_FEE_STROOPS}).`,
      { code: 'FEE_BELOW_MINIMUM', details: { fee: numericFee, minTotal } },
    );
  }
  if (numericFee > MAX_TOTAL_FEE_STROOPS) {
    throw new ValidationError(
      `fee bid ${numericFee} stroops exceeds the Astroid safety ceiling of ` +
        `${MAX_TOTAL_FEE_STROOPS} stroops.`,
      { code: 'FEE_BID_TOO_HIGH', details: { fee: numericFee } },
    );
  }
}

/**
 * Build a Stellar transaction containing **multiple operations**.
 *
 * Assembles the declarative {@link OperationSpec} bundle into standard
 * stellar-base operations on a single transaction sourced from `source`,
 * validating operation sequencing, count bounds, fee limits and memo
 * requirements before anything is built. The result is unsigned — sign it
 * locally (e.g. with the wallet package's offline signer) and submit the XDR.
 *
 * @param options Build options (`source`, `networkPassphrase`, `fee`,
 *   `timeout`, memo) plus the `operations` bundle.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For a missing/invalid source account, an empty or
 *   oversized operation bundle, an invalid destination/amount/asset, a
 *   conflicting memo, or a fee outside the accepted bounds.
 *
 * @example
 * ```ts
 * // Batch two payments under one fee bid and memo:
 * const tx = buildMultiOperationTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   fee: 400,
 *   memoText: 'batch-42',
 *   operations: [
 *     { type: 'payment', destination: 'G…A', asset: 'XLM', amount: '10' },
 *     { type: 'payment', destination: 'G…B', asset: 'USDC:G…issuer', amount: '2.5' },
 *   ],
 * });
 * ```
 */
export function buildMultiOperationTransaction(
  options: MultiOperationTransactionOptions,
): Transaction {
  const { operations, ...buildOptions } = options;

  validateOperationSequence(operations, buildOptions.fee ?? '100');

  // stellar-base treats the builder fee as a per-operation base fee and
  // multiplies it by the operation count on build. `fee` in this API is the
  // TOTAL bid (already validated against the count × 100 floor and the Astroid
  // ceiling), so derive the per-operation base fee to keep the final
  // `tx.fee` equal to the caller's total bid.
  const totalBid = Number(buildOptions.fee ?? '100');
  const perOpFee = Math.max(MIN_BASE_FEE_STROOPS, Math.floor(totalBid / operations.length));

  const builder = createBuilder({ ...buildOptions, fee: perOpFee });
  operations.forEach((spec, index) => builder.addOperation(toStellarOperation(spec, index)));
  return builder.build();
}

/**
 * Build a transaction from pre-constructed `xdr.Operation`s.
 *
 * Escape hatch for operation types not covered by the declarative specs —
 * the bundle still passes through the same count and fee validation as
 * {@link buildMultiOperationTransaction}.
 *
 * Sequencing rule enforced: an **account merge must be the final operation**
 * of a transaction — it consumes the source account, so any operation after it
 * could never execute. Violations throw `INVALID_OPERATION_SEQUENCE`.
 *
 * @param options    Build options (`source`, `networkPassphrase`, `fee`, …).
 * @param operations The stellar-base operations, in execution order.
 * @returns An unsigned Stellar `Transaction`.
 * @throws {ValidationError} For invalid counts, fees, source, memo, or an
 *   account merge that is not the last operation.
 *
 * @example
 * ```ts
 * const tx = buildTransactionFromOperations(
 *   { source: account, networkPassphrase: Networks.TESTNET },
 *   [
 *     Operation.payment({ destination: 'G…', asset: Asset.native(), amount: '1' }),
 *     Operation.accountMerge({ destination: 'G…' }), // must be last
 *   ],
 * );
 * ```
 */
export function buildTransactionFromOperations(
  options: BuildTransactionOptions,
  operations: xdr.Operation[],
): Transaction {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ValidationError('A multi-operation transaction requires at least one operation.', {
      code: 'EMPTY_OPERATIONS',
      details: { field: 'operations' },
    });
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new ValidationError(
      `A transaction may contain at most ${MAX_OPERATIONS} operations (got ${operations.length}).`,
      { code: 'TOO_MANY_OPERATIONS', details: { field: 'operations', count: operations.length } },
    );
  }

  // Sequencing: an account merge must be the last operation in the bundle.
  // stellar-base operations expose their XDR type through `body().switch()`.
  const mergeIndex = operations.findIndex(
    (op) => op.body().switch() === xdr.OperationType.accountMerge(),
  );
  if (mergeIndex !== -1 && mergeIndex !== operations.length - 1) {
    throw new ValidationError('An account merge must be the final operation of a transaction.', {
      code: 'INVALID_OPERATION_SEQUENCE',
      details: { mergeIndex, operationCount: operations.length },
    });
  }

  // Mirror the total-bid semantics of {@link buildMultiOperationTransaction}:
  // derive the per-operation base fee so `tx.fee` equals the caller's bid.
  const totalBid = Number(options.fee ?? '100');
  const perOpFee = Math.max(MIN_BASE_FEE_STROOPS, Math.floor(totalBid / operations.length));

  const builder = createBuilder({ ...options, fee: perOpFee });
  for (const op of operations) builder.addOperation(op);
  return builder.build();
}
