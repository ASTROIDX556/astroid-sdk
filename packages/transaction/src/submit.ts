/**
 * Transaction submission helpers.
 *
 * These functions format a Stellar transaction envelope into the request body
 * the Astroid API expects and submit it to the backend submission endpoint via
 * the shared {@link HttpClient}. They keep the SDK thin: no business logic is
 * bundled here — the API decides policy, risk and execution.
 *
 * @module
 */

import type { HttpClient } from '@astroid/core';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import type { Transaction as ApiTransaction } from '@astroid/types';

import { encodeTransaction } from './builder.js';

/** A transaction ready for submission: an XDR string or a built instance. */
export type TransactionSource = string | Transaction | FeeBumpTransaction;

/** The request body accepted by the Astroid transaction submission endpoint. */
export interface TransactionSubmissionBody {
  transactionXdr: string;
}

/**
 * Format a transaction for submission.
 *
 * Accepts a base64 XDR envelope string, a built `Transaction`, or a
 * `FeeBumpTransaction` and normalises it into the `{ transactionXdr }` request
 * body the Astroid API reads. Built transactions are encoded via
 * {@link encodeTransaction}; bare strings pass through unchanged.
 *
 * @param source The transaction to format.
 * @returns A submission-ready request body.
 */
export function formatTransactionForSubmission(source: TransactionSource): TransactionSubmissionBody {
  return { transactionXdr: encodeTransaction(source) };
}

/**
 * Submit a signed transaction to the Astroid backend.
 *
 * Formats the envelope with {@link formatTransactionForSubmission} and POSTs it
 * to the `/transactions/submit` endpoint through the provided client. The
 * returned {@link ApiTransaction} reflects the backend's decision: it may be
 * executed immediately or parked as a proposal awaiting approval.
 *
 * @param client The shared {@link HttpClient} (use `astroid.http`).
 * @param source The signed transaction to submit.
 * @returns The resulting Stellar transaction record.
 * @throws {AstroidError} On API rejection or transport failure (typed).
 *
 * @example
 * ```ts
 * const tx = buildPaymentTransaction({ source, networkPassphrase, ... });
 * tx.sign(keypair);
 * const record = await submitSignedTransaction(astroid.http, tx);
 * ```
 */
export async function submitSignedTransaction(
  client: HttpClient,
  source: TransactionSource,
): Promise<ApiTransaction> {
  const body = formatTransactionForSubmission(source);
  const res = await client.post<ApiTransaction>('/transactions/submit', body);
  return res.data;
}