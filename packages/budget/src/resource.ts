/**
 * `BudgetsResource` — budget CRUD and allocation tracking built directly on the
 * core {@link Resource} layer.
 *
 * This mirrors the surface of {@link BudgetClient} but is wired to the shared
 * `HttpClient` handed to every SDK resource namespace, so `astroid.budgets`
 * behaves like the other namespaces (`wallets`, `agents`, …).
 *
 * @module
 */

import { Resource } from '@astroid/core';
import type {
  Budget,
  BudgetHistoryEntry,
  BudgetHistoryQueryParams,
  BudgetMetrics,
  ConsumeBudgetInput,
  CreateBudgetInput,
  Paginated,
  PaginationParams,
  UpdateBudgetInput,
} from '@astroid/types';

/** Filters accepted by {@link BudgetResource.list}. */
export interface BudgetListParams extends PaginationParams {
  /** Only budgets scoped to this agent. */
  agentId?: string;
  /** Only child budgets of this parent. */
  parentBudgetId?: string;
  /** Only enabled / disabled budgets. */
  enabled?: boolean;
}

/**
 * The `budgets` namespace on the Astroid client.
 */
export class BudgetResource extends Resource {
  /** Create a new budget. */
  async create(input: CreateBudgetInput): Promise<Budget> {
    const res = await this.client.post<Budget>('/budgets', input);
    return res.data;
  }

  /** Retrieve a single budget by id. */
  async get(budgetId: string): Promise<Budget> {
    return this.getData<Budget>(`/budgets/${encodeURIComponent(budgetId)}`);
  }

  /** List budgets with optional filters and pagination. */
  async list(params: BudgetListParams = {}): Promise<Paginated<Budget>> {
    return this.listData<Budget>('/budgets', { ...params });
  }

  /** Iterate every budget across all pages. */
  iterate(params: BudgetListParams = {}): AsyncGenerator<Budget, void, void> {
    return this.iterateData<Budget>('/budgets', { ...params });
  }

  /** Update an existing budget. */
  async update(budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    const res = await this.client.patch<Budget>(`/budgets/${encodeURIComponent(budgetId)}`, input);
    return res.data;
  }

  /** Delete a budget. */
  async delete(budgetId: string): Promise<void> {
    await this.client.delete<void>(`/budgets/${encodeURIComponent(budgetId)}`);
  }

  /** Record consumption against a budget, returning the updated budget. */
  async consume(budgetId: string, input: ConsumeBudgetInput): Promise<Budget> {
    const res = await this.client.post<Budget>(
      `/budgets/${encodeURIComponent(budgetId)}/consume`,
      input,
    );
    return res.data;
  }

  /** Page through a budget's consumption history. */
  async history(
    budgetId: string,
    params?: BudgetHistoryQueryParams,
  ): Promise<Paginated<BudgetHistoryEntry>> {
    return this.listData<BudgetHistoryEntry>(`/budgets/${encodeURIComponent(budgetId)}/history`, {
      ...params,
    });
  }

  /** Fetch the server-computed metrics for a budget. */
  async metrics(budgetId: string): Promise<BudgetMetrics> {
    return this.getData<BudgetMetrics>(`/budgets/${encodeURIComponent(budgetId)}/metrics`);
  }
}

/** Alias of {@link BudgetResource} matching the `*sResource` client naming. */
export const BudgetsResource = BudgetResource;
