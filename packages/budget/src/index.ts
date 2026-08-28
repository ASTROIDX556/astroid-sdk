/**
 * `@astroid/budget` — recurring and one-time spending-budget resource.
 *
 * A budget caps spend over a period (daily/weekly/monthly/…) and tracks
 * consumption. Agents draw against budgets; this resource manages them and
 * exposes the running consumption history.
 *
 * @packageDocumentation
 */

export {
  checkBudgetLimit,
  type BudgetValidationResult,
  type SpendRequest,
} from './validation.js';

import { Resource } from '@astroid/core';
import type {
  Budget,
  BudgetHistoryEntry,
  BudgetPeriod,
  ConsumeBudgetInput,
  CreateBudgetInput,
  Paginated,
  PaginationParams,
  UpdateBudgetInput,
} from '@astroid/types';

/** Filters accepted by {@link BudgetResource.list}. */
export interface BudgetListParams extends PaginationParams {
  period?: BudgetPeriod;
  enabled?: boolean;
  agentId?: string;
  walletId?: string;
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
    return this.listData<BudgetHistoryEntry>(
      `/budgets/${encodeURIComponent(budgetId)}/history`,
      { ...params },
    );
  }
}
