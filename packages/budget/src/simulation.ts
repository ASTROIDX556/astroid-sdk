/**
 * Budget dry-run simulation helpers.
 *
 * The resource method `BudgetResource.simulateBudgetCheck` POSTs the proposed
 * draw to the API. Before that happens, {@link validateSimulationRequest}
 * performs the client-side half of the contract: it resolves the budget's
 * active window and currency and rejects the request locally — with typed,
 * machine-readable reasons — for the edge cases the API would otherwise have
 * to surface:
 *
 * - **Expired budgets** — the active window has already closed.
 * - **Disabled budgets** — nothing can be drawn while `enabled === false`.
 * - **Multi-asset conversions** — a cross-asset request must carry an explicit
 *   `conversionRate`; otherwise it is rejected instead of silently converted.
 * - **Limit overflows** — the (converted) draw exceeds the remaining allowance.
 *
 * Decimal arithmetic uses BigInt-scaled integers, so amounts never round-trip
 * through IEEE-754 floats.
 *
 * @module
 */

import type {
  Budget,
  BudgetCheckResult,
  BudgetSimulationCheckResult,
  BudgetSimulationRejectionReason,
  BudgetSimulationRequest,
  BudgetSimulationViolation,
  DecimalString,
  IsoDateTime,
} from '@astroid/types';
import { classifyAllocation } from './budget.js';

/* -------------------------------------------------------------------------- */
/* Decimal helpers (BigInt-scaled integer arithmetic)                          */
/* -------------------------------------------------------------------------- */

/** Parse a decimal amount into `{ int, frac }` string parts. */
function parseParts(value: DecimalString | number): { int: string; frac: string } {
  const s = String(value).trim();
  const dot = s.indexOf('.');
  if (dot === -1) return { int: s === '' ? '0' : s, frac: '' };
  const int = dot === 0 ? '0' : s.slice(0, dot);
  const frac = s.slice(dot + 1);
  return { int: int === '' || int === '-' ? `${int}0` : int, frac };
}

/** Scale a decimal amount to a BigInt at `scale` fractional digits. */
function toScaled(value: DecimalString | number, scale: number): bigint {
  const { int, frac } = parseParts(value);
  const fracPadded = frac.padEnd(scale, '0').slice(0, scale || frac.length);
  const digits = `${int}${scale > 0 ? fracPadded.padEnd(scale, '0') : ''}`.replace('-', '');
  return BigInt(digits) * (int.startsWith('-') ? -1n : 1n);
}

/**
 * Format a scaled BigInt back into a decimal string.
 *
 * By default trailing fractional zeros are trimmed (`'50.0'` → `'50'`). Pass
 * `preserve = true` to keep exactly `scale` fractional digits — used by the
 * amount arithmetic so monetary values keep the inputs' natural precision
 * (`'1000.00'` stays `'1000.00'`).
 */
function fromScaled(value: bigint, scale: number, preserve = false): DecimalString {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale) || '0';
  const rawFrac = scale > 0 ? digits.slice(digits.length - scale) : '';
  const fracPart = preserve ? rawFrac : rawFrac.replace(/0+$/, '');
  const sign = negative && (intPart !== '0' || fracPart !== '') ? '-' : '';
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/** Sum a list of decimal amounts, preserving the inputs' fractional scale. */
function decSum(values: DecimalString[]): DecimalString {
  const scale = Math.max(0, ...values.map((v) => parseParts(v).frac.length));
  return fromScaled(
    values.reduce((acc, v) => acc + toScaled(v, scale), 0n),
    scale,
    true,
  );
}

/** Subtract `b` from `a`, preserving the inputs' fractional scale. */
function decSub(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const scale = Math.max(parseParts(a).frac.length, parseParts(b).frac.length);
  const diff = toScaled(a, scale) - toScaled(b, scale);
  return fromScaled(diff <= 0n ? 0n : diff, scale, true);
}

/** Compare two decimal amounts: `-1`, `0`, or `1`. */
function decCmp(a: DecimalString | number, b: DecimalString | number): -1 | 0 | 1 {
  const scale = Math.max(parseParts(a).frac.length, parseParts(b).frac.length);
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Multiply two decimal amounts, keeping up to 12 fractional digits. */
function decMul(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const scaleA = parseParts(a).frac.length;
  const scaleB = parseParts(b).frac.length;
  const productScale = Math.min(scaleA + scaleB, 12);
  const product = toScaled(a, scaleA) * toScaled(b, scaleB);
  // Drop the excess scale digits (truncation, matching the API's rounding).
  const excess = BigInt(Math.max(0, scaleA + scaleB - productScale));
  const shifted = excess > 0n ? product / 10n ** excess : product;
  return fromScaled(shifted, productScale);
}

/** Clamp a fraction into `0..1` for the utilization ratio. */
function clampUnit(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* -------------------------------------------------------------------------- */
/* Window helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Derive the budget's active window from its period and `periodStart`. */
export function resolveBudgetWindow(budget: Pick<Budget, 'period' | 'periodStart'>): {
  start: IsoDateTime;
  end: IsoDateTime;
} {
  const ps = new Date(budget.periodStart);
  const startOfDay = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  const addMonths = (d: Date, n: number) => {
    const r = new Date(d.getTime());
    r.setUTCMonth(r.getUTCMonth() + n);
    return r;
  };

  let start: Date;
  switch (budget.period) {
    case 'ONE_TIME':
      start = ps;
      break;
    case 'DAILY':
      start = startOfDay(ps);
      break;
    case 'WEEKLY': {
      const dayStart = startOfDay(ps);
      const dow = dayStart.getUTCDay();
      start = addDays(dayStart, dow === 0 ? -6 : 1 - dow); // Monday-aligned
      break;
    }
    case 'MONTHLY':
      start = new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), 1));
      break;
    case 'QUARTERLY':
      start = new Date(Date.UTC(ps.getUTCFullYear(), Math.floor(ps.getUTCMonth() / 3) * 3, 1));
      break;
    case 'YEARLY':
      start = new Date(Date.UTC(ps.getUTCFullYear(), 0, 1));
      break;
    default:
      start = ps;
  }

  const end = new Date(start.getTime());
  switch (budget.period) {
    case 'ONE_TIME':
      end.setUTCFullYear(end.getUTCFullYear() + 100);
      break;
    case 'DAILY':
      end.setTime(addDays(start, 1).getTime());
      break;
    case 'WEEKLY':
      end.setTime(addDays(start, 7).getTime());
      break;
    case 'MONTHLY':
      end.setTime(addMonths(start, 1).getTime());
      break;
    case 'QUARTERLY':
      end.setTime(addMonths(start, 3).getTime());
      break;
    case 'YEARLY':
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      break;
    default:
      end.setUTCFullYear(end.getUTCFullYear() + 100);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Resolve the budget's remaining allowance for the active window.
 *
 * Prefers the API-provided counters (`budget.spent`), which already reflect
 * the window the API is authoritative for.
 */
export function resolveBudgetRemaining(budget: Budget): DecimalString {
  return decSub(budget.limitAmount, budget.spent ?? '0');
}

/** Whether the budget's active window has already closed at `now`. */
export function isBudgetExpired(
  budget: Pick<Budget, 'period' | 'periodStart'>,
  now: Date = new Date(),
): boolean {
  const { end } = resolveBudgetWindow(budget);
  return now.getTime() >= new Date(end).getTime();
}

/* -------------------------------------------------------------------------- */
/* Core validation                                                             */
/* -------------------------------------------------------------------------- */

/** Options for {@link validateSimulationRequest}. */
export interface ValidateSimulationOptions {
  /** Evaluation instant; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Validate a proposed spend against a budget **locally** — no network calls.
 *
 * The budget is trusted to be the live entity the caller intends to draw from
 * (fetch it with `BudgetResource.get` first when in doubt).
 *
 * @param budget  The budget the draw would be made against.
 * @param request The proposed transaction parameters.
 * @param options Evaluation options (custom `now` for tests).
 * @returns A strongly typed {@link BudgetSimulationCheckResult}.
 *
 * @example
 * ```ts
 * import { validateSimulationRequest } from '@astroid/budget';
 *
 * const result = validateSimulationRequest(budget, { asset: 'USDC', amount: '250' });
 * if (!result.allowed) {
 *   for (const v of result.violations) {
 *     if (v.reason === 'EXPIRED_BUDGET') rotateBudgetWindow();
 *   }
 * }
 * ```
 */
export function validateSimulationRequest(
  budget: Budget,
  request: BudgetSimulationRequest,
  options: ValidateSimulationOptions = {},
): BudgetSimulationCheckResult {
  const now = options.now ?? new Date();
  const violations: BudgetSimulationViolation[] = [];
  const window = resolveBudgetWindow(budget);
  const expired = now.getTime() >= new Date(window.end).getTime();

  // --- Multi-asset conversion -------------------------------------------------
  const requestedAsset = request.asset.trim();
  const currency = budget.currency.trim();
  const sameAsset = requestedAsset.toUpperCase() === currency.toUpperCase();
  let convertedAmount: DecimalString | undefined;
  let appliedRate: DecimalString | undefined;
  let draw = String(request.amount);

  if (!sameAsset) {
    if (request.conversionRate === undefined) {
      violations.push({
        reason: 'CURRENCY_MISMATCH',
        message:
          `Budget ${budget.id} is denominated in ${currency}, but the request spends ` +
          `${requestedAsset} and no conversionRate was supplied.`,
        currency,
      });
    } else {
      const rate = String(request.conversionRate);
      draw = decMul(request.amount, rate);
      convertedAmount = draw;
      appliedRate = rate;
    }
  }

  // --- Expired / disabled -----------------------------------------------------
  if (expired) {
    violations.push({
      reason: 'EXPIRED_BUDGET',
      message: `Budget ${budget.id} expired at ${window.end}; its window has closed.`,
      expiredAt: window.end,
    });
  }
  if (!budget.enabled) {
    violations.push({
      reason: 'DISABLED',
      message: `Budget ${budget.id} is disabled; draws are rejected until re-enabled.`,
    });
  }

  // --- Limit overflow ---------------------------------------------------------
  const remaining = resolveBudgetRemaining(budget);
  const projectedSpend = decSum([budget.spent ?? '0', draw]);
  const overflows =
    violations.every((v) => v.reason !== 'CURRENCY_MISMATCH') &&
    decCmp(draw, '0') > 0 &&
    decCmp(projectedSpend, budget.limitAmount) === 1;

  if (overflows) {
    violations.push({
      reason: 'LIMIT_OVERFLOW',
      message:
        `Spend of ${draw} ${currency} would exceed the remaining allowance of ` +
        `${remaining} ${currency} (limit ${budget.limitAmount}, projected ${projectedSpend}).`,
      limit: budget.limitAmount,
      projectedSpend,
      remaining,
      currency,
    });
  }

  const allowed = violations.length === 0;
  const limitNum = Number(budget.limitAmount) || 0;
  const utilizationAfter = limitNum > 0 ? clampUnit(Number(projectedSpend) / limitNum) : 0;
  // Headroom after the simulated draw, clamped at zero (overflows do not
  // report negative allowance).
  const afterRemaining = decSub(remaining, draw);

  const result: BudgetSimulationCheckResult = {
    budgetId: budget.id,
    allowed,
    wouldExceed: violations.some((v) => v.reason === 'LIMIT_OVERFLOW'),
    afterRemaining,
    utilizationAfter,
    state: classifyAllocation(utilizationAfter * 100),
    explanation: allowed
      ? `Spend of ${draw} ${currency} is within the remaining allowance of ${remaining} ${currency}.`
      : violations.map((v) => v.message).join(' '),
    violations,
    expired,
    currency,
    evaluatedAt: now.toISOString(),
  };
  if (convertedAmount !== undefined) result.convertedAmount = convertedAmount;
  if (appliedRate !== undefined) result.appliedConversionRate = appliedRate;
  return result;
}

/**
 * Convert a local {@link BudgetSimulationCheckResult} into the wire-level
 * {@link BudgetCheckResult} shape (string `violations` list).
 *
 * Useful for callers that persist or transmit the plain envelope.
 */
export function toBudgetCheckResult(result: BudgetSimulationCheckResult): BudgetCheckResult {
  return {
    budgetId: result.budgetId,
    allowed: result.allowed,
    wouldExceed: result.wouldExceed,
    afterRemaining: result.afterRemaining,
    utilizationAfter: result.utilizationAfter,
    state: result.state,
    violations: result.violations.map((v) => v.message),
    explanation: result.explanation,
  };
}

/** Re-export for convenience — the rejection-reason union used in violations. */
export type { BudgetSimulationRejectionReason };
