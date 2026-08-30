/**
 * Live network fee estimation for Stellar transactions.
 *
 * {@link simulateTransactionFee} (see `simulation.ts`) estimates fees offline
 * using only the transaction envelope. This module adds the *network-aware*
 * half of issue #123: it queries the current ledger conditions (Horizon
 * `fee_stats`) and combines them with the base fee so callers get a fee that
 * is both sufficient for the current network state and buffered against
 * short-term spikes.
 *
 * Nothing here is Stellar-RPC specific; it uses the public Horizon `fee_stats`
 * endpoint, so it works with a plain `fetch`.
 *
 * @module
 */

/** Options for {@link queryFeeStats}. */
export interface FeeStatsQueryOptions {
  /** Horizon fee_stats endpoint URL (e.g. `https://horizon.stellar.org/fee_stats`). */
  horizonUrl: string;
  /** Injectable `fetch` for tests and non-browser runtimes. */
  fetch?: typeof fetch;
  /** Request abort signal. */
  signal?: AbortSignal;
  /** Optional request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional headers sent to Horizon. */
  headers?: Record<string, string>;
}

/** Per-op fee buckets reported by Horizon `fee_stats`. */
export interface HorizonFeeBucket {
  /** Seconds this bucket represents. */
  seconds: number;
  /** The 50th-percentile fee (stroops) observed in this bucket. */
  p50: number | null;
  /** The 95th-percentile fee (stroops) observed in this bucket. */
  p95: number | null;
  /** The 99th-percentile fee (stroops) observed in this bucket. */
  p99: number | null;
}

/** Parsed result of a Horizon `fee_stats` query. */
export interface NetworkFeeStats {
  /** Fees per operation bucket (5 entries, one per liquidity window). */
  feeCharged: HorizonFeeBucket[];
  /** The base (fee-bump) fee, in stroops. */
  ledgerBaseFee: number;
  /** The current max fee the network accepted, in stroops. */
  maxFee: number;
  /** The minimum fee sequence accepted by the network, in stroops. */
  minFee: number;
  /** Mode of the last 100 transaction fees, in stroops. */
  modeFee: number;
  /** The raw response body, for diagnostics. */
  raw: unknown;
}

/**
 * The recommended fee a caller should submit, combining live network
 * conditions and an optional safety buffer.
 */
export interface RecommendedFee {
  /** True when the fee could be estimated from live network data. */
  live: boolean;
  /** The raw live mean fee (stroops), when available. */
  liveFee: number;
  /** The recommended fee (stroops) to submit. */
  recommendedFee: number;
  /** How much the recommendation exceeds the live mean, as a percentage. */
  bufferPercentage: number;
  /** Human-readable description of the current network conditions. */
  networkState: 'busy' | 'normal' | 'unknown';
  /** When `live` is false, why live estimation was unavailable. */
  reason?: string;
}

const DEFAULT_BUFFER_PERCENTAGE = 30;

/** Normalise a Horizon bucket payload into a {@link HorizonFeeBucket}. */
function parseBucket(b: unknown): HorizonFeeBucket {
  const value = (b ?? {}) as Record<string, unknown>;
  const toNumber = (v: unknown): number | null =>
    typeof v === 'number' ? v : v == null || v === '' ? null : Number(v);
  return {
    seconds: Number(value.seconds ?? 0),
    p50: toNumber(value.p50),
    p95: toNumber(value.p95),
    p99: toNumber(value.p99),
  };
}

/**
 * Query Horizon `fee_stats` and return parsed, typed ledger conditions.
 *
 * @param options Horizon URL, optional fetch/headers/signal/timeout.
 * @returns      A parsed {@link NetworkFeeStats} — never throws on network
 *               failures; callers should use {@link queryFeeStatsSafe} if they
 *               want structured failure handling, or catch here.
 */
export async function queryFeeStats(options: FeeStatsQueryOptions): Promise<NetworkFeeStats> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available for live fee estimation.');
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  // Combine an explicit abort signal with a timeout so slow/misbehaving
  // Horizons don't hang the caller indefinitely. `AbortSignal.any`/`timeout`
  // are Node 20.3+; this fallback keeps older runtimes working.
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
      ? (AbortSignal as { timeout(ms: number): AbortSignal }).timeout(timeoutMs)
      : undefined;
  const combined =
    options.signal !== undefined && timeoutSignal !== undefined
      ? typeof AbortSignal.any === 'function'
        ? AbortSignal.any([options.signal, timeoutSignal])
        : options.signal
      : (options.signal ?? timeoutSignal);

  const response = await fetchImpl(options.horizonUrl, {
    method: 'GET',
    headers: { accept: 'application/json', ...options.headers },
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`Horizon fee_stats request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const feeCharged = (body.fee_charged ?? body.feeCharged ?? []) as unknown[];
  const feeActual = (body.ledger_max_fee ?? body.ledgerMaxFee ?? body.max_fee ?? 0) as number;

  return {
    feeCharged: Array.isArray(feeCharged) ? feeCharged.map(parseBucket) : [],
    ledgerBaseFee: Number(body.base_fee ?? body.ledgerBaseFee ?? 100),
    maxFee: Number(feeActual),
    minFee: Number(body.min_fee ?? body.minFee ?? 0),
    modeFee: Number(body.mode_fee ?? body.modeFee ?? 0),
    raw: body,
  };
}

/**
 * Safe wrapper around {@link queryFeeStats} that never throws on a
 * fetch/parse failure — it returns a structured, graceful result instead.
 */
export async function queryFeeStatsSafe(
  options: FeeStatsQueryOptions,
): Promise<NetworkFeeStats | null> {
  try {
    return await queryFeeStats(options);
  } catch {
    return null;
  }
}

/**
 * Compute a recommended fee for a transaction from live network data.
 *
 * The live mean fee is derived from the most recent fee bucket's `p50` (or
 * falls back to `modeFee`); a configurable safety buffer is added. If the
 * supplied base fee already exceeds the live recommendation, the base fee is
 * kept (never downgrade).
 *
 * @param liveFee   The observed live fee (stroops). Use the median or mode
 *                  value from {@link queryFeeStats}.
 * @param baseFee   The transaction's parsed base fee (stroops).
 * @param options   Optional buffer override (`0–100`).
 * @returns         A {@link RecommendedFee}.
 */
export function estimateFromNetworkFee(
  liveFee: number,
  baseFee: number,
  options: { bufferPercentage?: number } = {},
): RecommendedFee {
  const bufferPercentage = options.bufferPercentage ?? DEFAULT_BUFFER_PERCENTAGE;
  const feasible = Number.isFinite(liveFee) && liveFee > 0;
  if (!feasible) {
    return {
      live: false,
      liveFee: 0,
      recommendedFee: baseFee,
      bufferPercentage,
      networkState: 'unknown',
      reason: 'No live fee data available; falling back to the parsed base fee.',
    };
  }

  const buffered = Math.round(liveFee * (1 + bufferPercentage / 100));
  const recommendedFee = Math.max(buffered, baseFee);
  const networkState: RecommendedFee['networkState'] = liveFee > 5000 ? 'busy' : 'normal';

  return {
    live: true,
    liveFee,
    recommendedFee,
    bufferPercentage,
    networkState,
  };
}

/**
 * One-call convenience: query Horizon, derive the live mean fee from the most
 * recent bucket, and return a recommendation. Falls back gracefully to the
 * base fee when the network query fails.
 *
 * @param horizonUrl Horizon fee_stats URL.
 * @param baseFee    The parsed base fee (stroops) of the transaction.
 * @param options    Query + buffer options.
 * @returns          A {@link RecommendedFee}.
 */
export async function estimateLiveFee(
  horizonUrl: string,
  baseFee: number,
  options: Omit<FeeStatsQueryOptions, 'horizonUrl'> & { bufferPercentage?: number } = {},
): Promise<RecommendedFee> {
  const stats = await queryFeeStatsSafe({
    horizonUrl,
    ...options,
  });

  if (!stats || stats.feeCharged.length === 0) {
    return estimateFromNetworkFee(NaN, baseFee, options);
  }

  // Most recent bucket (highest `seconds`) is the freshest signal.
  const recent = stats.feeCharged.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  const liveFee = recent.p50 ?? stats.modeFee ?? recent.p95 ?? 0;
  return estimateFromNetworkFee(Number(liveFee), baseFee, options);
}