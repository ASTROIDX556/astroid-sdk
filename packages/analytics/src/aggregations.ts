/**
 * `@astroid/analytics` — local analytical aggregation utilities.
 *
 * Pure, floating-point-free helpers that transform raw transaction feeds into
 * structured telemetry metrics (volume, fees, latency, success rates) grouped
 * by configurable time-bucket intervals (hourly, daily, weekly).
 *
 * No network or database access — every function is deterministic and safe to
 * call from both Node and browser runtimes.
 *
 * @module
 */

import type {
  AnalyticsMetricsResponse,
  AggregateTimeSeriesOptions,
  AggregatedTimeSeriesBucket,
  AggregatedTimeSeriesResult,
  TimeSeriesDataPoint,
  TimeSeriesDataResponse,
  TimeSeriesMetricPoint,
  TimeSeriesPoint,
  TimeSeriesResolution,
  Transaction,
  TransactionStatus,
  VolumeSummary,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Supported UTC bucket granularities. */
export type AggregateGranularity = 'hour' | 'day' | 'week';

export type {
  TimeSeriesResolution,
  AggregateTimeSeriesOptions,
  AggregatedTimeSeriesBucket,
  AggregatedTimeSeriesResult,
};

/**
 * Raw point or DTO shape that can be processed by {@link aggregateTimeSeriesMetrics}.
 */
export type TimeSeriesInputPoint =
  | TimeSeriesMetricPoint
  | TimeSeriesDataPoint
  | TimeSeriesPoint
  | {
      timestamp?: string | Date;
      date?: string | Date;
      createdAt?: string | Date;
      volume?: string | number;
      amount?: string | number;
      value?: number | string;
      fee?: string | number;
      gasEstimate?: string | number;
      count?: number;
      transactionCount?: number;
      successCount?: number;
      failureCount?: number;
      status?: string;
    };

/**
 * Valid input accepted by {@link aggregateTimeSeriesMetrics}.
 *
 * Can be an array of points, an {@link AnalyticsMetricsResponse}, a
 * {@link TimeSeriesDataResponse}, or `null`/`undefined`.
 */
export type TimeSeriesMetricsInput =
  | readonly TimeSeriesInputPoint[]
  | AnalyticsMetricsResponse
  | TimeSeriesDataResponse
  | { trend: readonly TimeSeriesPoint[] }
  | null
  | undefined;

/** Configuration for {@link aggregateTransactionMetrics}. */
export interface AggregateTelemetryOptions {
  /** Bucket size in UTC. Defaults to `'day'`. */
  granularity?: AggregateGranularity;
  /** Which timestamp field to bucket on. Defaults to `'createdAt'`. */
  timestampField?: 'createdAt' | 'updatedAt';
}

/** Statistics for a single time-bucket window. */
export interface TransactionTelemetryBucket {
  /** ISO-8601 start of the bucket (inclusive). */
  start: string;
  /** ISO-8601 end of the bucket (exclusive). */
  end: string;
  /** Sum of transaction amounts in this bucket (decimal string). */
  totalVolume: string;
  /** Sum of fees (gasEstimate) in this bucket (decimal string). */
  totalFees: string;
  /** Mean latency (updatedAt − createdAt) in milliseconds for resolved txns. */
  averageLatencyMs: number;
  /** Transactions with a terminal success status. */
  successCount: number;
  /** Transactions with a terminal failure status. */
  failureCount: number;
  /** Total transactions in this bucket. */
  totalCount: number;
  /** `successCount / (successCount + failureCount)`, or `0` when neither exists. */
  successRate: number;
}

/** Aggregate totals across all buckets plus the per-bucket breakdown. */
export interface AggregatedTelemetry {
  /** The granularity used for bucketing. */
  granularity: AggregateGranularity;
  /** Sum of all transaction amounts across every bucket (decimal string). */
  totalVolume: string;
  /** Sum of all fees across every bucket (decimal string). */
  totalFees: string;
  /** Global mean latency in milliseconds for resolved transactions. */
  averageLatencyMs: number;
  /** Total successful transactions across all buckets. */
  successCount: number;
  /** Total failed transactions across all buckets. */
  failureCount: number;
  /** Total transactions processed. */
  totalCount: number;
  /** Global success rate: `successCount / (successCount + failureCount)`. */
  successRate: number;
  /** Per-bucket breakdown, sorted chronologically by `start`. */
  buckets: TransactionTelemetryBucket[];
}

/* -------------------------------------------------------------------------- */
/* Internal helpers — decimal-string arithmetic (no floating-point)            */
/* -------------------------------------------------------------------------- */

type Decimal = { n: bigint; scale: number };

/** Parse a decimal string or number into a `Decimal` (integer numerator + scale). */
function parseDecimal(value: string | number): Decimal {
  const text = String(value).trim();
  const sign = text.startsWith('-') ? -1n : 1n;
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return { n: sign * BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
}

/** Align two `Decimal` values to the same scale and return their BigInt numerators. */
function alignDecimals(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * 10n ** BigInt(scale - a.scale), b.n * 10n ** BigInt(scale - b.scale), scale];
}

/** Add two decimal strings, returning a decimal string. */
function decAdd(a: string, b: string): string {
  const da = parseDecimal(a);
  const db = parseDecimal(b);
  const [x, y, scale] = alignDecimals(da, db);
  return formatDecimal({ n: x + y, scale });
}

/** Sum an array of decimal strings. */
function decSum(values: string[]): string {
  return values.reduce(decAdd, '0');
}

/** Format a `Decimal` back to a human-readable string (no trailing zeros in fraction). */
function formatDecimal(value: Decimal): string {
  const negative = value.n < 0n;
  let digits = (negative ? -value.n : value.n).toString().padStart(value.scale + 1, '0');
  if (value.scale) {
    digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(
      /\.0+$|(?<=\.[0-9]*?)0+$/,
      '',
    );
  }
  return `${negative ? '-' : ''}${digits || '0'}`;
}

/* -------------------------------------------------------------------------- */
/* Bucketing helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Terminal success statuses. */
const SUCCESS_STATUSES: ReadonlySet<TransactionStatus> = new Set(['COMPLETED', 'CONFIRMED']);

/** Terminal failure statuses. */
const FAILURE_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);

/** Snap a Date to the start of its UTC bucket. */
function bucketStart(date: Date, granularity: AggregateGranularity): Date {
  const d = new Date(date);
  if (granularity === 'hour') {
    d.setUTCMinutes(0, 0, 0);
  } else if (granularity === 'day') {
    d.setUTCHours(0, 0, 0, 0);
  } else {
    // week — snap to Monday 00:00 UTC
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  }
  return d;
}

/** Return the ISO-8601 date at the end (exclusive) of a bucket. */
function bucketEnd(start: Date, granularity: AggregateGranularity): Date {
  const d = new Date(start);
  if (granularity === 'hour') {
    d.setUTCHours(d.getUTCHours() + 1);
  } else if (granularity === 'day') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return d;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Compute telemetry summary metrics from a list of transactions, grouped by
 * the requested time-bucket interval.
 *
 * The function performs a single pass over the input array, buckets each
 * transaction by its timestamp, and aggregates:
 *
 * - **Volume** — sum of `transaction.amount` (decimal-string, no precision loss).
 * - **Fees** — sum of `transaction.gasEstimate` (falls back to `"0"` when absent).
 * - **Latency** — `updatedAt − createdAt` in milliseconds (averaged per bucket).
 * - **Success rate** — `COMPLETED` / `CONFIRMED` vs `FAILED` / `REJECTED` /
 *   `CANCELLED` / `EXPIRED`. Pending / in-progress statuses are excluded from
 *   the rate denominator.
 *
 * Buckets are returned sorted chronologically by their start timestamp.
 *
 * @param history  Array of `Transaction` objects to process.
 * @param options  Bucket granularity and timestamp field selector.
 * @returns        An {@link AggregatedTelemetry} object ready for dashboard consumption.
 *
 * @example
 * ```ts
 * import { aggregateTransactionMetrics } from '@astroid/analytics/aggregations';
 *
 * const metrics = aggregateTransactionMetrics(transactions, {
 *   granularity: 'day',
 *   timestampField: 'createdAt',
 * });
 * console.log(metrics.totalVolume);   // "12500.75"
 * console.log(metrics.successRate);   // 0.94
 * ```
 */
export function aggregateTransactionMetrics(
  history: Transaction[],
  options: AggregateTelemetryOptions = {},
): AggregatedTelemetry {
  const granularity = options.granularity ?? 'day';
  const timestampField = options.timestampField ?? 'createdAt';

  // --- Bucket groupings: key → accumulator ---
  interface BucketAccumulator {
    start: Date;
    volumeParts: string[];
    feeParts: string[];
    latenciesMs: number[];
    successCount: number;
    failureCount: number;
    totalCount: number;
  }

  const buckets = new Map<string, BucketAccumulator>();

  for (const tx of history) {
    const raw = new Date(tx[timestampField]);
    if (Number.isNaN(raw.getTime())) continue;

    const start = bucketStart(raw, granularity);
    const key = start.toISOString();

    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        start,
        volumeParts: [],
        feeParts: [],
        latenciesMs: [],
        successCount: 0,
        failureCount: 0,
        totalCount: 0,
      };
      buckets.set(key, acc);
    }

    acc.totalCount += 1;
    acc.volumeParts.push(tx.amount);
    acc.feeParts.push(tx.gasEstimate ?? '0');

    // Latency: difference between updatedAt and createdAt in milliseconds.
    const created = new Date(tx.createdAt).getTime();
    const updated = new Date(tx.updatedAt).getTime();
    if (!Number.isNaN(created) && !Number.isNaN(updated)) {
      acc.latenciesMs.push(updated - created);
    }

    if (SUCCESS_STATUSES.has(tx.status)) {
      acc.successCount += 1;
    } else if (FAILURE_STATUSES.has(tx.status)) {
      acc.failureCount += 1;
    }
  }

  // --- Build sorted bucket results ---
  const sortedKeys = [...buckets.keys()].sort();
  const bucketResults: TransactionTelemetryBucket[] = sortedKeys.map((key) => {
    const acc = buckets.get(key)!;
    const end = bucketEnd(acc.start, granularity);
    const resolved = acc.successCount + acc.failureCount;
    const avgLatency =
      acc.latenciesMs.length > 0
        ? acc.latenciesMs.reduce((sum, v) => sum + v, 0) / acc.latenciesMs.length
        : 0;

    return {
      start: acc.start.toISOString(),
      end: end.toISOString(),
      totalVolume: decSum(acc.volumeParts),
      totalFees: decSum(acc.feeParts),
      averageLatencyMs: avgLatency,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      totalCount: acc.totalCount,
      successRate: resolved > 0 ? acc.successCount / resolved : 0,
    };
  });

  // --- Global aggregates ---
  const totalVolume = decSum(bucketResults.map((b) => b.totalVolume));
  const totalFees = decSum(bucketResults.map((b) => b.totalFees));
  const totalSuccess = bucketResults.reduce((s, b) => s + b.successCount, 0);
  const totalFailure = bucketResults.reduce((s, b) => s + b.failureCount, 0);
  const totalCount = bucketResults.reduce((s, b) => s + b.totalCount, 0);
  const totalResolved = totalSuccess + totalFailure;

  // Global average latency: recompute from all latencies across buckets.
  const allLatencies: number[] = [];
  for (const key of sortedKeys) {
    const acc = buckets.get(key)!;
    for (const ms of acc.latenciesMs) allLatencies.push(ms);
  }
  const globalAvgLatency =
    allLatencies.length > 0 ? allLatencies.reduce((sum, v) => sum + v, 0) / allLatencies.length : 0;

  return {
    granularity,
    totalVolume,
    totalFees,
    averageLatencyMs: globalAvgLatency,
    successCount: totalSuccess,
    failureCount: totalFailure,
    totalCount,
    successRate: totalResolved > 0 ? totalSuccess / totalResolved : 0,
    buckets: bucketResults,
  };
}

/* -------------------------------------------------------------------------- */
/* Time-series metrics aggregation (issue #442)                                */
/* -------------------------------------------------------------------------- */

/**
 * Normalise a user-provided interval string to standard UTC bucket granularity.
 */
function normalizeInterval(interval?: TimeSeriesResolution): AggregateGranularity {
  switch (interval) {
    case 'hour':
    case 'hourly':
      return 'hour';
    case 'week':
    case 'weekly':
      return 'week';
    case 'day':
    case 'daily':
    default:
      return 'day';
  }
}

/** Left-pad a single-digit integer with leading zero. */
function padZero(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Default human-friendly date formatter for chart labels. */
function defaultFormatDate(date: Date, granularity: AggregateGranularity): string {
  const y = date.getUTCFullYear();
  const m = padZero(date.getUTCMonth() + 1);
  const d = padZero(date.getUTCDate());
  if (granularity === 'hour') {
    const h = padZero(date.getUTCHours());
    return `${y}-${m}-${d} ${h}:00`;
  }
  return `${y}-${m}-${d}`;
}

/** Safely extract an array of point items from diverse input formats. */
function extractPoints(input: TimeSeriesMetricsInput): readonly TimeSeriesInputPoint[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if ('points' in input && Array.isArray(input.points)) {
    return input.points as readonly TimeSeriesInputPoint[];
  }
  if ('trend' in input && Array.isArray((input as { trend: unknown[] }).trend)) {
    return (input as { trend: TimeSeriesInputPoint[] }).trend;
  }
  return [];
}

interface ParsedMetricPoint {
  date: Date;
  volume: string;
  fee: string;
  count: number;
  successCount: number;
  failureCount: number;
}

/** Extract normalized timestamp, volume, fee, and counts from an input item. */
function parsePoint(item: TimeSeriesInputPoint): ParsedMetricPoint | undefined {
  if (!item || typeof item !== 'object') return undefined;

  // 1. Timestamp resolution
  const rawTimestamp =
    'timestamp' in item && item.timestamp !== undefined
      ? item.timestamp
      : 'date' in item && item.date !== undefined
        ? item.date
        : 'createdAt' in item && item.createdAt !== undefined
          ? item.createdAt
          : undefined;

  if (rawTimestamp === undefined) return undefined;
  const date = rawTimestamp instanceof Date ? rawTimestamp : new Date(rawTimestamp);
  if (Number.isNaN(date.getTime())) return undefined;

  // 2. Volume resolution
  let volume = '0';
  if ('volume' in item && item.volume !== undefined && item.volume !== null) {
    volume = String(item.volume).trim();
  } else if ('amount' in item && item.amount !== undefined && item.amount !== null) {
    volume = String(item.amount).trim();
  } else if ('value' in item && item.value !== undefined && item.value !== null) {
    volume = String(item.value).trim();
  }
  if (!volume || volume === 'NaN') volume = '0';

  // 3. Fee resolution
  let fee = '0';
  if ('fee' in item && item.fee !== undefined && item.fee !== null) {
    fee = String(item.fee).trim();
  } else if ('gasEstimate' in item && item.gasEstimate !== undefined && item.gasEstimate !== null) {
    fee = String(item.gasEstimate).trim();
  }
  if (!fee || fee === 'NaN') fee = '0';

  // 4. Count resolution
  let count = 1;
  if ('count' in item && typeof item.count === 'number' && !Number.isNaN(item.count)) {
    count = item.count;
  } else if (
    'transactionCount' in item &&
    typeof item.transactionCount === 'number' &&
    !Number.isNaN(item.transactionCount)
  ) {
    count = item.transactionCount;
  }

  // 5. Success / Failure counts
  let successCount = 0;
  let failureCount = 0;
  if ('successCount' in item && typeof item.successCount === 'number' && !Number.isNaN(item.successCount)) {
    successCount = item.successCount;
  }
  if ('failureCount' in item && typeof item.failureCount === 'number' && !Number.isNaN(item.failureCount)) {
    failureCount = item.failureCount;
  }

  if (
    !('successCount' in item) &&
    !('failureCount' in item) &&
    'status' in item &&
    typeof item.status === 'string'
  ) {
    const status = item.status as TransactionStatus;
    if (SUCCESS_STATUSES.has(status)) {
      successCount = 1;
    } else if (FAILURE_STATUSES.has(status)) {
      failureCount = 1;
    }
  }

  return {
    date,
    volume,
    fee,
    count,
    successCount,
    failureCount,
  };
}

interface MetricBucketAccumulator {
  start: Date;
  volumeParts: string[];
  feeParts: string[];
  count: number;
  successCount: number;
  failureCount: number;
}

/** Format an accumulated bucket into an AggregatedTimeSeriesBucket. */
function accumulatorToBucket(
  acc: MetricBucketAccumulator,
  granularity: AggregateGranularity,
  customFormatDate?: (date: Date, interval: AggregateGranularity) => string,
): AggregatedTimeSeriesBucket {
  const end = bucketEnd(acc.start, granularity);
  const volume = decSum(acc.volumeParts);
  const fee = decSum(acc.feeParts);
  const resolved = acc.successCount + acc.failureCount;
  const successRate = resolved > 0 ? acc.successCount / resolved : 0;
  const volumeNumeric = parseFloat(volume) || 0;
  const feeNumeric = parseFloat(fee) || 0;
  const formattedDate = customFormatDate
    ? customFormatDate(acc.start, granularity)
    : defaultFormatDate(acc.start, granularity);
  const isoDate = acc.start.toISOString().slice(0, 10);

  return {
    timestamp: acc.start.toISOString(),
    endTimestamp: end.toISOString(),
    volume,
    fee,
    count: acc.count,
    successCount: acc.successCount,
    failureCount: acc.failureCount,
    successRate,
    volumeNumeric,
    feeNumeric,
    formattedDate,
    date: isoDate,
    value: volumeNumeric,
  };
}

/** Construct an empty zero-value bucket for a missing interval period. */
function createZeroBucket(
  start: Date,
  granularity: AggregateGranularity,
  customFormatDate?: (date: Date, interval: AggregateGranularity) => string,
): AggregatedTimeSeriesBucket {
  const end = bucketEnd(start, granularity);
  const formattedDate = customFormatDate
    ? customFormatDate(start, granularity)
    : defaultFormatDate(start, granularity);
  const isoDate = start.toISOString().slice(0, 10);

  return {
    timestamp: start.toISOString(),
    endTimestamp: end.toISOString(),
    volume: '0',
    fee: '0',
    count: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    volumeNumeric: 0,
    feeNumeric: 0,
    formattedDate,
    date: isoDate,
    value: 0,
  };
}

/**
 * Aggregate and format raw time-series metrics into hourly, daily, or weekly
 * buckets for charting and reporting.
 *
 * Operates on raw analytics DTOs from `@astroid/types` (such as
 * {@link AnalyticsMetricsResponse}, {@link TimeSeriesMetricPoint} arrays, or
 * {@link TimeSeriesDataResponse}). Data points within the same interval are
 * combined using exact decimal-string arithmetic for monetary totals (volume,
 * fees) and counts.
 *
 * Missing time buckets can be automatically populated with zero-values via the
 * `zeroFill` option.
 *
 * The return value extends `Array<AggregatedTimeSeriesBucket>` and satisfies
 * standard array operations (mapping, filtering, indexing) while also attaching
 * summary statistics and metadata.
 *
 * @param input Raw time-series points or response DTO.
 * @param options Configuration for interval resolution, zero-filling, and date boundaries.
 * @returns An {@link AggregatedTimeSeriesResult} array of formatted buckets with summary totals.
 *
 * @example
 * ```ts
 * import { aggregateTimeSeriesMetrics } from '@astroid/analytics';
 *
 * const report = aggregateTimeSeriesMetrics(response, {
 *   interval: 'hourly',
 *   zeroFill: true,
 *   startDate: '2026-01-01T00:00:00.000Z',
 *   endDate: '2026-01-01T23:59:59.999Z',
 * });
 *
 * console.log(report.totalVolume); // "15200.50"
 * console.log(report.points.length); // 24
 * console.log(report[0].formattedDate); // "2026-01-01 00:00"
 * ```
 */
export function aggregateTimeSeriesMetrics(
  input: TimeSeriesMetricsInput,
  options: AggregateTimeSeriesOptions = {},
): AggregatedTimeSeriesResult {
  const granularity = normalizeInterval(options.interval);
  const rawPoints = extractPoints(input);

  const rawStart = options.startDate ?? options.startTime ?? options.from;
  const rawEnd = options.endDate ?? options.endTime ?? options.to;
  const startDate = rawStart ? new Date(rawStart) : undefined;
  const endDate = rawEnd ? new Date(rawEnd) : undefined;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
  const validEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;

  const bucketsMap = new Map<string, MetricBucketAccumulator>();

  for (const raw of rawPoints) {
    const parsed = parsePoint(raw);
    if (!parsed) continue;

    // Filter by window if explicit bounds are provided
    if (validStart && parsed.date.getTime() < validStart.getTime()) continue;
    if (validEnd && parsed.date.getTime() >= validEnd.getTime()) continue;

    const start = bucketStart(parsed.date, granularity);
    const key = start.toISOString();

    let acc = bucketsMap.get(key);
    if (!acc) {
      acc = {
        start,
        volumeParts: [],
        feeParts: [],
        count: 0,
        successCount: 0,
        failureCount: 0,
      };
      bucketsMap.set(key, acc);
    }

    acc.volumeParts.push(parsed.volume);
    acc.feeParts.push(parsed.fee);
    acc.count += parsed.count;
    acc.successCount += parsed.successCount;
    acc.failureCount += parsed.failureCount;
  }

  const sortedKeys = [...bucketsMap.keys()].sort();
  const results: AggregatedTimeSeriesBucket[] = [];

  if (options.zeroFill) {
    if (sortedKeys.length === 0) {
      // Empty data set: if valid bounds are provided, generate zero-filled buckets across the window
      if (validStart && validEnd && validStart.getTime() < validEnd.getTime()) {
        let curr = bucketStart(validStart, granularity);
        const endLimit = validEnd.getTime();
        while (curr.getTime() < endLimit) {
          results.push(createZeroBucket(curr, granularity, options.formatDate));
          curr = bucketEnd(curr, granularity);
        }
      }
    } else {
      // Non-empty data set: step through every bucket from start to end
      const earliestDataStart = bucketsMap.get(sortedKeys[0]!)!.start;
      const latestDataStart = bucketsMap.get(sortedKeys[sortedKeys.length - 1]!)!.start;

      const rangeStart =
        validStart && validStart.getTime() < earliestDataStart.getTime()
          ? bucketStart(validStart, granularity)
          : earliestDataStart;

      const rangeEndExclusive = validEnd
        ? validEnd
        : bucketEnd(latestDataStart, granularity);

      let curr = rangeStart;
      while (curr.getTime() < rangeEndExclusive.getTime()) {
        const key = curr.toISOString();
        const existing = bucketsMap.get(key);
        if (existing) {
          results.push(accumulatorToBucket(existing, granularity, options.formatDate));
        } else {
          results.push(createZeroBucket(curr, granularity, options.formatDate));
        }
        curr = bucketEnd(curr, granularity);
      }
    }
  } else {
    // Zero-filling disabled: return only non-empty buckets sorted chronologically
    for (const key of sortedKeys) {
      const acc = bucketsMap.get(key)!;
      results.push(accumulatorToBucket(acc, granularity, options.formatDate));
    }
  }

  const totalVolume = decSum(results.map((b) => b.volume));
  const totalFees = decSum(results.map((b) => b.fee));
  const totalCount = results.reduce((sum, b) => sum + b.count, 0);
  const totalSuccess = results.reduce((sum, b) => sum + b.successCount, 0);
  const totalFailure = results.reduce((sum, b) => sum + b.failureCount, 0);
  const totalResolved = totalSuccess + totalFailure;
  const globalSuccessRate = totalResolved > 0 ? totalSuccess / totalResolved : 0;

  const summary: VolumeSummary = {
    timeframe: granularity,
    totalVolume,
    totalFees,
    transactionCount: totalCount,
    successRate: globalSuccessRate,
    averageLatencyMs: 0,
  };

  const resolution = options.interval ?? 'day';

  return Object.assign(results, {
    interval: granularity,
    resolution,
    points: results,
    buckets: results,
    summary,
    totalVolume,
    totalFees,
    totalCount,
    successCount: totalSuccess,
    failureCount: totalFailure,
    successRate: globalSuccessRate,
  }) as AggregatedTimeSeriesResult;
}

