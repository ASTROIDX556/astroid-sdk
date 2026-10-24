/**
 * Budget expenditure summary and threshold-alert query helpers (issue #436).
 *
 * Autonomous agents need to know how fast they are burning through a budget
 * before they hit the limit. These helpers wrap the expenditure endpoint so a
 * caller can fetch a live utilization summary — optionally scoped to a time
 * range and evaluated against a warning threshold — without doing any of the
 * arithmetic themselves.
 *
 * Like the other standalone budget helpers, {@link getBudgetExpenditureSummary}
 * takes a {@link BudgetHttpClient} transport (satisfied by `@astroid/client`) as
 * its first argument, so it composes with {@link BudgetClient} and is trivial to
 * unit-test with a mock. The same query is also available as
 * `BudgetResource.getBudgetExpenditureSummary`.
 *
 * @module
 */

import type {
  BudgetExpenditureSummary,
  BudgetExpenditureSummaryParams,
  IsoDateTime,
} from '@astroid/types';
import { AstroidError } from '@astroid/errors';

import { toBudgetQuery, type BudgetHttpClient } from './budget.js';

export { DEFAULT_BUDGET_EXPENDITURE_THRESHOLD_PERCENT } from '@astroid/types';

/** Error thrown when an expenditure summary query fails local validation. */
export class BudgetExpenditureValidationError extends AstroidError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: 'BUDGET_EXPENDITURE_VALIDATION_ERROR', status: 400, details });
    this.name = 'BudgetExpenditureValidationError';
  }
}

/** Path of a budget's expenditure summary endpoint. */
export function budgetExpenditurePath(budgetId: string): string {
  return `/budgets/${encodeURIComponent(budgetId)}/expenditure`;
}

/** Whether `percent` is a usable warning threshold: a finite number in `(0, 100]`. */
export function isValidExpenditureThreshold(percent: unknown): percent is number {
  return typeof percent === 'number' && Number.isFinite(percent) && percent > 0 && percent <= 100;
}

function assertValidDateBoundary(value: IsoDateTime, field: 'from' | 'to'): number {
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
    throw new BudgetExpenditureValidationError(
      `"${field}" must be a valid ISO-8601 date or timestamp.`,
      { field, value },
    );
  }
  return Date.parse(value);
}

/**
 * Validate an expenditure-summary query without hitting the network.
 *
 * Checks the budget id, the optional threshold percentage (`(0, 100]`) and the
 * optional `from` / `to` window (valid ISO-8601, `from` not after `to`).
 *
 * @throws {BudgetExpenditureValidationError} When any field is invalid.
 */
export function assertValidExpenditureSummaryQuery(
  budgetId: string,
  params: BudgetExpenditureSummaryParams = {},
): void {
  if (typeof budgetId !== 'string' || budgetId.trim() === '') {
    throw new BudgetExpenditureValidationError('budgetId must be a non-empty string.', {
      budgetId,
    });
  }
  if (params === null || typeof params !== 'object') {
    throw new BudgetExpenditureValidationError('Expenditure summary params must be an object.', {
      params,
    });
  }
  if (
    params.thresholdPercent !== undefined &&
    !isValidExpenditureThreshold(params.thresholdPercent)
  ) {
    throw new BudgetExpenditureValidationError(
      'thresholdPercent must be a finite number greater than 0 and at most 100.',
      { thresholdPercent: params.thresholdPercent },
    );
  }
  const from = params.from !== undefined ? assertValidDateBoundary(params.from, 'from') : undefined;
  const to = params.to !== undefined ? assertValidDateBoundary(params.to, 'to') : undefined;
  if (from !== undefined && to !== undefined && from > to) {
    throw new BudgetExpenditureValidationError('"from" must not be after "to".', {
      from: params.from,
      to: params.to,
    });
  }
}

/**
 * Fetch a budget's expenditure summary (spend, utilization, threshold state).
 *
 * @param http     The HTTP transport.
 * @param budgetId The budget to summarize.
 * @param params   Optional time range (`from` / `to`) and warning threshold.
 * @returns The structured {@link BudgetExpenditureSummary} snapshot.
 * @throws {BudgetExpenditureValidationError} When the query is invalid — no
 *   request is issued.
 *
 * @example
 * ```ts
 * const summary = await getBudgetExpenditureSummary(http, 'bud_1', {
 *   from: '2026-10-01T00:00:00.000Z',
 *   to: '2026-10-22T00:00:00.000Z',
 *   thresholdPercent: 80,
 * });
 * if (summary.thresholdExceeded) console.warn(summary.thresholdWarning);
 * ```
 */
export async function getBudgetExpenditureSummary(
  http: BudgetHttpClient,
  budgetId: string,
  params: BudgetExpenditureSummaryParams = {},
): Promise<BudgetExpenditureSummary> {
  assertValidExpenditureSummaryQuery(budgetId, params);
  return http.get<BudgetExpenditureSummary>(budgetExpenditurePath(budgetId), {
    query: toBudgetQuery(params),
  });
}

// Re-exported for discoverability alongside the helper.
export type { BudgetExpenditureSummary, BudgetExpenditureSummaryParams } from '@astroid/types';
