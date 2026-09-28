/** Pure aggregation helpers for collections of budgets, including hierarchies. */

import { ValidationError } from '@astroid/errors';
import type { Budget, DecimalString } from '@astroid/types';

/** Totals calculated across every budget supplied to {@link calculateBudgetTotals}. */
export interface BudgetTotals {
  totalAllocated: DecimalString;
  totalSpent: DecimalString;
  totalRemaining: DecimalString;
  utilizationPercentage: number;
}

interface ParsedDecimal {
  units: bigint;
  scale: number;
}

function parseDecimal(value: DecimalString, budgetId: string, field: string): ParsedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new ValidationError(`Budget ${field} must be a finite decimal amount.`, {
      code: 'INVALID_BUDGET_AMOUNT',
      details: { budgetId, field, value },
    });
  }

  const fraction = match[3] ?? '';
  const units = BigInt(`${match[2]}${fraction}`) * (match[1] === '-' ? -1n : 1n);
  return { units, scale: fraction.length };
}

function toUnits(value: ParsedDecimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function formatDecimal(units: bigint, scale: number): DecimalString {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const digits = absolute.toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;

  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Sum allocation totals over the supplied budgets, counting each entry once.
 * Parent and child budgets are both included when both are supplied.
 * Remaining amounts are derived from limit minus spent and clamped at zero.
 */
export function calculateBudgetTotals(budgets: readonly Budget[]): BudgetTotals {
  const parsed = budgets.map((budget) => ({
    limit: parseDecimal(budget.limitAmount, budget.id, 'limitAmount'),
    spent: parseDecimal(budget.spent, budget.id, 'spent'),
  }));
  const scale = parsed.reduce(
    (maxScale, budget) => Math.max(maxScale, budget.limit.scale, budget.spent.scale),
    0,
  );

  let allocated = 0n;
  let spent = 0n;
  let remaining = 0n;
  for (const budget of parsed) {
    const limitUnits = toUnits(budget.limit, scale);
    const spentUnits = toUnits(budget.spent, scale);
    allocated += limitUnits;
    spent += spentUnits;
    remaining += limitUnits > spentUnits ? limitUnits - spentUnits : 0n;
  }

  const utilizationPercentage =
    allocated > 0n ? Number((spent * 10_000n + allocated / 2n) / allocated) / 100 : 0;

  return {
    totalAllocated: formatDecimal(allocated, scale),
    totalSpent: formatDecimal(spent, scale),
    totalRemaining: formatDecimal(remaining, scale),
    utilizationPercentage,
  };
}

/** Calculate total allocated amounts across a budget collection. */
export function calculateTotalAllocated(budgets: readonly Budget[]): DecimalString {
  return calculateBudgetTotals(budgets).totalAllocated;
}

/** Calculate total spent amounts across a budget collection. */
export function calculateTotalSpent(budgets: readonly Budget[]): DecimalString {
  return calculateBudgetTotals(budgets).totalSpent;
}

/** Calculate remaining amounts across a budget collection, clamped at zero per budget. */
export function calculateTotalRemaining(budgets: readonly Budget[]): DecimalString {
  return calculateBudgetTotals(budgets).totalRemaining;
}

/** Calculate aggregate spend as a percentage of allocated amounts. */
export function calculateBudgetUtilizationPercentage(budgets: readonly Budget[]): number {
  return calculateBudgetTotals(budgets).utilizationPercentage;
}