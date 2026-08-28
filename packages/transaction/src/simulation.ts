/**
 * Transaction fee simulation helper.
 *
 * Estimates the fee required to submit a Stellar transaction based on its
 * declared fee and an optional congestion buffer — without touching the
 * network. Agents use this to dry-run transaction costs before submission.
 *
 * Parsing failures never crash the caller: they are returned inside a
 * structured `error` container on the result.
 *
 * @module
 */

import { TransactionBuilder, Networks } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Options for {@link simulateTransactionFee}. */
export interface TransactionFeeSimulationOptions {
  /**
   * Network passphrase used to parse XDR input. Defaults to the Public
   * network passphrase.
   */
  networkPassphrase?: string;
  /**
   * Extra percentage added to the base fee as a congestion buffer.
   * Defaults to 15 (i.e. a 1.15 multiplier).
   */
  feeBufferPercentage?: number;
}

/** A structured, machine-readable simulation error (never thrown). */
export interface TransactionSimulationError {
  /** Stable error code, e.g. `'INVALID_XDR'`. */
  code: string;
  /** Human-readable description of the failure. */
  message: string;
}

/** The result of a transaction fee simulation. */
export interface TransactionFeeEstimate {
  /** The fee declared on the transaction, in stroops (1 XLM = 10,000,000). */
  baseFee: number;
  /** `baseFee` multiplied by `(1 + feeBufferPercentage / 100)`, rounded. */
  estimatedFee: number;
  /** The buffer percentage applied to produce `estimatedFee`. */
  feeBufferPercentage: number;
  /** Whether the transaction is likely to be accepted given its fee. */
  isViable: boolean;
  /** Present when the transaction could not be parsed or estimated. */
  error?: TransactionSimulationError;
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                              */
/* -------------------------------------------------------------------------- */

/** Default congestion buffer percentage. */
const DEFAULT_FEE_BUFFER_PERCENTAGE = 15;

/**
 * Estimate the submission fee for a Stellar transaction.
 *
 * Accepts either a base64-encoded transaction envelope XDR string or an
 * already-constructed `Transaction` / `FeeBumpTransaction` instance. The base
 * fee is read from the transaction itself; a buffer percentage (default 15%)
 * is applied to produce the recommended fee under congestion.
 *
 * If the input cannot be parsed, the function does **not** throw — it returns
 * a result with `isViable: false` and an `error` container describing the
 * problem.
 *
 * @param transaction Base64 XDR string or Stellar transaction instance.
 * @param options     Optional network passphrase and fee buffer percentage.
 * @returns           The fee estimate with viability flag and optional error.
 *
 * @example
 * ```ts
 * const { estimatedFee, isViable } = simulateTransactionFee(xdr, {
 *   feeBufferPercentage: 25,
 * });
 * ```
 */
export function simulateTransactionFee(
  transaction: string | Transaction | FeeBumpTransaction,
  options: TransactionFeeSimulationOptions = {},
): TransactionFeeEstimate {
  const feeBufferPercentage = options.feeBufferPercentage ?? DEFAULT_FEE_BUFFER_PERCENTAGE;
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;

  let tx: Transaction | FeeBumpTransaction;
  try {
    if (typeof transaction === 'string') {
      tx = TransactionBuilder.fromXDR(transaction, networkPassphrase);
    } else {
      tx = transaction;
    }
  } catch {
    return {
      baseFee: 0,
      estimatedFee: 0,
      feeBufferPercentage,
      isViable: false,
      error: {
        code: 'INVALID_XDR',
        message: 'Unable to parse the transaction XDR. Provide a valid base64 envelope.',
      },
    };
  }

  // The fee (in stroops) is the total fee charged for the transaction,
  // including any fee-bump surcharge. stellar-base exposes it as a string.
  const baseFee = Number(tx.fee);

  const estimatedFee = Math.round(baseFee * (1 + feeBufferPercentage / 100));

  // A transaction is viable when it declares a positive fee and the
  // buffered estimate is at least the declared fee. A zero-fee envelope is
  // never accepted by the network.
  const isViable = Number.isFinite(baseFee) && baseFee > 0 && estimatedFee >= baseFee;

  return {
    baseFee,
    estimatedFee,
    feeBufferPercentage,
    isViable,
  };
}
