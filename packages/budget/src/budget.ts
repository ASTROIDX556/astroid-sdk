/**
 * Budget resource client and allocation-tracking helpers.
 *
 * {@link BudgetClient} is a thin, typed wrapper over the Astroid budget
 * endpoints — create, read, update, delete, consume, history and metrics — plus
 * an {@link BudgetClient.allocationStatus | allocationStatus} check that reports
 * how much of a budget's allocation is spent.
 *
 * The client talks to the API through a minimal injected {@link BudgetHttpClient}
 * transport (satisfied by `@astroid/client`), which keeps this package free of a
 * hard dependency on the HTTP layer and makes every method trivial to unit-test
 * with a mocked transport.
 *
 * The allocation helpers ({@link deriveAllocationStatus},
 * {@link classifyAllocation}, {@link isAllocationExhausted}) are pure functions
 * that work offline against a {@link Budget} you already hold.
 *
 * @module
 */

import type {
  Budget,
  BudgetAllocationState,
  BudgetAllocationStatus,
  BudgetAllocationThresholds,
  BudgetHistoryEntry,
  BudgetHistoryQueryParams,
  BudgetMetrics,
  BudgetSimulationRequest,
  BudgetSimulationResult,
  ConsumeBudgetInput,
  CreateBudgetInput,
  DecimalString,
  PaginatedResponse,
  PaginationParams,
  UpdateBudgetInput,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/** Query parameters passed to a transport request. */
export type BudgetQuery = Record<string, string | number | boolean | undefined | null>;

/** Per-request options accepted by the transport. */
export interface BudgetRequestOptions {
  query?: BudgetQuery;
  signal?: AbortSignal;
}

/**
 * The minimal HTTP surface {@link BudgetClient} needs. `@astroid/client`'s
 * `Astroid` instance satisfies this shape; tests pass a mock.
 */
export interface BudgetHttpClient {
  get<T>(path: string, options?: BudgetRequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T>;
  delete<T>(path: string, options?: BudgetRequestOptions): Promise<T>;
}

/** Filter + pagination parameters for listing budgets. */
export interface ListBudgetsParams extends PaginationParams {
  /** Only budgets scoped to this agent. */
  agentId?: string;
  /** Only child budgets of this parent. */
  parentBudgetId?: string;
  /** Only enabled / disabled budgets. */
  enabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Query helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Drop `undefined` / `null` entries so they never reach the query string. */
export function toBudgetQuery(params?: object): BudgetQuery {
  const out: BudgetQuery = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Decimal helpers (shared with allocation math)                               */
/* -------------------------------------------------------------------------- */

function toNumber(value: DecimalString | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampFraction(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function formatAmount(n: number): DecimalString {
  return String(Math.max(0, Math.round(n * 1e7) / 1e7));
}

/* -------------------------------------------------------------------------- */
/* Allocation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Default thresholds used when classifying an allocation. */
export const DEFAULT_ALLOCATION_THRESHOLDS: Required<BudgetAllocationThresholds> = Object.freeze({
  warnAt: 80,
  criticalAt: 95,
});

/**
 * Bucket a utilization percentage (`0`–`100+`) into a {@link BudgetAllocationState}.
 *
 * - `>= 100` → `exhausted`
 * - `>= criticalAt` → `critical`
 * - `>= warnAt` → `warning`
 * - otherwise → `healthy`
 */
export function classifyAllocation(
  percent: number,
  thresholds: BudgetAllocationThresholds = {},
): BudgetAllocationState {
  const warnAt = thresholds.warnAt ?? DEFAULT_ALLOCATION_THRESHOLDS.warnAt;
  const criticalAt = thresholds.criticalAt ?? DEFAULT_ALLOCATION_THRESHOLDS.criticalAt;

  if (percent >= 100) return 'exhausted';
  if (percent >= criticalAt) return 'critical';
  if (percent >= warnAt) return 'warning';
  return 'healthy';
}

/** Whether the budget's own counters indicate its allocation is fully consumed. */
export function isAllocationExhausted(budget: Pick<Budget, 'limitAmount' | 'spent'>): boolean {
  const limit = toNumber(budget.limitAmount);
  if (limit <= 0) return false;
  return toNumber(budget.spent) >= limit;
}

/** Options for {@link deriveAllocationStatus}. */
export interface DeriveAllocationOptions extends BudgetAllocationThresholds {
  /**
   * A prospective spend to test against the remaining allowance. When set, the
   * returned status reflects spending *including* this amount and
   * `wouldExceed` is populated.
   */
  prospectiveSpend?: DecimalString | number;
}

/**
 * Compute a {@link BudgetAllocationStatus} from a {@link Budget} using only
 * local arithmetic — no network calls.
 *
 * @param budget  The budget to inspect.
 * @param options Threshold overrides and an optional prospective spend.
 */
export function deriveAllocationStatus(
  budget: Budget,
  options: DeriveAllocationOptions = {},
): BudgetAllocationStatus {
  const limit = toNumber(budget.limitAmount);
  const baseSpent = toNumber(budget.spent);
  const prospective = toNumber(options.prospectiveSpend);
  const spent = baseSpent + prospective;

  const utilization = limit > 0 ? clampFraction(spent / limit) : spent > 0 ? 1 : 0;
  const percent = limit > 0 ? Math.round((spent / limit) * 10000) / 100 : spent > 0 ? 100 : 0;
  const remaining = Math.max(0, limit - spent);

  const status: BudgetAllocationStatus = {
    budgetId: budget.id,
    limit: formatAmount(limit),
    spent: formatAmount(spent),
    remaining: formatAmount(remaining),
    utilization,
    percent,
    state: classifyAllocation(percent, options),
  };

  if (options.prospectiveSpend !== undefined) {
    status.wouldExceed = limit > 0 && spent > limit;
  }

  return status;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

const BASE_PATH = '/v1/budgets';

/**
 * Typed wrapper over the Astroid budget endpoints.
 *
 * @example
 * ```ts
 * import { Astroid } from '@astroid/client';
 * import { BudgetClient } from '@astroid/budget';
 *
 * const budgets = new BudgetClient(new Astroid({ apiKey }));
 * const budget = await budgets.create({ name: 'Q3 Ops', limitAmount: '5000' });
 * const status = await budgets.allocationStatus(budget.id);
 * ```
 */
export class BudgetClient {
  private readonly http: BudgetHttpClient;

  constructor(http: BudgetHttpClient) {
    this.http = http;
  }

  /** Create a new budget. */
  async create(input: CreateBudgetInput): Promise<Budget> {
    return this.http.post<Budget>(BASE_PATH, input);
  }

  /** Retrieve a single budget by id. */
  async get(budgetId: string, options?: { signal?: AbortSignal }): Promise<Budget> {
    return this.http.get<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`, {
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * Alias of {@link get} that matches the SDK's `getBudget` resource naming.
   *
   * @example
   * ```ts
   * const budget = await budgets.getBudget('bud_1');
   * ```
   */
  async getBudget(budgetId: string, options?: { signal?: AbortSignal }): Promise<Budget> {
    return this.get(budgetId, options);
  }

  /** List budgets with optional filters and pagination. */
  async list(params?: ListBudgetsParams): Promise<PaginatedResponse<Budget>> {
    return this.http.get<PaginatedResponse<Budget>>(BASE_PATH, { query: toBudgetQuery(params) });
  }

  /**
   * Alias of {@link list} that matches the SDK's `listBudgets` resource naming.
   *
   * @example
   * ```ts
   * const page = await budgets.listBudgets({ agentId: 'agt_1', limit: 25 });
   * ```
   */
  async listBudgets(params?: ListBudgetsParams): Promise<PaginatedResponse<Budget>> {
    return this.list(params);
  }

  /**
   * Simulate a prospective spend against a budget before executing it.
   *
   * The server evaluates the request against the budget's limit, active
   * window and policy rules, returning whether the spend is allowed and the
   * resulting headroom.
   *
   * @example
   * ```ts
   * const result = await budgets.simulateBudgetCheck('bud_1', {
   *   asset: 'USDC',
   *   amount: '250',
   * });
   * if (!result.allowed) {
   *   throw new Error(result.explanation);
   * }
   * ```
   */
  async simulateBudgetCheck(
    budgetId: string,
    request: BudgetSimulationRequest,
  ): Promise<BudgetSimulationResult> {
    return this.http.post<BudgetSimulationResult>(
      `${BASE_PATH}/${encodeURIComponent(budgetId)}/simulate`,
      request,
    );
  }

  /** Update an existing budget. */
  async update(budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    return this.http.patch<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`, input);
  }

  /** Delete a budget. */
  async delete(budgetId: string): Promise<void> {
    await this.http.delete<void>(`${BASE_PATH}/${encodeURIComponent(budgetId)}`);
  }

  /** Record consumption against a budget, returning the updated budget. */
  async consume(budgetId: string, input: ConsumeBudgetInput): Promise<Budget> {
    return this.http.post<Budget>(`${BASE_PATH}/${encodeURIComponent(budgetId)}/consume`, input);
  }

  /**
   * Page through a budget's consumption history.
   *
   * Supports keyset (`cursor`) or offset (`page`) pagination plus `from` / `to`
   * date filters, a `transactionId` filter and `minAmount` / `maxAmount` bounds.
   */
  async history(
    budgetId: string,
    params?: BudgetHistoryQueryParams,
  ): Promise<PaginatedResponse<BudgetHistoryEntry>> {
    return this.http.get<PaginatedResponse<BudgetHistoryEntry>>(
      `${BASE_PATH}/${encodeURIComponent(budgetId)}/history`,
      { query: toBudgetQuery(params) },
    );
  }

  /** Fetch the server-computed metrics for a budget. */
  async metrics(budgetId: string): Promise<BudgetMetrics> {
    return this.http.get<BudgetMetrics>(`${BASE_PATH}/${encodeURIComponent(budgetId)}/metrics`);
  }

  /**
   * Check how much of a budget's allocation is consumed.
   *
   * Fetches the budget and derives a {@link BudgetAllocationStatus} locally. Pass
   * `prospectiveSpend` to test whether an upcoming charge would exceed the
   * remaining allowance.
   */
  async allocationStatus(
    budgetId: string,
    options: DeriveAllocationOptions = {},
  ): Promise<BudgetAllocationStatus> {
    const budget = await this.get(budgetId);
    return deriveAllocationStatus(budget, options);
  }
}
