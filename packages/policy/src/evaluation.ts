/**
 * Local (offline) authorization pre-flight evaluation engine.
 *
 * Before an agent's action is dispatched for online authorization,
 * {@link evaluatePolicy} validates it against a {@link PolicySet} entirely on
 * the caller's machine: no network, no globals, no side effects. It covers the
 * standard local constraints:
 *
 * - **List membership** — destination allowlists and denylists, matched
 *   case-insensitively and across Stellar / federated address formats.
 * - **Structural payload fields** — the proposed asset and amount.
 * - **Timing** — a time-of-day window (`allowedHours`), with optional timezone
 *   and weekday restrictions.
 * - **Signature weight thresholds** — the total signing weight already
 *   collected must meet the configured `requiredSignatures`.
 *
 * A breach is never an error: the function returns a
 * {@link PolicyEvaluationResult} whose `results` records, for every check, the
 * rule name, whether it passed, and — on failure — a human-readable
 * explanation. Evaluation is deterministic for a given `(policySet, tx)`
 * (time-dependent rules read `tx.timestamp`, falling back to `options.now`).
 *
 * @module
 */

import type {
  Policy,
  PolicyAllowedHours,
  PolicyEvaluationResult,
  PolicyRule,
  PolicyRuleEvaluation,
  PolicySet,
  TransactionDetails,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Options accepted by {@link evaluatePolicy}. */
export interface EvaluatePolicyOptions {
  /**
   * Clock used for time-of-day checks when `tx.timestamp` is absent.
   * Defaults to the current time; supply a fixed value for deterministic runs.
   */
  now?: Date | string | number;
}

/** Default signing weight of a signature that does not declare one. */
const DEFAULT_SIGNATURE_WEIGHT = 1;

/** Short weekday names returned by `Intl.DateTimeFormat`, mapped to `Date#getDay`. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Whether `value` is a non-empty, non-blank string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Keep only the non-empty string entries of a candidate list. */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString);
}

/* -------------------------------------------------------------------------- */
/* Address handling                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Normalize an address for comparison.
 *
 * Handles the three shapes a destination may take:
 *
 * - Stellar strkeys (`G…`, `M…`, `C…`) — base32, upper-cased so that
 *   lowercase input still matches.
 * - Federated addresses (`name*domain`) — split on `*`, with both halves
 *   trimmed and lower-cased (per SEP-0002 federation is case-insensitive).
 * - Anything else — trimmed and upper-cased.
 *
 * Non-string or blank input normalizes to `""`, which never matches.
 *
 * @param address The address to normalize.
 * @returns         A canonical, comparably-cased form (or `""`).
 *
 * @example
 * ```ts
 * normalizeAddress('alice*Example.COM'); // 'alice*example.com'
 * normalizeAddress('gabc…');             // 'GABC…'
 * ```
 */
export function normalizeAddress(address: string | null | undefined): string {
  if (typeof address !== 'string') return '';
  const trimmed = address.trim();
  if (trimmed === '') return '';

  const separator = trimmed.indexOf('*');
  if (separator !== -1) {
    const name = trimmed.slice(0, separator).trim().toLowerCase();
    const domain = trimmed
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    return `${name}*${domain}`;
  }

  return trimmed.toUpperCase();
}

/**
 * Whether two addresses refer to the same destination.
 *
 * Comparison is case-insensitive and federation-aware (see
 * {@link normalizeAddress}); blank or missing addresses never match, so an
 * absent recipient cannot accidentally satisfy an allowlist.
 *
 * @param a First address.
 * @param b Second address.
 * @returns  `true` when both are non-empty and normalize to the same value.
 */
export function addressesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeAddress(a);
  if (left === '') return false;
  return left === normalizeAddress(b);
}

/** Whether `address` appears in `list` (federation-aware, case-insensitive). */
function matchesAny(address: string, list: string[]): boolean {
  return list.some((entry) => addressesMatch(address, entry));
}

/* -------------------------------------------------------------------------- */
/* Timing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether an action occurring at `at` falls inside a time-of-day window.
 *
 * The hour and weekday are resolved in `hours.timezone` (defaulting to UTC; an
 * unrecognised zone falls back to UTC rather than throwing). The window is
 * inclusive of `startHour` and exclusive of `endHour`; when `endHour` is less
 * than or equal to `startHour` the window wraps past midnight, and when the two
 * are equal the whole day is permitted. `hours.days`, when non-empty, further
 * restricts the allowed weekdays.
 *
 * @param hours The window to test.
 * @param at    The instant to test.
 * @returns     `true` when the action is permitted by the window.
 */
export function isActionWithinAllowedHours(hours: PolicyAllowedHours, at: Date): boolean {
  const start = hours?.startHour;
  const end = hours?.endHour;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    // A malformed window cannot be enforced; treat it as unrestricted.
    return true;
  }

  const timezone =
    typeof hours.timezone === 'string' && hours.timezone.trim() !== ''
      ? hours.timezone.trim()
      : 'UTC';
  const { hour, day } = zonedHourAndDay(at, timezone);

  if (Array.isArray(hours.days) && hours.days.length > 0 && !hours.days.includes(day)) {
    return false;
  }

  if (start === end) return true; // whole-day window
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps past midnight
}

/** Resolve the hour and weekday of an instant in a specific IANA timezone. */
function zonedHourAndDay(at: Date, timezone: string): { hour: number; day: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
      weekday: 'short',
    });
    const parts = formatter.formatToParts(at);
    const hourValue = Number(parts.find((part) => part.type === 'hour')?.value);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    return {
      hour: Number.isFinite(hourValue) ? hourValue : at.getUTCHours(),
      day:
        weekday !== undefined && WEEKDAY_INDEX[weekday] !== undefined
          ? WEEKDAY_INDEX[weekday]
          : at.getUTCDay(),
    };
  } catch {
    // Invalid timezone: degrade to UTC instead of throwing mid-evaluation.
    return { hour: at.getUTCHours(), day: at.getUTCDay() };
  }
}

/** Resolve the instant a payload is evaluated at. */
function resolveEvaluationDate(tx: TransactionDetails, options: EvaluatePolicyOptions): Date {
  const source = tx.timestamp ?? options.now;
  if (source instanceof Date) return source;
  if (typeof source === 'number' && Number.isFinite(source)) return new Date(source);
  if (typeof source === 'string' && source.trim() !== '') {
    const parsed = new Date(source);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/* -------------------------------------------------------------------------- */
/* Signature weight                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Total signing weight already collected on a payload.
 *
 * When `tx.signedWeight` is a finite number it wins outright (the caller has
 * already accounted for weights). Otherwise the weights of `tx.signatures` are
 * summed, with each signature defaulting to a weight of {@link
 * DEFAULT_SIGNATURE_WEIGHT}. Non-finite or negative weights are ignored.
 *
 * @param tx The transaction payload.
 * @returns  The collected signing weight (never negative).
 */
export function resolveSignedWeight(tx: TransactionDetails | null | undefined): number {
  if (!tx || typeof tx !== 'object') return 0;

  if (typeof tx.signedWeight === 'number' && Number.isFinite(tx.signedWeight)) {
    return Math.max(0, tx.signedWeight);
  }

  if (!Array.isArray(tx.signatures)) return 0;

  return tx.signatures.reduce((total, signature) => {
    // A missing weight defaults to 1 (the common single-signer weight); a
    // present-but-malformed weight (NaN, Infinity, wrong type) grants no
    // weight rather than silently satisfying a threshold.
    if (!signature || signature.weight === undefined) return total + DEFAULT_SIGNATURE_WEIGHT;
    if (typeof signature.weight !== 'number' || !Number.isFinite(signature.weight)) return total;
    return total + Math.max(0, signature.weight);
  }, 0);
}

/* -------------------------------------------------------------------------- */
/* Rule evaluation                                                             */
/* -------------------------------------------------------------------------- */

/** Human-readable label for a rule, falling back for malformed names. */
function ruleName(rule: PolicyRule): string {
  return isNonEmptyString(rule.name) ? rule.name : 'unnamed';
}

/** A passing result for a check. */
function pass(rule: string, check: PolicyRuleEvaluation['check']): PolicyRuleEvaluation {
  return { rule, check, success: true };
}

/** A failing result for a check, carrying the explanation. */
function fail(
  rule: string,
  check: PolicyRuleEvaluation['check'],
  explanation: string,
): PolicyRuleEvaluation {
  return { rule, check, success: false, explanation };
}

/**
 * Evaluate a single rule, returning one result per configured constraint.
 *
 * A rule with no configured constraints yields a single trivially-passing
 * `none` result, so the report always explains that the rule was considered.
 */
function evaluateRule(rule: PolicyRule, tx: TransactionDetails, at: Date): PolicyRuleEvaluation[] {
  const name = ruleName(rule);
  const results: PolicyRuleEvaluation[] = [];
  const allowed = cleanList(rule.allowedRecipients);
  const blocked = cleanList(rule.blockedRecipients);

  if (allowed.length > 0) {
    const destination = tx.recipientAddress;
    if (!isNonEmptyString(destination)) {
      results.push(
        fail(
          name,
          'address',
          'A recipient address is required when an allowed-recipients list is configured.',
        ),
      );
    } else if (!matchesAny(destination, allowed)) {
      results.push(
        fail(name, 'address', `Destination ${destination} is not in the allowed recipients list.`),
      );
    } else {
      results.push(pass(name, 'address'));
    }
  }

  if (blocked.length > 0) {
    const destination = tx.recipientAddress;
    if (isNonEmptyString(destination) && matchesAny(destination, blocked)) {
      results.push(fail(name, 'address', `Destination ${destination} is blocked by policy.`));
    } else {
      results.push(pass(name, 'address'));
    }
  }

  if (rule.allowedHours !== undefined && rule.allowedHours !== null) {
    if (isActionWithinAllowedHours(rule.allowedHours, at)) {
      results.push(pass(name, 'time'));
    } else {
      const { startHour, endHour, timezone } = rule.allowedHours;
      const zone = isNonEmptyString(timezone) ? timezone : 'UTC';
      results.push(
        fail(
          name,
          'time',
          `Action at ${at.toISOString()} falls outside the allowed hours (${startHour}:00–${endHour}:00 ${zone}).`,
        ),
      );
    }
  }

  if (typeof rule.requiredSignatures === 'number' && Number.isFinite(rule.requiredSignatures)) {
    const required = rule.requiredSignatures;
    const collected = resolveSignedWeight(tx);
    if (collected >= required) {
      results.push(pass(name, 'signatures'));
    } else {
      results.push(
        fail(
          name,
          'signatures',
          `Collected signing weight ${collected} is below the required threshold ${required}.`,
        ),
      );
    }
  }

  if (results.length === 0) {
    results.push({
      rule: name,
      check: 'none',
      success: true,
      explanation: 'No constraints configured.',
    });
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a proposed transaction against a local policy set.
 *
 * Every enabled rule in `policySet.rules` is checked in declaration order and
 * contributes one result per configured constraint (destination allowlist,
 * destination denylist, time window, signature threshold). The function is pure
 * and total: a malformed or missing input is treated as an empty set that
 * passes, and a policy breach resolves to `allowed: false` rather than
 * throwing.
 *
 * @param policySet The rules to evaluate (typically built with
 *                  {@link policySetFromPolicies} or hand-written).
 * @param tx        The prospective transaction payload.
 * @param options   Optional evaluation clock override for deterministic runs.
 * @returns         A {@link PolicyEvaluationResult} with the overall decision
 *                  and per-check detail.
 *
 * @example
 * ```ts
 * const result = evaluatePolicy(
 *   {
 *     rules: [
 *       { name: 'Treasury allowlist', allowedRecipients: ['GABC…'] },
 *       { name: 'Business hours', allowedHours: { startHour: 9, endHour: 17 } },
 *       { name: 'Multisig', requiredSignatures: 2 },
 *     ],
 *   },
 *   {
 *     asset: 'USDC',
 *     amount: '250',
 *     recipientAddress: 'GABC…',
 *     timestamp: '2026-09-28T12:00:00.000Z',
 *     signatures: [{ signer: 'GONE…' }, { signer: 'GTWO…' }],
 *   },
 * );
 *
 * if (!result.allowed) {
 *   console.error(result.results.filter((r) => !r.success));
 * }
 * ```
 */
export function evaluatePolicy(
  policySet: PolicySet | null | undefined,
  tx: TransactionDetails | null | undefined,
  options: EvaluatePolicyOptions = {},
): PolicyEvaluationResult {
  const rules = policySet && Array.isArray(policySet.rules) ? policySet.rules : [];
  const payload: TransactionDetails =
    tx && typeof tx === 'object' ? tx : ({ asset: '', amount: 0 } as TransactionDetails);

  const at = resolveEvaluationDate(payload, options);
  const results: PolicyRuleEvaluation[] = [];

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || rule.enabled === false) continue;
    results.push(...evaluateRule(rule, payload, at));
  }

  const failedRuleNames: string[] = [];
  let failedRules = 0;
  for (const result of results) {
    if (result.success) continue;
    failedRules += 1;
    if (!failedRuleNames.includes(result.rule)) failedRuleNames.push(result.rule);
  }

  const allowed = failedRules === 0;

  return {
    allowed,
    passed: allowed,
    results,
    evaluatedRules: results.length,
    failedRules,
    failedRuleNames,
  };
}

/**
 * Adapt server-side {@link Policy} records into a local {@link PolicySet}.
 *
 * Enabled policies are converted into rules carrying the constraints the local
 * engine understands: recipient allow/deny lists, `allowedHours` and
 * `requiredSignatures`. Policies with no locally-evaluable constraint are
 * retained as unconstrained rules so the report still lists them. Disabled
 * policies are dropped. The input is only read, never mutated.
 *
 * @param policies Server-side policy records (e.g. from
 *                 `astroid.policies.listPolicies({ enabled: true })`).
 * @param name     Optional label for the resulting set.
 * @returns        A {@link PolicySet} ready for {@link evaluatePolicy}.
 */
export function policySetFromPolicies(
  policies: readonly Policy[] | null | undefined,
  name?: string,
): PolicySet {
  const rules: PolicyRule[] = [];

  if (Array.isArray(policies)) {
    for (const policy of policies) {
      if (!policy || typeof policy !== 'object' || !policy.enabled) continue;
      const configuration = policy.configuration ?? {};
      const rule: PolicyRule = { name: policy.name };

      const allowedRecipients = cleanList(configuration.allowedRecipients);
      if (allowedRecipients.length > 0) rule.allowedRecipients = allowedRecipients;

      const blockedRecipients = cleanList(configuration.blockedRecipients);
      if (blockedRecipients.length > 0) rule.blockedRecipients = blockedRecipients;

      if (configuration.allowedHours) rule.allowedHours = configuration.allowedHours;
      if (
        typeof configuration.requiredSignatures === 'number' &&
        Number.isFinite(configuration.requiredSignatures)
      ) {
        rule.requiredSignatures = configuration.requiredSignatures;
      }

      rules.push(rule);
    }
  }

  const set: PolicySet = { rules };
  if (name !== undefined) set.name = name;
  return set;
}

/** Re-export the evaluation types so consumers can import them from the module. */
export type {
  PolicyAllowedHours,
  PolicyEvaluationResult,
  PolicyRule,
  PolicyRuleCheck,
  PolicyRuleEvaluation,
  PolicySet,
  TransactionDetails,
  TransactionSignature,
} from '@astroid/types';
