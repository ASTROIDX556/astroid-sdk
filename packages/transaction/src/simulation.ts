import { Networks, TransactionBuilder } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import type {
  PolicyBudgetImpact,
  PolicyRiskAssessment,
  TransactionFeeBumpSuggestion,
  TransactionFeeEstimate,
  TransactionResourceEstimate,
  TransactionSimulationDiagnostics,
  TransactionSimulationErrorCode,
  TransactionSimulationOptions,
  TransactionSimulationOutcome,
  TransactionSimulationPolicyEvaluation,
  TransactionSimulationPolicyViolation,
  TransactionSimulationRemoteResult,
  TransactionSimulationRequest,
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

const SIMULATION_ERROR_CODES = [
  'INVALID_ENVELOPE',
  'ZERO_OR_NEGATIVE_FEE',
  'FEE_BELOW_MINIMUM',
  'FEE_TOO_HIGH',
  'FEE_BUMP_REQUIRED',
  'POLICY_VIOLATION',
  'NO_OPERATIONS',
  'VALIDATION_FAILED',
  'SIMULATION_FAILED',
  'MALFORMED_RESPONSE',
  'NETWORK_ERROR',
] as const satisfies ReadonlyArray<TransactionSimulationErrorCode>;

function parseSimulationErrorCode(value: unknown): TransactionSimulationErrorCode | undefined {
  return typeof value === 'string' &&
    (SIMULATION_ERROR_CODES as readonly string[]).includes(value)
    ? (value as TransactionSimulationErrorCode)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function parsePolicyViolation(value: unknown): TransactionSimulationPolicyViolation | undefined {
  const record = isRecord(value);
  if (!record) return undefined;

  const policyId = firstString(record.policyId, record.ruleId, record.id);
  const reasonCode = firstString(record.reasonCode, record.code);
  const message = firstString(record.message, record.reason, record.detail, record.description);
  if (policyId === undefined && message === undefined && reasonCode === undefined) return undefined;

  const violation: TransactionSimulationPolicyViolation = {
    policyId: policyId ?? 'unknown',
    message: message ?? reasonCode ?? 'Policy rule violated.',
  };
  const parsedPolicyType = firstString(record.policyType, record.type);
  const parsedPolicyName = firstString(record.policyName, record.name);
  const parsedLimit = record.limit;
  const parsedActual = record.actual;
  if (parsedPolicyType !== undefined) violation.policyType = parsedPolicyType;
  if (parsedPolicyName !== undefined) violation.policyName = parsedPolicyName;
  if (reasonCode !== undefined) violation.reasonCode = reasonCode;
  if (
    typeof parsedLimit === 'string' ||
    (typeof parsedLimit === 'number' && Number.isFinite(parsedLimit))
  ) {
    violation.limit = parsedLimit;
  }
  if (
    typeof parsedActual === 'string' ||
    (typeof parsedActual === 'number' && Number.isFinite(parsedActual))
  ) {
    violation.actual = parsedActual;
  }
  return violation;
}

function parsePolicyViolations(value: unknown): TransactionSimulationPolicyViolation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const violations = value
    .map(parsePolicyViolation)
    .filter((violation): violation is TransactionSimulationPolicyViolation => violation !== undefined);
  return violations.length > 0 || value.length === 0 ? violations : undefined;
}

function parsePolicyEvaluation(
  raw: Record<string, unknown>,
): TransactionSimulationPolicyEvaluation | undefined {
  const containers = [
    raw.policyEvaluation,
    raw.policy,
    raw.policySimulation,
    raw.policyResult,
    raw.error,
    raw,
  ]
    .map(isRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined);

  let container: Record<string, unknown> | undefined;
  for (const candidate of containers) {
    if (
      typeof candidate.allowed === 'boolean' ||
      typeof candidate.denied === 'boolean' ||
      candidate.decision !== undefined ||
      candidate.violations !== undefined ||
      candidate.policyId !== undefined ||
      candidate.reasonCode !== undefined ||
      candidate.explanation !== undefined
    ) {
      container = candidate;
      break;
    }
  }
  if (!container) return undefined;

  const violations =
    parsePolicyViolations(container.violations) ??
    parsePolicyViolations(raw.violations) ??
    parsePolicyViolations(isRecord(raw.error)?.violations) ??
    [];
  const decision = firstString(container.decision, raw.decision);
  const upperDecision = decision?.toUpperCase();
  const explicitCode = firstString(
    container.code,
    container.errorCode,
    isRecord(raw.error)?.code,
    raw.code,
    raw.errorCode,
  );

  let allowed: boolean | undefined;
  if (typeof container.allowed === 'boolean') allowed = container.allowed;
  else if (typeof container.denied === 'boolean') allowed = !container.denied;
  else if (typeof raw.allowed === 'boolean') allowed = raw.allowed;
  else if (typeof raw.denied === 'boolean') allowed = !raw.denied;
  else if (upperDecision === 'DENIED') allowed = false;
  else if (upperDecision === 'ALLOWED') allowed = true;
  else if (explicitCode === 'POLICY_VIOLATION') allowed = false;
  else if (violations.length > 0) allowed = false;
  if (allowed === undefined) return undefined;

  const evaluation: TransactionSimulationPolicyEvaluation = { allowed, violations };
  if (typeof container.denied === 'boolean') evaluation.denied = container.denied;
  else if (typeof raw.denied === 'boolean') evaluation.denied = raw.denied;
  else evaluation.denied = !allowed;
  if (upperDecision === 'DENIED' || upperDecision === 'ALLOWED') {
    evaluation.decision = upperDecision;
  }

  const reasonCode = firstString(container.reasonCode, raw.reasonCode, violations[0]?.reasonCode);
  if (reasonCode !== undefined) evaluation.reasonCode = reasonCode;
  if (Array.isArray(container.requiredApprovals)) {
    const approvals = container.requiredApprovals.filter(
      (approval): approval is string => typeof approval === 'string' && approval.length > 0,
    );
    if (approvals.length > 0) evaluation.requiredApprovals = approvals;
  }

  const riskRecord = isRecord(container.risk);
  if (
    riskRecord &&
    typeof riskRecord.score === 'number' &&
    typeof riskRecord.band === 'string' &&
    Array.isArray(riskRecord.factors)
  ) {
    evaluation.risk = riskRecord as unknown as PolicyRiskAssessment;
  }
  if (Array.isArray(container.budgetImpact)) {
    const budgetImpact = container.budgetImpact
      .map(isRecord)
      .filter((impact): impact is Record<string, unknown> => impact !== undefined)
      .map((impact) => ({
        budgetId: firstString(impact.budgetId, impact.id),
        beforeRemaining: firstString(impact.beforeRemaining),
        afterRemaining: firstString(impact.afterRemaining),
      }))
      .filter(
        (impact): impact is PolicyBudgetImpact =>
          impact.budgetId !== undefined &&
          impact.beforeRemaining !== undefined &&
          impact.afterRemaining !== undefined,
      );
    if (budgetImpact.length > 0) evaluation.budgetImpact = budgetImpact;
  }

  const explanation = firstString(
    container.explanation,
    container.message,
    container.detail,
    raw.explanation,
    allowed ? undefined : firstString(raw.message, firstRecordString(raw.error, 'message')),
  );
  if (explanation !== undefined) evaluation.explanation = explanation;
  return evaluation;
}

function firstRecordString(value: unknown, key: string): string | undefined {
  const record = isRecord(value);
  return record ? firstString(record[key]) : undefined;
}

function parseFailureReasons(
  raw: Record<string, unknown>,
  policyEvaluation: TransactionSimulationPolicyEvaluation | undefined,
  diagnostics: TransactionSimulationDiagnostics | undefined,
): string[] | undefined {
  const reasons: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0 && !reasons.includes(value)) {
      reasons.push(value);
    }
  };

  const rawReasons = raw.failureReasons ?? raw.reasons;
  if (Array.isArray(rawReasons)) rawReasons.forEach(add);
  add(firstString(raw.explanation, firstRecordString(raw.error, 'message')));
  if (policyEvaluation) {
    add(policyEvaluation.explanation);
    policyEvaluation.violations.forEach((violation) => add(violation.message));
  }
  add(diagnostics?.detail);
  return reasons.length > 0 ? reasons : undefined;
}

function withLeadingReason(reasons: string[] | undefined, message: string | undefined): string[] {
  const result = [...(reasons ?? [])];
  if (message && !result.includes(message)) result.unshift(message);
  return result;
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
  estimatedFee?: number;
  feeBumpSuggestion?: TransactionFeeBumpSuggestion;
  policyEvaluation?: TransactionSimulationPolicyEvaluation;
  failureReasons?: string[];
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
  const status =
    parseSimulationStatus(raw.status) ??
    (raw.success === false ? 'failed' : undefined) ??
    parseSimulationStatus(raw.state);
  const diagnostics = parseSimulationDiagnostics(raw);
  const resourceUsage = parseResourceEstimate(raw.resourceUsage ?? raw.resources);
  const estimatedFee = parseNonNegativeNumber(raw.estimatedFee ?? raw.fee ?? raw.minResourceFee);
  const feeBumpSuggestion = parseFeeBumpSuggestion(raw, diagnostics, currentFee, operationCount);
  const policyEvaluation = parsePolicyEvaluation(raw);
  const failureReasons = parseFailureReasons(raw, policyEvaluation, diagnostics);

  const parsed: ParsedSimulationResponse = {};
  if (status !== undefined) parsed.status = status;
  if (diagnostics !== undefined) parsed.diagnostics = diagnostics;
  if (resourceUsage !== undefined) parsed.resourceUsage = resourceUsage;
  if (estimatedFee !== undefined) parsed.estimatedFee = estimatedFee;
  if (feeBumpSuggestion !== undefined) parsed.feeBumpSuggestion = feeBumpSuggestion;
  if (policyEvaluation !== undefined) parsed.policyEvaluation = policyEvaluation;
  if (failureReasons !== undefined) parsed.failureReasons = failureReasons;
  return parsed;
}

/** Coerce a raw status value onto the {@link TransactionSimulationStatus} union. */
function parseSimulationStatus(value: unknown): TransactionSimulationStatus | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value) {
    case 'success':
    case 'failed':
    case 'fee_bump_required':
    case 'policy_violation':
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

  const localEstimatedFee = feeEstimate ? Math.max(feeEstimate.recommendedFee, baseFee) : baseFee;

  const request: TransactionSimulationRequest = { transactionXdr: xdr };
  if (options.agentId !== undefined) request.agentId = options.agentId;
  if (options.walletId !== undefined) request.walletId = options.walletId;
  if (options.metadata !== undefined) request.metadata = options.metadata;

  let remote: TransactionSimulationRemoteResult | undefined;
  if (options.client && !options.skipRemote) {
    try {
      const response = await options.client.post<unknown>('/transactions/simulate', request);
      const raw = isRecord(response.data);
      if (!raw) {
        // A non-object payload from the API is a malformed response, not a
        // viable simulation: surface it instead of crashing or fabricating.
        remote = {
          performed: true,
          success: false,
          errorCode: 'MALFORMED_RESPONSE',
          errorMessage: 'Simulation endpoint returned a non-object response body.',
          failureReasons: ['Simulation endpoint returned a non-object response body.'],
          data: response.data === undefined ? undefined : { value: response.data },
        };
      } else {
        const parsed = parseSimulationResponse(raw, baseFee, operationCount);
        const reportedFee = parsed.feeBumpSuggestion?.suggestedFee;
        const policyDenied =
          (parsed.policyEvaluation !== undefined && !parsed.policyEvaluation.allowed) ||
          parsed.status === 'policy_violation' ||
          firstString(raw.code, raw.errorCode, firstRecordString(raw.error, 'code')) ===
            'POLICY_VIOLATION';

        remote = {
          performed: true,
          success:
            !policyDenied &&
            raw.success !== false &&
            (parsed.status === undefined ||
              (parsed.status !== 'failed' && parsed.status !== 'policy_violation')),
          status: parsed.status,
          diagnostics: parsed.diagnostics,
          resourceUsage: parsed.resourceUsage,
          estimatedFee: parsed.estimatedFee,
          feeBumpSuggestion: parsed.feeBumpSuggestion,
          data: raw,
        };
        if (parsed.policyEvaluation !== undefined) {
          remote.policyEvaluation = parsed.policyEvaluation;
        } else if (policyDenied) {
          remote.policyEvaluation = {
            allowed: false,
            violations: parsePolicyViolations(raw.violations) ?? [],
          };
        }
        if (parsed.failureReasons !== undefined) remote.failureReasons = parsed.failureReasons;

        if (policyDenied) {
          const policyEvaluation = remote.policyEvaluation as TransactionSimulationPolicyEvaluation;
          remote.errorCode = 'POLICY_VIOLATION';
          remote.errorMessage = firstString(
            policyEvaluation.explanation,
            policyEvaluation.violations[0]?.message,
            remote.failureReasons?.[0],
            firstString(raw.message, firstRecordString(raw.error, 'message')),
          ) ?? 'Transaction rejected by the Astroid policy engine.';
        } else if (parsed.status === 'failed') {
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
        } else if (raw.success === false) {
          remote.errorCode =
            parseSimulationErrorCode(raw.code ?? raw.errorCode ?? firstRecordString(raw.error, 'code')) ??
            'SIMULATION_FAILED';
          remote.errorMessage =
            firstString(raw.message, firstRecordString(raw.error, 'message')) ??
            'Remote simulation reported a failed outcome.';
        }
        // A reported minimum fee above the current bid must not be silently
        // swallowed either, even when the backend kept `success: true`: at the
        // bid it carries, the transaction would be rejected, so it is not
        // viable as built.
        if (remote.success && reportedFee !== undefined && reportedFee > baseFee) {
          remote.success = false;
          remote.errorCode = 'FEE_BUMP_REQUIRED';
          remote.errorMessage =
            remote.errorMessage ??
            `The simulation requires a fee of at least ${reportedFee} stroops (current bid: ${baseFee}).`;
        }
        if (!remote.success) {
          remote.failureReasons = withLeadingReason(remote.failureReasons, remote.errorMessage);
        }
      }
    } catch (error) {
      const errorRecord = isRecord(error);
      const details = isRecord(errorRecord?.details) ?? errorRecord;
      const code =
        parseSimulationErrorCode(errorRecord?.code ?? errorRecord?.errorCode) ??
        parseSimulationErrorCode(details?.code ?? details?.errorCode);
      const isPolicyViolation =
        code === 'POLICY_VIOLATION' ||
        errorRecord?.name === 'PolicyViolationError' ||
        firstString(errorRecord?.code, details?.code) === 'POLICY_VIOLATION';
      const message = error instanceof Error ? error.message : 'Remote simulation failed';

      remote = {
        performed: true,
        success: false,
        errorCode: isPolicyViolation ? 'POLICY_VIOLATION' : 'SIMULATION_FAILED',
        errorMessage: message,
      };
      if (isPolicyViolation && details) {
        const policyEvaluation =
          parsePolicyEvaluation(details) ??
          ({
            allowed: false,
            violations: parsePolicyViolations(details.violations) ?? [],
          } as TransactionSimulationPolicyEvaluation);
        remote.policyEvaluation = policyEvaluation;
        remote.failureReasons = withLeadingReason(
          parseFailureReasons(details, policyEvaluation, undefined),
          message,
        );
        remote.data = code !== undefined ? { ...details, code } : details;
      } else {
        remote.failureReasons = [message];
      }
    }
  }

  const remoteFeeBump = remote?.feeBumpSuggestion;
  const remoteFailed = remote !== undefined && !remote.success;
  // A fee-bump requirement is a viability signal of its own: the caller must
  // rebuild or wrap the transaction before it can be accepted.
  const needsFeeBump = remoteFeeBump !== undefined;
  const policyViolation = remote?.policyEvaluation?.allowed === false;

  const result: TransactionSimulationResult = {
    viable: !remoteFailed,
    success: !remoteFailed,
    status: remote?.status ?? (remoteFailed ? 'failed' : 'success'),
    valid: report.valid,
    operationCount,
    baseFee,
    estimatedFee: remote?.estimatedFee ?? localEstimatedFee,
    sourceAccount: decoded.sourceAccount,
    transactionXdr: xdr,
  };
  if (feeEstimate) result.feeEstimate = feeEstimate;
  if (remote?.resourceUsage) result.resourceUsage = remote.resourceUsage;
  if (remote?.diagnostics) result.diagnostics = remote.diagnostics;
  if (remoteFeeBump) result.feeBumpSuggestion = remoteFeeBump;
  if (remote) {
    result.remote = remote;
    if (remote.policyEvaluation !== undefined) {
      result.policyEvaluation = remote.policyEvaluation;
      result.violations = remote.policyEvaluation.violations;
    }
    if (remote.failureReasons !== undefined) result.failureReasons = remote.failureReasons;
    if (remoteFailed || needsFeeBump) {
      // A fee-bump requirement is the more actionable signal — surface it over
      // the generic failure code so callers know to rebuild or wrap the tx.
      result.errorCode = policyViolation
        ? 'POLICY_VIOLATION'
        : needsFeeBump
          ? 'FEE_BUMP_REQUIRED'
          : (remote.errorCode ?? 'SIMULATION_FAILED');
      result.errorMessage = remote.errorMessage;
      if (result.errorCode !== undefined && result.errorMessage !== undefined) {
        result.failureReasons = withLeadingReason(remote.failureReasons, result.errorMessage);
        result.error = new TransactionSimulationError(result.errorMessage, {
          code: result.errorCode,
          status: 400,
          transactionXdr: xdr,
          stellarCode: remote.diagnostics?.stellarCode,
          operationCode: remote.diagnostics?.operationCode,
          operationResultCodes: remote.diagnostics?.operationResultCodes,
          details: {
            policyEvaluation: remote.policyEvaluation,
            violations: remote.policyEvaluation?.violations,
            data: remote.data,
          },
        });
      }
    }
  }
  return result;
}
