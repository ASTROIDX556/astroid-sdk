/**
 * Transaction submission helpers.
 *
 * These functions format a Stellar transaction envelope into the request body
 * the Astroid API expects and submit it to the backend submission endpoint via
 * the shared {@link HttpClient}. They keep the SDK thin: no business logic is
 * bundled here — the API decides policy, risk and execution.
 *
 * On top of that, this module owns the *envelope-level* concerns of getting a
 * signed transaction onto the network:
 *
 * - {@link parseTransactionEnvelope} — decode a base64 XDR envelope into the
 *   fields a caller needs (hash, source, sequence, fee, operation count) and
 *   reject malformed envelopes before they are broadcast.
 * - {@link submitTransaction} — broadcast an envelope straight to a Horizon
 *   server and parse the response into a structured result carrying the
 *   transaction hash and the ledger it landed in.
 * - {@link submitTransactionToApi} — hand an envelope to the Astroid API and
 *   parse the resulting transaction record into the same structured shape.
 *
 * Failures are never thrown: both submission helpers return a
 * {@link SubmitTransactionResult} whose `error` holds a **typed** SDK error.
 * Stellar result codes (`tx_bad_seq`, `op_underfunded`, `tx_too_late`, …) are
 * mapped onto the dedicated error classes of `@astroid/errors`
 * (`SequenceConflictError`, `InsufficientBalanceError`,
 * `TransactionExpiredError`, …) so callers can branch on `instanceof` instead
 * of parsing strings.
 *
 * @module
 */

import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import { Networks } from '@stellar/stellar-base';
import type { HttpClient } from '@astroid/core';
import { AstroidError, NetworkError, mapStellarError } from '@astroid/errors';
import type {
  Transaction as ApiTransaction,
  TransactionResultCodes,
  TransactionStatus,
  TransactionSubmissionResult,
} from '@astroid/types';
import { normalizeTransactionError } from './errors.js';

import { encodeTransaction } from './builder.js';
import { decodeTransactionXDR } from './decoder.js';

/** A transaction ready for submission: an XDR string or a built instance. */
export type TransactionSource = string | Transaction | FeeBumpTransaction;

/** The request body accepted by the Astroid transaction submission endpoint. */
export interface TransactionSubmissionBody {
  transactionXdr: string;
}

/** Network context used when validating a transaction envelope for submission. */
export interface TransactionSubmissionOptions {
  networkPassphrase?: string;
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
export function formatTransactionForSubmission(
  source: TransactionSource,
  options: TransactionSubmissionOptions = {},
): TransactionSubmissionBody {
  const transactionXdr = encodeTransaction(source);
  decodeTransactionXDR(transactionXdr, options.networkPassphrase ?? Networks.PUBLIC);
  return { transactionXdr };
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
  options: TransactionSubmissionOptions = {},
): Promise<ApiTransaction> {
  const body = formatTransactionForSubmission(source, options);
  const res = await client.post<ApiTransaction>('/transactions/submit', body);
  return res.data;
}

/* -------------------------------------------------------------------------- */
/* Envelope parsing                                                            */
/* -------------------------------------------------------------------------- */

/** The decoded fields of a signed Stellar transaction envelope. */
export interface ParsedTransactionEnvelope {
  /** The base64 XDR envelope that was parsed. */
  xdr: string;
  /**
   * The hex-encoded Stellar hash of the envelope.
   *
   * The hash is derived from the envelope's signature base, so it only matches
   * the on-chain hash when `networkPassphrase` matches the network the
   * envelope was built for.
   */
  hash: string;
  /** The source account of the transaction. */
  sourceAccount: string;
  /** The source account sequence number. */
  sequenceNumber: string;
  /** The fee bid, in stroops. */
  fee: string;
  /** The number of operations in the envelope. */
  operationCount: number;
  /** Whether the envelope is a fee-bump transaction. */
  isFeeBump: boolean;
  /** The network passphrase the envelope was decoded with. */
  networkPassphrase: string;
}

/**
 * Parse a signed transaction envelope into its structured fields.
 *
 * The envelope is decoded with `networkPassphrase` (defaulting to the public
 * network) and its hash is computed locally — no network call is made. A
 * malformed envelope raises a {@link ValidationError} from `@astroid/errors`.
 *
 * @param source The signed transaction, its base64 XDR, or a fee-bump envelope.
 * @param options The network context to decode with.
 * @returns The parsed envelope.
 * @throws {ValidationError} When the envelope cannot be decoded.
 *
 * @example
 * ```ts
 * const parsed = parseTransactionEnvelope(xdr, { networkPassphrase: Networks.TESTNET });
 * parsed.hash; // hex transaction hash
 * parsed.operationCount; // number of operations
 * ```
 */
export function parseTransactionEnvelope(
  source: TransactionSource,
  options: TransactionSubmissionOptions = {},
): ParsedTransactionEnvelope {
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;
  const xdr = encodeTransaction(source);
  const decoded = decodeTransactionXDR(xdr, networkPassphrase);
  return {
    xdr,
    hash: decoded.hash ?? '',
    sourceAccount: decoded.sourceAccount,
    sequenceNumber: decoded.sequenceNumber,
    fee: decoded.fee,
    operationCount: decoded.operations.length,
    isFeeBump: decoded.isFeeBump === true,
    networkPassphrase,
  };
}

/* -------------------------------------------------------------------------- */
/* Structured submission                                                        */
/* -------------------------------------------------------------------------- */

/** Options for {@link submitTransaction} and {@link submitTransactionToApi}. */
export interface SubmitTransactionOptions {
  /**
   * The network passphrase the envelope was built for. Defaults to the public
   * network (`Networks.PUBLIC`).
   */
  networkPassphrase?: string;
  /**
   * The Horizon base URL to broadcast to. Defaults to `https://horizon.stellar.org`.
   * Ignored by {@link submitTransactionToApi}, which talks to the Astroid API.
   */
  horizonUrl?: string;
  /** The `fetch` implementation to use. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** The request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
}

/**
 * The structured result of a transaction submission.
 *
 * `successful` reports whether the submission was accepted; `status` reports
 * where the transaction sits in its lifecycle. `error` holds the typed SDK
 * error for a failed submission — a Stellar result code mapped onto
 * `InsufficientBalanceError`, `SequenceConflictError`,
 * `TransactionExpiredError`, and friends.
 */
export interface SubmitTransactionResult extends TransactionSubmissionResult {
  /** The typed error explaining a failed submission. */
  error?: AstroidError;
}

/** The default Horizon server used when no `horizonUrl` is supplied. */
const DEFAULT_HORIZON_URL = 'https://horizon.stellar.org';

/** The default submission timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Broadcast a signed transaction envelope to a Stellar Horizon server.
 *
 * The envelope is parsed locally first (so a malformed envelope never reaches
 * the network) and then POSTed to Horizon's `/transactions` endpoint. The
 * response is parsed into a {@link SubmitTransactionResult} carrying the
 * transaction hash and the ledger sequence the transaction landed in.
 *
 * Failures never throw. A rejected transaction yields
 * `successful: false` with a typed `error`:
 *
 * - `op_underfunded` / `op_low_reserve` → `InsufficientBalanceError`
 * - `tx_bad_seq` → `SequenceConflictError`
 * - `tx_too_late` / `tx_timebounds_not_met` → `TransactionExpiredError`
 * - `tx_bad_auth` / `op_bad_auth` → `StellarAuthError`
 * - anything else with a result code → `StellarNetworkError`
 *
 * @param source The signed transaction, its base64 XDR, or a fee-bump envelope.
 * @param options Horizon URL, network passphrase, fetch and timeout.
 * @returns The structured submission result.
 *
 * @example
 * ```ts
 * const result = await submitTransaction(signedXdr, {
 *   horizonUrl: 'https://horizon-testnet.stellar.org',
 *   networkPassphrase: Networks.TESTNET,
 * });
 * if (result.successful) {
 *   console.log(result.hash, result.ledger);
 * } else if (result.error instanceof InsufficientBalanceError) {
 *   // top the account up and retry
 * }
 * ```
 */
export async function submitTransaction(
  source: TransactionSource,
  options: SubmitTransactionOptions = {},
): Promise<SubmitTransactionResult> {
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;
  const horizonUrl = (options.horizonUrl ?? DEFAULT_HORIZON_URL).replace(/\/+$/, '');
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let envelope: ParsedTransactionEnvelope;
  try {
    envelope = parseTransactionEnvelope(source, { networkPassphrase });
  } catch (error) {
    return {
      successful: false,
      status: 'FAILED',
      error: toEnvelopeError(error),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: envelope.xdr }).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    return {
      successful: false,
      status: 'FAILED',
      hash: envelope.hash,
      error: new NetworkError('Failed to reach the Stellar network.', {
        code: 'NETWORK_ERROR',
        cause: error,
      }),
    };
  } finally {
    clearTimeout(timer);
  }

  const body = await readJsonBody(response);
  const resultCodes = readResultCodes(body);
  const hash = readString(body, 'hash');
  const ledger = readNumber(body, 'ledger');

  if (!response.ok) {
    return {
      successful: false,
      status: 'FAILED',
      ...(hash !== undefined ? { hash } : {}),
      ...(ledger !== undefined ? { ledger } : {}),
      ...(resultCodes !== undefined ? { resultCodes } : {}),
      error: mapSubmissionError(body, {
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? undefined,
      }),
    };
  }

  const transactionCode = resultCodes?.transaction;
  if (transactionCode !== undefined && transactionCode !== 'tx_success') {
    return {
      successful: false,
      status: 'FAILED',
      ...(hash !== undefined ? { hash } : {}),
      ...(ledger !== undefined ? { ledger } : {}),
      resultCodes,
      error: mapSubmissionError(body, { status: response.status }),
    };
  }

  return {
    successful: true,
    status: 'SUCCESS',
    hash: hash ?? envelope.hash,
    ...(ledger !== undefined ? { ledger } : {}),
    ...(resultCodes !== undefined ? { resultCodes } : {}),
  };
}

/**
 * Submit a signed transaction envelope to the Astroid API and parse the
 * resulting transaction record into a {@link SubmitTransactionResult}.
 *
 * Where {@link submitTransaction} talks to Horizon directly, this helper hands
 * the envelope to the backend — which applies the organization's policies,
 * risk checks and approval flows — and reports what the backend decided. The
 * transaction hash is taken from the record when the backend knows it, and
 * from the locally parsed envelope otherwise.
 *
 * Failures never throw: a rejected submission yields `successful: false` with
 * a typed `error`. When the backend forwards Stellar result codes, they are
 * mapped onto the dedicated `@astroid/errors` classes.
 *
 * @param client The shared {@link HttpClient} (use `astroid.http`).
 * @param source The signed transaction, its base64 XDR, or a fee-bump envelope.
 * @param options The network passphrase to parse the envelope with.
 * @returns The structured submission result.
 *
 * @example
 * ```ts
 * const result = await submitTransactionToApi(astroid.http, signedXdr);
 * if (result.successful) {
 *   console.log(result.transactionId, result.status); // 'tx_123', 'PENDING'
 * }
 * ```
 */
export async function submitTransactionToApi(
  client: HttpClient,
  source: TransactionSource,
  options: TransactionSubmissionOptions = {},
): Promise<SubmitTransactionResult> {
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;

  let envelope: ParsedTransactionEnvelope;
  try {
    envelope = parseTransactionEnvelope(source, { networkPassphrase });
  } catch (error) {
    return {
      successful: false,
      status: 'FAILED',
      error: toEnvelopeError(error),
    };
  }

  let record: ApiTransaction | undefined;
  try {
    const res = await client.post<ApiTransaction>('/transactions/submit', {
      transactionXdr: envelope.xdr,
    });
    record = res.data;
  } catch (error) {
    return {
      successful: false,
      status: 'FAILED',
      hash: envelope.hash,
      error: mapApiSubmissionError(error),
    };
  }

  const ledger = readLedgerFromMetadata(record?.metadata);
  const resultCodes = readResultCodes(record?.metadata);

  return {
    successful: true,
    status: mapRecordStatus(record?.status),
    hash: record?.stellarHash ?? envelope.hash,
    ...(record?.id !== undefined ? { transactionId: record.id } : {}),
    ...(ledger !== undefined ? { ledger } : {}),
    ...(resultCodes !== undefined ? { resultCodes } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Normalise a failure that happened *before* the network was contacted.
 *
 * A malformed envelope surfaces as the original `ValidationError` so callers
 * can tell "this envelope is broken" from "the network rejected it"; anything
 * else is normalised into a `TransactionSubmissionError`.
 */
function toEnvelopeError(error: unknown): AstroidError {
  if (error instanceof AstroidError) return error;
  return normalizeTransactionError(error, 'Transaction envelope could not be parsed.', {
    isSimulation: false,
  });
}

/** Read a JSON body, tolerating an empty or malformed payload. */async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Read a string field from an unknown payload. */
function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read a finite numeric field from an unknown payload. */
function readNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * Extract Stellar result codes from the payload shapes the Astroid API and
 * Horizon produce:
 *
 * - `{ result_codes: { transaction, operations } }` — Horizon's success body
 * - `{ extras: { result_codes: { … } } }` — Horizon's error envelope
 * - `{ result_code }` / `{ stellarCode }` — normalized/flat shapes
 *
 * Nested locations (`details`, `error`, `data`) are searched too, so a result
 * code forwarded inside an API error envelope is still found.
 */
function readResultCodes(payload: unknown, depth = 0): TransactionResultCodes | undefined {
  if (depth > 3 || typeof payload !== 'object' || payload === null) return undefined;
  const obj = payload as Record<string, unknown>;

  const direct = obj.result_codes;
  if (typeof direct === 'object' && direct !== null) {
    const codes = direct as Record<string, unknown>;
    const transaction = typeof codes.transaction === 'string' ? codes.transaction : undefined;
    const operations = Array.isArray(codes.operations) ? (codes.operations as string[]) : undefined;
    const operation = operations?.[0];
    if (transaction || operation) return { transaction, operation, operations };
  }

  const flat =
    typeof obj.result_code === 'string'
      ? obj.result_code
      : typeof obj.stellarCode === 'string'
        ? obj.stellarCode
        : undefined;
  if (flat) return { transaction: flat };

  for (const key of ['extras', 'details', 'error', 'data'] as const) {
    const nested = obj[key];
    if (nested && typeof nested === 'object') {
      const codes = readResultCodes(nested, depth + 1);
      if (codes) return codes;
    }
  }

  return undefined;
}

/** Read the ledger sequence a transaction landed in from a record's metadata. */
function readLedgerFromMetadata(
  metadata: Record<string, unknown> | undefined,
): number | undefined {
  if (!metadata) return undefined;
  for (const key of ['ledger', 'ledgerSequence', 'ledger_sequence', 'stellarLedger'] as const) {
    const value = metadata[key];
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

/** Map an API transaction status onto the submission lifecycle. */
function mapRecordStatus(status: TransactionStatus | undefined): 'PENDING' | 'SUCCESS' | 'FAILED' {
  switch (status) {
    case 'COMPLETED':
    case 'CONFIRMED':
      return 'SUCCESS';
    case 'REJECTED':
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * Map a failed submission payload onto a typed SDK error.
 *
 * When the payload carries Stellar result codes they are mapped onto the
 * dedicated `@astroid/errors` classes (see {@link mapStellarError}); otherwise
 * a generic `TransactionSubmissionError` is returned.
 */
function mapSubmissionError(
  body: unknown,
  context: { status?: number; requestId?: string },
): AstroidError {
  const codes = readResultCodes(body);
  if (codes) {
    return mapStellarError(
      {
        extras: {
          result_codes: {
            transaction: codes.transaction,
            operations: codes.operations,
          },
        },
      },
      {
        ...(context.status !== undefined ? { status: context.status } : {}),
        ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
        message: readErrorMessage(body),
        details: {
          ...(codes.operation !== undefined ? { operationCode: codes.operation } : {}),
        },
      },
    );
  }

  return normalizeTransactionError(
    new Error(readErrorMessage(body) ?? 'Transaction submission failed.'),
    'Transaction submission failed.',
    { isSimulation: false },
  );
}

/**
 * Map a failed Astroid API submission onto a typed SDK error.
 *
 * The API forwards the Stellar failure that caused the rejection, so the
 * result codes are extracted from the error payload and mapped onto the
 * dedicated `@astroid/errors` classes.
 */
function mapApiSubmissionError(error: unknown): AstroidError {
  const details =
    error instanceof AstroidError && error.details ? error.details : undefined;
  const codes = readResultCodes(details) ?? readResultCodes(error);
  if (codes) {
    const status = error instanceof AstroidError ? error.status : undefined;
    const requestId = error instanceof AstroidError ? error.requestId : undefined;
    return mapStellarError(
      {
        extras: {
          result_codes: {
            transaction: codes.transaction,
            operations: codes.operations,
          },
        },
      },
      {
        ...(status !== undefined ? { status } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
        ...(error instanceof Error ? { message: error.message } : {}),
        details: {
          ...(codes.operation !== undefined ? { operationCode: codes.operation } : {}),
        },
        cause: error,
      },
    );
  }

  if (error instanceof AstroidError) return error;
  return normalizeTransactionError(error, 'Transaction submission failed.', {
    isSimulation: false,
  });
}

/** Read a human-readable message from an error payload. */
function readErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  for (const key of ['detail', 'title', 'message'] as const) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
