export * from './calculator.js';
export * from './budget.js';

// `metrics.ts` and `validation.ts` both export a `SpendRequest` alias for the
// same shape; re-export explicitly to avoid a duplicate-export ambiguity.
export {
  calculateUtilization,
  isThresholdExceeded,
  estimateBurnRate,
  type SpendRequest,
  type UtilizationResult,
  type ThresholdResult,
  type BurnRateResult,
} from './metrics.js';
export { checkBudgetLimit, type BudgetValidationResult } from './validation.js';

export {
  assertValidThresholdPercent,
  createBudgetAlert,
  deleteBudgetAlert,
  getBudgetAlert,
  isValidBudgetAlertChannel,
  listBudgetAlerts,
  updateBudgetAlert,
  BudgetAlertValidationError,
  BUDGET_ALERT_THRESHOLDS,
  type BudgetAlert,
  type BudgetAlertChannel,
  type CreateBudgetAlertInput,
  type UpdateBudgetAlertInput,
  type ListBudgetAlertsParams,
} from './alerts.js';
export {
  BudgetClient,
  classifyAllocation,
  deriveAllocationStatus,
  isAllocationExhausted,
  toBudgetQuery,
  DEFAULT_ALLOCATION_THRESHOLDS,
  type BudgetHttpClient,
  type BudgetQuery,
  type BudgetRequestOptions,
  type DeriveAllocationOptions,
  type ListBudgetsParams,
} from './budget.js';
export {
  validateSimulationRequest,
  resolveBudgetWindow,
  resolveBudgetRemaining,
  isBudgetExpired,
  toBudgetCheckResult,
  type ValidateSimulationOptions,
} from './simulation.js';

import { Resource } from '@astroid/core';
import type {
  Budget,
  BudgetHistoryEntry,
  BudgetPeriod,
  BudgetSimulationCheckResult,
  BudgetSimulationInput,
  BudgetSimulationResult,
  BudgetUtilization,
  ConsumeBudgetInput,
  CreateBudgetInput,
  Paginated,
  PaginationParams,
  UpdateBudgetInput,
} from '@astroid/types';
import { validateSimulationRequest, type ValidateSimulationOptions } from './simulation.js';

/** Filters accepted by {@link BudgetResource.list}. */
export interface BudgetListParams extends PaginationParams {
  period?: BudgetPeriod;
  enabled?: boolean;
  agentId?: string;
  walletId?: string;
  /** Field to sort the returned budgets by. */
  sort?: string;
}

/**
 * The `budgets` namespace on the Astroid client.
 *
 * Budgets are created against an organization/agent, consumed as transactions
 * settle, and can roll over between periods. {@link BudgetResource.consume}
 * records a draw explicitly (the transaction pipeline normally does this for
 * you); {@link BudgetResource.history} returns the audit trail.
 */
export class BudgetResource extends Resource {
  /** Create a new budget. */
  async create(input: CreateBudgetInput): Promise<Budget> {
    const res = await this.client.post<Budget>('/budgets', input);
    return res.data;
  }

  /** Fetch a single budget by id. */
  async get(budgetId: string): Promise<Budget> {
    return this.getData<Budget>(`/budgets/${encodeURIComponent(budgetId)}`);
  }

  /** List budgets, with optional period/scope filters and pagination. */
  async list(params: BudgetListParams = {}): Promise<Paginated<Budget>> {
    return this.listData<Budget>('/budgets', { ...params });
  }

  /** Iterate every budget across all pages. */
  iterate(params: BudgetListParams = {}): AsyncGenerator<Budget, void, void> {
    return this.iterateData<Budget>('/budgets', { ...params });
  }

  /** Update a budget's limit, period, rollover, or enabled state. */
  async update(budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    const res = await this.client.patch<Budget>(`/budgets/${encodeURIComponent(budgetId)}`, input);
    return res.data;
  }

  /** Permanently delete a budget. */
  async delete(budgetId: string): Promise<void> {
    await this.client.delete<void>(`/budgets/${encodeURIComponent(budgetId)}`);
  }

  /**
   * Record a draw against a budget, returning the updated budget. Amounts are
   * decimal strings; the API rejects a draw that would exceed the remaining
   * balance unless the budget permits overage.
   */
  async consume(budgetId: string, input: ConsumeBudgetInput): Promise<Budget> {
    const res = await this.client.post<Budget>(
      `/budgets/${encodeURIComponent(budgetId)}/consume`,
      input,
    );
    return res.data;
  }

  /** Reset a budget's consumption for the current period back to zero. */
  async reset(budgetId: string): Promise<Budget> {
    const res = await this.client.post<Budget>(`/budgets/${encodeURIComponent(budgetId)}/reset`);
    return res.data;
  }

  /** The budget's consumption history (one entry per draw). */
  async history(
    budgetId: string,
    params: PaginationParams = {},
  ): Promise<Paginated<BudgetHistoryEntry>> {
    return this.listData<BudgetHistoryEntry>(`/budgets/${encodeURIComponent(budgetId)}/history`, {
      ...params,
    });
  }

  /**
   * Fetch a single budget by id.
   *
   * This is the fully-qualified alias of {@link BudgetResource.get} exposed for
   * callers who prefer a `getBudget`-style resource API; behaviour is identical.
   */
  async getBudget(budgetId: string): Promise<Budget> {
    return this.getData<Budget>(`/budgets/${encodeURIComponent(budgetId)}`);
  }

  /**
   * List budgets, with optional period/scope filters and pagination.
   *
   * This is the fully-qualified alias of {@link BudgetResource.list} exposed for
   * callers who prefer a `listBudgets`-style resource API; behaviour is identical.
   */
  async listBudgets(params: BudgetListParams = {}): Promise<Paginated<Budget>> {
    return this.listData<Budget>('/budgets', { ...params });
  }

  /**
   * Simulate a prospective spend draw against a budget **without committing it**.
   *
   * The API evaluates the request against the budget's active window, currency,
   * and remaining allowance and returns a {@link BudgetSimulationResult}. This is
   * the enforcement path agents / wallets use before executing a transaction.
   *
   * @param budgetId The budget to simulate against.
   * @param input    The prospective draw (`asset` + `amount`).
   * @returns        Whether the draw would be allowed and, if not, why.
   */
  async simulateBudgetCheck(
    budgetId: string,
    input: BudgetSimulationInput,
  ): Promise<BudgetSimulationResult> {
    const res = await this.client.post<BudgetSimulationResult>(
      `/budgets/${encodeURIComponent(budgetId)}/simulate`,
      input,
    );
    return res.data;
  }

  /**
   * Run the full dry-run validation for a proposed spend: the request is
   * checked locally (expired budget, disabled budget, multi-asset conversion
   * and limit overflow) and then — when the local check passes — forwarded to
   * the API's simulation endpoint for the authoritative evaluation.
   *
   * The returned {@link BudgetSimulationCheckResult} carries typed violations
   * so agents can branch on machine-readable reasons instead of parsing the
   * `explanation` string.
   *
   * @param budgetId The budget to simulate against.
   * @param input    The proposed transaction parameters.
   * @param budget   Optional pre-fetched budget (skips the `get` round-trip).
   * @param options  Evaluation options (custom `now` for tests).
   * @returns        The strongly typed dry-run result.
   * @throws        Propagates API errors when the local check passes and the
   *                remote simulation call fails.
   *
   * @example
   * ```ts
   * const result = await budgets.simulateBudgetCheck('bud_1', {
   *   asset: 'USDC',
   *   amount: '250',
   * });
   * if (!result.allowed) {
   *   throw new Error(result.violations.map((v) => v.message).join('; '));
   * }
   * ```
   */
  async validateBudgetSpend(
    budgetId: string,
    input: BudgetSimulationInput & { conversionRate?: string | number },
    options: { budget?: Budget; simulation?: ValidateSimulationOptions } = {},
  ): Promise<BudgetSimulationCheckResult> {
    const budget = options.budget ?? (await this.get(budgetId));
    const local = validateSimulationRequest(budget, input, options.simulation);

    // A locally-rejected draw never reaches the API — the dry-run result is
    // already final and no state was mutated.
    if (!local.allowed) return local;

    const { asset, amount } = input;
    const remote = await this.simulateBudgetCheck(budgetId, { asset, amount });

    // The remote decision is authoritative: if the API rejects the draw, map
    // its textual violations onto the typed shape while preserving the wire
    // counters (`remainingAfter`, `windowStart`).
    if (!remote.allowed) {
      return {
        ...local,
        allowed: false,
        wouldExceed: remote.wouldExceed || local.wouldExceed,
        afterRemaining: remote.remainingAfter,
        explanation: remote.restriction || local.explanation,
        violations: [
          ...local.violations,
          {
            reason: 'LIMIT_OVERFLOW' as const,
            message: remote.restriction ?? 'The API rejected the simulated draw.',
          },
        ],
      };
    }

    return {
      ...local,
      afterRemaining: remote.remainingAfter,
      explanation: local.explanation,
    };
  }

  /**
   * Retrieve the current utilization snapshot for a budget.
   *
   * @param budgetId The budget to inspect.
   * @returns        Limit, spending, headroom, and the 0..1 utilization ratio
   *                 for the active window (see {@link BudgetUtilization}).
   */
  async utilization(budgetId: string): Promise<BudgetUtilization> {
    return this.getData<BudgetUtilization>(`/budgets/${encodeURIComponent(budgetId)}/utilization`);
  }

  /**
   * Retrieve the current utilization snapshot for a budget.
   *
   * This is the fully-qualified alias of {@link BudgetResource.utilization}
   * exposed for callers who prefer a `getBudgetUtilization`-style resource API;
   * behaviour is identical.
   *
   * @param budgetId The budget to inspect.
   * @returns        Limit, spending, headroom, and the 0..1 utilization ratio
   *                 for the active window (see {@link BudgetUtilization}).
   */
  async getBudgetUtilization(budgetId: string): Promise<BudgetUtilization> {
    return this.utilization(budgetId);
  }
}

/**
 * Budget DTOs re-exported from `@astroid/types` so consumers of
 * `@astroid/budget` can use the resource return types without a second import.
 */
export type {
  Budget,
  BudgetAllocationState,
  BudgetAllocationStatus,
  BudgetAllocationThresholds,
  BudgetCheckResult,
  BudgetMetrics,
  BudgetSimulationCheckResult,
  BudgetSimulationRejectionReason,
  BudgetSimulationViolation,
  BudgetSimulationResult,
  BudgetUtilization,
} from '@astroid/types';

/** Alias of {@link BudgetResource} matching the `*sResource` client naming. */
export const BudgetsResource = BudgetResource;

