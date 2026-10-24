/**
 * Budget allocation adjustment helper.
 *
 * Enables agent runtimes to dynamically request temporary limit expansions
 * or reallocation of funds between sub-budgets within established policy boundaries.
 *
 * @module
 */

import { HttpClient, type AstroidResponse, type RequestOptionsExtras } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import type {
  BudgetAdjustmentRequest,
  BudgetAdjustmentResponse,
  BudgetAdjustmentStatus,
  DecimalString,
} from '@astroid/types';
import type { BudgetHttpClient, BudgetRequestOptions } from './budget.js';

/** Positive decimal pattern for amount validation. */
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;
const NON_ZERO_DIGIT_PATTERN = /[1-9]/;

function isValidAdjustmentAmount(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return DECIMAL_AMOUNT_PATTERN.test(trimmed) && NON_ZERO_DIGIT_PATTERN.test(trimmed);
}

/** Options for budget adjustment requests. */
export interface BudgetAdjustmentOptions extends RequestOptionsExtras {
  /** Optional custom client transport. */
  client?: BudgetHttpClient;
}

/**
 * Request a dynamic budget allocation adjustment.
 *
 * Submits an adjustment proposal to expand an agent's spending limits or
 * reallocate funds between sub-budgets, returning strongly typed allocation
 * state representing the pending or resolved decision.
 *
 * @param budgetId      The unique identifier of the budget to adjust.
 * @param amount        The adjustment amount (positive decimal string or number).
 * @param justification Reason or metadata explaining the adjustment need.
 * @param options       Optional request or transport options.
 * @returns             The pending or resolved adjustment response.
 * @throws              `ValidationError` on invalid inputs or malformed parameters.
 *
 * @example
 * ```ts
 * import { requestBudgetAdjustment } from '@astroid/budget';
 *
 * const adjustment = await requestBudgetAdjustment('bud_123', '500.00', {
 *   reason: 'Temporary surge in LLM query tokens for market analysis',
 *   tags: ['high-priority', 'q3-expansion'],
 * });
 *
 * if (adjustment.status === 'APPROVED') {
 *   console.log('New limit:', adjustment.adjustedLimit);
 * } else if (adjustment.status === 'PENDING') {
 *   console.log('Awaiting approval with id:', adjustment.id);
 * }
 * ```
 */
export async function requestBudgetAdjustment(
  budgetId: string,
  amount: DecimalString | number,
  justification?: string | Record<string, unknown> | BudgetAdjustmentRequest,
  options?: BudgetAdjustmentOptions,
): Promise<BudgetAdjustmentResponse>;
export async function requestBudgetAdjustment(
  client: BudgetHttpClient,
  budgetId: string,
  amount: DecimalString | number,
  justification?: string | Record<string, unknown> | BudgetAdjustmentRequest,
  options?: BudgetRequestOptions,
): Promise<BudgetAdjustmentResponse>;
export async function requestBudgetAdjustment(
  first: string | BudgetHttpClient,
  second: DecimalString | number | string,
  third?: string | Record<string, unknown> | BudgetAdjustmentRequest | DecimalString | number,
  fourth?:
    | BudgetAdjustmentOptions
    | BudgetRequestOptions
    | string
    | Record<string, unknown>
    | BudgetAdjustmentRequest,
  fifth?: BudgetRequestOptions,
): Promise<BudgetAdjustmentResponse> {
  let client: BudgetHttpClient;
  let budgetId: string;
  let amount: DecimalString | number;
  let justification: string | Record<string, unknown> | BudgetAdjustmentRequest | undefined;
  let requestOptions: BudgetRequestOptions | undefined;

  // Overload 2: client as first parameter
  if (typeof first === 'object' && first !== null && 'post' in first) {
    client = first as BudgetHttpClient;
    budgetId = String(second ?? '');
    amount = third as DecimalString | number;
    justification = fourth as string | Record<string, unknown> | BudgetAdjustmentRequest | undefined;
    requestOptions = fifth;
  } else {
    // Overload 1: budgetId as first parameter
    budgetId = String(first ?? '');
    amount = second as DecimalString | number;
    justification = third as string | Record<string, unknown> | BudgetAdjustmentRequest | undefined;
    const opts = fourth as BudgetAdjustmentOptions | undefined;
    client =
      opts?.client ??
      (new HttpClient({}) as unknown as BudgetHttpClient);
    requestOptions = opts;
  }

  // Validate budgetId
  if (!budgetId || typeof budgetId !== 'string' || budgetId.trim() === '') {
    throw new ValidationError('A non-empty budgetId is required to request a budget adjustment.', {
      code: 'INVALID_BUDGET_ID',
      details: { field: 'budgetId', received: budgetId },
    });
  }

  // Validate amount
  if (!isValidAdjustmentAmount(amount)) {
    throw new ValidationError('Adjustment amount must be a positive finite number or decimal string.', {
      code: 'INVALID_AMOUNT',
      details: { field: 'amount', received: amount },
    });
  }

  const encodedId = encodeURIComponent(budgetId.trim());
  const path = `/budgets/${encodedId}/adjustments`;

  let justificationText: string | undefined;
  let metadata: Record<string, unknown> | undefined;
  let targetBudgetId: string | undefined;

  if (typeof justification === 'string') {
    justificationText = justification.trim();
  } else if (typeof justification === 'object' && justification !== null) {
    const rawJust = justification as Record<string, unknown>;
    justificationText =
      typeof rawJust['justification'] === 'string'
        ? (rawJust['justification'] as string)
        : typeof rawJust['reason'] === 'string'
          ? (rawJust['reason'] as string)
          : undefined;

    if (rawJust['metadata'] && typeof rawJust['metadata'] === 'object') {
      metadata = rawJust['metadata'] as Record<string, unknown>;
    } else {
      const rest = { ...rawJust };
      delete rest['justification'];
      delete rest['reason'];
      delete rest['targetBudgetId'];
      delete rest['amount'];
      if (Object.keys(rest).length > 0) {
        metadata = rest;
      }
    }

    if (typeof rawJust['targetBudgetId'] === 'string') {
      targetBudgetId = rawJust['targetBudgetId'] as string;
    }
  }

  const payload: Record<string, unknown> = {
    amount: String(amount).trim(),
    ...(justificationText !== undefined ? { justification: justificationText } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(targetBudgetId !== undefined ? { targetBudgetId } : {}),
  };

  // If using Astroid core HttpClient, res has `.data`. If using mock or BudgetHttpClient, it might return data directly or in `.data`.
  const res = await client.post<BudgetAdjustmentResponse | AstroidResponse<BudgetAdjustmentResponse>>(
    path,
    payload,
    requestOptions,
  );

  const rawData =
    res && typeof res === 'object' && 'data' in res
      ? (res as AstroidResponse<BudgetAdjustmentResponse>).data
      : (res as BudgetAdjustmentResponse);

  const status: BudgetAdjustmentStatus = rawData.status ?? 'PENDING';
  const state =
    rawData.state ??
    (status === 'APPROVED' || status === 'APPLIED'
      ? 'approved'
      : status === 'REJECTED'
        ? 'rejected'
        : 'pending');

  return {
    id: rawData.id,
    budgetId: rawData.budgetId ?? budgetId.trim(),
    targetBudgetId: rawData.targetBudgetId ?? targetBudgetId,
    amount: rawData.amount ?? String(amount).trim(),
    status,
    state,
    allocationState: rawData.allocationState,
    currentLimit: rawData.currentLimit,
    adjustedLimit: rawData.adjustedLimit,
    justification: rawData.justification ?? justificationText,
    metadata: rawData.metadata ?? metadata,
    rejectionReason: rawData.rejectionReason,
    createdAt: rawData.createdAt,
    updatedAt: rawData.updatedAt,
  };
}
