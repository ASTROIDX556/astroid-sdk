/**
 * Server-side policy simulation endpoint helper.
 *
 * {@link simulatePolicy} performs a pre-flight dry-run of a proposed
 * transaction against an organization's active policy rules. It talks to the
 * `POST /policies/simulate` endpoint through a minimal injected transport, so it
 * can be used with an `@astroid/client` instance, a raw `HttpClient`, or a mock
 * in tests — without constructing a `PolicyResource`.
 *
 * A blocked transaction is not an error: the endpoint responds with an
 * `allowed: false` {@link PolicySimulationResult} describing the breached rules.
 *
 * @module
 */

import type { AstroidResponse, RequestOptionsExtras } from '@astroid/core';
import type {
  PolicySimulationEvaluation,
  PolicySimulationInput,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';
import { ValidationError } from '@astroid/errors';
import { PolicySimulationRequestSchema } from './schemas.js';
import { simulatePolicyEvaluation } from './simulation.js';

/** The path of the server-side policy simulation endpoint. */
export const POLICY_SIMULATE_PATH = '/policies/simulate';

/**
 * The minimal HTTP surface {@link simulatePolicy} needs.
 *
 * `@astroid/core`'s `HttpClient` satisfies this shape, which is what
 * `PolicyResource` passes in; tests can pass a lightweight mock.
 */
export interface PolicySimulationHttpClient {
  post<TData>(
    path: string,
    body?: unknown,
    options?: RequestOptionsExtras,
  ): Promise<AstroidResponse<TData>>;
}

/**
 * Simulate a proposed transaction against a single policy by ID.
 *
 * Runs local payload validation and sends the dry-run request to
 * `POST /policies/{policyId}/simulate`. Returns a {@link PolicySimulationEvaluation}
 * describing whether the transaction complies with the specific policy.
 *
 * @param client   The transport used to reach the API (`HttpClient` or `@astroid/client`).
 * @param policyId The ID of the policy to evaluate against.
 * @param input    The transaction payload (`asset`, `amount`, `recipientAddress`, etc.).
 * @param options  Extra request options (e.g. `signal`, `timeoutMs`).
 * @returns        Detailed simulation evaluation containing decision, rule breaches, risk score, and budget impact.
 *
 * @example
 * ```ts
 * import { HttpClient } from '@astroid/core';
 * import { simulatePolicy } from '@astroid/policy';
 *
 * const http = new HttpClient({ apiKey: process.env.ASTROID_API_KEY! });
 * const evaluation = await simulatePolicy(http, 'pol_123', {
 *   asset: 'USDC',
 *   amount: '100.00',
 *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
 * });

 * if (!evaluation.allowed) {
 *   console.warn(evaluation.explanation);
 * }
 * ```
 */
export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  policyId: string,
  input: PolicySimulationInput,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationEvaluation>;

/**
 * Simulate a proposed transaction against an organization's active policy rules.
 *
 * Combines the transaction payload with the rules to evaluate (scoped by `walletId`, `agentId`,
 * or `policyIds`). Sends the dry-run request to `POST /policies/simulate` and returns
 * a {@link PolicySimulationResult}.
 *
 * @param client  The transport used to reach the API (`HttpClient` or `@astroid/client`).
 * @param input   The transaction payload plus policy scoping (`walletId`, `agentId`, or `policyIds`).
 * @param options Extra request options (e.g. `signal`, `timeoutMs`).
 * @returns       Simulation decision, rule violations, required approvals, risk assessment, and budget impact.
 *
 * @example
 * ```ts
 * const result = await simulatePolicy(http, {
 *   walletId: 'w_1',
 *   asset: 'USDC',
 *   amount: '250.00',
 *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
 * });
 * ```
 */
export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  input: PolicySimulationRequest,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationResult>;

export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  policyIdOrRequest: string | PolicySimulationRequest,
  inputOrOptions?: PolicySimulationInput | RequestOptionsExtras,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationResult | PolicySimulationEvaluation> {
  if (typeof policyIdOrRequest === 'string') {
    const policyId = policyIdOrRequest;
    const input = inputOrOptions as PolicySimulationInput;
    return simulatePolicyEvaluation(client, policyId, input, options);
  }

  const input = policyIdOrRequest as PolicySimulationRequest;
  const reqOptions = inputOrOptions as RequestOptionsExtras | undefined;

  const validation = PolicySimulationRequestSchema.safeParse(input);
  if (!validation.success) {
    throw new ValidationError('Validation failed for PolicySimulationRequest', {
      code: 'VALIDATION_ERROR',
      details: {
        fields: validation.error.flatten().fieldErrors,
      },
    });
  }

  const res = await client.post<PolicySimulationResult>(POLICY_SIMULATE_PATH, input, reqOptions);
  return res.data;
}
