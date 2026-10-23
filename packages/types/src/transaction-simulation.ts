/**
 * Transaction simulation and fee-estimation contracts shared by
 * `@astroid/transaction` and API consumers.
 *
 * These types describe the structured result of the two pre-flight helpers the
 * transaction package exposes — {@link TransactionFeeEstimate} for fee bidding
 * and {@link TransactionSimulationOutcome} for execution viability — so callers
 * can reason about a transaction *before* it is broadcast, whether the estimate
 * came from local envelope decoding or a live Horizon / Astroid API round-trip.
 *
 * @module
 */

/**
 * Congestion classification derived from live Horizon fee statistics.
 *
 * - `normal`    — the live fee is at or near the network base fee.
 * - `busy`      — the live fee is more than 2× the base fee.
 * - `congested` — the live fee is extremely high (≥ 5000 stroops).
 * - `unknown`   — no live sample was available (offline / query failed).
 */
export type StellarNetworkState = 'normal' | 'busy' | 'congested' | 'unknown';

/** Machine-readable reason a simulated transaction was deemed non-viable. */
export type TransactionSimulationErrorCode =
  | 'INVALID_ENVELOPE'
  | 'ZERO_OR_NEGATIVE_FEE'
  | 'FEE_BELOW_MINIMUM'
  | 'FEE_TOO_HIGH'
  | 'FEE_BUMP_REQUIRED'
  | 'NO_OPERATIONS'
  | 'VALIDATION_FAILED'
  | 'SIMULATION_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK_ERROR';

/**
 * Estimated on-chain resource consumption reported for a simulated
 * (Soroban) transaction.
 *
 * Every field is optional: the simulation API reports each metric only when the
 * corresponding ledger data is available, and consumers must not fabricate
 * values for missing fields.
 */
export interface TransactionResourceEstimate {
  /** Estimated CPU instructions the invocation consumes. */
  cpuInstructions?: number;
  /** Estimated memory the invocation consumes, in bytes. */
  memoryBytes?: number;
  /** Total ledger read bytes. */
  readBytes?: number;
  /** Total ledger write bytes. */
  writeBytes?: number;
  /** Number of ledger read entries. */
  readEntries?: number;
  /** Number of ledger write entries. */
  writeEntries?: number;
  /** The Soroban resource fee the simulation charged, in stroops. */
  resourceFee?: number;
  /** Size of the transaction envelope, in bytes. */
  transactionSizeBytes?: number;
}

/**
 * A transaction envelope accepted by the estimators: a base64 XDR string or any
 * object that can serialise itself to one (e.g. a built `Transaction`).
 *
 * Kept structural so `@astroid/types` stays free of a `@stellar/stellar-base`
 * dependency.
 */
export type TransactionEnvelopeLike = string | { toXDR(): string };

/**
 * Ledger-side execution status for a simulated transaction, mirroring the
 * Stellar protocol's transaction outcome taxonomy.
 */
export type TransactionSimulationStatus = 'success' | 'failed' | 'fee_bump_required';

/* -------------------------------------------------------------------------- */
/* Fee estimation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Options for the `estimateFee` helper.
 *
 * Supply either a `transaction` envelope (from which the operation count and
 * current fee bid are read) or an explicit `operationCount`. When `horizonUrl`
 * (or a custom `fetch`) is provided the estimator also samples live network fee
 * statistics; otherwise it falls back to the static base fee.
 */
export interface TransactionFeeEstimateOptions {
  /** Unsigned transaction envelope to estimate for. */
  transaction?: TransactionEnvelopeLike;
  /** Explicit operation count, used when no `transaction` is supplied. */
  operationCount?: number;
  /** Per-operation base fee in stroops. Defaults to the network minimum (100). */
  baseFee?: number;
  /** Safety buffer added on top of the live fee, as a percentage. Defaults to 30. */
  bufferPercentage?: number;
  /** Horizon endpoint used to sample live fee stats. */
  horizonUrl?: string;
  /** Network passphrase used to decode an XDR envelope. Defaults to public. */
  networkPassphrase?: string;
  /** Custom fetch implementation (proxies, tests). */
  fetch?: typeof fetch;
}

/**
 * A structured fee estimate: the minimum fee the network will accept, the
 * recommended bid including a safety buffer, and the congestion context.
 */
export interface TransactionFeeEstimate {
  /** Number of operations the fee covers (always ≥ 1). */
  operationCount: number;
  /** Per-operation base fee in stroops (network minimum or supplied value). */
  baseFee: number;
  /** Total minimum fee in stroops (`operationCount × baseFee`). */
  minFee: number;
  /** Recommended per-operation fee in stroops (buffered live fee or base fee). */
  recommendedBaseFee: number;
  /** Recommended total fee in stroops, including the safety buffer. */
  recommendedFee: number;
  /** Applied buffer percentage, e.g. `30` for a +30% bid. */
  bufferPercentage: number;
  /** Network congestion classification. */
  networkState: StellarNetworkState;
  /** Whether a live Horizon fee sample informed this estimate. */
  live: boolean;
  /** Base64 XDR the estimate was computed for, when one was supplied. */
  transactionXdr?: string;
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Minimal HTTP client surface needed for remote simulation.
 *
 * Matches the shape of `@astroid/core`'s `HttpClient`, so callers can pass
 * `astroid.http` directly without `@astroid/types` depending on core.
 */
export interface SimulateTransactionClient {
  post<T>(path: string, body?: unknown): Promise<{ data: T }>;
}

/** Options for the `simulateTransaction` helper. */
export interface TransactionSimulationOptions {
  /** Network passphrase used to decode the envelope. Defaults to public. */
  networkPassphrase?: string;
  /** Buffer applied to the estimated fee, as a percentage. Defaults to 15. */
  feeBufferPercentage?: number;
  /** Horizon endpoint used to sample live fee stats. */
  horizonUrl?: string;
  /** Custom fetch implementation (proxies, tests). */
  fetch?: typeof fetch;
  /** Astroid HTTP client used for a remote `/transactions/simulate` dry-run. */
  client?: SimulateTransactionClient;
  /** Skip the remote API call even when a `client` is supplied. */
  skipRemote?: boolean;
}

/** Outcome of an optional remote simulation round-trip. */
export interface TransactionSimulationRemoteResult {
  /** Whether the remote call was attempted. */
  performed: boolean;
  /** Whether the backend reported the transaction as acceptable. */
  success: boolean;
  /** Ledger-side execution status, when the simulation ran. */
  status?: TransactionSimulationStatus;
  /** Machine-readable failure reason when `success` is `false`. */
  errorCode?: TransactionSimulationErrorCode;
  /** Human-readable failure reason when `success` is `false`. */
  errorMessage?: string;
  /** Structured diagnostics extracted from a failed simulation, when present. */
  diagnostics?: TransactionSimulationDiagnostics;
  /** Estimated on-chain resource usage, when the backend reported it. */
  resourceUsage?: TransactionResourceEstimate;
  /** Present when the backend indicates a fee bump is required. */
  feeBumpSuggestion?: TransactionFeeBumpSuggestion;
  /** Raw backend payload, when it returned one. */
  data?: Record<string, unknown>;
}

/**
 * Structured diagnostic detail extracted from a failed simulation response.
 *
 * Mirrors the Stellar result-code taxonomy (`tx_failed` / `tx_insufficient_fee`
 * plus per-operation result codes) so callers can branch on the failure mode
 * without parsing XDR themselves. Every field is optional: the API reports each
 * one only when the underlying data was present, and nothing is fabricated.
 */
export interface TransactionSimulationDiagnostics {
  /** Transaction-level Stellar result code (e.g. `tx_failed`). */
  stellarCode?: string;
  /** Result code of the first failing operation, when reported. */
  operationCode?: string;
  /** Per-operation result codes, in operation order, when reported. */
  operationResultCodes?: string[];
  /** Index of the first failing operation, when the API identifies one. */
  failedOperationIndex?: number;
  /** Free-form, API-provided failure detail beyond the result codes. */
  detail?: string;
}

/**
 * Everything a caller needs to reconstruct a fee-bumped transaction when the
 * simulation indicates the current fee bid is not enough.
 *
 * `suggestedFee` is the minimum the ledger reported — never silently raised —
 * and `suggestedBaseFee` (when present) is that total spread over the operation
 * count. Nothing here is fabricated: when the API does not report a suggested
 * amount the fields are simply absent and the caller must choose one.
 */
export interface TransactionFeeBumpSuggestion {
  /** Whether the simulation explicitly indicated a fee bump is required. */
  required: boolean;
  /** Minimum total fee (stroops) the simulation reported as required. */
  suggestedFee?: number;
  /** `suggestedFee` spread over the operation count, when it is present. */
  suggestedBaseFee?: number;
  /** Public key of the account the backend suggested as the fee source, if any. */
  suggestedFeeSource?: string;
  /** Human-readable explanation of why the bump was flagged. */
  reason?: string;
}

/**
 * The structured result of simulating a transaction before broadcast.
 *
 * `viable` is the headline signal: when `false`, `errorCode`/`errorMessage`
 * explain why the transaction would be rejected so the caller can fix it
 * without spending network fees.
 */
export interface TransactionSimulationOutcome {
  /** Whether the transaction is expected to be accepted by the network. */
  viable: boolean;
  /** Whether the envelope passed local protocol validation. */
  valid: boolean;
  /** Number of operations in the envelope. */
  operationCount: number;
  /** Base fee (stroops) decoded from the envelope, or `0` when unknown. */
  baseFee: number;
  /** Recommended total fee (stroops) to bid for the transaction. */
  estimatedFee: number;
  /** Full fee estimate, when one could be computed. */
  feeEstimate?: TransactionFeeEstimate;
  /** Estimated on-chain resource usage, when a simulation reported it. */
  resourceUsage?: TransactionResourceEstimate;
  /** Structured diagnostics behind a failed remote simulation, when present. */
  diagnostics?: TransactionSimulationDiagnostics;
  /** Present when the simulation indicates a fee bump is required. */
  feeBumpSuggestion?: TransactionFeeBumpSuggestion;
  /** Decoded source account, when available. */
  sourceAccount?: string;
  /** Base64 XDR that was simulated. */
  transactionXdr?: string;
  /** Result of the optional remote simulation call. */
  remote?: TransactionSimulationRemoteResult;
  /** Machine-readable failure reason when `viable` is `false`. */
  errorCode?: TransactionSimulationErrorCode;
  /** Human-readable failure reason when `viable` is `false`. */
  errorMessage?: string;
}
