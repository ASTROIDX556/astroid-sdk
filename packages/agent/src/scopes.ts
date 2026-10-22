/**
 * Agent permission scope validation utilities for `@astroid/agent`.
 *
 * Autonomous agents operate under strict permission boundaries. This module
 * provides helpers to verify whether an agent instance possesses the required
 * scopes before executing sensitive resource actions.
 *
 * Supports hierarchical scopes (e.g., `wallet:*` covers `wallet:read`,
 * `wallet:write`, `wallet:transfer`) and wildcard matching (`*` matches all).
 *
 * @module
 */

import type { Agent } from '@astroid/types';

/**
 * Normalized scope string.
 *
 * Scopes follow the format `resource:action` (e.g., `wallet:read`,
 * `transaction:create`) or `resource:*` for all actions on a resource.
 * The special scope `*` grants all permissions.
 */
export type Scope = string;

/**
 * An agent with a `scopes` array property.
 *
 * The Astroid `Agent` entity doesn't currently include scopes in the core type,
 * so this interface extends it for scope-aware consumers. Agents that have
 * scopes attached (e.g., via `metadata.scopes` or a dedicated field) should
 * be narrowed to this type before calling the validators.
 */
export interface ScopedAgent extends Agent {
  /** Array of scope strings granted to this agent. */
  scopes: Scope[];
}

/**
 * Checks if a single scope string matches a required scope pattern.
 *
 * Matching rules:
 * - Exact match: `wallet:read` matches `wallet:read`
 * - Resource wildcard: `wallet:*` matches `wallet:read`, `wallet:write`, etc.
 * - Global wildcard: `*` matches any scope
 *
 * @param grantedScope - The scope the agent possesses.
 * @param requiredScope - The scope required for the action.
 * @returns `true` if the granted scope satisfies the requirement.
 *
 * @example
 * ```ts
 * scopeMatches('wallet:*', 'wallet:read');    // true
 * scopeMatches('wallet:read', 'wallet:read'); // true
 * scopeMatches('*', 'anything:everything');   // true
 * scopeMatches('wallet:read', 'wallet:write'); // false
 * ```
 */
export function scopeMatches(grantedScope: Scope, requiredScope: Scope): boolean {
  // Global wildcard matches everything
  if (grantedScope === '*') return true;

  // Exact match
  if (grantedScope === requiredScope) return true;

  // Resource wildcard: granted "wallet:*" covers required "wallet:read"
  if (grantedScope.endsWith(':*')) {
    const resourcePrefix = grantedScope.slice(0, -1); // "wallet:"
    return requiredScope.startsWith(resourcePrefix);
  }

  return false;
}

/**
 * Checks whether an agent has a specific required scope.
 *
 * @param agent - The agent to check (must have a `scopes` array).
 * @param requiredScope - The scope required for the action (e.g., `wallet:transfer`).
 * @returns `true` if the agent has a matching scope.
 *
 * @example
 * ```ts
 * const agent = { ..., scopes: ['wallet:*', 'transaction:read'] } as ScopedAgent;
 * hasAgentScope(agent, 'wallet:transfer'); // true
 * hasAgentScope(agent, 'budget:create');   // false
 * ```
 */
export function hasAgentScope(agent: ScopedAgent, requiredScope: Scope): boolean {
  if (!agent.scopes || !Array.isArray(agent.scopes) || agent.scopes.length === 0) {
    return false;
  }

  return agent.scopes.some((granted) => scopeMatches(granted, requiredScope));
}

/**
 * Validates that an agent has all of the required scopes.
 *
 * Throws an `AuthorizationError` if any required scope is missing.
 *
 * @param agent - The agent to validate.
 * @param requiredScopes - Array of scopes required for the action.
 * @throws {AuthorizationError} When the agent lacks one or more required scopes.
 * @returns `void` (throws on failure).
 *
 * @example
 * ```ts
 * validateAgentScopes(agent, ['wallet:read', 'wallet:write']);
 * // Proceed with wallet operations...
 * ```
 */
export function validateAgentScopes(agent: ScopedAgent, requiredScopes: Scope[]): void {
  const missing = requiredScopes.filter((scope) => !hasAgentScope(agent, scope));

  if (missing.length > 0) {
    const { AuthorizationError } = require('@astroid/errors');
    throw new AuthorizationError(
      `Agent ${agent.id} lacks required scope(s): ${missing.join(', ')}`,
      {
        code: 'INSUFFICIENT_SCOPE',
        status: 403,
        details: {
          agentId: agent.id,
          requiredScopes,
          missingScopes: missing,
          grantedScopes: agent.scopes,
        },
      },
    );
  }
}

/**
 * Returns the list of scopes an agent is missing for a given requirement.
 *
 * Useful for diagnostic/logging purposes when you want to know exactly
 * which scopes are missing without throwing.
 *
 * @param agent - The agent to check.
 * @param requiredScopes - Array of scopes required for the action.
 * @returns Array of missing scope strings (empty if all present).
 *
 * @example
 * ```ts
 * const missing = getMissingScopes(agent, ['wallet:read', 'wallet:write']);
 * if (missing.length > 0) {
 *   logger.warn({ agentId: agent.id, missing }, 'Scope check failed');
 * }
 * ```
 */
export function getMissingScopes(agent: ScopedAgent, requiredScopes: Scope[]): Scope[] {
  return requiredScopes.filter((scope) => !hasAgentScope(agent, scope));
}

/**
 * Checks whether an agent has **any** of the required scopes (OR logic).
 *
 * @param agent - The agent to check.
 * @param requiredScopes - Array of scopes; at least one must match.
 * @returns `true` if the agent has at least one matching scope.
 *
 * @example
 * ```ts
 * // Agent needs either wallet:read OR transaction:read
 * hasAnyScope(agent, ['wallet:read', 'transaction:read']);
 * ```
 */
export function hasAnyScope(agent: ScopedAgent, requiredScopes: Scope[]): boolean {
  if (!agent.scopes || !Array.isArray(agent.scopes) || agent.scopes.length === 0) {
    return false;
  }

  return requiredScopes.some((required) => hasAgentScope(agent, required));
}

/**
 * Type guard to narrow an `Agent` to a `ScopedAgent`.
 *
 * Checks if the agent has a `scopes` property that is a non-empty array of strings.
 *
 * @param agent - The agent to check.
 * @returns `true` if the agent has valid scopes.
 */
export function isScopedAgent(agent: Agent): agent is ScopedAgent {
  return (
    agent !== null &&
    typeof agent === 'object' &&
    'scopes' in agent &&
    Array.isArray((agent as Record<string, unknown>).scopes) &&
    ((agent as Record<string, unknown>).scopes as unknown[]).every((s) => typeof s === 'string')
  );
}

/**
 * Extracts scopes from an agent's metadata if present.
 *
 * Some deployments store scopes in `agent.metadata.scopes` rather than
 * a top-level field. This helper checks both locations.
 *
 * @param agent - The agent to extract scopes from.
 * @returns Array of scope strings, or empty array if none found.
 */
export function extractScopes(agent: Agent): Scope[] {
  // First check for top-level scopes property
  if (isScopedAgent(agent)) {
    return agent.scopes;
  }

  // Then check metadata.scopes
  const metadata = agent.metadata as Record<string, unknown> | undefined;
  const metadataScopes = metadata?.scopes;
  if (Array.isArray(metadataScopes) && metadataScopes.every((s) => typeof s === 'string')) {
    return metadataScopes as Scope[];
  }

  return [];
}

/**
 * Creates a `ScopedAgent` by extracting scopes from an agent's metadata.
 *
 * Useful when scopes are stored in `metadata.scopes` and you need a
 * `ScopedAgent` for the validation functions.
 *
 * @param agent - The base agent.
 * @returns A `ScopedAgent` with scopes populated from metadata (or empty array).
 */
export function toScopedAgent(agent: Agent): ScopedAgent {
  return {
    ...agent,
    scopes: extractScopes(agent),
  };
}