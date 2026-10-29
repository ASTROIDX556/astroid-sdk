/**
 * `@astroid/analytics` — aggregates helper module.
 *
 * Client-side aggregation helper functions for computing rolling totals,
 * gas expenditures, transaction volume, average fees, and success rates
 * over custom time windows.
 *
 * All functions are pure, side-effect free, deterministic, and safe to execute
 * in both Node.js and browser environments.
 *
 * @module
 */

import type {
  TransactionStatus,
} from '@astroid/types';
import {
  aggregateTransactionMetrics,
  aggregateTimeSeriesMetrics,
  type AggregateGranularity,
  type AggregateTelemetryOptions,
  type AggregatedTelemetry,
  type TransactionTelemetryBucket,
  type TimeSeriesResolution,
  type AggregateTimeSeriesOptions,
  type AggregatedTimeSeriesBucket,
  type AggregatedTimeSeriesResult,
  type TimeSeriesInputPoint,
  type TimeSeriesMetricsInput,
} from './aggregations.js';

/* -------------------------------------------------------------------------- */
/* Types & Interfaces                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Raw telemetry record representing transaction execution or gas usage data.
 */
export interface TelemetryRecord {
  readonly id?: string;
  readonly timestamp: string | Date;
  readonly amount?: string | number;
  readonly fee?: string | number;
  readonly gasUsed?: string | number;
  readonly success?: boolean;
  readonly status?: TransactionStatus | string;
  readonly asset?: string;
  readonly agentId?: string;
}

/**
 * Filter and windowing options for metric aggregation.
 */
export interface AggregationWindowOptions {
  /** Start of the aggregation time window (inclusive). */
  readonly from?: string | Date;
  /** End of the aggregation time window (inclusive). */
  readonly to?: string | Date;
  /** Optional filter by agent identifier. */
  readonly agentId?: string;
  /** Optional filter by asset code/string. */
  readonly asset?: string;
  /** Bucket interval granularity. Defaults to 'day'. */
  readonly granularity?: AggregateGranularity;
}

/**
 * Summary computed from telemetry records.
 */
export interface TelemetrySummary {
  /** Total transaction count evaluated. */
  readonly totalTransactions: number;
  /** Total count of successful transactions. */
  readonly successfulTransactions: number;
  /** Total count of failed transactions. */
  readonly failedTransactions: number;
  /** Success rate ratio between 0 and 1 (or 0 if no transactions). */
  readonly successRate: number;
  /** Total volume summed across transactions formatted as decimal string. */
  readonly totalVolume: string;
  /** Total fee expenditure summed across transactions formatted as decimal string. */
  readonly totalFees: string;
  /** Total gas / resource units used across transactions formatted as decimal string. */
  readonly totalGasUsed: string;
  /** Average execution fee per transaction formatted as decimal string. */
  readonly averageFee: string;
  /** Average transaction volume formatted as decimal string. */
  readonly averageVolume: string;
}

/* -------------------------------------------------------------------------- */
/* Pure Aggregation Helpers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Re-export core aggregation functions and types from aggregations.
 */
export {
  aggregateTransactionMetrics,
  aggregateTimeSeriesMetrics,
  type AggregateGranularity,
  type AggregateTelemetryOptions,
  type AggregatedTelemetry,
  type TransactionTelemetryBucket,
  type TimeSeriesResolution,
  type AggregateTimeSeriesOptions,
  type AggregatedTimeSeriesBucket,
  type AggregatedTimeSeriesResult,
  type TimeSeriesInputPoint,
  type TimeSeriesMetricsInput,
};

/**
 * Computes comprehensive summary metrics (volume, fees, success rate) from raw telemetry records.
 *
 * @param records Collection of telemetry records.
 * @param options Optional window and filtering parameters.
 * @returns Pure, deterministic summary object.
 */
export function computeTelemetrySummary(
  records: readonly TelemetryRecord[],
  options?: AggregationWindowOptions,
): TelemetrySummary {
  if (!records || records.length === 0) {
    return {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      successRate: 0,
      totalVolume: '0',
      totalFees: '0',
      totalGasUsed: '0',
      averageFee: '0',
      averageVolume: '0',
    };
  }

  const fromTime = options?.from ? new Date(options.from).getTime() : -Infinity;
  const toTime = options?.to ? new Date(options.to).getTime() : Infinity;

  let totalCount = 0;
  let successCount = 0;
  let failCount = 0;
  let volumeSum = 0;
  let feeSum = 0;
  let gasSum = 0;

  for (const rec of records) {
    const t = new Date(rec.timestamp).getTime();
    if (isNaN(t) || t < fromTime || t > toTime) {
      continue;
    }

    if (options?.agentId && rec.agentId && rec.agentId !== options.agentId) {
      continue;
    }

    if (options?.asset && rec.asset && rec.asset !== options.asset) {
      continue;
    }

    totalCount++;

    const isSuccess =
      rec.success !== undefined
        ? Boolean(rec.success)
        : rec.status
          ? rec.status === 'SUCCESS' || rec.status === 'success' || rec.status === 'CONFIRMED'
          : true;

    if (isSuccess) {
      successCount++;
    } else {
      failCount++;
    }

    const amt = typeof rec.amount === 'string' ? parseFloat(rec.amount) : (rec.amount ?? 0);
    if (!isNaN(amt)) {
      volumeSum += amt;
    }

    const fee = typeof rec.fee === 'string' ? parseFloat(rec.fee) : (rec.fee ?? 0);
    if (!isNaN(fee)) {
      feeSum += fee;
    }

    const gas = typeof rec.gasUsed === 'string' ? parseFloat(rec.gasUsed) : (rec.gasUsed ?? 0);
    if (!isNaN(gas)) {
      gasSum += gas;
    }
  }

  const successRate = totalCount > 0 ? successCount / totalCount : 0;
  const avgFee = totalCount > 0 ? (feeSum / totalCount).toFixed(7).replace(/\.?0+$/, '') || '0' : '0';
  const avgVol = totalCount > 0 ? (volumeSum / totalCount).toFixed(7).replace(/\.?0+$/, '') || '0' : '0';

  return {
    totalTransactions: totalCount,
    successfulTransactions: successCount,
    failedTransactions: failCount,
    successRate: Math.round(successRate * 10000) / 10000,
    totalVolume: volumeSum.toFixed(7).replace(/\.?0+$/, '') || '0',
    totalFees: feeSum.toFixed(7).replace(/\.?0+$/, '') || '0',
    totalGasUsed: gasSum.toFixed(7).replace(/\.?0+$/, '') || '0',
    averageFee: avgFee,
    averageVolume: avgVol,
  };
}

/**
 * Calculates rolling gas and fee expenditure totals over telemetry records.
 *
 * @param records Array of telemetry records.
 * @param options Optional windowing constraints.
 * @returns Total fee, gas used, and average fee.
 */
export function calculateExpenditures(
  records: readonly TelemetryRecord[],
  options?: AggregationWindowOptions,
): { totalFees: string; totalGasUsed: string; averageFee: string } {
  const summary = computeTelemetrySummary(records, options);
  return {
    totalFees: summary.totalFees,
    totalGasUsed: summary.totalGasUsed,
    averageFee: summary.averageFee,
  };
}

/**
 * Calculates overall transaction success rate (0 to 1).
 *
 * @param records Telemetry records.
 * @param options Optional windowing options.
 */
export function calculateSuccessRate(
  records: readonly TelemetryRecord[],
  options?: AggregationWindowOptions,
): number {
  return computeTelemetrySummary(records, options).successRate;
}
