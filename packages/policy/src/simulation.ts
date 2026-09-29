/**
 * Single-policy simulation helper for `POST /policies/{id}/simulate`.
 *
 * Where {@link simulatePolicy} (in `./simulate-policy.js`) evaluates a
 * transaction against *every* policy in scope, this module targets **one**
 * policy by id: the endpoint the API exposes for "would this transaction pass
 * *this* rule?". It is the check an agent runs immediately before signing a
 * transfer it has already decided to make.
 *
 * The module has three layers, each usable on its own:
 *
 * 1. {@link validatePolicySimulationInput} — local payload checks, so a
 *    malformed transaction fails before it costs a round trip.
 * 2. {@link toPolicySimulationEvaluation} — a defensive parser that turns the
 *    raw response into the strict {@link PolicySimulationEvaluation} DTO.
 * 3. {@link simulatePolicyEvaluation} — the transport helper that combines
 *    both, working against any transport that satisfies
 *    {@link PolicySimulationHttpClient} (an `HttpClient`, an `@astroid/client`
 *    instance, or a mock in tests).
 *
 * **Fail-closed by design.** A policy breach is not an error: it resolves
 * normally with `allowed: false` and the breaches in `violatedRules`. Only a
 * response that carries no decision at all is rejected — silently treating an
 * unparseable answer as an allow would be the worst possible failure mode for a
 * financial guard.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import {
  PolicyType,
  type PolicyBudgetImpact,
  type PolicyRiskAssessment,
  type PolicyRiskFactor,
  type PolicyRuleBreach,
  type PolicySimulationEvaluation,
  type PolicySimulationInput,
} from '@astroid/types';

import type { PolicySimulationHttpClient } from './simulate-policy.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The `/policies` collection the single-policy simulation path is built from.
 *
 * Exported so callers can assert the endpoint family in tests without
 * hardcoding the whole path; use {@link policySimulationPath} for the full
 * `/policies/{id}/simulate` route.
 */
export const POLICY_SIMULATE_BY_ID_PATH = '/policies';

/**
 * A plain decimal amount (`"500"`, `"1000.00"`).
 *
 * Deliberately stricter than `Number(value)`, which accepts `"Infinity"`,
 * `"0x10"`, `"1e3"` and `""`. Amounts cross the wire as decimal strings to
 * preserve precision, so only plain decimal notation is accepted.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;

/** Any digit 1-9, used to prove a decimal amount is strictly greater than zero. */
const NON_ZERO_DIGIT_PATTERN = /[1-9]/;

/** Upper bound (exclusive) of each {@link PolicyRiskAssessment} band. */
const RISK_BANDS: ReadonlyArray<{ max: number; band: PolicyRiskAssessment['band'] }> = [
  { max: 0.3, band: 'LOW' },
  { max: 0.6, band: 'MEDIUM' },
  { max: 0.85, band: 'HIGH' },
  { max: 1, band: 'CRITICAL' },
];

/** The `rule` reported when the API names no machine-readable reason. */
const DEFAULT_BREACH_RULE = 'POLICY_RULE';

/* -------------------------------------------------------------------------- */
/* Small parsing primitives                                                    */
/* -------------------------------------------------------------------------- */

/** Narrow an unknown value to a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first candidate that is a non-empty, non-blank string. */
function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') return trimmed;
  }
  return undefined;
}

/** The first candidate that is a boolean. */
function firstBoolean(...candidates: unknown[]): boolean | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;
  }
  return undefined;
}

/** The first candidate that is an array. */
function firstArray(...candidates: unknown[]): unknown[] | undefined {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Read a monetary value reported by the API, keeping the shape it arrived in.
 *
 * Decimal strings are preserved verbatim so a large limit never loses precision
 * by round-tripping through IEEE-754; anything else (booleans, objects, `NaN`)
 * is treated as absent rather than coerced into a misleading number.
 */
function toComparable(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  return undefined;
}

/** Clamp a score into the documented `0`–`1` range. */
function clampScore(score: number): number {
  return Math.min(1, Math.max(0, score));
}

/** Read a 0..1 score from a number or a numeric string; `undefined` if unusable. */
function toScore(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? clampScore(value) : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampScore(parsed) : undefined;
  }
  return undefined;
}

/** A short label describing what was received, for error details. */
function describeReceived(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/* -------------------------------------------------------------------------- */
/* Public validation helpers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Map a 0..1 risk score onto its band.
 *
 * The thresholds mirror the `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` bands the
 * API reports, and are applied only when the API omits a band of its own.
 * Scores are clamped to `0`–`1` first, so an out-of-range score still lands in a
 * defined band.
 *
 * @param score The 0..1 risk score.
 * @returns      The band the score falls in.
 *
 * @example
 * ```ts
 * riskBandForScore(0.05); // 'LOW'
 * riskBandForScore(0.9);  // 'CRITICAL'
 * ```
 */
export function riskBandForScore(score: number): PolicyRiskAssessment['band'] {
  const clamped = Number.isFinite(score) ? clampScore(score) : 0;
  for (const { max, band } of RISK_BANDS) {
    if (clamped < max) return band;
  }
  return 'CRITICAL';
}

/**
 * Whether `value` is a usable positive transfer amount.
 *
 * Accepts a positive finite number, or a decimal string whose value is greater
 * than zero — `"0"`, `"-5"`, `"1e3"` and `""` are all rejected. Strings are
 * checked digit-wise so a very large amount cannot be rounded to `0` (or to
 * `Infinity`) by `Number()`.
 *
 * @example
 * ```ts
 * isValidPolicySimulationAmount('1000.00'); // true
 * isValidPolicySimulationAmount('-5');       // false
 * ```
 */
export function isValidPolicySimulationAmount(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  return DECIMAL_AMOUNT_PATTERN.test(value) && NON_ZERO_DIGIT_PATTERN.test(value);
}

/**
 * Whether `value` is a usable `spentInWindow` amount.
 *
 * Same decimal rules as {@link isValidPolicySimulationAmount}, but zero is
 * valid: "nothing spent in this window yet" is a legitimate starting state for
 * a rolling-limit rule.
 */
export function isValidPolicySpentInWindow(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  if (typeof value !== 'string') return false;
  return DECIMAL_AMOUNT_PATTERN.test(value);
}

/* -------------------------------------------------------------------------- */
/* Internal validation                                                         */
/* -------------------------------------------------------------------------- */

/** Build a structured `ValidationError` naming the offending field. */
function invalid(field: string, message: string, code: string): ValidationError {
  return new ValidationError(message, { code, details: { field } });
}

/**
 * Require a usable policy id and return it trimmed.
 *
 * Runs before the request is built, so a blank id can never become a request
 * against `/policies//simulate`.
 *
 * @throws {ValidationError} When the id is not a non-blank string.
 */
function requirePolicyId(policyId: unknown): string {
  const trimmed = firstString(policyId);
  if (trimmed === undefined) {
    throw invalid('policyId', 'policyId is required to simulate a policy.', 'INVALID_POLICY_ID');
  }
  return trimmed;
}

/**
 * Validate the transaction payload locally, before any network call.
 *
 * A broken payload costs a local exception instead of a round trip and a 422 —
 * and, more importantly, a payload that could never execute is never reported
 * as "allowed".
 *
 * @param input The proposed transaction to evaluate.
 * @returns     The same payload, narrowed to {@link PolicySimulationInput}.
 * @throws      {ValidationError} When a required field is missing, wrongly
 *              typed, or holds an amount that is not positive and finite.
 */
export function validatePolicySimulationInput(input: unknown): PolicySimulationInput {
  if (!isRecord(input)) {
    throw invalid(
      'input',
      'A transaction payload object is required to simulate a policy.',
      'INVALID_POLICY_SIMULATION_INPUT',
    );
  }

  const { asset, amount, recipientAddress, senderAddress, memo, spentInWindow, metadata } = input;

  if (firstString(asset) === undefined) {
    throw invalid('asset', 'asset is required to simulate a policy.', 'INVALID_POLICY_ASSET');
  }
  if (!isValidPolicySimulationAmount(amount)) {
    throw invalid(
      'amount',
      'amount must be a positive finite number or decimal string.',
      'INVALID_POLICY_AMOUNT',
    );
  }
  if (recipientAddress !== undefined && firstString(recipientAddress) === undefined) {
    throw invalid(
      'recipientAddress',
      'recipientAddress must be a non-empty string when provided.',
      'INVALID_POLICY_RECIPIENT',
    );
  }
  if (senderAddress !== undefined && firstString(senderAddress) === undefined) {
    throw invalid(
      'senderAddress',
      'senderAddress must be a non-empty string when provided.',
      'INVALID_POLICY_SENDER',
    );
  }
  if (memo !== undefined && typeof memo !== 'string') {
    throw invalid('memo', 'memo must be a string when provided.', 'INVALID_POLICY_MEMO');
  }
  if (spentInWindow !== undefined && !isValidPolicySpentInWindow(spentInWindow)) {
    throw invalid(
      'spentInWindow',
      'spentInWindow must be a non-negative number or decimal string.',
      'INVALID_POLICY_SPENT_IN_WINDOW',
    );
  }
  if (metadata !== undefined && !isRecord(metadata)) {
    throw invalid(
      'metadata',
      'metadata must be a plain object when provided.',
      'INVALID_POLICY_METADATA',
    );
  }

  return input as unknown as PolicySimulationInput;
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

/** Build the error thrown when a response carries no usable decision. */
function malformedResponse(message: string, policyId: string, received: unknown): ValidationError {
  return new ValidationError(message, {
    code: 'MALFORMED_RESPONSE',
    details: { field: 'response', policyId, received: describeReceived(received) },
  });
}

/** Coerce a raw type onto the {@link PolicyType} union, or drop it. */
function toPolicyType(value: unknown): PolicyType | undefined {
  const name = firstString(value)?.toUpperCase();
  if (name === undefined) return undefined;
  return Object.values(PolicyType).find((type) => type === name);
}

/** Coerce a raw band onto the {@link PolicyRiskAssessment} band union. */
function toRiskBand(value: unknown): PolicyRiskAssessment['band'] | undefined {
  const name = firstString(value)?.toUpperCase();
  if (name === undefined) return undefined;
  return RISK_BANDS.find(({ band }) => band === name)?.band;
}

/** Parse the risk-factor list, dropping malformed entries. */
function toRiskFactors(value: unknown): PolicyRiskFactor[] {
  const entries = firstArray(value);
  if (entries === undefined) return [];

  const factors: PolicyRiskFactor[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const factor = firstString(entry.factor, entry.name);
    const description = firstString(entry.description, entry.message, entry.detail);
    const score = toScore(entry.score);
    // A factor missing its name, explanation or score carries no usable
    // information: drop the entry rather than zero-fill a score the API never
    // reported, which would read as "this factor contributed nothing".
    if (factor === undefined || description === undefined || score === undefined) continue;
    factors.push({ factor, score, description });
  }
  return factors;
}

/** Parse the risk block (or a flat `riskScore`) into a typed assessment. */
function toRiskAssessment(riskValue: unknown, flatScore: unknown): PolicyRiskAssessment {
  const record = isRecord(riskValue) ? riskValue : undefined;
  const score = toScore(record?.score) ?? toScore(flatScore) ?? 0;
  return {
    score,
    band: (record ? toRiskBand(record.band) : undefined) ?? riskBandForScore(score),
    factors: record ? toRiskFactors(record.factors) : [],
  };
}

/** Parse a single reported rule breach, or `null` when it is unusable. */
function toRuleBreach(policyId: string, entry: unknown): PolicyRuleBreach | null {
  const text = firstString(entry);
  if (text !== undefined) return { policyId, rule: DEFAULT_BREACH_RULE, message: text };

  if (!isRecord(entry)) return null;

  const policyType = toPolicyType(entry.policyType ?? entry.type);
  const rule = firstString(entry.rule, entry.code) ?? policyType ?? DEFAULT_BREACH_RULE;
  const message = firstString(entry.message, entry.detail, entry.description, entry.reason);

  const breach: PolicyRuleBreach = {
    policyId: firstString(entry.policyId) ?? policyId,
    rule,
    message: message ?? `Transaction breaches policy rule "${rule}".`,
  };

  const policyName = firstString(entry.policyName, entry.name);
  if (policyName !== undefined) breach.policyName = policyName;
  if (policyType !== undefined) breach.policyType = policyType;

  const limit = toComparable(entry.limit);
  if (limit !== undefined) breach.limit = limit;
  const actual = toComparable(entry.actual);
  if (actual !== undefined) breach.actual = actual;

  return breach;
}

/** Parse the budget-impact list, dropping malformed entries. */
function toBudgetImpact(value: unknown): PolicyBudgetImpact[] {
  const entries = firstArray(value);
  if (entries === undefined) return [];

  const impact: PolicyBudgetImpact[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const budgetId = firstString(entry.budgetId);
    if (budgetId === undefined) continue;
    const before = toComparable(entry.beforeRemaining);
    const after = toComparable(entry.afterRemaining);
    // An impact entry missing either side would misstate the draw; drop it
    // rather than report a partial movement as a whole one.
    if (before === undefined || after === undefined) continue;
    impact.push({ budgetId, beforeRemaining: String(before), afterRemaining: String(after) });
  }
  return impact;
}

/** Parse a string list, dropping non-string and blank entries. */
function toStringList(value: unknown): string[] {
  const entries = firstArray(value);
  if (entries === undefined) return [];

  const list: string[] = [];
  for (const entry of entries) {
    const text = firstString(entry);
    if (text !== undefined) list.push(text);
  }
  return list;
}

/**
 * Parse a raw single-policy simulation response into a strict
 * {@link PolicySimulationEvaluation}.
 *
 * The API's canonical payload — `{ allowed, violations, requiredApprovals,
 * risk, budgetImpact, explanation }`, the same shape as
 * {@link PolicySimulationResult} — is understood, as are the common
 * alternatives (`permitted` / `passed` for the decision, `violatedRules` /
 * `breaches` for the breach list, a flat `riskScore`).
 *
 * Parsing is defensive and never fabricates data:
 *
 * - A well-formed denial resolves normally with `allowed: false`; only the
 *   *reported* breaches are listed, so dropping a malformed entry can never
 *   turn a denial into an allow.
 * - A reported decision flag always wins over a derived one, and when there is
 *   no flag the decision is derived from the raw breach list, never from the
 *   breaches that survived parsing.
 * - A missing risk assessment yields a score of `0` and a `LOW` band; a
 *   missing band is derived from the score.
 * - A response that carries no decision at all — a non-object body, `{}`, or a
 *   risk block with neither flag nor breaches — is **rejected** as malformed
 *   rather than reported as an allow.
 *
 * @param policyId The policy that was simulated, used as the fallback id.
 * @param raw      The response body returned by the API.
 * @returns        The normalized, strictly typed evaluation.
 * @throws         {ValidationError} With code `MALFORMED_RESPONSE` when the
 *                 response carries no usable decision.
 *
 * @example
 * ```ts
 * const evaluation = toPolicySimulationEvaluation('pol_1', await response.json());
 * evaluation.allowed;       // boolean
 * evaluation.riskScore;     // 0..1
 * evaluation.violatedRules; // PolicyRuleBreach[]
 * ```
 */
export function toPolicySimulationEvaluation(
  policyId: string,
  raw: unknown,
): PolicySimulationEvaluation {
  const requestedPolicyId = requirePolicyId(policyId);

  if (!isRecord(raw)) {
    throw malformedResponse(
      'The policy simulation endpoint returned a non-object response body.',
      requestedPolicyId,
      raw,
    );
  }

  const rawBreaches = firstArray(raw.violatedRules, raw.violations, raw.breaches);
  const reportedAllowed = firstBoolean(raw.allowed, raw.permitted, raw.passed);

  let allowed: boolean;
  if (reportedAllowed !== undefined) {
    allowed = reportedAllowed;
  } else if (rawBreaches !== undefined) {
    allowed = rawBreaches.length === 0;
  } else {
    throw malformedResponse(
      'The policy simulation response did not include an allow/deny decision.',
      requestedPolicyId,
      raw,
    );
  }

  const violatedRules: PolicyRuleBreach[] = [];
  for (const entry of rawBreaches ?? []) {
    const breach = toRuleBreach(requestedPolicyId, entry);
    if (breach !== null) violatedRules.push(breach);
  }

  const risk = toRiskAssessment(raw.risk, raw.riskScore);
  const reportedCount = rawBreaches?.length ?? violatedRules.length;
  const explanation =
    firstString(raw.explanation, raw.message, raw.reason, raw.summary) ??
    (allowed
      ? 'Transaction complies with the policy.'
      : `Transaction is blocked by ${reportedCount} policy rule${reportedCount === 1 ? '' : 's'}.`);

  return {
    policyId: firstString(raw.policyId) ?? requestedPolicyId,
    allowed,
    passed: allowed,
    violatedRules,
    riskScore: risk.score,
    risk,
    requiredApprovals: toStringList(raw.requiredApprovals ?? raw.approvals),
    budgetImpact: toBudgetImpact(raw.budgetImpact),
    explanation,
  };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build the single-policy simulation path for a policy id.
 *
 * The id is URL-encoded, so a path-unsafe id (`pol/../admin`) cannot escape the
 * `/policies/{id}/simulate` route.
 *
 * @param policyId The policy to simulate.
 * @returns        The request path, e.g. `/policies/pol_1/simulate`.
 * @throws         {ValidationError} When the id is blank.
 */
export function policySimulationPath(policyId: string): string {
  return `${POLICY_SIMULATE_BY_ID_PATH}/${encodeURIComponent(requirePolicyId(policyId))}/simulate`;
}

/**
 * Simulate a proposed transaction against a single policy, without committing it.
 *
 * The payload is validated locally, POSTed to
 * `/policies/{id}/simulate` and the response parsed into a strict
 * {@link PolicySimulationEvaluation}. A denial resolves normally with
 * `allowed: false`; only transport failures and unparseable responses reject.
 *
 * @param client  The transport used to reach the API (an `HttpClient` satisfies it).
 * @param policyId The policy to evaluate the transaction against.
 * @param input    The proposed transaction payload.
 * @returns        The decision, the violated rules, the risk score and the budget impact.
 * @throws         `ValidationError` for a blank id or malformed payload,
 *                 `NetworkError` / typed API errors when the request fails, and
 *                 a `ValidationError` with code `MALFORMED_RESPONSE` when the
 *                 response carries no decision.
 *
 * @example
 * ```ts
 * const evaluation = await simulatePolicyEvaluation(http, 'pol_1', {
 *   asset: 'USDC',
 *   amount: '750',
 *   recipientAddress: 'GABC…',
 * });
 *
 * if (!evaluation.allowed) {
 *   for (const rule of evaluation.violatedRules) console.warn(rule.rule, rule.message);
 * }
 * ```
 */
export async function simulatePolicyEvaluation(
  client: PolicySimulationHttpClient,
  policyId: string,
  input: PolicySimulationInput,
): Promise<PolicySimulationEvaluation> {
  // Both the id and the payload are checked before a single byte goes over the
  // wire, so a malformed request can never reach the API.
  const path = policySimulationPath(policyId);
  const payload = validatePolicySimulationInput(input);
  const id = requirePolicyId(policyId);

  const res = await client.post<unknown>(path, payload);
  return toPolicySimulationEvaluation(id, res.data);
}
