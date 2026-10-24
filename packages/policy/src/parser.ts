/**
 * Strongly typed simulation result parser.
 *
 * Parses simulation JSON into clear summary objects showing whether a
 * transaction passed or failed and identifying any violated policy rules.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';

export interface ViolatedPolicyRule {
  /** Rule identifier/name that was violated */
  rule: string;
  /** Human-readable explanation of the violation */
  message?: string;
  /** Policy identifier if available */
  policyId?: string;
  /** Policy name if available */
  policyName?: string;
  /** Policy type if available */
  policyType?: string;
  /** Configured limit that was breached */
  limit?: number | string;
  /** Actual value that breached the limit */
  actual?: number | string;
  /** Additional details */
  [key: string]: unknown;
}

export interface SimulationResultSummary {
  /** Whether the transaction passed/complied with policies */
  passed: boolean;
  /** Whether the transaction failed/was blocked by policies */
  failed: boolean;
  /** Whether the transaction was allowed */
  allowed: boolean;
  /** Whether the transaction was denied/blocked */
  denied: boolean;
  /** List of violated policy rules */
  violatedRules: ViolatedPolicyRule[];
  /** Number of violated rules */
  violationCount: number;
  /** Human-readable explanation */
  explanation?: string;
  /** Raw simulation result if needed */
  raw?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') return trimmed;
  }
  return undefined;
}

function firstBoolean(...candidates: unknown[]): boolean | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;
  }
  return undefined;
}

function firstArray(...candidates: unknown[]): unknown[] | undefined {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

function toComparable(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  return undefined;
}

function normalizeViolatedRule(entry: unknown): ViolatedPolicyRule | null {
  if (typeof entry === 'string') {
    const rule = entry.trim();
    if (rule === '') return null;
    return { rule };
  }

  if (!isRecord(entry)) return null;

  // Try to extract rule name from common fields
  const rule =
    firstString(entry.rule, entry.ruleId, entry.ruleName, entry.name, entry.code, entry.type) ??
    'POLICY_RULE';

  const message =
    firstString(entry.message, entry.explanation, entry.reason, entry.detail, entry.description) ??
    `Transaction violates policy rule "${rule}".`;

  const violated: ViolatedPolicyRule = {
    rule,
    message,
  };

  const policyId = firstString(entry.policyId, entry.policy_id);
  if (policyId !== undefined) violated.policyId = policyId;

  const policyName = firstString(entry.policyName, entry.policy_name, entry.policy);
  if (policyName !== undefined) violated.policyName = policyName;

  const policyType = firstString(entry.policyType, entry.policy_type);
  if (policyType !== undefined) violated.policyType = policyType;

  const limit = toComparable(entry.limit);
  if (limit !== undefined) violated.limit = limit;

  const actual = toComparable(entry.actual) ?? toComparable(entry.actualValue);
  if (actual !== undefined) violated.actual = actual;

  // Copy any other fields
  for (const [key, value] of Object.entries(entry)) {
    if (!(key in violated) && value !== undefined) {
      violated[key] = value;
    }
  }

  return violated;
}

/**
 * Parse simulation JSON into a clear summary object showing whether a
 * transaction passed or failed and identifying any violated policy rules.
 *
 * This parser is defensive and handles various simulation result formats
 * from different API endpoints.
 *
 * @param raw - The raw simulation JSON/result to parse
 * @returns A strongly typed summary object
 * @throws {ValidationError} If the payload is completely invalid and cannot be parsed
 */
export function parseSimulationResult(raw: unknown): SimulationResultSummary {
  if (raw === null || raw === undefined) {
    throw new ValidationError('Simulation result cannot be null or undefined', {
      code: 'INVALID_SIMULATION_RESULT',
      details: { field: 'result' },
    });
  }

  if (!isRecord(raw)) {
    throw new ValidationError('Simulation result must be an object', {
      code: 'INVALID_SIMULATION_RESULT',
      details: { field: 'result', received: typeof raw },
    });
  }

  // Extract violated rules from various possible field names
  const rawViolations =
    firstArray(
      raw.violatedRules,
      raw.violations,
      raw.breaches,
      raw.failedRules,
      raw.triggeredRules,
      raw.violatedConstraints,
      raw.errors,
    ) ?? [];

  const violatedRules: ViolatedPolicyRule[] = [];
  for (const entry of rawViolations) {
    const normalized = normalizeViolatedRule(entry);
    if (normalized !== null) {
      violatedRules.push(normalized);
    }
  }

  // Determine pass/fail status from various field names
  let passed: boolean | undefined;
  let allowed: boolean | undefined;
  let failed: boolean | undefined;
  let denied: boolean | undefined;

  passed = firstBoolean(raw.passed, raw.success, raw.ok);
  allowed = firstBoolean(raw.allowed, raw.permitted);
  failed = firstBoolean(raw.failed);
  denied = firstBoolean(raw.denied, raw.blocked, raw.rejected);

  // If not explicitly set, derive from allowed/denied/passed
  if (passed === undefined && allowed !== undefined) {
    passed = allowed;
  }
  if (allowed === undefined && passed !== undefined) {
    allowed = passed;
  }
  if (failed === undefined && denied !== undefined) {
    failed = denied;
  }
  if (denied === undefined && failed !== undefined) {
    denied = failed;
  }

  // If still undefined, derive from violations
  if (passed === undefined && allowed === undefined) {
    if (violatedRules.length > 0) {
      passed = false;
      allowed = false;
    } else {
      // If no violations and no explicit status, be conservative but reasonable
      // Check if there might be other indicators
      passed = true;
      allowed = true;
    }
  }

  if (passed === undefined) passed = allowed ?? false;
  if (allowed === undefined) allowed = passed;
  if (failed === undefined) failed = !passed;
  if (denied === undefined) denied = !allowed;

  // Ensure consistency
  passed = !!passed;
  allowed = !!allowed;
  failed = !passed;
  denied = !allowed;

  const explanation =
    firstString(raw.explanation, raw.message, raw.reason, raw.summary, raw.error) ??
    (passed
      ? 'Transaction complies with all policies.'
      : `Transaction is blocked by ${violatedRules.length} policy rule${
          violatedRules.length === 1 ? '' : 's'
        }.`);

  return {
    passed,
    failed,
    allowed,
    denied,
    violatedRules,
    violationCount: violatedRules.length,
    explanation,
    raw,
  };
}

/**
 * Alias for parseSimulationResult for compatibility with different naming conventions
 */
export const parsePolicySimulationResult = parseSimulationResult;
export const parseSimulation = parseSimulationResult;
export const parsePolicyResult = parseSimulationResult;

/**
 * Parse simulation result and return just the violated rules
 */
export function extractViolatedRules(raw: unknown): ViolatedPolicyRule[] {
  const summary = parseSimulationResult(raw);
  return summary.violatedRules;
}

/**
 * Check if a simulation result indicates failure/violation
 */
export function isSimulationFailed(raw: unknown): boolean {
  const summary = parseSimulationResult(raw);
  return summary.failed || summary.denied || !summary.passed;
}

/**
 * Check if a simulation result indicates success/passage
 */
export function isSimulationPassed(raw: unknown): boolean {
  const summary = parseSimulationResult(raw);
  return summary.passed && summary.allowed && !summary.failed;
}
