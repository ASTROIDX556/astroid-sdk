/**
 * @astroid/transaction — Fee estimation helper.
 *
 * Provides {@link estimateFee} for querying network fee statistics and
 * computing recommended base fees and surge pricing multipliers.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type {
  FeeStatsResult,
  TransactionFeeEstimate,
  TransactionFeeEstimateOptions,
} from '@astroid/types';

import { queryFeeStatsSafe } from './fee-estimation.js';

/**
 * Options for estimating a transaction fee, matching the existing
 * {@link TransactionFeeEstimateOptions} shape from {@astroid/types}.
 */
export type EstimatorEstimateFeeOptions = TransactionFeeEstimateOptions;

/**
 * Result of estimating a transaction fee, including a surge pricing
 * multiplier and network congestion state.
 */
export interface EstimatorFeeResult {
  /** Recommended per-operation base fee in stroops. */
  recommendedBaseFee: number;
  /** Surge pricing multiplier (1.0 = no surge, >1.0 = surcharge). */
  surgeMultiplier: number;
  /** Network congestion classification. */
  networkState: 'normal' | 'busy' | 'congested' | 'unknown';
  /** Whether a live network fee sample was available. */
  live: boolean;
}

/**
 * Estimate the transaction fee by querying network fee statistics.
 *
 * Queries the Horizon `fee_stats` endpoint (or a custom `fetch`/`horizonUrl`)
 * and computes a recommended per-operation base fee and a surge pricing
 * multiplier based on current network congestion.
 *
 * If the network query fails, the function degrades gracefully to the static
 * base fee rather than throwing.
 *
 * @param options - Options specifying the horizon URL, fetch implementation,
 *   and optional base fee override.
 * @returns A fee result with recommended base fee, surge multiplier,
 *   network state, and live status.
 * @throws {ValidationError} When the fee stats query produces unparseable data.
 *
 * @example
 * ```ts
 * const result = await estimateFee({
 *   horizonUrl: 'https://horizon-testnet.stellar.org',
 * });
 * console.log(`Recommended base fee: ${result.recommendedBaseFee} stroops`);
 * console.log(`Surge multiplier: ${result.surgeMultiplier}x`);
 * ```
 */
export async function estimateFee(
  options: EstimatorEstimateFeeOptions = {},
): Promise<EstimatorFeeResult> {
  const bufferPercentage = options.bufferPercentage ?? 30;

  // Query live fee statistics from Horizon (or safe no-op fallback).
  const stats = await queryFeeStatsSafe(options);

  let baseFee: number;
  let networkState: 'normal' | 'busy' | 'congested' | 'unknown' = 'unknown';
  let live = false;

  if (stats) {
    // Use the mode fee as the representative live fee, falling back to
    // ledger base fee, then to the network minimum.
    const modeFee = stats.modeFee;
    const ledgerBaseFee = stats.ledgerBaseFee;

    if (typeof modeFee === 'number' && Number.isFinite(modeFee) && modeFee > 0) {
      baseFee = Math.floor(modeFee);
      live = true;
    } else if (
      typeof ledgerBaseFee === 'number' &&
      Number.isFinite(ledgerBaseFee) &&
      ledgerBaseFee > 0
    ) {
      baseFee = Math.floor(ledgerBaseFee);
      live = true;
    } else {
      baseFee = 100;
    }

    // Derive network state from the base fee.
    if (baseFee >= 5000) {
      networkState = 'congested';
    } else if (baseFee > 100 * 2) {
      networkState = 'busy';
    } else {
      networkState = 'normal';
    }
  } else {
    // No live stats available: fall back to the static base fee.
    baseFee = 100;
  }

  // Calculate surge multiplier based on network state.
  let surgeMultiplier: number;
  if (networkState === 'congested') {
    surgeMultiplier = 3.0;
  } else if (networkState === 'busy') {
    surgeMultiplier = 1.5;
  } else {
    surgeMultiplier = 1.0;
  }

  // Apply safety buffer to the base fee.
  const recommendedBaseFee = Math.ceil((baseFee * (100 + bufferPercentage)) / 100);

  return {
    recommendedBaseFee,
    surgeMultiplier,
    networkState,
    live,
  };
}