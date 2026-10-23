/**
 * Policy update simulation helper (issue #249).
 *
 * {@link simulatePolicyUpdate} validates a **proposed policy rule change**
 * against historical transaction payloads before the update is persisted.
 * Modifying an agent's spending policy without this dry-run can silently
 * reject future Stellar transactions; replaying recent history against the
 * candidate rule surfaces the damage up front.
 *
 * The helper talks to the `POST /policies/simulate-update` endpoint through a
 * minimal injected transport, so it can be used with an `@astroid/client`
 * instance, a raw `HttpClient`, or a mock in tests — without constructing a
 * `PolicyResource`. Input is validated strictly on the client before any
 * network call is made.
 *
 * An unsafe proposed rule is not an error: the endpoint responds with a
 * `valid: false` {@link PolicyUpdateSimulationResult} describing the blocked
 * historical transactions and the estimated impact of persisting the change.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { AstroidResponse } from '@astroid/core';
import type { PolicyUpdateSimulationRequest, PolicyUpdateSimulationResult } from '@astroid/types';

/** The path of the server-side policy update simulation endpoint. */
export const POLICY_SIMULATE_UPDATE_PATH = '/policies/simulate-update';

/**
 * The minimal HTTP surface {@link simulatePolicyUpdate} needs.
 *
 * `@astroid/core`'s `HttpClient` satisfies this shape, which is what
 * `PolicyResource` passes in; tests can pass a lightweight mock.
 */
export interface PolicyUpdateSimulationHttpClient {
  post<TData>(path: string, body?: unknown): Promise<AstroidResponse<TData>>;
}

/** Whether `value` is a non-empty, non-blank string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Whether `value` is a non-empty array whose entries are all non-empty strings. */
function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

/** Whether `value` is a finite number (number or numeric string form). */
function isFiniteAmount(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/** Whether `value` is a plain object (not an array, not `null`). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a locally-evaluable policy rule (shape of `PolicyRule`). */
function isPolicyRuleLike(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  // `PolicyRule.name` is a required field of the DTO: it is the label every
  // simulation outcome reports, so a proposed rule without one is invalid.
  if (!isNonEmptyString(value['name'])) return false;
  if (value['enabled'] !== undefined && typeof value['enabled'] !== 'boolean') return false;
  if (
    value['allowedRecipients'] !== undefined &&
    !isNonEmptyStringArray(value['allowedRecipients'])
  ) {
    return false;
  }
  if (
    value['blockedRecipients'] !== undefined &&
    !isNonEmptyStringArray(value['blockedRecipients'])
  ) {
    return false;
  }
  if (value['requiredSignatures'] !== undefined) {
    const weight = value['requiredSignatures'];
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0) return false;
  }
  return true;
}

/** Whether `value` is a transaction payload (shape of `TransactionDetails`). */
function isTransactionDetailsLike(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value['asset'])) return false;
  return isFiniteAmount(value['amount']);
}

/**
 * Validate a policy update simulation request before dispatching it.
 *
 * Throws a {@link ValidationError} with the offending `field` in `details`
 * when the payload is malformed, so bad input never reaches the API.
 *
 * @param input The request to validate.
 * @throws      `ValidationError` when required fields are missing or malformed.
 */
export function validatePolicyUpdateSimulationInput(input: PolicyUpdateSimulationRequest): void {
  if (!isPlainObject(input)) {
    throw new ValidationError(
      'Policy update simulation failed: the request must be a non-null object.',
      { code: 'VALIDATION_ERROR', status: 400, details: { received: typeof input } },
    );
  }

  if (!isNonEmptyString(input.policyId)) {
    throw new ValidationError(
      'Policy update simulation failed: "policyId" is required and must be a non-empty string.',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'policyId', received: input.policyId },
      },
    );
  }

  if (!isPolicyRuleLike(input.proposedRule)) {
    throw new ValidationError(
      'Policy update simulation failed: "proposedRule" must be a valid policy rule object.',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'proposedRule', received: input.proposedRule },
      },
    );
  }

  if (
    !Array.isArray(input.transactions) ||
    input.transactions.length === 0 ||
    !input.transactions.every(isTransactionDetailsLike)
  ) {
    throw new ValidationError(
      'Policy update simulation failed: "transactions" must be a non-empty array of transaction payloads (each with an "asset" and a finite "amount").',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'transactions', received: input.transactions },
      },
    );
  }

  if (input.agentId !== undefined && !isNonEmptyString(input.agentId)) {
    throw new ValidationError(
      'Policy update simulation failed: "agentId" must be a non-empty string when provided.',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'agentId', received: input.agentId },
      },
    );
  }

  if (input.walletId !== undefined && !isNonEmptyString(input.walletId)) {
    throw new ValidationError(
      'Policy update simulation failed: "walletId" must be a non-empty string when provided.',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'walletId', received: input.walletId },
      },
    );
  }

  if (input.metadata !== undefined && !isPlainObject(input.metadata)) {
    throw new ValidationError(
      'Policy update simulation failed: "metadata" must be a plain object when provided.',
      {
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'metadata', received: input.metadata },
      },
    );
  }
}

/**
 * Simulate a proposed policy rule change against historical transactions.
 *
 * The proposed rule is replayed against each supplied historical payload so
 * the caller can see, before persisting anything, exactly which transactions
 * the change would reject, which rule checks pass, and the estimated impact.
 * Nothing is committed — the endpoint is a pure dry-run.
 *
 * @param client The transport used to reach the API (an `HttpClient` satisfies it).
 * @param input  The policy id, the proposed rule and the historical transactions.
 * @returns      The verdict, per-transaction outcomes, aggregate impact and a
 *               human-readable explanation. An unsafe change resolves
 *               normally with `valid: false`.
 * @throws       `ValidationError` when the request payload is malformed;
 *               `NetworkError` / typed API errors when the request itself fails.
 *
 * @example
 * ```ts
 * import { HttpClient } from '@astroid/core';
 * import { simulatePolicyUpdate } from '@astroid/policy';
 *
 * const http = new HttpClient({ apiKey: process.env.ASTROID_API_KEY! });
 *
 * const result = await simulatePolicyUpdate(http, {
 *   policyId: 'pol_max',
 *   proposedRule: { name: 'max-250', allowedRecipients: ['GABCD…'] },
 *   transactions: [{ asset: 'USDC', amount: '150' }],
 * });
 *
 * if (!result.valid) {
 *   console.warn(result.explanation, result.estimatedImpact);
 * }
 * ```
 */
export async function simulatePolicyUpdate(
  client: PolicyUpdateSimulationHttpClient,
  input: PolicyUpdateSimulationRequest,
): Promise<PolicyUpdateSimulationResult> {
  validatePolicyUpdateSimulationInput(input);
  const res = await client.post<PolicyUpdateSimulationResult>(POLICY_SIMULATE_UPDATE_PATH, input);
  return res.data;
}
