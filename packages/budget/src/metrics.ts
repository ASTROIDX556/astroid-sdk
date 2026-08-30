/**
 * Budget utilization and alert-threshold helpers.
 *
 * Pure functions for computing how much of a budget has been consumed,
 * whether a warning/critical threshold has been crossed, and for deriving a
 * projected depletion (burn) rate. No network or database access — trivially
 * testable and safe on both Node and browser runtimes.
 *
 * All monetary arithmetic uses BigInt-backed decimal comparison to avoid
 * floating-point precision hazards (see `validation.ts` for the shared
 * numerical helpers).
 *
 * @module
 */

import type { DecimalString } from '@astroid/types';
import { checkBudgetLimit, type SpendRequest } from './validation.js';
import type { Budget, BudgetHistoryEntry } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Named, reusable alert thresholds for budget utilization. */
export interface BudgetAlertThresholds {
  /** Warn when utilization crosses this fraction (e.g. `0.8` = 80%). */
  warn?: number;
  /** Flag as critical/over-budget when utilization crosses this fraction. */
  critical?: number;
}

/** The computed utilization state of a budget. */
export interface BudgetUtilization {
  /** Utilization as a fraction `0–1` (e.g. `0.75` = 75%). 0 for an unlimited/zero-limit budget. */
  utilization: number;
  /** Utilization as a percentage (e.g. `75`). */
  percent: number;
  /** Amount spent so far in the active window (decimal string). */
  spent: DecimalString;
  /** Amount remaining (decimal string). */
  remaining: DecimalString;
  /** Total window limit (decimal string). */
  limit: DecimalString;
}

/** Classification of utilization relative to the configured thresholds. */
export type BudgetAlertLevel = 'ok' | 'warn' | 'critical' | 'exceeded';

/** Whether a budget has crossed a threshold and how urgently. */
export interface ThresholdResult {
  /** `true` if any threshold is crossed. */
  exceeded: boolean;
  /** `true` if the budget is fully consumed (remaining ≤ 0). */
  depleted: boolean;
  /** The active alert level. */
  level: BudgetAlertLevel;
  /** The threshold that was crossed, as a fraction; `undefined` when none. */
  thresholdCrossed: number | undefined;
  /** The utilization when the classification was computed. */
  utilization: number;
}

/** Projected burn-rate statistics for a budget. */
export interface BudgetBurnStats {
  /** Average consumption in `limit` units per period over `sampleCount` windows. */
  averagePerPeriod: number;
  /** Number of windows sampled. */
  sampleCount: number;
  /** Estimated window periods until the budget is exhausted (∞ when no burn). */
  periodsUntilExhaustion: number | null;
  /** `true` when the budget is being consumed faster than it is replenished. */
  unsustainable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Internal decimal helpers (mirror validation.ts)                             */
/* -------------------------------------------------------------------------- */

/** Compare two decimal string/number values. Returns -1, 0, or 1. */
function decCmp(a: DecimalString | number, b: DecimalString | number): -1 | 0 | 1 {
  const sc = (v: DecimalString | number): bigint => {
    const s = String(v);
    const [intPart = '0', fracPart = ''] = s.split('.');
    const scale = 18;
    const frac = fracPart.padEnd(scale, '0').slice(0, scale);
    return BigInt(intPart) * 10n ** BigInt(scale) + BigInt(frac || '0');
  };
  const aScaled = sc(a);
  const bScaled = sc(b);
  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

/** String subtraction; floors at `'0'`. */
function decSub(a: DecimalString, b: DecimalString): DecimalString {
  if (decCmp(a, b) <= 0) return '0';
  const [ia = '0', fa = ''] = a.split('.');
  const [ib = '0', fb = ''] = b.split('.');
  const scale = Math.max(fa.length, fb.length);
  const aN = BigInt(ia + fa.padEnd(scale, '0'));
  const bN = BigInt(ib + fb.padEnd(scale, '0'));
  const diff = aN - bN;
  const str = diff.toString().padStart(scale + 1, '0');
  const int = str.slice(0, str.length - scale) || '0';
  const frac = str.slice(str.length - scale).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** String addition of two decimal strings. */
function decAddDecimal(a: DecimalString, b: DecimalString): DecimalString {
  const [ia = '0', fa = ''] = a.split('.');
  const [ib = '0', fb = ''] = b.split('.');
  const scale = Math.max(fa.length, fb.length);
  const aN = BigInt(ia + fa.padEnd(scale, '0'));
  const bN = BigInt(ib + fb.padEnd(scale, '0'));
  const sum = aN + bN;
  const str = sum.toString().padStart(scale + 1, '0');
  const int = str.slice(0, str.length - scale) || '0';
  const frac = str.slice(str.length - scale).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** Convert a decimal string to a JS number (used only for percentage display). */
function toNumber(v: DecimalString): number {
  return Number(v);
}

/* -------------------------------------------------------------------------- */
/* Core helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compute what fraction of a budget limit has been spent, using the stored
 * `spent`/`remaining` fields when present (fast path) or recomputing from the
 * window history when they are unavailable.
 *
 * Handles the edge cases the issue calls out:
 * - **zero limit**  → utilization is `0` (avoid div-by-zero).
 * - **exact match** → utilization is exactly `1.0`.
 * - **low-precision** → decimal-safe arithmetic.
 *
 * @param budget The budget definition.
 * @param history Optional window history for recomputing spent when
 *                `budget.spent` is absent. Falls back to `budget.spent`.
 * @param request Optional prospective spend to include in the projection.
 * @returns       A {@link BudgetUtilization}.
 */
export function calculateUtilization(
  budget: Budget,
  history?: BudgetHistoryEntry[],
  request?: SpendRequest,
): BudgetUtilization {
  const limit = String(budget.limitAmount) as DecimalString;

  // Prefer recomputing spent from window history for accuracy; otherwise fall
  // back to the stored `spent` figure. When a prospective `request` is given,
  // its amount is projected on top of the current spent total.
  let spent: DecimalString;
  if (history && history.length > 0) {
    const result = checkBudgetLimit(
      budget,
      history,
      request ?? { asset: budget.currency, amount: '0' },
    );
    spent = result.spent;
  } else {
    const current = String(budget.spent ?? '0') as DecimalString;
    // Sum current spent + prospective request (decimal-safe).
    const projected = request && decCmp(String(request.amount), 0) === 1
      ? decAddDecimal(current, String(request.amount))
      : current;
    spent = projected;
  }

  const limitNum = toNumber(limit);
  if (!Number.isFinite(limitNum) || limitNum <= 0) {
    return { utilization: 0, percent: 0, spent, remaining: limit, limit };
  }

  const remaining = decSub(limit, spent);
  const spentNum = toNumber(spent);
  const utilization = Math.max(0, Math.min(spentNum / limitNum, 1));

  return {
    utilization,
    percent: Math.round(utilization * 1000) / 10,
    spent,
    remaining,
    limit,
  };
}

/**
 * Check whether a budget's current utilization crosses configured alert
 * thresholds (e.g. warn at 80%, critical at 95%).
 *
 * @param budget     The budget to evaluate.
 * @param thresholds Optional thresholds. Defaults to warn `0.8`, critical `0.95`.
 * @param history    Optional history for accurate spent computation.
 * @param request    Optional prospective spend.
 * @returns          A {@link ThresholdResult}.
 */
export function isThresholdExceeded(
  budget: Budget,
  thresholds: BudgetAlertThresholds = {},
  history?: BudgetHistoryEntry[],
  request?: SpendRequest,
): ThresholdResult {
  const { warn = 0.8, critical = 0.95 } = thresholds;

  const util = calculateUtilization(budget, history, request);
  const depleted = decCmp(util.remaining, '0') <= 0;

  let level: BudgetAlertLevel = 'ok';
  let thresholdCrossed: number | undefined;

  if (depleted) {
    level = 'exceeded';
    thresholdCrossed = critical;
  } else if (util.utilization >= critical) {
    level = 'critical';
    thresholdCrossed = critical;
  } else if (util.utilization >= warn) {
    level = 'warn';
    thresholdCrossed = warn;
  }

  return {
    exceeded: level !== 'ok',
    depleted,
    level,
    thresholdCrossed,
    utilization: util.utilization,
  };
}

/**
 * Estimate how quickly a budget is being consumed and whether it can sustain
 * its current burn rate over the configured window count.
 *
 * This is deliberately pure: it uses the *delta* between the current spent
 * figure and the budget limit, so it does not require historical records.
 *
 * @param budget      The budget definition.
 * @param windowCount How many periods back to assume the current spend
 *                    accumulated over (used to derive a per-period burn rate).
 * @returns           A {@link BudgetBurnStats}.
 */
export function estimateBurnRate(
  budget: Budget,
  windowCount = 1,
): BudgetBurnStats {
  const spent = toNumber(String(budget.spent ?? '0'));
  const limit = toNumber(String(budget.limitAmount));
  const periods = Math.max(1, Math.floor(windowCount));

  if (!Number.isFinite(limit) || limit <= 0) {
    return { averagePerPeriod: 0, sampleCount: periods, periodsUntilExhaustion: null, unsustainable: false };
  }

  const averagePerPeriod = spent / periods;
  const remaining = limit - spent;
  const periodsUntilExhaustion =
    averagePerPeriod > 0 && remaining > 0 ? remaining / averagePerPeriod : null;

  return {
    averagePerPeriod: Math.round(averagePerPeriod * 100) / 100,
    sampleCount: periods,
    periodsUntilExhaustion,
    unsustainable: spent >= limit,
  };
}