/**
 * `@astroid/transaction` — transaction status verification helpers.
 *
 * Agents need to answer two questions about a transaction they submitted:
 * *did it succeed?* and *is it safe to treat as final?* — and they need to
 * answer them without re-implementing the lifecycle rules in every caller.
 *
 * This module owns those rules:
 *
 * - {@link isFinalTransactionStatus} / {@link isSuccessfulTransactionStatus} —
 *   the lifecycle predicates.
 * - {@link checkTransactionStatus} — turns an Astroid transaction record into
 *   a {@link TransactionStatusVerification}.
 * - {@link verifyTransactionStatus} — fetches the record and verifies it.
 *
 * @module
 */

import type { HttpClient } from '@astroid/core';
import type { Transaction, TransactionStatus, TransactionStatusVerification } from '@astroid/types';

/**
 * Statuses that will never change again: the transaction either completed or
 * was definitively rejected.
 */
const FINAL_STATUSES: readonly TransactionStatus[] = [
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
];

/**
 * Statuses that mean the transaction succeeded on-chain. `CONFIRMED` counts:
 * the transaction is in a ledger and executed, it is simply not final yet.
 */
const SUCCESSFUL_STATUSES: readonly TransactionStatus[] = ['COMPLETED', 'CONFIRMED'];

/** Options for the status verification helpers. */
export interface TransactionStatusOptions {
  /**
   * The number of confirmations a transaction needs before it counts as final.
   * Defaults to `1`.
   */
  requiredConfirmations?: number;
}

/**
 * Whether a transaction status is terminal — the transaction will not change
 * state again.
 *
 * @param status The transaction status.
 * @returns `true` for `COMPLETED`, `REJECTED`, `EXPIRED`, `CANCELLED` and
 *   `FAILED`.
 *
 * @example
 * ```ts
 * isFinalTransactionStatus('COMPLETED'); // true
 * isFinalTransactionStatus('SUBMITTED');  // false
 * ```
 */
export function isFinalTransactionStatus(status: TransactionStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/**
 * Whether a transaction status means the transaction succeeded on-chain.
 *
 * @param status The transaction status.
 * @returns `true` for `COMPLETED` and `CONFIRMED`.
 */
export function isSuccessfulTransactionStatus(status: TransactionStatus): boolean {
  return SUCCESSFUL_STATUSES.includes(status);
}

/**
 * Verify the status of an Astroid transaction record.
 *
 * A transaction is *final* when its status is terminal **and** it reached the
 * required number of confirmations — a `COMPLETED` transaction that is still
 * waiting for confirmations is successful but not yet final.
 *
 * @param record The transaction record returned by the Astroid API.
 * @param options The confirmations required for finality.
 * @returns The structured verification.
 *
 * @example
 * ```ts
 * const record = await astroid.transactions.get('tx_123');
 * const verification = checkTransactionStatus(record, { requiredConfirmations: 2 });
 * if (verification.final) console.log('safe to settle');
 * ```
 */
export function checkTransactionStatus(
  record: Transaction,
  options: TransactionStatusOptions = {},
): TransactionStatusVerification {
  const requiredConfirmations = Math.max(options.requiredConfirmations ?? 1, 0);
  const confirmations = Number.isFinite(record.confirmationCount) ? record.confirmationCount : 0;
  const ledger = readLedger(record.metadata);

  const verification: TransactionStatusVerification = {
    status: record.status,
    successful: isSuccessfulTransactionStatus(record.status),
    final: isFinalTransactionStatus(record.status) && confirmations >= requiredConfirmations,
    confirmations,
    requiredConfirmations,
  };

  if (record.stellarHash) verification.hash = record.stellarHash;
  if (ledger !== undefined) verification.ledger = ledger;

  return verification;
}

/**
 * Fetch a transaction record and verify its status.
 *
 * @param client The shared {@link HttpClient} (use `astroid.http`).
 * @param transactionId The transaction record id.
 * @param options The confirmations required for finality.
 * @returns The structured verification.
 * @throws {AstroidError} When the transaction cannot be fetched.
 */
export async function verifyTransactionStatus(
  client: HttpClient,
  transactionId: string,
  options: TransactionStatusOptions = {},
): Promise<TransactionStatusVerification> {
  const res = await client.get<Transaction>(
    `/transactions/${encodeURIComponent(transactionId)}`,
  );
  return checkTransactionStatus(res.data, options);
}

/** Read the ledger sequence a transaction landed in from the record metadata. */
function readLedger(metadata: Record<string, unknown> | undefined): number | undefined {
  if (!metadata) return undefined;
  for (const key of ['ledger', 'ledgerSequence', 'ledger_sequence', 'stellarLedger'] as const) {
    const value = metadata[key];
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}
