/**
 * Policy rule evaluation helper for `POST /policies/simulate-rule`.
 *
 * Where {@link simulatePolicyEvaluation} (in `./simulation.js`) replays a
 * transaction against a *persisted* policy, this module evaluates a **single
 * proposed rule** against a proposed transaction — the check an autonomous
 * agent runs before it signs anything, and the check a policy author runs
 * while drafting a rule.
 *
 * The module has three layers, each usable on its own:
 *
 * 1. {@link validatePolicyEvaluationRequest} — local payload checks, so a
 *    malformed rule or transaction fails before it costs a round trip.
 * 2. {@link toPolicyEvaluationOutcome} — a defensive parser that turns the raw
 *    response into the strict {@link PolicyEvaluationOutcome} DTO.
 * 3. {@link simulatePolicyRuleEvaluation} — the transport helper that combines
 *    both, working against any transport that satisfies
 *    {@link PolicySimulationHttpClient} (an `HttpClient`, an `@astroid/client`
 *    instance, or a mock in tests).
 *
 * **Fail-closed by design.** A rule violation is not an error: it resolves
 * normally with `allowed: false` and the failed checks in `violatedRules`.
 * Only a response that carries no decision at all is rejected — silently
 * treating an unparseable answer as an allow would be the worst possible
 * failure mode for a financial guard.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type {
  PolicyEvaluationOutcome,
  PolicyEvaluationRequest,
  PolicyRuleCheck,
  PolicyRuleEvaluation,
} from '@astroid/types';

import { PolicyEvaluationRequestSchema } from './schemas.js';
import type { PolicySimulationHttpClient } from './simulate-policy.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The path of the policy rule evaluation endpoint. */
export const POLICY_SIMULATE_RULE_PATH = '/policies/simulate-rule';

/** The constraint families a reported check may name. */
const POLICY_RULE_CHECKS: readonly PolicyRuleCheck[] = ['address', 'time', 'signatures', 'none'];

/** The check family reported when the API names none. */
const DEFAULT_RULE_CHECK: PolicyRuleCheck = 'none';

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

/** A short label describing what was received, for error details. */
function describeReceived(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
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

/* -------------------------------------------------------------------------- */
/* Request validation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Validate a policy evaluation request before it reaches the network.
 *
 * The rule and the transaction payload are both checked: a rule without a
 * name cannot be reported in an outcome, and a transaction without an asset
 * and an amount cannot be evaluated. A payload that could never execute is
 * therefore never reported as "allowed".
 *
 * @param input The evaluation request to check.
 * @returns     The request, narrowed to {@link PolicyEvaluationRequest}.
 * @throws      {ValidationError} When the request is malformed; the error's
 *              `fieldErrors` name every offending field.
 *
 * @example
 * ```ts
 * const request = validatePolicyEvaluationRequest({
 *   rule: { name: 'treasury-only', allowedRecipients: ['GABC…'] },
 *   transaction: { asset: 'USDC', amount: '250' },
 * });
 * ```
 */
export function validatePolicyEvaluationRequest(input: unknown): PolicyEvaluationRequest {
  const result = PolicyEvaluationRequestSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Validation failed for PolicyEvaluationRequest', {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: {
        fields: result.error.flatten().fieldErrors,
      },
    });
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

/** Build the error thrown when a response carries no usable decision. */
function malformedResponse(message: string, received: unknown): ValidationError {
  return new ValidationError(message, {
    code: 'MALFORMED_RESPONSE',
    status: 502,
    details: { field: 'response', received: describeReceived(received) },
  });
}

/** Coerce a raw check name onto the {@link PolicyRuleCheck} union. */
function toRuleCheck(value: unknown): PolicyRuleCheck {
  const name = firstString(value)?.toLowerCase();
  if (name === undefined) return DEFAULT_RULE_CHECK;
  return POLICY_RULE_CHECKS.find((check) => check === name) ?? DEFAULT_RULE_CHECK;
}

/** Parse a single reported rule evaluation, or `null` when it is unusable. */
function toRuleEvaluation(entry: unknown): PolicyRuleEvaluation | null {
  if (typeof entry === 'string') {
    const rule = entry.trim();
    if (rule === '') return null;
    return { rule, check: DEFAULT_RULE_CHECK, success: false };
  }
  if (!isRecord(entry)) return null;

  const rule = firstString(entry.rule, entry.ruleName, entry.name);
  if (rule === undefined) return null;

  const evaluation: PolicyRuleEvaluation = {
    rule,
    check: toRuleCheck(entry.check ?? entry.constraint ?? entry.type),
    success: firstBoolean(entry.success, entry.passed) ?? false,
  };

  const explanation = firstString(entry.explanation, entry.message, entry.reason, entry.detail);
  if (explanation !== undefined) evaluation.explanation = explanation;

  return evaluation;
}

/**
 * Parse a raw rule-evaluation response into a strict
 * {@link PolicyEvaluationOutcome}.
 *
 * The API's canonical payload — `{ allowed, denied, triggeredRuleIds,
 * violatedRules, riskScore, explanation }` — is understood, as are the common
 * alternatives (`permitted` / `passed` for the decision, `violations` /
 * `failedRules` for the failed checks, `risk.score` for the risk score).
 *
 * Parsing is defensive and never fabricates data:
 *
 * - A well-formed denial resolves normally with `allowed: false`; only the
 *   *reported* failures are listed, so dropping a malformed entry can never
 *   turn a denial into an allow.
 * - A reported decision flag always wins over a derived one, and when there
 *   is no flag the decision is derived from the raw failure list, never from
 *   the failures that survived parsing.
 * - A missing risk score yields `0`.
 * - A response that carries no decision at all — a non-object body, `{}`, or
 *   a payload with neither flag nor failure list — is **rejected** as
 *   malformed rather than reported as an allow.
 *
 * @param raw     The response body returned by the API.
 * @param request The request that produced it, used for the fallback policy id
 *                and the default explanation.
 * @returns       The normalized, strictly typed outcome.
 * @throws        {ValidationError} With code `MALFORMED_RESPONSE` when the
 *                response carries no usable decision.
 *
 * @example
 * ```ts
 * const outcome = toPolicyEvaluationOutcome(await response.json(), request);
 * outcome.allowed;       // boolean
 * outcome.violatedRules; // PolicyRuleEvaluation[]
 * ```
 */
export function toPolicyEvaluationOutcome(
  raw: unknown,
  request: PolicyEvaluationRequest,
): PolicyEvaluationOutcome {
  if (!isRecord(raw)) {
    throw malformedResponse(
      'The policy rule evaluation endpoint returned a non-object response body.',
      raw,
    );
  }

  const rawViolations = firstArray(raw.violatedRules, raw.violations, raw.failedRules);
  const reportedAllowed = firstBoolean(raw.allowed, raw.permitted, raw.passed);
  const reportedDenied = firstBoolean(raw.denied, raw.blocked);

  let allowed: boolean;
  let denied: boolean;
  if (reportedAllowed !== undefined) {
    allowed = reportedAllowed;
    denied = reportedDenied ?? !allowed;
  } else if (reportedDenied !== undefined) {
    denied = reportedDenied;
    allowed = !denied;
  } else if (rawViolations !== undefined) {
    allowed = rawViolations.length === 0;
    denied = !allowed;
  } else {
    throw malformedResponse(
      'The policy rule evaluation response did not include an allow/deny decision.',
      raw,
    );
  }

  const violatedRules: PolicyRuleEvaluation[] = [];
  for (const entry of rawViolations ?? []) {
    const evaluation = toRuleEvaluation(entry);
    if (evaluation !== null) violatedRules.push(evaluation);
  }

  const triggeredRuleIds: string[] = [];
  const rawTriggered = firstArray(raw.triggeredRuleIds, raw.triggeredRules);
  for (const entry of rawTriggered ?? []) {
    const name = typeof entry === 'string' ? firstString(entry) : firstString(
      isRecord(entry) ? (entry.rule ?? entry.name ?? entry.ruleName) : undefined,
    );
    if (name !== undefined) triggeredRuleIds.push(name);
  }

  const risk = isRecord(raw.risk) ? raw.risk : undefined;
  const riskScore = toScore(raw.riskScore) ?? toScore(risk?.score) ?? 0;

  const policyId = firstString(raw.policyId) ?? request.policyId;

  const reportedCount = rawViolations?.length ?? violatedRules.length;
  const explanation =
    firstString(raw.explanation, raw.message, raw.reason, raw.summary) ??
    (allowed
      ? `Transaction satisfies rule "${request.rule.name}".`
      : `Transaction violates ${reportedCount} check${reportedCount === 1 ? '' : 's'} on rule "${request.rule.name}".`);

  return {
    ...(policyId !== undefined ? { policyId } : {}),
    allowed,
    denied,
    triggeredRuleIds,
    violatedRules,
    riskScore,
    explanation,
  };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a single proposed policy rule against a proposed transaction.
 *
 * The request is validated locally, POSTed to `/policies/simulate-rule` and
 * the response parsed into a strict {@link PolicyEvaluationOutcome}. A rule
 * violation resolves normally with `allowed: false`; only transport failures
 * and unparseable responses reject.
 *
 * @param client  The transport used to reach the API (an `HttpClient` satisfies it).
 * @param request The rule to evaluate and the transaction to evaluate it against.
 * @returns       The decision, the failed checks, the triggered rules and the
 *                risk score.
 * @throws        `ValidationError` for a malformed payload, `NetworkError` /
 *                typed API errors when the request fails, and a
 *                `ValidationError` with code `MALFORMED_RESPONSE` when the
 *                response carries no decision.
 *
 * @example
 * ```ts
 * import { HttpClient } from '@astroid/core';
 * import { simulatePolicyRuleEvaluation } from '@astroid/policy';
 *
 * const http = new HttpClient({ apiKey: process.env.ASTROID_API_KEY! });
 *
 * const outcome = await simulatePolicyRuleEvaluation(http, {
 *   rule: { name: 'treasury-only', allowedRecipients: ['GABC…'] },
 *   transaction: { asset: 'USDC', amount: '250', recipientAddress: 'GXYZ…' },
 * });
 *
 * if (!outcome.allowed) {
 *   for (const violation of outcome.violatedRules) {
 *     console.warn(violation.rule, violation.explanation);
 *   }
 * }
 * ```
 */
export async function simulatePolicyRuleEvaluation(
  client: PolicySimulationHttpClient,
  request: PolicyEvaluationRequest,
): Promise<PolicyEvaluationOutcome> {
  // The payload is checked before a single byte goes over the wire, so a
  // malformed request can never reach the API.
  const payload = validatePolicyEvaluationRequest(request);

  const res = await client.post<unknown>(POLICY_SIMULATE_RULE_PATH, payload);
  return toPolicyEvaluationOutcome(res.data, payload);
}
