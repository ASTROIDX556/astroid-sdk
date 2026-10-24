/**
 * Transaction fee optimization and dynamic surge pricing helpers.
 *
 * Provides functions to analyze network statistics DTOs, determine congestion
 * states and surge pricing multipliers, and calculate recommended base and total
 * transaction fees for Stellar network transactions.
 *
 * @module
 */

import type {
  FeeRecommendationOptions,
  FeeRecommendationResult,
  NetworkFeeStatisticsDto,
  StellarNetworkState,
} from '@astroid/types';
import { MIN_BASE_FEE_STROOPS } from './validator.js';

/**
 * Calculates a dynamic surge pricing multiplier based on network congestion metrics.
 *
 * Inspects fee statistics (p50, p95, p99, mode, base fee) and ledger capacity usage
 * to compute a multiplier indicating how much above the standard base fee transactions
 * should bid to guarantee timely inclusion.
 *
 * Multiplier rules:
 * - High congestion (e.g. p95/p50 ratio high, high capacity usage, or fees >= 5000 stroops): 2.0x - 5.0x+
 * - Moderate / busy congestion (e.g. fee > 2x base fee, capacity usage > 70%): 1.25x - 2.0x
 * - Low / normal congestion (fees near base fee, capacity usage < 50%): 1.0x (no surge)
 *
 * @param stats - Network fee statistics DTO containing recent ledger fee distribution and capacity.
 * @param options - Optional multiplier bounds (minSurgeMultiplier, maxSurgeMultiplier).
 * @returns Surge multiplier as a number (clamped within [minSurgeMultiplier, maxSurgeMultiplier]).
 *
 * @example
 * ```ts
 * const multiplier = calculateSurgeMultiplier({
 *   baseFee: 100,
 *   p50Fee: 350,
 *   ledgerCapacityUsage: 0.85,
 * });
 * // returns e.g. 2.5
 * ```
 */
export function calculateSurgeMultiplier(
  stats: NetworkFeeStatisticsDto,
  options?: Pick<FeeRecommendationOptions, 'minSurgeMultiplier' | 'maxSurgeMultiplier'>,
): number {
  const minMultiplier = options?.minSurgeMultiplier ?? 1.0;
  const maxMultiplier = options?.maxSurgeMultiplier ?? 10.0;

  const baseFee =
    typeof stats.baseFee === 'number' && Number.isFinite(stats.baseFee) && stats.baseFee > 0
      ? stats.baseFee
      : MIN_BASE_FEE_STROOPS;

  // Derive highest representative fee metric among p99, p95, p50, modeFee
  const representativeFee = Math.max(
    stats.p99Fee ?? 0,
    stats.p95Fee ?? 0,
    stats.p50Fee ?? 0,
    stats.modeFee ?? 0,
    baseFee,
  );

  let multiplier = 1.0;

  // 1. Fee ratio component
  const feeRatio = representativeFee / baseFee;
  if (feeRatio > 1.0) {
    // Proportional surge based on fee pressure
    multiplier = Math.max(multiplier, feeRatio);
  }

  // 2. Ledger capacity utilization surge component
  if (typeof stats.ledgerCapacityUsage === 'number' && Number.isFinite(stats.ledgerCapacityUsage)) {
    const usage = Math.max(0, Math.min(1, stats.ledgerCapacityUsage));
    if (usage >= 0.95) {
      // Emergency saturation (>95% capacity)
      multiplier = Math.max(multiplier, multiplier * 2.0, 3.0);
    } else if (usage >= 0.8) {
      // Heavy congestion (80% - 95%)
      multiplier = Math.max(multiplier, multiplier * 1.5, 2.0);
    } else if (usage >= 0.6) {
      // Moderate congestion (60% - 80%)
      multiplier = Math.max(multiplier, multiplier * 1.2, 1.3);
    }
  }

  // 3. Absolute fee threshold check (Stellar congested threshold >= 5000 stroops)
  if (representativeFee >= 5000) {
    multiplier = Math.max(multiplier, 3.0);
  } else if (representativeFee >= 1000) {
    multiplier = Math.max(multiplier, 1.5);
  }

  // Round multiplier to 2 decimal places to prevent floating point anomalies
  const roundedMultiplier = Math.round(multiplier * 100) / 100;

  // Clamp within user or default bounds
  const clamped = Math.min(Math.max(roundedMultiplier, minMultiplier), maxMultiplier);
  return Math.round(clamped * 100) / 100;
}

/**
 * Assesses the network congestion state from network statistics and surge multiplier.
 *
 * @param stats - Network fee statistics DTO.
 * @param surgeMultiplier - Calculated surge pricing multiplier.
 * @returns Congestion classification matching {@link StellarNetworkState}.
 */
export function deriveNetworkCongestionState(
  stats: NetworkFeeStatisticsDto,
  surgeMultiplier: number,
): StellarNetworkState {
  if (!Number.isFinite(stats.baseFee) || stats.baseFee <= 0) {
    return 'unknown';
  }

  const baseFee = stats.baseFee;
  const representativeFee = Math.max(
    stats.p99Fee ?? 0,
    stats.p95Fee ?? 0,
    stats.p50Fee ?? 0,
    stats.modeFee ?? 0,
    baseFee,
  );

  const usage = stats.ledgerCapacityUsage ?? 0;

  if (representativeFee >= 5000 || surgeMultiplier >= 2.5 || usage >= 0.9) {
    return 'congested';
  }

  if (representativeFee > baseFee * 1.5 || surgeMultiplier > 1.2 || usage >= 0.6) {
    return 'busy';
  }

  return 'normal';
}

/**
 * Calculates recommended base fee and surge pricing multipliers based on network congestion metrics.
 *
 * Accepts network statistics DTOs (e.g. from Horizon fee_stats or custom indexers) and computes:
 * - Recommended base fee per operation (stroops)
 * - Total recommended fee for the given operation count
 * - Dynamic surge pricing multiplier
 * - Congestion state ('normal' | 'busy' | 'congested' | 'unknown')
 * - Priority adjustments ('low' | 'normal' | 'high' | 'urgent')
 *
 * @param stats - Network statistics DTO representing current fee conditions and capacity.
 * @param options - Configuration options including operationCount, priority, buffer, and bounds.
 * @returns Comprehensive {@link FeeRecommendationResult}.
 *
 * @example
 * ```ts
 * const recommendation = calculateRecommendedFee(
 *   {
 *     baseFee: 100,
 *     p50Fee: 200,
 *     p95Fee: 500,
 *     ledgerCapacityUsage: 0.75,
 *   },
 *   { operationCount: 2, priority: 'high' }
 * );
 * console.log(recommendation.recommendedBaseFee); // Recommended stroops per operation
 * console.log(recommendation.surgeMultiplier);    // Surge multiplier applied
 * console.log(recommendation.recommendedTotalFee); // recommendedBaseFee * 2
 * ```
 */
export function calculateRecommendedFee(
  stats: NetworkFeeStatisticsDto,
  options: FeeRecommendationOptions = {},
): FeeRecommendationResult {
  const rawOps = options.operationCount ?? 1;
  const operationCount = Number.isFinite(rawOps) && rawOps > 0 ? Math.floor(rawOps) : 1;

  const validBaseFee =
    typeof stats.baseFee === 'number' && Number.isFinite(stats.baseFee) && stats.baseFee > 0
      ? Math.floor(stats.baseFee)
      : MIN_BASE_FEE_STROOPS;

  const minRequiredFee = validBaseFee * operationCount;

  // Calculate surge multiplier
  const surgeMultiplier = calculateSurgeMultiplier(stats, options);

  // Congestion state
  const networkState = deriveNetworkCongestionState(stats, surgeMultiplier);

  // Default buffer percentages by priority
  let priorityBuffer = 20;
  let priorityMultiplier = 1.0;

  switch (options.priority) {
    case 'low':
      priorityBuffer = 10;
      priorityMultiplier = 0.9;
      break;
    case 'high':
      priorityBuffer = 35;
      priorityMultiplier = 1.25;
      break;
    case 'urgent':
      priorityBuffer = 50;
      priorityMultiplier = 1.5;
      break;
    case 'normal':
    default:
      priorityBuffer = 20;
      priorityMultiplier = 1.0;
      break;
  }

  const effectiveBufferPercentage = options.customBufferPercentage ?? priorityBuffer;

  // Base calculation starting from representative fee or validBaseFee
  const referenceFee = Math.max(
    validBaseFee,
    stats.p50Fee ?? 0,
    stats.modeFee ?? 0,
  );

  // Apply surge multiplier and priority adjustments
  const surgedBase = referenceFee * surgeMultiplier * priorityMultiplier;

  // Apply safety buffer percentage
  const bufferedFee = Math.ceil((surgedBase * (100 + effectiveBufferPercentage)) / 100);

  // Final recommended base fee (must at least satisfy network validBaseFee)
  const recommendedBaseFee = Math.max(validBaseFee, bufferedFee);
  const recommendedTotalFee = recommendedBaseFee * operationCount;

  return {
    recommendedBaseFee,
    recommendedTotalFee,
    minRequiredFee,
    surgeMultiplier,
    networkState,
    bufferPercentage: effectiveBufferPercentage,
    operationCount,
  };
}
