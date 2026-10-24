/**
 * Transaction simulation wrapper and helper.
 *
 * Simulates Stellar transaction envelopes via the Astroid API
 * (or injectable HTTP transport / fetch implementation) before broadcast.
 *
 * @module
 */

import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';
import type { HttpClient } from '@astroid/core';
import { encodeTransaction } from './builder.js';
import {
  TransactionSimulationError,
  normalizeTransactionError,
} from './errors.js';

/**
 * A transaction ready for simulation: base64 XDR envelope string or built instance.
 */
export type TransactionEnvelopeSource = string | Transaction | FeeBumpTransaction;

/**
 * Soroban / Stellar ledger execution resource metrics.
 */
export interface SimulationResourceUsage {
  cpuInstructions?: number | string;
  memoryBytes?: number | string;
  readBytes?: number | string;
  writeBytes?: number | string;
  readEntries?: number | string;
  writeEntries?: number | string;
  resourceFee?: number | string;
  transactionSizeBytes?: number | string;
  [key: string]: unknown;
}

/**
 * Structured diagnostics extracted from simulation errors or rejections.
 */
export interface SimulationDiagnostics {
  stellarCode?: string;
  operationCode?: string;
  operationResultCodes?: string[];
  failedOperationIndex?: number;
  detail?: string;
  [key: string]: unknown;
}

/**
 * Fee bump recommendation when transaction fee bid is insufficient.
 */
export interface FeeBumpSuggestion {
  required: boolean;
  suggestedFee?: number;
  suggestedBaseFee?: number;
  suggestedFeeSource?: string;
  reason?: string;
}

/**
 * Options for {@link simulateTransaction}.
 */
export interface SimulateTransactionOptions {
  /**
   * Astroid HTTP client instance (or compatible client with a post method).
   */
  client?: HttpClient | { post<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> };
  /**
   * Endpoint path or URL to post simulation requests. Defaults to `/transactions/simulate`.
   */
  endpoint?: string;
  /**
   * Custom fetch function for mocking or non-standard environments.
   */
  fetch?: typeof fetch;
  /**
   * Network passphrase for decoding transactions when necessary. Defaults to Public.
   */
  networkPassphrase?: string;
  /**
   * Optional custom HTTP headers.
   */
  headers?: Record<string, string>;
  /**
   * Optional abort signal.
   */
  signal?: AbortSignal;
}

/**
 * The structured report returned by {@link simulateTransaction}.
 */
export interface TransactionSimulationReport {
  /** Whether the simulation succeeded and the transaction is viable. */
  success: boolean;
  /** Ledger execution or simulation status. */
  status?: 'success' | 'failed' | 'fee_bump_required' | string;
  /** The normalized base64 XDR transaction envelope simulated. */
  transactionXdr: string;
  /** Estimated fee reported by the simulation, if available. */
  estimatedFee?: number | string;
  /** Projected resource consumption (Soroban / on-chain metrics). */
  resourceUsage?: SimulationResourceUsage;
  /** Detailed diagnostics for debugging simulation failures. */
  diagnostics?: SimulationDiagnostics;
  /** Recommended fee bump suggestions if fee was insufficient. */
  feeBumpSuggestion?: FeeBumpSuggestion;
  /** Normalized error details if simulation failed or was rejected. */
  error?: TransactionSimulationError | Error;
  /** Raw simulation API response payload. */
  raw?: unknown;
}

/** Narrow an unknown value to a plain object, or return `undefined`. */
function isRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Simulates a Stellar transaction envelope and returns a structured simulation report.
 *
 * Accepts an unsigned or signed transaction envelope (base64 XDR string, `Transaction`,
 * or `FeeBumpTransaction`), encodes it, posts it to the simulation endpoint, and parses
 * the simulation response into a comprehensive report.
 *
 * @param source - Transaction envelope string or built transaction object.
 * @param options - Simulation options including client, fetch, or custom endpoint.
 * @returns A structured simulation report.
 */
export async function simulateTransaction(
  source: TransactionEnvelopeSource,
  options: SimulateTransactionOptions = {},
): Promise<TransactionSimulationReport> {
  let transactionXdr: string;
  try {
    transactionXdr = encodeTransaction(source);
    if (!transactionXdr || typeof transactionXdr !== 'string' || transactionXdr.trim() === '') {
      throw new Error('Transaction XDR cannot be empty');
    }
  } catch (err) {
    const normErr = normalizeTransactionError(err, 'Invalid transaction envelope', {
      isSimulation: true,
    });
    return {
      success: false,
      status: 'failed',
      transactionXdr: typeof source === 'string' ? source : '',
      error: normErr,
      diagnostics: {
        detail: normErr.message,
      },
    };
  }

  const endpoint = options.endpoint ?? '/transactions/simulate';
  let responseData: unknown;

  try {
    if (options.client) {
      const res = await options.client.post<unknown>(endpoint, { transactionXdr });
      responseData = res.data;
    } else {
      const fetchImpl = options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        throw new Error('No fetch implementation or HTTP client available for transaction simulation');
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options.headers,
        },
        body: JSON.stringify({ transactionXdr }),
        signal: options.signal,
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }

      if (!response.ok) {
        const message =
          (isRecord(json)?.message as string) ||
          (isRecord(json)?.error as string) ||
          `Transaction simulation request failed with HTTP status ${response.status}`;
        const err = new TransactionSimulationError(message, {
          code: (isRecord(json)?.code as string) || 'SIMULATION_FAILED',
          status: response.status,
          transactionXdr,
          details: isRecord(json),
        });
        return parseFailurePayload(err, json, transactionXdr);
      }

      responseData = json;
    }
  } catch (error) {
    const normErr = normalizeTransactionError(error, 'Transaction simulation failed', {
      transactionXdr,
      isSimulation: true,
    });
    return {
      success: false,
      status: 'failed',
      transactionXdr,
      error: normErr,
      diagnostics: {
        stellarCode: normErr instanceof TransactionSimulationError ? normErr.stellarCode : undefined,
        operationCode: normErr instanceof TransactionSimulationError ? normErr.operationCode : undefined,
        operationResultCodes: normErr instanceof TransactionSimulationError ? normErr.operationResultCodes : undefined,
        detail: normErr.message,
      },
    };
  }

  return parseSuccessPayload(responseData, transactionXdr);
}

function parseSuccessPayload(
  payload: unknown,
  transactionXdr: string,
): TransactionSimulationReport {
  const record = isRecord(payload);
  if (!record) {
    const err = new TransactionSimulationError('Simulation response is not a valid JSON object', {
      code: 'MALFORMED_RESPONSE',
      transactionXdr,
    });
    return {
      success: false,
      status: 'failed',
      transactionXdr,
      error: err,
      raw: payload,
    };
  }

  // Handle explicit failure payloads returned with 200 OK (e.g. status: "failed" or success: false)
  if (record.success === false || record.status === 'failed') {
    const diagnostics = extractDiagnostics(record);
    const feeBump = extractFeeBump(record);
    const status = record.status === 'fee_bump_required' ? 'fee_bump_required' : 'failed';
    const errorMsg =
      (record.error as string) ||
      diagnostics?.detail ||
      `Transaction simulation failed with status ${status}`;

    return {
      success: false,
      status,
      transactionXdr,
      diagnostics,
      feeBumpSuggestion: feeBump,
      estimatedFee: (record.estimatedFee ?? record.fee ?? record.minResourceFee) as number | string | undefined,
      resourceUsage: (record.resourceUsage ?? record.resources) as SimulationResourceUsage | undefined,
      error: new TransactionSimulationError(errorMsg, {
        code: (record.code as string) || (status === 'fee_bump_required' ? 'FEE_BUMP_REQUIRED' : 'SIMULATION_FAILED'),
        stellarCode: diagnostics?.stellarCode,
        operationCode: diagnostics?.operationCode,
        operationResultCodes: diagnostics?.operationResultCodes,
        transactionXdr,
        details: record,
      }),
      raw: payload,
    };
  }

  const diagnostics = extractDiagnostics(record);
  const feeBump = extractFeeBump(record);
  const status = (record.status as string) || 'success';
  const isFeeBumpRequired = status === 'fee_bump_required' || feeBump?.required === true;

  return {
    success: !isFeeBumpRequired,
    status: isFeeBumpRequired ? 'fee_bump_required' : status,
    transactionXdr,
    estimatedFee: (record.estimatedFee ?? record.fee ?? record.minResourceFee) as number | string | undefined,
    resourceUsage: (record.resourceUsage ?? record.resources) as SimulationResourceUsage | undefined,
    diagnostics,
    feeBumpSuggestion: feeBump,
    raw: payload,
  };
}

function parseFailurePayload(
  err: TransactionSimulationError,
  payload: unknown,
  transactionXdr: string,
): TransactionSimulationReport {
  const record = isRecord(payload);
  const diagnostics = record ? extractDiagnostics(record) : undefined;
  const feeBump = record ? extractFeeBump(record) : undefined;

  return {
    success: false,
    status: (record?.status as string) || 'failed',
    transactionXdr,
    diagnostics: diagnostics ?? { detail: err.message },
    feeBumpSuggestion: feeBump,
    estimatedFee: record ? ((record.estimatedFee ?? record.fee) as number | string | undefined) : undefined,
    resourceUsage: record ? ((record.resourceUsage ?? record.resources) as SimulationResourceUsage | undefined) : undefined,
    error: err,
    raw: payload,
  };
}

function extractDiagnostics(record: Record<string, unknown>): SimulationDiagnostics | undefined {
  const container = isRecord(record.diagnostics) ?? isRecord(record.error) ?? record;
  const resultCodes = isRecord(isRecord(record.extras)?.result_codes);

  let stellarCode: string | undefined;
  let operationCode: string | undefined;
  let operationResultCodes: string[] | undefined;
  let failedOperationIndex: number | undefined;
  let detail: string | undefined;

  if (typeof container.stellarCode === 'string') stellarCode = container.stellarCode;
  else if (typeof container.transaction === 'string') stellarCode = container.transaction;

  if (typeof container.operationCode === 'string') operationCode = container.operationCode;

  if (Array.isArray(container.operationResultCodes)) {
    operationResultCodes = container.operationResultCodes.filter(
      (c): c is string => typeof c === 'string' && c.length > 0,
    );
  }

  if (resultCodes) {
    if (typeof resultCodes.transaction === 'string' && !stellarCode) {
      stellarCode = resultCodes.transaction;
    }
    if (Array.isArray(resultCodes.operations)) {
      operationResultCodes = resultCodes.operations.filter(
        (c): c is string => typeof c === 'string' && c.length > 0,
      );
    }
  }

  if (operationResultCodes && operationResultCodes.length > 0 && !operationCode) {
    operationCode = operationResultCodes[0];
  }

  if (typeof container.failedOperationIndex === 'number') {
    failedOperationIndex = container.failedOperationIndex;
  }

  if (typeof container.detail === 'string') {
    detail = container.detail;
  } else if (typeof record.message === 'string') {
    detail = record.message;
  }

  if (!stellarCode && !operationCode && !operationResultCodes && failedOperationIndex === undefined && !detail) {
    return undefined;
  }

  return {
    stellarCode,
    operationCode,
    operationResultCodes,
    failedOperationIndex,
    detail,
  };
}

function extractFeeBump(record: Record<string, unknown>): FeeBumpSuggestion | undefined {
  const feeBumpRecord = isRecord(record.feeBumpSuggestion) ?? isRecord(record.feeBump);
  if (feeBumpRecord) {
    return {
      required: feeBumpRecord.required !== false,
      suggestedFee: typeof feeBumpRecord.suggestedFee === 'number' ? feeBumpRecord.suggestedFee : undefined,
      suggestedBaseFee: typeof feeBumpRecord.suggestedBaseFee === 'number' ? feeBumpRecord.suggestedBaseFee : undefined,
      suggestedFeeSource: typeof feeBumpRecord.suggestedFeeSource === 'string' ? feeBumpRecord.suggestedFeeSource : undefined,
      reason: typeof feeBumpRecord.reason === 'string' ? feeBumpRecord.reason : undefined,
    };
  }

  if (record.status === 'fee_bump_required') {
    return {
      required: true,
      suggestedFee: typeof record.suggestedFee === 'number' ? record.suggestedFee : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    };
  }

  return undefined;
}
