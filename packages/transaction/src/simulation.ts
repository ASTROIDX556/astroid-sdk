import { TransactionBuilder, Networks } from '@stellar/stellar-base';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-base';

/** Options for a Stellar transaction simulation request. */
export interface TransactionSimulationOptions {
  /** Simulation endpoint URL. */
  endpoint: string;
  /** Optional fetch implementation for tests and non-browser runtimes. */
  fetch?: typeof fetch;
  /** Optional request abort signal. */
  signal?: AbortSignal;
  /** Optional request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional headers sent to the simulation endpoint. */
  headers?: Record<string, string>;
}

/** Resource consumption reported by a simulation endpoint. */
export interface SimulationResources {
  cpuInstructions?: string;
  memoryBytes?: string;
  footprint?: unknown;
  [key: string]: unknown;
}

/** Parsed transaction simulation result. */
export interface TransactionSimulationResult {
  success: boolean;
  resources: SimulationResources;
  estimatedFee: string;
  authorizationRequirements: unknown[];
  raw: unknown;
}

/** Error thrown when a simulation endpoint rejects or cannot parse a transaction. */
export class TransactionSimulationException extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code = 'SIMULATION_FAILED', details?: unknown) {
    super(message);
    this.name = 'TransactionSimulationException';
    this.code = code;
    this.details = details;
  }
}

/** Simulate a transaction XDR and parse resources, fees, and authorization requirements. */
export async function simulateTransaction(
  transactionXdr: string,
  options: TransactionSimulationOptions,
): Promise<TransactionSimulationResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new TransactionSimulationException('No fetch implementation is available.', 'NO_FETCH');
  if (!transactionXdr)
    throw new TransactionSimulationException('Transaction XDR is required.', 'INVALID_XDR');

  let response: Response;
  try {
    response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({ transaction: transactionXdr }),
      signal: options.signal,
    });
  } catch (error) {
    throw new TransactionSimulationException(
      'Unable to reach the transaction simulation endpoint.',
      'NETWORK_ERROR',
      error,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message =
      getMessage(body) ?? `Transaction simulation failed with status ${response.status}.`;
    throw new TransactionSimulationException(message, getCode(body) ?? 'SIMULATION_FAILED', body);
  }
  if (!body || typeof body !== 'object')
    throw new TransactionSimulationException(
      'Simulation endpoint returned an invalid response.',
      'INVALID_RESPONSE',
      body,
    );

  const value = body as Record<string, unknown>;
  const resources = (value.resources ??
    value.resourceUsage ??
    value.result ??
    {}) as SimulationResources;
  const fee =
    value.estimatedFee ??
    value.minResourceFee ??
    value.fee ??
    (value.result as Record<string, unknown> | undefined)?.estimatedFee ??
    '0';
  const auth =
    value.authorizationRequirements ??
    value.auth ??
    (value.result as Record<string, unknown> | undefined)?.auth ??
    [];
  return {
    success: value.success !== false,
    resources,
    estimatedFee: String(fee),
    authorizationRequirements: Array.isArray(auth) ? auth : [auth],
    raw: body,
  };
}

function getMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as Record<string, unknown>;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  if (
    value.error &&
    typeof value.error === 'object' &&
    typeof (value.error as Record<string, unknown>).message === 'string'
  )
    return (value.error as Record<string, unknown>).message as string;
  return undefined;
}
function getCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as Record<string, unknown>;
  if (typeof value.code === 'string') return value.code;
  if (
    value.error &&
    typeof value.error === 'object' &&
    typeof (value.error as Record<string, unknown>).code === 'string'
  )
    return (value.error as Record<string, unknown>).code as string;
  return undefined;
}

/** Options for {@link simulateTransactionFee}. */
export interface TransactionFeeSimulationOptions {
  networkPassphrase?: string;
  feeBufferPercentage?: number;
}
/** A structured, machine-readable simulation error. */
export interface TransactionSimulationError {
  code: string;
  message: string;
}
/** The result of a transaction fee simulation. */
export interface TransactionFeeEstimate {
  baseFee: number;
  estimatedFee: number;
  feeBufferPercentage: number;
  isViable: boolean;
  error?: TransactionSimulationError;
}
const DEFAULT_FEE_BUFFER_PERCENTAGE = 15;
/** Estimate a transaction's Stellar fee without network access. */
export function simulateTransactionFee(
  transaction: string | Transaction | FeeBumpTransaction,
  options: TransactionFeeSimulationOptions = {},
): TransactionFeeEstimate {
  const feeBufferPercentage = options.feeBufferPercentage ?? DEFAULT_FEE_BUFFER_PERCENTAGE;
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx =
      typeof transaction === 'string'
        ? TransactionBuilder.fromXDR(transaction, options.networkPassphrase ?? Networks.PUBLIC)
        : transaction;
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
  const baseFee = Number(tx.fee);
  const estimatedFee = Math.round(baseFee * (1 + feeBufferPercentage / 100));
  return {
    baseFee,
    estimatedFee,
    feeBufferPercentage,
    isViable: Number.isFinite(baseFee) && baseFee > 0 && estimatedFee >= baseFee,
  };
}
