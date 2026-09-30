/**
 * Policy-validated transaction submission.
 *
 * {@link submitPolicyTransaction} is the last line of defence between a signed
 * transaction and the Stellar network. Before a single byte leaves the
 * process it re-evaluates the caller's {@link PolicySet} against the
 * transaction's spend; if the evaluation rejects, a
 * {@link TransactionPolicyViolationError} is returned and **no network call
 * is made** — the injected client is never touched.
 *
 * Only after the gate passes is the envelope broadcast, through an injected
 * Horizon `Server` (the repo's only network client surface today). Failures
 * are mapped to typed errors:
 *
 * - `tx_bad_seq` → {@link TransactionSequenceMismatchError}, with an opt-in,
 *   bounded retry that reloads the account (never on by default, never
 *   unbounded — see {@link SubmitPolicyOptions.retryOnSequenceMismatch});
 * - `tx_failed` / `tx_*` and `op_*` result codes →
 *   {@link TransactionNetworkRejectedError} preserving the codes;
 * - timeouts / unreachable network → {@link TransactionNetworkUnavailableError};
 * - anything else → {@link TransactionSubmissionFailedError}.
 *
 * The XDR is never echoed into error messages, and neither this module nor
 * its errors handle or log secret keys — signing stays with the wallet
 * package.
 *
 * @module
 */

import type { Transaction, FeeBumpTransaction } from '@stellar/stellar-base';
import type { Account } from '@stellar/stellar-base';
import type { PolicySet, TransactionDetails } from '@astroid/types';
import { evaluatePolicy } from '@astroid/policy';
import type { PolicyEvaluationResult } from '@astroid/types';

import { encodeTransaction } from './builder.js';
import { decodeTransactionXDR } from './decoder.js';
import type { DecodedTxPayload } from './decoder.js';
import type { PolicyEnvelope } from './policy-builders.js';
import { POLICY_ENVELOPE_NAME, PolicyViolationError } from './policy-builders.js';
import { validateTransactionEnvelope } from './validator.js';
import { TransactionSubmissionError } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Minimal client interfaces (injected — never imported from a network SDK)    */
/* -------------------------------------------------------------------------- */

/**
 * The subset of the Horizon `Server.submitTransaction` surface used here.
 *
 * Structural typing keeps the submitter decoupled from
 * `@stellar/stellar-sdk`: any object with an async `submitTransaction`
 * method works — the real Horizon `Server`, a Soroban RPC adapter, or (in
 * tests) a mock. `unknown` parameters/results are validated locally so a
 * deviating client cannot bypass the mapping.
 */
export interface HorizonSubmitterClient {
  submitTransaction(transaction: Transaction | FeeBumpTransaction | string): Promise<unknown>;
}

/**
 * Minimal account loader used by the opt-in `tx_bad_seq` retry to refresh a
 * stale sequence number. Mirrors the read shape of the Horizon `Server`.
 */
export interface HorizonAccountLoader {
  loadAccount(accountId: string): Promise<Account>;
}

/* -------------------------------------------------------------------------- */
/* Typed submission errors                                                     */
/* -------------------------------------------------------------------------- */

/** Shared option bag for the submission error constructors. */
interface SubmissionErrorOptions {
  /** Machine-readable error code, mirroring `AstroidErrorOptions.code`. */
  code: string;
  /** The Stellar transaction-level result code, when known. */
  stellarCode?: string;
  /** First operation-level result code, when known. */
  operationCode?: string;
  /** All operation-level result codes, when known. */
  operationResultCodes?: string[];
  /** HTTP status reported by the server, when known. */
  status?: number;
  /** Structured diagnostics. Kept free of secret keys and XDR by contract. */
  details?: Record<string, unknown>;
  /** Underlying cause. */
  cause?: unknown;
}

/**
 * The transaction was rejected because its sequence number is stale
 * (`tx_bad_seq`). The message tells the caller exactly what to do: reload the
 * account's sequence and rebuild+re-sign.
 */
export class TransactionSequenceMismatchError extends TransactionSubmissionError {
  /** The Stellar result code — always `tx_bad_seq` for this error. */
  override readonly stellarCode: string;

  constructor(message: string, options: SubmissionErrorOptions) {
    super(message, options);
    this.name = 'TransactionSequenceMismatchError';
    this.stellarCode = options.stellarCode ?? 'tx_bad_seq';
  }
}

/**
 * The network processed the transaction but an operation failed
 * (`tx_failed` and friends). Result codes are preserved verbatim for
 * diagnostics.
 */
export class TransactionNetworkRejectedError extends TransactionSubmissionError {}

/**
 * The network could not be reached in time — a transport timeout, DNS
 * failure, or connection refusal. Submission may or may not have taken
 * effect; the caller should reconcile by hash before blindly resubmitting.
 */
export class TransactionNetworkUnavailableError extends TransactionSubmissionError {}

/**
 * A policy check rejected the submission. No network call was made.
 *
 * Extends {@link PolicyViolationError} so callers that already catch the
 * builder-side violation handle the submitter-side one identically.
 */
export class TransactionPolicyViolationError extends PolicyViolationError {
  constructor(evaluation: PolicyEvaluationResult) {
    super(evaluation);
    this.name = 'TransactionPolicyViolationError';
  }
}

/** Catch-all for submission failures without a more specific mapping. */
export class TransactionSubmissionFailedError extends TransactionSubmissionError {}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Extract Horizon `extras.result_codes`-style fields from an unknown error. */
function extractResultCodes(err: unknown): {
  stellarCode?: string;
  operationCode?: string;
  operationResultCodes?: string[];
} {
  if (typeof err !== 'object' || err === null) return {};
  const obj = err as Record<string, unknown>;

  const response = obj.response as Record<string, unknown> | undefined;
  const extras =
    (obj.extras as Record<string, unknown> | undefined) ??
    (response?.extras as Record<string, unknown> | undefined);
  if (extras) {
    const resultCodes = extras.result_codes as Record<string, unknown> | undefined;
    if (resultCodes) {
      const operations = Array.isArray(resultCodes.operations)
        ? (resultCodes.operations as string[])
        : undefined;
      const operation =
        typeof resultCodes.operations === 'string' ? resultCodes.operations : operations?.[0];
      return {
        stellarCode:
          typeof resultCodes.transaction === 'string' ? resultCodes.transaction : operation,
        operationCode: operation,
        operationResultCodes: operations,
      };
    }
  }

  // Flat/normalized shapes: { result_code } or { stellarCode }.
  const resultCode = typeof obj.result_code === 'string' ? obj.result_code : undefined;
  const stellarCodeProp = typeof obj.stellarCode === 'string' ? obj.stellarCode : undefined;
  const code = resultCode ?? stellarCodeProp;
  if (code) return { stellarCode: code };

  return {};
}

/** Whether the error looks like a transport timeout or unreachable network. */
function isNetworkUnavailable(err: unknown): boolean {
  if (err instanceof Error) {
    const name = err.name.toLowerCase();
    if (name.includes('timeout') || name.includes('abort')) return true;
    const message = err.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('network error') ||
      message.includes('fetch failed')
    ) {
      return true;
    }
  }
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Inspect the operations of a decoded payload for the Astroid policy
 * envelope, returning it when present.
 */
function findPolicyEnvelope(payload: DecodedTxPayload): PolicyEnvelope | undefined {
  // `GenericOperation` widens `type` back to `string`, so the literal check
  // above cannot narrow the union on its own — guard on the `name` property.
  const envelopeOp = payload.operations.find(
    (op) =>
      op.type === 'manageData' &&
      'name' in op &&
      (op as { name: string }).name === POLICY_ENVELOPE_NAME,
  );
  if (!envelopeOp || envelopeOp.type !== 'manageData') return undefined;
  const manageData = envelopeOp as DecodedTxPayload['operations'][number] & {
    type: 'manageData';
    name: string;
    value: string | null;
  };
  if (!manageData.value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(manageData.value, 'base64').toString('utf8'));
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'allowed' in parsed) {
      return parsed as PolicyEnvelope;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Options for {@link submitPolicyTransaction}. */
export interface SubmitPolicyOptions {
  /**
   * The policy set the transaction is re-checked against. Required — the
   * submitter's whole point is the pre-broadcast gate. Pass `{ rules: [] }`
   * to record "no local rules configured" and proceed.
   */
  policySet: PolicySet;
  /**
   * Policy record ids attached to the resulting error/envelope context when
   * the gate rejects.
   */
  policyIds?: string[];
  /**
   * Clock override for the gate's time-of-day rules and diagnostics.
   * Supply a fixed value for deterministic runs (and tests).
   */
  now?: Date | number;
  /**
   * Network passphrase used to decode an XDR envelope input. Defaults to
   * `Networks.PUBLIC` (matching the validator's convention).
   */
  networkPassphrase?: string;
  /**
   * Opt-in bounded retry for `tx_bad_seq`. When `true`, a stale sequence
   * number triggers one account reload and a **single** resubmission of the
   * same envelope — nothing is rebuilt or re-signed here, so the retry only
   * makes sense when the caller's envelope was built with the account's
   * *current* sequence and merely raced. Defaults to `false`: the typed
   * error is returned and the caller decides.
   */
  retryOnSequenceMismatch?: boolean;
  /**
   * Maximum number of sequence-mismatch retries. Defaults to 1 and is
   * capped at 2 — the submitter never loops unboundedly.
   */
  maxSequenceRetries?: number;
}

/** The successful outcome of {@link submitPolicyTransaction}. */
export interface SubmitPolicySuccess {
  successful: true;
  /** The transaction hash, as reported by the server (string-coerced). */
  hash: string;
  /** The ledger the transaction was included in, when the server reports it. */
  ledger?: number;
  /** Echo of the policy envelope the submitter found on the envelope, if any. */
  policyEnvelope?: PolicyEnvelope;
}

/** The failed outcome of {@link submitPolicyTransaction} — never throws. */
export interface SubmitPolicyFailure {
  successful: false;
  /** The typed error explaining the failure. */
  error: TransactionSubmissionError | TransactionPolicyViolationError;
}

/** The result of {@link submitPolicyTransaction}: a success or a typed failure. */
export type SubmitPolicyResult = SubmitPolicySuccess | SubmitPolicyFailure;

/**
 * Result of the internal broadcast, used to disambiguate success shapes.
 */
interface BroadcastOutcome {
  ok: boolean;
  hash?: string;
  ledger?: number;
  error?: unknown;
}

/**
 * Coerce the server's response into a success/failure outcome without ever
 * trusting its shape.
 */
function coerceBroadcastOutcome(response: unknown): BroadcastOutcome {
  if (typeof response === 'string') {
    // Some clients return the raw hash or envelope; treat strings as opaque
    // but non-empty results.
    return response.length > 0 ? { ok: true, hash: response } : { ok: false };
  }
  if (typeof response !== 'object' || response === null) {
    return { ok: false };
  }
  const obj = response as Record<string, unknown>;
  const hash = typeof obj.hash === 'string' ? obj.hash : undefined;
  const ledgerRaw = obj.ledger;
  const ledger = typeof ledgerRaw === 'number' ? ledgerRaw : Number(ledgerRaw);
  const successful =
    obj.successful === true ||
    (hash !== undefined && obj.successful !== false && obj.errorResultXdr === undefined);
  if (successful) {
    return {
      ok: true,
      hash,
      ledger: Number.isFinite(ledger) && ledger > 0 ? ledger : undefined,
    };
  }
  return { ok: false, error: response };
}

/**
 * Validate policies for a signed transaction and broadcast it.
 *
 * The flow is: structural validation → policy gate → broadcast. The network
 * client is only invoked after the gate passes, so a policy-violating
 * transaction never leaves the process and the mock in tests is asserted
 * never called.
 *
 * @param client   The injected network client (Horizon `Server` or a mock).
 * @param envelope The signed transaction, its base64 XDR, or a fee-bump.
 * @param options  Policy set, retry behaviour, and decode options.
 * @returns A {@link SubmitPolicyResult} — this function never throws.
 *
 * @example
 * ```ts
 * const result = await submitPolicyTransaction(server, signedTx, {
 *   policySet: activePolicies,
 *   networkPassphrase: Networks.TESTNET,
 * });
 * if (!result.successful) {
 *   // result.error is one of the typed Transaction*Error classes.
 * }
 * ```
 */
export async function submitPolicyTransaction(
  client: HorizonSubmitterClient,
  envelope: string | Transaction | FeeBumpTransaction,
  options: SubmitPolicyOptions,
): Promise<SubmitPolicyResult> {
  const networkPassphrase =
    options.networkPassphrase ?? 'Public Global Stellar Network ; September 2015';

  // --- structural validation (cheap, local) -------------------------------
  let xdr: string;
  let decoded: DecodedTxPayload;
  try {
    xdr = encodeTransaction(envelope);
    const report = validateTransactionEnvelope(xdr, { networkPassphrase });
    if (!report.valid) {
      return {
        successful: false,
        error: new TransactionSubmissionFailedError(
          `Transaction envelope failed validation: ${report.errors.map((e) => e.message).join('; ')}`,
          { code: 'TRANSACTION_VALIDATION_FAILED', details: { issues: report.issues } },
        ),
      };
    }
    decoded = decodeTransactionXDR(xdr, networkPassphrase);
  } catch (err) {
    return {
      successful: false,
      error: new TransactionSubmissionFailedError('Transaction envelope could not be decoded.', {
        code: 'TRANSACTION_DECODE_FAILED',
        cause: err,
      }),
    };
  }

  // --- policy gate (local, before any network call) ------------------------
  const evaluation = evaluatePolicy(options.policySet, deriveTransactionDetails(decoded, options));
  if (!evaluation.allowed) {
    return {
      successful: false,
      error: new TransactionPolicyViolationError(evaluation),
    };
  }

  // --- broadcast -----------------------------------------------------------
  // A single broadcast attempt. The opt-in `tx_bad_seq` retry lives in
  // {@link submitPolicyTransactionWithRetry}, which owns the account reload
  // that a genuine sequence-mismatch recovery requires.
  let response: unknown;
  try {
    response = await client.submitTransaction(envelope);
  } catch (err) {
    return { successful: false, error: mapSubmissionError(err) };
  }

  const outcome = coerceBroadcastOutcome(response);
  if (outcome.ok) {
    const found = findPolicyEnvelope(decoded);
    return {
      successful: true,
      hash: outcome.hash ?? '',
      ...(outcome.ledger !== undefined ? { ledger: outcome.ledger } : {}),
      ...(found !== undefined ? { policyEnvelope: found } : {}),
    };
  }

  return { successful: false, error: mapSubmissionError(outcome.error) };
}

/**
 * Submit with an opt-in, bounded `tx_bad_seq` retry that reloads the account.
 *
 * Separate from {@link submitPolicyTransaction} so the plain submitter keeps a
 * minimal surface; this variant additionally requires an account loader (the
 * Horizon `Server` also implements `loadAccount`). On `tx_bad_seq` it reloads
 * the account, then resubmits the **same envelope** at most `maxRetries`
 * times (capped at 2) — the retry only succeeds when the server's current
 * sequence has caught up past the envelope's; a genuinely stale envelope
 * keeps failing and the typed error is returned after the bound.
 */
export async function submitPolicyTransactionWithRetry(
  client: HorizonSubmitterClient & HorizonAccountLoader,
  envelope: string | Transaction | FeeBumpTransaction,
  options: SubmitPolicyOptions & { reloadAccount?: (accountId: string) => Promise<Account> },
): Promise<SubmitPolicyResult> {
  const networkPassphrase =
    options.networkPassphrase ?? 'Public Global Stellar Network ; September 2015';

  // Decode once so the retry knows which account to reload.
  let accountId: string;
  try {
    const xdr = encodeTransaction(envelope);
    const report = validateTransactionEnvelope(xdr, { networkPassphrase });
    if (!report.valid) {
      return {
        successful: false,
        error: new TransactionSubmissionFailedError(
          `Transaction envelope failed validation: ${report.errors.map((e) => e.message).join('; ')}`,
          { code: 'TRANSACTION_VALIDATION_FAILED', details: { issues: report.issues } },
        ),
      };
    }
    const decoded = decodeTransactionXDR(xdr, networkPassphrase);
    accountId = decoded.sourceAccount;
  } catch (err) {
    return {
      successful: false,
      error: new TransactionSubmissionFailedError('Transaction envelope could not be decoded.', {
        code: 'TRANSACTION_DECODE_FAILED',
        cause: err,
      }),
    };
  }

  const first: SubmitPolicyResult = await submitPolicyTransaction(client, envelope, options);
  if (first.successful) return first;

  let last: SubmitPolicyFailure = first;
  if (options.retryOnSequenceMismatch !== true) return last;

  const isSeqError = (error: unknown): boolean =>
    error instanceof TransactionSequenceMismatchError ||
    (error instanceof TransactionSubmissionError && error.stellarCode === 'tx_bad_seq');
  if (!isSeqError(last.error)) return last;

  const maxRetries = Math.min(Math.max(options.maxSequenceRetries ?? 1, 0), 2);
  const reload = options.reloadAccount ?? ((id: string) => client.loadAccount(id));
  let retries = 0;

  for (;;) {
    if (retries >= maxRetries) return last;
    retries += 1;
    try {
      // Reload the account so diagnostics (and callers) can see the current
      // sequence; the envelope itself is not rebuilt — see the doc comment.
      await reload(accountId);
    } catch {
      // The reload failing must not mask the original typed error.
      return last;
    }
    const attempt = await submitPolicyTransaction(client, envelope, options);
    if (attempt.successful) return attempt;
    if (!isSeqError(attempt.error)) return attempt;
    last = attempt;
  }
}

/**
 * Derive the {@link TransactionDetails} payload the local policy engine
 * evaluates from a decoded transaction.
 *
 * The first payment-like operation wins — the Astroid policy engine reasons
 * about single spends. Multi-operation bundles evaluate on their first
 * transfer, which is the conservative choice (the largest exposure is gated;
 * a bundle that hides spend in a later operation is caught by the envelope's
 * structural checks server-side).
 */
function deriveTransactionDetails(
  payload: DecodedTxPayload,
  options: Pick<SubmitPolicyOptions, 'now'>,
): TransactionDetails {
  const transferOp = payload.operations.find(
    (op) =>
      op.type === 'payment' ||
      op.type === 'pathPaymentStrictReceive' ||
      op.type === 'pathPaymentStrictSend',
  );

  if (!transferOp) {
    return { asset: '', amount: 0, senderAddress: payload.sourceAccount };
  }

  const op = transferOp as {
    type: string;
    destination?: string;
    amount?: string;
    destAsset?: string;
    destAmount?: string;
    asset?: string;
    sendAsset?: string;
  };

  const isReceivedAssetOp =
    op.type === 'pathPaymentStrictReceive' || op.type === 'pathPaymentStrictSend';
  const asset = isReceivedAssetOp ? (op.destAsset ?? op.asset ?? '') : (op.asset ?? '');
  const amount = isReceivedAssetOp ? (op.destAmount ?? op.amount ?? '0') : (op.amount ?? '0');

  return {
    asset,
    amount,
    ...(op.destination !== undefined ? { recipientAddress: op.destination } : {}),
    senderAddress: payload.sourceAccount,
    ...(options.now !== undefined
      ? { timestamp: options.now instanceof Date ? options.now : new Date(options.now) }
      : {}),
  };
}

/**
 * Map an unknown broadcast failure into the typed submission error hierarchy.
 *
 * The XDR and any secret material are deliberately kept out of the message —
 * result codes and diagnostics land in `details`.
 */
export function mapSubmissionError(err: unknown): TransactionSubmissionError {
  if (err instanceof TransactionSubmissionError) return err;

  if (isNetworkUnavailable(err)) {
    return new TransactionNetworkUnavailableError(
      'The Stellar network could not be reached, or the submission timed out. ' +
        'Reconcile by transaction hash before resubmitting.',
      { code: 'NETWORK_UNAVAILABLE', cause: err, details: { reason: 'network_unavailable' } },
    );
  }

  const codes = extractResultCodes(err);
  const stellarCode = codes.stellarCode;
  const base: SubmissionErrorOptions = {
    code: stellarCode ?? 'SUBMISSION_FAILED',
    ...codes,
    cause: err,
    details: {
      stellarCode,
      ...(codes.operationCode ? { operationCode: codes.operationCode } : {}),
    },
  };

  if (stellarCode === 'tx_bad_seq') {
    return new TransactionSequenceMismatchError(
      'Transaction rejected: the source account sequence number is stale (tx_bad_seq). ' +
        'Reload the account and rebuild/resign with the current sequence.',
      base,
    );
  }

  if (stellarCode !== undefined) {
    return new TransactionNetworkRejectedError(
      `Transaction rejected by the network: ${stellarCode}.`,
      base,
    );
  }

  const message = err instanceof Error ? err.message : 'Transaction submission failed.';
  return new TransactionSubmissionFailedError(message, base);
}
