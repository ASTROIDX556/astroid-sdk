import { ValidationError } from '@astroid/errors';
import type { TransactionEnvelopeLike } from '@astroid/types';

/** Minimal Astroid HTTP client contract used by {@link estimateTransactionFee}. */
export interface TransactionFeeEstimationClient {
  /** Send a typed request to an Astroid API endpoint. */
  post<T>(path: string, body?: unknown): Promise<{ data: T }>;
}

/** Input accepted by the Astroid-backed transaction fee estimator. */
export interface EstimateTransactionFeeOptions {
  /** Transaction envelope or XDR string to estimate. */
  transaction?: TransactionEnvelopeLike;
  /** Base64 XDR string, as an alternative to `transaction`. */
  transactionXdr?: string;
  /** Number of operations when no transaction envelope is supplied. */
  operationCount?: number;
  /** Stellar network name understood by the Astroid API. */
  network?: string;
  /** Astroid HTTP client, commonly `astroid.http`. */
  client: TransactionFeeEstimationClient;
}

/** Fee recommendation returned by the Astroid fee-estimation endpoint. */
export interface TransactionFeeRecommendation {
  /** Minimum per-operation network fee in stroops. */
  baseFee: number;
  /** Recommended fee multiplier over the base fee. */
  surgeMultiplier: number;
  /** Recommended total transaction fee bid in stroops. */
  recommendedMaxFeeBid: number;
  /** Number of operations covered by the recommendation. */
  operationCount: number;
  /** Minimum total transaction fee in stroops. */
  minFee?: number;
  /** Recommended per-operation fee in stroops. */
  recommendedBaseFee?: number;
  /** Recommended total fee in stroops, when provided by the API. */
  recommendedFee?: number;
  /** Safety buffer percentage applied by the API. */
  bufferPercentage?: number;
  /** Network congestion classification returned by the API. */
  networkState?: 'normal' | 'busy' | 'congested' | 'unknown';
  /** Whether a live network fee sample informed the recommendation. */
  live?: boolean;
  /** XDR string used to calculate the estimate, when supplied. */
  transactionXdr?: string;
}

interface BackendFeeEstimate {
  baseFee?: unknown;
  ledgerBaseFee?: unknown;
  surgeMultiplier?: unknown;
  recommendedBaseFee?: unknown;
  recommendedMaxFeeBid?: unknown;
  recommendedFee?: unknown;
  maxFeeBid?: unknown;
  operationCount?: unknown;
  minFee?: unknown;
  bufferPercentage?: unknown;
  networkState?: unknown;
  live?: unknown;
  transactionXdr?: unknown;
}

/**
 * Query the Astroid API for a transaction fee recommendation.
 *
 * Supply either a transaction/XDR envelope or an `operationCount`. The result
 * includes a base fee, a surge multiplier, and the recommended total max-fee
 * bid, all fee amounts expressed in stroops.
 *
 * @param options Transaction details and the Astroid HTTP client.
 * @returns A normalized fee recommendation from `/transactions/estimate-fee`.
 * @throws {ValidationError} If the input or backend fee estimate is incomplete.
 *
 * @example
 * ```ts
 * const estimate = await estimateTransactionFee({
 *   transaction: unsignedTransaction,
 *   network: 'testnet',
 *   client: astroid.http,
 * });
 * unsignedTransaction.fee = String(estimate.recommendedMaxFeeBid);
 * ```
 */
export async function estimateTransactionFee(
  options: EstimateTransactionFeeOptions,
): Promise<TransactionFeeRecommendation> {
  const transactionXdr = options.transactionXdr ?? serializeTransaction(options.transaction);
  if (transactionXdr === undefined && options.operationCount === undefined) {
    throw new ValidationError('Provide a transaction envelope or operation count.', {
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
  }
  if (transactionXdr !== undefined && transactionXdr.length === 0) {
    throw new ValidationError('Transaction XDR must not be empty.', {
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
  }
  if (
    options.operationCount !== undefined &&
    (!Number.isInteger(options.operationCount) || options.operationCount < 1)
  ) {
    throw new ValidationError('Operation count must be a positive integer.', {
      code: 'INVALID_FEE_ESTIMATE_INPUT',
    });
  }

  const body: { transactionXdr?: string; operationCount?: number; network?: string } = {};
  if (transactionXdr !== undefined) body.transactionXdr = transactionXdr;
  if (options.operationCount !== undefined) body.operationCount = options.operationCount;
  if (options.network !== undefined) body.network = options.network;

  const response = await options.client.post<BackendFeeEstimate>(
    '/transactions/estimate-fee',
    body,
  );
  const raw = response.data;
  const baseFee = positiveNumber(raw.baseFee) ?? positiveNumber(raw.ledgerBaseFee);
  if (baseFee === undefined) {
    throw invalidEstimate('The fee estimate did not include a valid base fee.');
  }

  const operationCount = positiveInteger(raw.operationCount) ?? options.operationCount ?? 1;
  const recommendedBaseFee = positiveNumber(raw.recommendedBaseFee);
  const recommendedMaxFeeBid =
    positiveNumber(raw.recommendedMaxFeeBid) ??
    positiveNumber(raw.recommendedFee) ??
    positiveNumber(raw.maxFeeBid) ??
    (recommendedBaseFee === undefined ? undefined : recommendedBaseFee * operationCount);

  if (recommendedMaxFeeBid === undefined) {
    throw invalidEstimate('The fee estimate did not include a valid recommended max fee bid.');
  }

  const surgeMultiplier =
    positiveNumber(raw.surgeMultiplier) ??
    (recommendedBaseFee === undefined
      ? recommendedMaxFeeBid / (baseFee * operationCount)
      : recommendedBaseFee / baseFee);
  const result: TransactionFeeRecommendation = {
    baseFee,
    surgeMultiplier,
    recommendedMaxFeeBid,
    operationCount,
  };

  const minFee = positiveNumber(raw.minFee);
  const bufferPercentage = finiteNumber(raw.bufferPercentage);
  const networkState = readNetworkState(raw.networkState);
  if (minFee !== undefined) result.minFee = minFee;
  if (recommendedBaseFee !== undefined) result.recommendedBaseFee = recommendedBaseFee;
  if (typeof raw.recommendedFee === 'number' && Number.isFinite(raw.recommendedFee)) {
    result.recommendedFee = raw.recommendedFee;
  }
  if (bufferPercentage !== undefined) result.bufferPercentage = bufferPercentage;
  if (networkState !== undefined) result.networkState = networkState;
  if (typeof raw.live === 'boolean') result.live = raw.live;
  if (typeof raw.transactionXdr === 'string') result.transactionXdr = raw.transactionXdr;
  else if (transactionXdr !== undefined) result.transactionXdr = transactionXdr;
  return result;
}

/** Convert an envelope-like input into the endpoint's XDR string. */
function serializeTransaction(
  transaction: TransactionEnvelopeLike | undefined,
): string | undefined {
  if (transaction === undefined) return undefined;
  return typeof transaction === 'string' ? transaction : transaction.toXDR();
}

/** Read a finite positive number from an unknown backend value. */
function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Read a finite number from an unknown backend value. */
function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Read a valid positive integer from an unknown backend value. */
function positiveInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Narrow an unknown congestion value to the public network-state union. */
function readNetworkState(
  value: unknown,
): TransactionFeeRecommendation['networkState'] | undefined {
  return value === 'normal' || value === 'busy' || value === 'congested' || value === 'unknown'
    ? value
    : undefined;
}

/** Create a consistent error for incomplete fee estimates. */
function invalidEstimate(message: string): ValidationError {
  return new ValidationError(message, { code: 'INVALID_FEE_ESTIMATE_RESPONSE' });
}
