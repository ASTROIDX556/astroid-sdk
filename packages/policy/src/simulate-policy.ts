/**
 * Server-side policy simulation endpoint helper.
 *
 * {@link simulatePolicy} performs a pre-flight dry-run of a proposed
 * transaction against an organization's active policy rules or against a
 * single policy by ID. It talks to the Astroid simulation endpoints through
 * an injected transport or default HTTP client, so it can be used with an
 * `@astroid/client` instance, a raw `HttpClient`, or a mock in tests —
 * without constructing a `PolicyResource`.
 *
 * A blocked transaction is not an error: the endpoint responds with an
 * `allowed: false` result describing the breached rules.
 *
 * @module
 */

import { HttpClient, type AstroidResponse, type RequestOptionsExtras } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import type {
  PolicySimulationEvaluation,
  PolicySimulationInput,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';
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

/** Options for simulating a policy by ID. */
export interface PolicySimulationOptions extends RequestOptionsExtras {
  /** Optional custom transport client. */
  client?: PolicySimulationHttpClient;
}

/**
 * Simulate a proposed transaction against a single policy by ID.
 *
 * Distinguishes between allowed actions and rule violations: a policy denial resolves
 * normally with `allowed: false` and the breached rules populated in `violatedRules`.
 *
 * @param policyId The ID of the policy to simulate against.
 * @param payload  The candidate payment or operational payload.
 * @param options  Optional transport or request options.
 * @returns        Strongly typed simulation results distinguishing between allowed actions and rule violations.
 *
 * @example
 * ```ts
 * const result = await simulatePolicy('pol_123', {
 *   asset: 'USDC',
 *   amount: '100',
 *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
 * });
 *
 * if (result.allowed) {
 *   console.log('Transfer is permitted');
 * } else {
 *   for (const violation of result.violatedRules) {
 *     console.warn(`Rule breached: ${violation.rule} - ${violation.message}`);
 *   }
 * }
 * ```
 */
export async function simulatePolicy(
  policyId: string,
  payload: PolicySimulationInput,
  options?: PolicySimulationOptions,
): Promise<PolicySimulationEvaluation>;
export async function simulatePolicy(
  policyId: string,
  payload: PolicySimulationInput,
  client: PolicySimulationHttpClient,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationEvaluation>;
export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  policyId: string,
  payload: PolicySimulationInput,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationEvaluation>;
export async function simulatePolicy(
  client: PolicySimulationHttpClient,
  input: PolicySimulationRequest,
  options?: RequestOptionsExtras,
): Promise<PolicySimulationResult>;
export async function simulatePolicy(
  first: string | PolicySimulationHttpClient,
  second: PolicySimulationInput | PolicySimulationRequest | string,
  third?:
    | PolicySimulationHttpClient
    | PolicySimulationOptions
    | PolicySimulationInput
    | RequestOptionsExtras,
  fourth?: RequestOptionsExtras,
): Promise<PolicySimulationEvaluation | PolicySimulationResult> {
  // If first is string: simulatePolicy(policyId, payload, options/client, options)
  if (typeof first === 'string') {
    const policyId = first;
    const payload = second as PolicySimulationInput;
    let client: PolicySimulationHttpClient;
    let requestOptions: RequestOptionsExtras | undefined;

    if (third && typeof (third as PolicySimulationHttpClient).post === 'function') {
      client = third as PolicySimulationHttpClient;
      requestOptions = fourth;
    } else {
      const opts = third as PolicySimulationOptions | undefined;
      client = opts?.client ?? new HttpClient({});
      requestOptions = opts;
    }

    return simulatePolicyEvaluation(client, policyId, payload, requestOptions);
  }

  // first is client
  const client = first;
  if (typeof second === 'string') {
    const policyId = second;
    const payload = third as PolicySimulationInput;
    return simulatePolicyEvaluation(client, policyId, payload, fourth);
  }

  const input = second as PolicySimulationRequest;
  const options = third as RequestOptionsExtras | undefined;
  const validation = PolicySimulationRequestSchema.safeParse(input);
  if (!validation.success) {
    throw new ValidationError('Validation failed for PolicySimulationRequest', {
      code: 'VALIDATION_ERROR',
      details: {
        fields: validation.error.flatten().fieldErrors,
      },
    });
  }

  const res = await client.post<PolicySimulationResult>(POLICY_SIMULATE_PATH, input, options);
  return res.data;
}
