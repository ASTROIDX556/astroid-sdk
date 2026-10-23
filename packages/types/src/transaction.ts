/**
 * `@astroid/types` — transaction submission and status contracts.
 *
 * These DTOs describe the payloads exchanged with the Astroid transaction
 * submission endpoints and the normalised view of a transaction's lifecycle.
 *
 * They are deliberately data-only: turning a failed submission into a typed
 * error class (Stellar result codes → {@link https://github.com/ASTROIDX556/astroid-sdk | SDK errors})
 * is the job of `@astroid/transaction`, which depends on this package — never
 * the other way around.
 *
 * @module
 */

import type { TransactionStatus } from './enums.js';

/**
 * The lifecycle status of a submitted transaction.
 *
 * - `PENDING` — the submission was accepted and the transaction has not
 *   reached a terminal state yet.
 * - `SUCCESS` — the transaction executed successfully.
 * - `FAILED` — the submission was rejected, or the transaction failed.
 */
export type TransactionSubmissionStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

/**
 * The Stellar result codes reported for a transaction.
 *
 * Mirrors Horizon's `result_codes` object: a transaction-level code plus the
 * per-operation codes that explain *why* the transaction failed.
 */
export interface TransactionResultCodes {
  /** Transaction-level result code, e.g. `tx_bad_seq`. */
  transaction?: string;
  /** First operation-level result code, e.g. `op_underfunded`. */
  operation?: string;
  /** All operation-level result codes, when the payload provides them. */
  operations?: string[];
}

/**
 * The structured result of submitting a signed transaction envelope.
 *
 * `successful` reports whether the submission itself was accepted; `status`
 * reports where the transaction sits in its lifecycle. The two differ for
 * API submissions, which are accepted long before the transaction is
 * executed on-chain.
 */
export interface TransactionSubmissionResult {
  /** Whether the submission was accepted without error. */
  successful: boolean;
  /** Where the transaction sits in its lifecycle. */
  status: TransactionSubmissionStatus;
  /** The Stellar transaction hash, when known. */
  hash?: string;
  /** The ledger sequence the transaction landed in, when known. */
  ledger?: number;
  /** The backend transaction record id, for API submissions. */
  transactionId?: string;
  /** The Stellar result codes, when the network reported any. */
  resultCodes?: TransactionResultCodes;
}

/**
 * The structured verification of a transaction's on-chain status.
 *
 * Produced from an Astroid transaction record, it answers the two questions
 * callers actually ask: "did it succeed?" and "is it safe to treat as
 * final?".
 */
export interface TransactionStatusVerification {
  /** The status of the transaction record the verification was derived from. */
  status: TransactionStatus;
  /** Whether the transaction succeeded on-chain. */
  successful: boolean;
  /** Whether the transaction reached a terminal state with enough confirmations. */
  final: boolean;
  /** The number of confirmations observed for the transaction. */
  confirmations: number;
  /** The number of confirmations required for the transaction to count as final. */
  requiredConfirmations: number;
  /** The Stellar transaction hash, when known. */
  hash?: string;
  /** The ledger the transaction landed in, when known. */
  ledger?: number;
}
