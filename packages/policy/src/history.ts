/**
 * Policy simulation history query helpers.
 *
 * @module
 */

import type { HttpClient, RequestOptionsExtras } from '@astroid/core';
import type {
  PaginationParams,
  PolicySimulationRequest,
  PolicySimulationResult,
  ResponseMeta,
} from '@astroid/types';

/** Endpoint used to retrieve policy simulation audit history. */
export const POLICY_SIMULATION_HISTORY_PATH = '/policies/simulation-history';

/** Filters and pagination options for policy simulation history. */
export interface PolicySimulationHistoryParams extends PaginationParams {
  /** Include simulations at or after this ISO-8601 timestamp. */
  from?: string;
  /** Include simulations at or before this ISO-8601 timestamp. */
  to?: string;
  /** Restrict results to an agent. */
  agentId?: string;
  /** Restrict results to a policy. */
  policyId?: string;
  /** Restrict results to simulations that passed or failed. */
  passed?: boolean;
}

/** A stored policy simulation and its audit context. */
export interface PolicySimulationHistoryEntry {
  id: string;
  policyId?: string;
  agentId?: string | null;
  walletId?: string | null;
  passed: boolean;
  createdAt: string;
  request?: PolicySimulationRequest;
  result?: PolicySimulationResult;
}

/** Paginated policy simulation history response. */
export interface PolicySimulationHistoryResponse {
  data: PolicySimulationHistoryEntry[];
  meta?: ResponseMeta;
}

/**
 * Fetch a page of policy simulation history with optional date, agent, policy,
 * pass/fail, and pagination filters.
 */
export async function getPolicySimulationHistory(
  client: HttpClient,
  params: PolicySimulationHistoryParams = {},
  options?: RequestOptionsExtras,
): Promise<PolicySimulationHistoryResponse> {
  const response = await client.get<PolicySimulationHistoryEntry[]>(
    POLICY_SIMULATION_HISTORY_PATH,
    {
      ...options,
      query: {
        page: params.page,
        cursor: params.cursor,
        limit: params.limit,
        order: params.order,
        from: params.from,
        to: params.to,
        agentId: params.agentId,
        policyId: params.policyId,
        passed: params.passed,
      },
    },
  );

  return { data: response.data, meta: response.meta };
}
