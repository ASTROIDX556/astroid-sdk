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
  /** Failure rate ratio between 0 and 1 (or 0 if no transactions). */
  readonly failureRate: number;
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

interface DecimalTotal {
  coefficient: bigint;
  scale: number;
}

function parseDecimal(value: string | number): DecimalTotal | undefined {
  const text = String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return undefined;

  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return undefined;

  const fraction = match[3] ?? '';
  let scale = fraction.length - exponent;
  let coefficient = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${fraction}` || '0');
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function addDecimal(total: DecimalTotal, value: string | number): DecimalTotal {
  const parsed = parseDecimal(value);
  if (!parsed) return total;

  const scale = Math.max(total.scale, parsed.scale);
  return {
    coefficient:
      total.coefficient * 10n ** BigInt(scale - total.scale) +
      parsed.coefficient * 10n ** BigInt(scale - parsed.scale),
    scale,
  };
}

function formatDecimal(coefficient: bigint, scale: number): string {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
  }
  return `${negative ? '-' : ''}${digits || '0'}`;
}

function averageDecimal(total: DecimalTotal, count: number): string {
  if (count === 0) return '0';

  const outputScale = 7;
  const numerator = total.coefficient * 10n ** BigInt(outputScale);
  const denominator = 10n ** BigInt(total.scale) * BigInt(count);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  let quotient = absoluteNumerator / denominator;
  if ((absoluteNumerator % denominator) * 2n >= denominator) quotient++;
  return formatDecimal(numerator < 0n ? -quotient : quotient, outputScale);
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
      failureRate: 0,
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
  let volumeSum: DecimalTotal = { coefficient: 0n, scale: 0 };
  let feeSum: DecimalTotal = { coefficient: 0n, scale: 0 };
  let gasSum: DecimalTotal = { coefficient: 0n, scale: 0 };

  for (const rec of records) {
    const t = new Date(rec.timestamp).getTime();
    if (isNaN(t) || t < fromTime || t > toTime) {
      continue;
    }

    if (options?.agentId !== undefined && rec.agentId !== options.agentId) {
      continue;
    }

    if (options?.asset !== undefined && rec.asset !== options.asset) {
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

    volumeSum = addDecimal(volumeSum, rec.amount ?? 0);
    feeSum = addDecimal(feeSum, rec.fee ?? 0);
    gasSum = addDecimal(gasSum, rec.gasUsed ?? 0);
  }

  const successRate = totalCount > 0 ? successCount / totalCount : 0;
  const failureRate = totalCount > 0 ? failCount / totalCount : 0;

  return {
    totalTransactions: totalCount,
    successfulTransactions: successCount,
    failedTransactions: failCount,
    successRate: Math.round(successRate * 10000) / 10000,
    failureRate: Math.round(failureRate * 10000) / 10000,
    totalVolume: formatDecimal(volumeSum.coefficient, volumeSum.scale),
    totalFees: formatDecimal(feeSum.coefficient, feeSum.scale),
    totalGasUsed: formatDecimal(gasSum.coefficient, gasSum.scale),
    averageFee: averageDecimal(feeSum, totalCount),
    averageVolume: averageDecimal(volumeSum, totalCount),
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

/**
 * Calculates overall transaction failure rate (0 to 1).
 *
 * @param records Telemetry records.
 * @param options Optional windowing options.
 */
export function calculateFailureRate(
  records: readonly TelemetryRecord[],
  options?: AggregationWindowOptions,
): number {
  return computeTelemetrySummary(records, options).failureRate;
}
