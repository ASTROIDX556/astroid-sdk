/**
 * Policy scope matchers — deciding which rules apply to a transaction context.
 *
 * Simulation answers "does this transaction pass?"; matching answers the
 * prior question, "which policies even apply here?". A matcher is a pure
 * predicate over a {@link Policy} and a {@link PolicyScope} so callers can
 * pre-select the rule set before a (local or server-side) dry-run, e.g. to
 * explain *why* a policy was evaluated or to skip irrelevant rules entirely.
 *
 * All helpers are pure and never throw: malformed policies or scopes simply
 * do not match.
 *
 * ```ts
 * import { matchPolicies } from '@astroid/policy';
 *
 * const applicable = matchPolicies(policies, { agentId: 'ag_1', asset: 'USDC' });
 * const report = evaluatePolicyRules(applicable, { asset: 'USDC', amount: '150' });
 * ```
 *
 * @module
 */

import type { Policy } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The transaction context a policy is matched against.
 */
export interface PolicyScope {
  /** Agent proposing the transaction; agent-scoped policies require this. */
  agentId?: string;
  /** Asset the transaction moves (`XLM`, `USDC`, `USDC:G…Issuer`). */
  asset?: string;
  /**
   * When `true`, disabled policies are considered applicable.
   * Defaults to `false` (enabled policies only).
   */
  includeDisabled?: boolean;
}

/**
 * A predicate deciding whether a policy applies to a scope.
 *
 * Receives the candidate policy and the transaction scope; returns `true`
 * when the policy should be evaluated. Implementations must be pure and
 * total (never throw on malformed input).
 */
export type PolicyMatcher = (
  policy: Policy | null | undefined,
  scope: PolicyScope | null | undefined,
) => boolean;

/* -------------------------------------------------------------------------- */
/* Asset matching helpers                                                      */
/* -------------------------------------------------------------------------- */

/** The asset code portion of an identifier (`USDC:G…` → `USDC`). */
function assetCode(asset: string): string {
  return asset.split(':')[0]?.trim().toUpperCase() ?? '';
}

/** Case-insensitive asset matching: exact, or by code when issuers differ. */
function assetMatches(configured: string, txAsset: string): boolean {
  if (configured.trim().toUpperCase() === txAsset.trim().toUpperCase()) return true;
  return assetCode(configured) === assetCode(txAsset);
}

/* -------------------------------------------------------------------------- */
/* Scope matching                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a policy applies to a transaction scope.
 *
 * A policy matches when **all** of the following hold:
 *
 * - It is enabled (unless `scope.includeDisabled` is `true`).
 * - Agent scoping: a globally-scoped policy (`agentId` nullish) applies
 *   everywhere; an agent-scoped policy applies only when `scope.agentId`
 *   equals it. An agent-scoped policy with no `scope.agentId` does not match
 *   (applicability cannot be confirmed).
 * - Asset scoping: when `scope.asset` is given, a policy constraining
 *   `configuration.asset` requires a match, and a non-empty
 *   `configuration.allowedAssets` requires the asset to be listed. Negative
 *   constraints (`blockedAssets`) never narrow applicability — a policy that
 *   blocks the asset still *applies* (it will report a violation).
 *
 * Malformed inputs (nullish policy/scope, non-object shapes) return `false`.
 *
 * @param policy Candidate policy rule.
 * @param scope  Transaction context to match against.
 * @returns      Whether the policy should be evaluated for the scope.
 *
 * @example
 * ```ts
 * matchesPolicyScope(agentPolicy, { agentId: 'ag_1', asset: 'USDC' }); // true
 * matchesPolicyScope(agentPolicy, { agentId: 'ag_2' }); // false
 * matchesPolicyScope(disabledPolicy, {}); // false
 * ```
 */
export function matchesPolicyScope(
  policy: Policy | null | undefined,
  scope: PolicyScope | null | undefined,
): boolean {
  if (!policy || typeof policy !== 'object' || !scope || typeof scope !== 'object') return false;

  if (!policy.enabled && scope.includeDisabled !== true) return false;

  const policyAgentId = policy.agentId ?? null;
  if (policyAgentId !== null && policyAgentId !== undefined) {
    if (typeof scope.agentId !== 'string' || scope.agentId !== policyAgentId) return false;
  }

  if (typeof scope.asset === 'string' && scope.asset.trim().length > 0) {
    const configuration = policy.configuration ?? {};
    const pinned = typeof configuration.asset === 'string' ? configuration.asset : undefined;
    if (pinned !== undefined && !assetMatches(pinned, scope.asset)) return false;
    const allowed = Array.isArray(configuration.allowedAssets)
      ? configuration.allowedAssets.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        )
      : [];
    if (allowed.length > 0 && !allowed.some((entry) => assetMatches(entry, scope.asset as string))) {
      return false;
    }
  }

  return true;
}

/**
 * Select every policy that applies to a scope, preserving input order.
 *
 * Pure function: inputs are only read, never mutated. A non-array `policies`
 * yields `[]`; policies failing {@link matchesPolicyScope} are dropped.
 *
 * @param policies Candidate policy rules.
 * @param scope    Transaction context to match against.
 * @param matcher  Predicate used for selection (defaults to {@link matchesPolicyScope}).
 * @returns        The applicable policies, in their original order.
 *
 * @example
 * ```ts
 * const { data: policies } = await astroid.policies.listPolicies({ enabled: true });
 * const applicable = matchPolicies(policies, { agentId: 'ag_1', asset: 'USDC' });
 * ```
 */
export function matchPolicies(
  policies: readonly Policy[] | null | undefined,
  scope: PolicyScope | null | undefined,
  matcher: PolicyMatcher = matchesPolicyScope,
): Policy[] {
  if (!Array.isArray(policies) || !scope || typeof scope !== 'object') return [];
  return policies.filter((policy) => {
    try {
      return matcher(policy, scope);
    } catch {
      return false;
    }
  });
}

/**
 * Combine several matchers into one.
 *
 * - `'all'` (default): the policy must satisfy every matcher (narrowing).
 * - `'any'`: the policy must satisfy at least one matcher (broadening).
 *
 * An empty matcher list matches everything under `'all'` and nothing under
 * `'any'`, following the vacuous-truth convention. Never throws.
 *
 * @param matchers Predicates to combine.
 * @param mode     Combination mode (`'all'` or `'any'`).
 * @returns        A single {@link PolicyMatcher} applying the combination.
 *
 * @example
 * ```ts
 * const matcher = combineMatchers([matchesPolicyScope, onlyMaxAmount], 'all');
 * const applicable = matchPolicies(policies, scope, matcher);
 * ```
 */
export function combineMatchers(
  matchers: readonly PolicyMatcher[] | null | undefined,
  mode: 'all' | 'any' = 'all',
): PolicyMatcher {
  return (policy, scope) => {
    if (!Array.isArray(matchers) || matchers.length === 0) return mode === 'all';
    try {
      return mode === 'all'
        ? matchers.every((matcher) => matcher(policy, scope))
        : matchers.some((matcher) => matcher(policy, scope));
    } catch {
      return false;
    }
  };
}
