/**
 * @astroid/transaction — Transaction fee inclusion estimator.
 *
 * Wraps {@link estimateFee} from {@link ./estimator} to provide recommended
 * inclusion fees for transaction builders. This ensures that transactions are
 * bid at a fee likely to be accepted by the network, based on current fee
 * statistics and surge pricing.
 *
 * @module
 */

import { estimateFee } from './estimator.js';

/**
 * Recommended fee for inclusion in a transaction, derived from network fee
 * statistics.
 *
 * The `recommendedMaxFeeBid` is the total fee in stroops to bid for the
 * transaction, incorporating the surge multiplier and safety buffer.
 */
export interface EstimatedInclusionFee {
  /** Per-operation base fee in stroops (already buffered). */
  baseFee: number;
  /** Surge multiplier that was applied (1.0 = no surge). */
  surgeMultiplier: number;
  /** Recommended total fee bid in stroops for the whole transaction. */
  recommendedMaxFeeBid: number;
  /** Minimum total fee in stroops (`baseFee × operationCount`). */
  minFee: number;
  /** Number of operations the fee covers. */
  operationCount: number;
  /** Network congestion state at the time of estimation. */
  networkState: 'normal' | 'busy' | 'congested' | 'unknown';
  /** Whether a live network fee sample was available. */
  live: boolean;
}

/**
 * Estimate a recommended inclusion fee for a transaction builder.
 *
 * Queries network fee statistics and computes a fee recommendation that
 * accounts for surge pricing and a safety buffer. The result can be directly
 * used with {@link buildTransaction} or {@link buildPaymentTransaction}.
 *
 * If the network query fails, the function degrades gracefully to the static
 * base fee (100 stroops per operation) rather than throwing.
 *
 * @returns A structured fee recommendation suitable for use with transaction builders.
 *
 * @example
 * ```ts
 * import { estimateInclusionFee, buildPaymentTransaction } from '@astroid/transaction';
 * import { Keypair, Account, Operation, Asset, Networks } from '@stellar/stellar-base';
 *
 * const keypair = Keypair.random();
 * const account = new Account(keypair.publicKey(), '1');
 *
 * const feeEstimate = await estimateInclusionFee();
 *
 * const tx = buildPaymentTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   destination: 'G...',
 *   asset: 'USDC',
 *   amount: '100',
 *   fee: String(feeEstimate.recommendedMaxFeeBid),
 * });
 * ```
 */
export async function estimateInclusionFee(): Promise<EstimatedInclusionFee> {
  // Use the estimator to get recommended base fee and surge multiplier.
  const estimatorOptions = {
    bufferPercentage: 30,
  };

  const estimate = await estimateFee(estimatorOptions);

  const baseFee = estimate.recommendedBaseFee;
  const surgeMultiplier = estimate.surgeMultiplier;
  const networkState = estimate.networkState;
  const live = estimate.live;

  // Default operation count to 1 when no transaction envelope is supplied.
  const operationCount = 1;

  // Compute the recommended total fee bid.
  // The surge multiplier is applied to the base fee, then the buffer is added.
  const bufferedBaseFee = Math.ceil((baseFee * (100 + 30)) / 100);
  const recommendedMaxFeeBid = Math.max(bufferedBaseFee * surgeMultiplier, bufferedBaseFee) * operationCount;
  const minFee = baseFee * operationCount;

  return {
    baseFee: bufferedBaseFee,
    surgeMultiplier,
    recommendedMaxFeeBid,
    minFee,
    operationCount,
    networkState,
    live,
  };
}