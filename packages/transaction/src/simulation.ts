import { Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import type {
  TransactionFeeBumpSuggestion,
  TransactionFeeEstimate,
  TransactionResourceEstimate,
  TransactionSimulationDiagnostics,
  TransactionSimulationErrorCode,
  TransactionSimulationOptions,
  TransactionSimulationOutcome,
  TransactionSimulationRemoteResult,
  TransactionSimulationStatus,
} from '@astroid/types';

import { encodeTransaction } from './builder.js';
import type { DecodedTxPayload } from './decoder.js';
import { decodeTransactionXDR } from './decoder.js';
import { TransactionSimulationError, normalizeTransactionError } from './errors.js';
import { estimateFee } from './fee-estimation.js';
import type { TransactionValidationCode } from './validator.js';
import { validateTransactionEnvelope } from './validator.js';

export interface SimulationOptions {
  networkPassphrase?: string;
  feeBufferPercentage?: number;
}

export interface SimulationResult {
  baseFee: number;
  estimatedFee: number;
  feeBufferPercentage: number;
  isViable: boolean;
  error?: TransactionSimulationError;
}

/**
 * Simulates a Stellar transaction fee and viability from an XDR string or Transaction object.
 */
export function simulateTransactionFee(
  transactionOrXdr: string | Transaction,
  options?: SimulationOptions,
): SimulationResult {
  const networkPassphrase = options?.networkPassphrase ?? Networks.PUBLIC;
  const feeBufferPercentage = options?.feeBufferPercentage ?? 15;

  let xdrString = '';
  let tx: Transaction | FeeBumpTransaction;

  try {
    if (typeof transactionOrXdr === 'string') {
      xdrString = transactionOrXdr;
      tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    } else {
      tx = transactionOrXdr;
      xdrString = tx.toXDR();
    }

    const baseFee = Number(tx.fee);
    if (isNaN(baseFee) || baseFee <= 0) {
      const err = new TransactionSimulationError('Transaction fee must be greater than zero', {
        code: 'ZERO_OR_NEGATIVE_FEE',
        transactionXdr: xdrString,
        status: 400,
      });
      return {
        baseFee: isNaN(baseFee) ? 0 : baseFee,
        estimatedFee: 0,
        feeBufferPercentage,
        isViable: false,
        error: err,
      };
    }

    const multiplier = 1 + feeBufferPercentage / 100;
    const estimatedFee = Math.round(baseFee * multiplier);

    return {
      baseFee,
      estimatedFee,
      feeBufferPercentage,
      isViable: true,
    };
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Failed to simulate transaction XDR', {
      transactionXdr:
        xdrString || (typeof transactionOrXdr === 'string' ? transactionOrXdr : undefined),
      isSimulation: true,
    });
    return {
      baseFee: 0,
      estimatedFee: 0,
      feeBufferPercentage,
      isViable: false,
      error: normalized,
    };
  }
}

/**
 * Simulation result, enriched with the underlying error instance when the
 * transaction is not viable.
 */
export interface TransactionSimulationResult extends TransactionSimulationOutcome {
  /** Typed error behind a `viable: false` outcome. */
  error?: TransactionSimulationError;
}

/** Narrow an unknown value to a plain object, or return `undefined`. */
function isRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Parse a finite, non-negative number; anything else is treated as absent. */
function parseNonNegativeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Map a protocol validator code onto the simulation error taxonomy. */
function mapValidationCode(code: TransactionValidationCode): TransactionSimulationErrorCode {
  switch (code) {
    case 'INVALID_ENVELOPE_XDR':
    case 'INVALID_INPUT':
      return 'INVALID_ENVELOPE';
    case 'FEE_BID_TOO_HIGH':
      return 'FEE_TOO_HIGH';
    case 'FEE_BELOW_MINIMUM':
    case 'MISSING_FEE':
      return 'FEE_BELOW_MINIMUM';
    case 'NO_OPERATIONS':
      return 'NO_OPERATIONS';
    default:
      return 'VALIDATION_FAILED';
  }
}

/** Read the first positive fee from the decoded envelope / normalized view. */
function readEnvelopeFee(...candidates: Array<string | number | null | undefined>): number {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/* Remote response parsing                                                     */
/* -------------------------------------------------------------------------- */

/** The parsed, strongly typed view of a raw remote simulation payload. */
interface ParsedSimulationResponse {
  status?: TransactionSimulationStatus;
  diagnostics?: TransactionSimulationDiagnostics;
  resourceUsage?: TransactionResourceEstimate;
  feeBumpSuggestion?: TransactionFeeBumpSuggestion;
}

/**
 * Parse a raw remote simulation payload (the Astroid API's
 * `/transactions/simulate` response, which mirrors the Soroban RPC
 * `simulateTransaction` result) into the typed simulation views.
 *
 * Nothing is fabricated: a field is only present when the payload carried a
 * well-formed value. Partial or malformed resource blocks yield a partial
 * `resourceUsage` (or `undefined` when nothing usable remains) instead of
 * throwing, so the anomaly is visible in the typed result rather than crashing
 * the caller.
 */
function parseSimulationResponse(
  raw: Record<string, unknown>,
  currentFee: number,
  operationCount: number,
): ParsedSimulationResponse {
  const status = parseSimulationStatus(raw.status);
  const diagnostics = parseSimulationDiagnostics(raw);
  const resourceUsage = parseResourceEstimate(raw.resourceUsage ?? raw.resources);
  const feeBumpSuggestion = parseFeeBumpSuggestion(raw, diagnostics, currentFee, operationCount);

  const parsed: ParsedSimulationResponse = {};
  if (status !== undefined) parsed.status = status;
  if (diagnostics !== undefined) parsed.diagnostics = diagnostics;
  if (resourceUsage !== undefined) parsed.resourceUsage = resourceUsage;
  if (feeBumpSuggestion !== undefined) parsed.feeBumpSuggestion = feeBumpSuggestion;
  return parsed;
}

/** Coerce a raw status value onto the {@link TransactionSimulationStatus} union. */
function parseSimulationStatus(value: unknown): TransactionSimulationStatus | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value) {
    case 'success':
    case 'failed':
    case 'fee_bump_required':
      return value;
    default:
      return undefined;
  }
}

/** Extract structured diagnostics from a failed simulation payload. */
function parseSimulationDiagnostics(
  raw: Record<string, unknown>,
): TransactionSimulationDiagnostics | undefined {
  const container = isRecord(raw.diagnostics) ?? isRecord(raw.error) ?? raw;
  const resultCodes = isRecord(isRecord(raw.extras)?.result_codes);

  let stellarCode: string | undefined;
  let operationCode: string | undefined;
  let operationResultCodes: string[] | undefined;
  let failedOperationIndex: number | undefined;
  let detail: string | undefined;

  if (typeof container.stellarCode === 'string') stellarCode = container.stellarCode;
  else if (typeof container.transaction === 'string') stellarCode = container.transaction;

  if (typeof container.operationCode === 'string') operationCode = container.operationCode;

  if (Array.isArray(container.operationResultCodes)) {
    const codes = container.operationResultCodes.filter(
      (code): code is string => typeof code === 'string' && code.length > 0,
    );
    if (codes.length > 0) operationResultCodes = codes;
  }

  if (resultCodes) {
    if (typeof resultCodes.transaction === 'string' && stellarCode === undefined) {
      stellarCode = resultCodes.transaction;
    }
    if (Array.isArray(resultCodes.operations)) {
      const codes = resultCodes.operations.filter(
        (code): code is string => typeof code === 'string' && code.length > 0,
      );
      if (codes.length > 0) operationResultCodes = codes;
    }
  }

  if (operationResultCodes !== undefined && operationCode === undefined) {
    operationCode = operationResultCodes[0];
  }

  if (
    typeof container.failedOperationIndex === 'number' &&
    Number.isInteger(container.failedOperationIndex) &&
    container.failedOperationIndex >= 0
  ) {
    failedOperationIndex = container.failedOperationIndex;
  }
  if (typeof container.detail === 'string' && container.detail.length > 0) {
    detail = container.detail;
  }

  if (
    stellarCode === undefined &&
    operationCode === undefined &&
    operationResultCodes === undefined &&
    failedOperationIndex === undefined &&
    detail === undefined
  ) {
    return undefined;
  }

  const diagnostics: TransactionSimulationDiagnostics = {};
  if (stellarCode !== undefined) diagnostics.stellarCode = stellarCode;
  if (operationCode !== undefined) diagnostics.operationCode = operationCode;
  if (operationResultCodes !== undefined) diagnostics.operationResultCodes = operationResultCodes;
  if (failedOperationIndex !== undefined) diagnostics.failedOperationIndex = failedOperationIndex;
  if (detail !== undefined) diagnostics.detail = detail;
  return diagnostics;
}

/** Resource metrics the parser accepts, in canonical order. */
const RESOURCE_METRICS = [
  'cpuInstructions',
  'memoryBytes',
  'readBytes',
  'writeBytes',
  'readEntries',
  'writeEntries',
  'resourceFee',
  'transactionSizeBytes',
] as const satisfies ReadonlyArray<keyof TransactionResourceEstimate>;

/**
 * Parse the estimated resource-usage block, tolerating partial or malformed
 * data. Each metric is only kept when the payload carried a well-formed
 * non-negative number — missing or corrupt fields are omitted (never zero-
 * filled or invented) — and an unusable block returns `undefined`.
 */
function parseResourceEstimate(value: unknown): TransactionResourceEstimate | undefined {
  const record = isRecord(value);
  if (!record) return undefined;

  const estimate: TransactionResourceEstimate = {};
  for (const key of RESOURCE_METRICS) {
    const parsed = parseNonNegativeNumber(record[key]);
    if (parsed !== undefined) estimate[key] = parsed;
  }

  return Object.keys(estimate).length > 0 ? estimate : undefined;
}

/**
 * Detect a fee-bump-required situation and assemble the typed suggestion.
 *
 * The bump is detected from the payload's own signals — an explicit
 * `feeBump.required` flag, a `fee_bump_required` status, a
 * `tx_insufficient_fee` result code, or a reported minimum fee above the
 * envelope's current bid — and the suggested amounts are surfaced exactly as
 * the backend reported them (a missing amount is never invented).
 */
function parseFeeBumpSuggestion(
  raw: Record<string, unknown>,
  diagnostics: TransactionSimulationDiagnostics | undefined,
  currentFee: number,
  operationCount: number,
): TransactionFeeBumpSuggestion | undefined {
  const explicitBlock = isRecord(raw.feeBump);
  const explicitRequired =
    typeof explicitBlock?.required === 'boolean' ? explicitBlock.required : undefined;
  const explicit = explicitBlock
    ? {
        suggestedFee: parseNonNegativeNumber(explicitBlock.suggestedFee),
        suggestedFeeSource:
          typeof explicitBlock.suggestedFeeSource === 'string' &&
          explicitBlock.suggestedFeeSource.length > 0
            ? explicitBlock.suggestedFeeSource
            : undefined,
        reason:
          typeof explicitBlock.reason === 'string' && explicitBlock.reason.length > 0
            ? explicitBlock.reason
            : undefined,
      }
    : undefined;

  const requestedFee = parseNonNegativeNumber(
    explicit?.suggestedFee ?? raw.requiredFee ?? raw.minimumFee ?? raw.minFee,
  );

  let required: boolean | undefined = explicitRequired;
  if (required === undefined) {
    required =
      raw.status === 'fee_bump_required' || diagnostics?.stellarCode === 'tx_insufficient_fee';
  }
  // A reported minimum fee above the envelope's current bid is itself a
  // fee-bump signal even when the backend does not raise an explicit flag.
  if (!required && requestedFee !== undefined && requestedFee > currentFee) {
    required = true;
  }
  if (!required) return undefined;

  const suggestion: TransactionFeeBumpSuggestion = { required: true };
  if (requestedFee !== undefined) {
    suggestion.suggestedFee = requestedFee;
    // Derive the per-operation rate only when the operation count is known —
    // the value is a straight division, never a fabricated figure.
    if (operationCount > 0) {
      suggestion.suggestedBaseFee = Math.ceil(requestedFee / operationCount);
    }
  }
  if (explicit?.suggestedFeeSource !== undefined) {
    suggestion.suggestedFeeSource = explicit.suggestedFeeSource;
  }
  if (explicit?.reason !== undefined) suggestion.reason = explicit.reason;
  return suggestion;
}

/** Build a structured failure outcome from a typed simulation error. */
function failedSimulation(
  errorCode: TransactionSimulationErrorCode,
  error: TransactionSimulationError,
  options: {
    operationCount?: number;
    baseFee?: number;
    valid?: boolean;
    transactionXdr?: string;
    sourceAccount?: string;
  } = {},
): TransactionSimulationResult {
  const result: TransactionSimulationResult = {
    viable: false,
    valid: options.valid ?? false,
    operationCount: options.operationCount ?? 0,
    baseFee: options.baseFee ?? 0,
    estimatedFee: 0,
    errorCode,
    errorMessage: error.message,
    error,
  };
  if (options.transactionXdr !== undefined) result.transactionXdr = options.transactionXdr;
  if (options.sourceAccount !== undefined) result.sourceAccount = options.sourceAccount;
  return result;
}

/**
 * Simulate a transaction's execution outcome before it is broadcast.
 *
 * This is the high-level pre-flight helper: it decodes the envelope, validates
 * it against Astroid protocol requirements, derives the fee it should bid (with
 * an optional live Horizon sample), and — when an Astroid HTTP `client` is
 * supplied — performs a remote dry-run against the `/transactions/simulate`
 * endpoint using the Astroid API's risk and policy engine.
 *
 * The raw remote payload is parsed into the typed
 * {@link TransactionSimulationRemoteResult} view: ledger status, structured
 * failure diagnostics, estimated resource usage and a fee-bump suggestion are
 * surfaced on the result (and mirrored at the top level) instead of returning
 * the untyped API response.
 *
 * Unlike the lower-level {@link simulateTransactionFee}, this function never
 * throws: network failures, malformed envelopes and malformed remote payloads
 * are returned as a structured `viable: false` outcome so callers can branch on
 * `errorCode` instead of wrapping every call in a try/catch.
 *
 * @param transactionOrXdr A base64 XDR envelope, a built `Transaction`, or a `FeeBumpTransaction`.
 * @param options Network, fee-buffer, Horizon and remote-client options.
 * @returns A {@link TransactionSimulationResult} describing viability, fees, resource usage and any fee-bump requirement.
 *
 * @example
 * ```ts
 * const result = await simulateTransaction(unsignedTx, { client: astroid.http });
 * if (!result.viable) throw new Error(result.errorMessage);
 * if (result.feeBumpSuggestion?.required) {
 *   // Rebuild (or fee-bump) with at least result.feeBumpSuggestion.suggestedFee.
 * }
 * tx.fee = String(result.estimatedFee);
 * ```
 */
export async function simulateTransaction(
  transactionOrXdr: string | Transaction | FeeBumpTransaction,
  options: TransactionSimulationOptions = {},
): Promise<TransactionSimulationResult> {
  const networkPassphrase = options.networkPassphrase ?? Networks.PUBLIC;
  const feeBufferPercentage = options.feeBufferPercentage ?? 15;

  let xdr: string;
  try {
    xdr = encodeTransaction(transactionOrXdr);
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Invalid transaction envelope', {
      isSimulation: true,
    });
    return failedSimulation('INVALID_ENVELOPE', normalized);
  }

  let decoded: DecodedTxPayload;
  try {
    decoded = decodeTransactionXDR(xdr, networkPassphrase);
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Failed to decode transaction envelope', {
      transactionXdr: xdr,
      isSimulation: true,
    });
    return failedSimulation('INVALID_ENVELOPE', normalized, { transactionXdr: xdr });
  }

  const operationCount = decoded.operations.length;
  const report = validateTransactionEnvelope(xdr, { networkPassphrase });
  const baseFee = readEnvelopeFee(decoded.fee, report.normalized.fee);

  const blocking = report.errors[0];
  if (blocking) {
    const errorCode = mapValidationCode(blocking.code);
    const error = new TransactionSimulationError(blocking.message, {
      code: errorCode,
      status: 400,
      transactionXdr: xdr,
      details: { issues: report.issues },
    });
    return failedSimulation(errorCode, error, {
      operationCount,
      baseFee,
      valid: report.valid,
      transactionXdr: xdr,
      sourceAccount: decoded.sourceAccount,
    });
  }

  if (baseFee <= 0) {
    const error = new TransactionSimulationError('Transaction fee must be greater than zero', {
      code: 'ZERO_OR_NEGATIVE_FEE',
      status: 400,
      transactionXdr: xdr,
    });
    return failedSimulation('ZERO_OR_NEGATIVE_FEE', error, {
      operationCount,
      baseFee,
      valid: report.valid,
      transactionXdr: xdr,
      sourceAccount: decoded.sourceAccount,
    });
  }

  let feeEstimate: TransactionFeeEstimate | undefined;
  try {
    feeEstimate = await estimateFee({
      transaction: xdr,
      networkPassphrase,
      bufferPercentage: feeBufferPercentage,
      horizonUrl: options.horizonUrl,
      fetch: options.fetch,
    });
  } catch {
    feeEstimate = undefined;
  }

  const estimatedFee = feeEstimate ? Math.max(feeEstimate.recommendedFee, baseFee) : baseFee;

  let remote: TransactionSimulationRemoteResult | undefined;
  if (options.client && !options.skipRemote) {
    try {
      const response = await options.client.post<unknown>('/transactions/simulate', {
        transactionXdr: xdr,
      });
      const raw = isRecord(response.data);
      if (!raw) {
        // A non-object payload from the API is a malformed response, not a
        // viable simulation: surface it instead of crashing or fabricating.
        remote = {
          performed: true,
          success: false,
          errorCode: 'MALFORMED_RESPONSE',
          errorMessage: 'Simulation endpoint returned a non-object response body.',
          data: response.data === undefined ? undefined : { value: response.data },
        };
      } else {
        const parsed = parseSimulationResponse(raw, baseFee, operationCount);
        const reportedFee = parsed.feeBumpSuggestion?.suggestedFee;
        remote = {
          performed: true,
          success:
            parsed.status === undefined ? true : parsed.status !== 'failed',
          status: parsed.status,
          diagnostics: parsed.diagnostics,
          resourceUsage: parsed.resourceUsage,
          feeBumpSuggestion: parsed.feeBumpSuggestion,
          data: raw,
        };
        if (parsed.status === 'failed') {
          remote.errorCode = 'SIMULATION_FAILED';
          remote.errorMessage =
            parsed.diagnostics?.detail ??
            (parsed.diagnostics?.stellarCode !== undefined
              ? `Transaction failed with result code "${parsed.diagnostics.stellarCode}".`
              : 'Remote simulation reported a failed outcome.');
        } else if (parsed.status === 'fee_bump_required') {
          remote.errorCode = 'FEE_BUMP_REQUIRED';
          remote.errorMessage =
            parsed.feeBumpSuggestion?.reason ??
            'The simulation indicates a higher fee (fee bump) is required.';
        }
        // A reported minimum fee above the current bid must not be silently
        // swallowed either, even when the backend kept `success: true`: at the
        // bid it carries, the transaction would be rejected, so it is not
        // viable as built.
        if (
          remote.success &&
          reportedFee !== undefined &&
          reportedFee > baseFee
        ) {
          remote.success = false;
          remote.errorCode = 'FEE_BUMP_REQUIRED';
          remote.errorMessage =
            remote.errorMessage ??
            `The simulation requires a fee of at least ${reportedFee} stroops (current bid: ${baseFee}).`;
        }
      }
    } catch (error) {
      remote = {
        performed: true,
        success: false,
        errorCode: 'SIMULATION_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Remote simulation failed',
      };
    }
  }

  const remoteFeeBump = remote?.feeBumpSuggestion;
  const remoteFailed = remote !== undefined && !remote.success;
  // A fee-bump requirement is a viability signal of its own: the caller must
  // rebuild or wrap the transaction before it can be accepted.
  const needsFeeBump = remoteFeeBump !== undefined;

  const result: TransactionSimulationResult = {
    viable: !remoteFailed,
    valid: report.valid,
    operationCount,
    baseFee,
    estimatedFee,
    sourceAccount: decoded.sourceAccount,
    transactionXdr: xdr,
  };
  if (feeEstimate) result.feeEstimate = feeEstimate;
  if (remote?.resourceUsage) result.resourceUsage = remote.resourceUsage;
  if (remote?.diagnostics) result.diagnostics = remote.diagnostics;
  if (remoteFeeBump) result.feeBumpSuggestion = remoteFeeBump;
  if (remote) {
    result.remote = remote;
    if (remoteFailed || needsFeeBump) {
      // A fee-bump requirement is the more actionable signal — surface it over
      // the generic failure code so callers know to rebuild or wrap the tx.
      result.errorCode = needsFeeBump
        ? 'FEE_BUMP_REQUIRED'
        : (remote.errorCode ?? 'SIMULATION_FAILED');
      result.errorMessage = remote.errorMessage;
    }
  }
  return result;
}
