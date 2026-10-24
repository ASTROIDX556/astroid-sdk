/**
 * DTO and options representing network statistics used for fee calculation
 * and surge pricing recommendation.
 */
export interface NetworkFeeStatisticsDto {
  /** The base fee of the ledger in stroops (minimum accepted fee per operation). */
  baseFee: number;
  /** Mode (most common) fee bid per operation in recent ledgers, in stroops. */
  modeFee?: number;
  /** Median (50th percentile) fee charged per operation in recent ledgers, in stroops. */
  p50Fee?: number;
  /** 95th percentile fee charged per operation in recent ledgers, in stroops. */
  p95Fee?: number;
  /** 99th percentile fee charged per operation in recent ledgers, in stroops. */
  p99Fee?: number;
  /** Maximum fee bid per operation observed in recent ledgers, in stroops. */
  maxFee?: number;
  /** Minimum fee bid per operation observed in recent ledgers, in stroops. */
  minFee?: number;
  /** Ratio of ledger capacity utilized (0.0 to 1.0, e.g. 0.85 = 85% full). */
  ledgerCapacityUsage?: number;
  /** Number of operations in transaction queue or pending pool. */
  queuedOperationsCount?: number;
}

/**
 * Options to customize fee recommendation and surge pricing multipliers.
 */
export interface FeeRecommendationOptions {
  /** Number of operations in the transaction (defaults to 1). */
  operationCount?: number;
  /** Desired priority/urgency level for transaction inclusion. */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Custom safety buffer percentage override. */
  customBufferPercentage?: number;
  /** Minimum floor multiplier for surge pricing (defaults to 1.0). */
  minSurgeMultiplier?: number;
  /** Maximum ceiling multiplier for surge pricing (defaults to 10.0). */
  maxSurgeMultiplier?: number;
}

/**
 * Detailed fee recommendation and network surge pricing analysis.
 */
export interface FeeRecommendationResult {
  /** Base fee per operation recommended for this transaction (in stroops). */
  recommendedBaseFee: number;
  /** Total recommended fee covering all operations (in stroops). */
  recommendedTotalFee: number;
  /** Minimum absolute fee required by protocol for this transaction (in stroops). */
  minRequiredFee: number;
  /** Surge pricing multiplier applied based on network congestion metrics (e.g. 1.0 = no surge, 2.5 = 2.5x). */
  surgeMultiplier: number;
  /** Assessed network congestion state. */
  networkState: 'normal' | 'busy' | 'congested' | 'unknown';
  /** Effective safety buffer percentage applied. */
  bufferPercentage: number;
  /** The operation count used for the fee calculation. */
  operationCount: number;
}
