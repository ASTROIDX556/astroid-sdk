/**
 * Local budget-limit validation helper.
 *
 * Checks whether a prospective spend request violates the rules or would
 * exceed the maximum remaining allowance of a given budget — without any
 * network or database round-trip, so it works identically in Node and
 * browser runtimes.
 *
 * @module
 */

import type {
  Budget,
  BudgetHistoryEntry,
  BudgetPeriod,
  DecimalString,
  IsoDateTime,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** A spend request to validate against a budget. */
export interface SpendRequest {
  /** Asset identifier (e.g. `"XLM"`, `"USDC"`, `"USDC:G...Issuer"`). */
  asset: string;
  /** Amount to spend (decimal string or number). */
  amount: DecimalString | number;
}

/** The outcome of a budget-limit validation check. */
export interface BudgetValidationResult {
  /** Whether the spend request is allowed by this budget. */
  allowed: boolean;
  /** Remaining headroom (budget limit minus already-spent), as a decimal string. */
  remaining: DecimalString;
  /** Whether the budget rule was actually violated (i.e. would exceed the limit). */
  violated: boolean;
  /**
   * When `violated` is true, a human-readable description of which
   * restriction was breached.  `null` otherwise.
   */
  restriction: string | null;
  /** How much of the budget is consumed so far in the active window, as a decimal string. */
  spent: DecimalString;
  /** The active window start (ISO-8601 UTC). */
  windowStart: IsoDateTime;
  /** The active window end (ISO-8601 UTC). */
  windowEnd: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decimal-string addition.  Both operands are non-negative finite decimals.
 * Scales both to the longer fractional length using integer arithmetic.
 */
function decAdd(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));
  const result = (aScaled + bScaled).toString();

  if (maxScale === 0) return result;

  const padded = result.padStart(maxScale + 1, '0');
  const intPart = padded.slice(0, padded.length - maxScale) || '0';
  const fracPart = padded.slice(padded.length - maxScale);
  const trimmedFrac = fracPart.replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

/**
 * Decimal-string subtraction (`a - b`).  Returns `"0"` if `b > a`.
 * Both operands are non-negative finite decimals.
 */
function decSub(a: DecimalString | number, b: DecimalString | number): DecimalString {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));

  const diff = aScaled - bScaled;
  if (diff <= 0n) return '0';

  const result = diff.toString();
  if (maxScale === 0) return result;

  const padded = result.padStart(maxScale + 1, '0');
  const intPart = padded.slice(0, padded.length - maxScale) || '0';
  const fracPart = padded.slice(padded.length - maxScale);
  const trimmedFrac = fracPart.replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

/** Compare two decimal strings.  Returns -1, 0, or 1. */
function decCmp(a: DecimalString | number, b: DecimalString | number): -1 | 0 | 1 {
  const sa = String(a);
  const sb = String(b);

  const [intA, fracA = ''] = sa.split('.');
  const [intB, fracB = ''] = sb.split('.');
  const scaleA = fracA.length;
  const scaleB = fracB.length;
  const maxScale = Math.max(scaleA, scaleB);

  const aScaled = BigInt(intA + fracA.padEnd(scaleA, '0') + '0'.repeat(maxScale - scaleA));
  const bScaled = BigInt(intB + fracB.padEnd(scaleB, '0') + '0'.repeat(maxScale - scaleB));

  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

/** Whether the decimal string representation of `a` is `> 0`. */
function decGtZero(a: DecimalString | number): boolean {
  return decCmp(a, 0) === 1;
}

/**
 * Sum a list of decimal-string amounts.
 * Returns `"0"` when the list is empty.
 */
function decSum(items: DecimalString[]): DecimalString {
  let acc: DecimalString = '0';
  for (const item of items) {
    acc = decAdd(acc, item);
  }
  return acc;
}

/* -------------------------------------------------------------------------- */
/* Window / boundary helpers                                                   */
/* -------------------------------------------------------------------------- */

/** ISO-8601 day boundaries (00:00 UTC) for a given Date. */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}

/**
 * Determine the start and end of the active budget window based on the
 * budget's period type and its recorded `periodStart`.
 *
 * Boundaries are always normalised to 00:00 UTC for day-level alignment
 * so that cross-midnight scenarios behave correctly.
 */
function getWindow(period: BudgetPeriod, periodStart: IsoDateTime): { start: Date; end: Date } {
  const ps = new Date(periodStart);

  switch (period) {
    case 'ONE_TIME':
      return { start: ps, end: addYears(ps, 100) };

    case 'DAILY': {
      const dayStart = startOfDay(ps);
      return { start: dayStart, end: addDays(dayStart, 1) };
    }

    case 'WEEKLY': {
      const dayStart = startOfDay(ps);
      // Align to Monday (ISO week start)
      const dow = dayStart.getUTCDay(); // 0=Sun 1=Mon … 6=Sat
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = addDays(dayStart, mondayOffset);
      return { start: monday, end: addDays(monday, 7) };
    }

    case 'MONTHLY': {
      const monthStart = new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), 1));
      return { start: monthStart, end: addMonths(monthStart, 1) };
    }

    case 'QUARTERLY': {
      const q = Math.floor(ps.getUTCMonth() / 3);
      const quarterStart = new Date(Date.UTC(ps.getUTCFullYear(), q * 3, 1));
      return { start: quarterStart, end: addMonths(quarterStart, 3) };
    }

    case 'YEARLY': {
      const yearStart = new Date(Date.UTC(ps.getUTCFullYear(), 0, 1));
      return { start: yearStart, end: addYears(yearStart, 1) };
    }

    default: {
      const _exhaustive: never = period;
      throw new Error(`Unhandled budget period: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Normalise a `SpendRequest.amount` to a `DecimalString`, stripping
 * trailing fractional zeros.
 */
function normaliseAmount(amount: DecimalString | number): DecimalString {
  if (typeof amount === 'number') {
    return String(amount);
  }
  return amount;
}

/* -------------------------------------------------------------------------- */
/* Structured Spending Validation API (Issue #429)                            */
/* -------------------------------------------------------------------------- */

/** Machine-readable classification of a spending limit breach. */
export type SpendingLimitViolationType =
  | 'REMAINING_ALLOWANCE_EXCEEDED'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'ASSET_CAP_EXCEEDED'
  | 'DISABLED_BUDGET'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT';

/** A single spending restriction violation. */
export interface SpendingLimitViolation {
  /** Machine-readable violation code. */
  type: SpendingLimitViolationType;
  /** Human-readable explanation. */
  message: string;
  /** The limit that was evaluated (decimal string), if applicable. */
  limit?: DecimalString;
  /** The current spent amount before the requested draw (decimal string), if applicable. */
  currentSpent?: DecimalString;
  /** The requested spend amount (decimal string), if applicable. */
  requestedAmount?: DecimalString;
}

/** Structured outcome of spending validation. */
export interface BudgetSpendingValidationResult {
  /** Whether the spend request is permitted under all evaluated limits. */
  allowed: boolean;
  /** Remaining allowance headroom after applying the request (clamped at 0). */
  remainingAllowance: DecimalString;
  /** Total spent in the active window before the request (decimal string). */
  spentInWindow: DecimalString;
  /** List of violated limits (empty when permitted). */
  violations: SpendingLimitViolation[];
  /** Human-readable summary of the validation decision. */
  explanation: string;
}

/** Input options for daily limit validation. */
export interface ValidateDailyLimitOptions {
  /** Explicit daily spending limit (decimal string or number). Defaults to budget's daily limit. */
  dailyLimit?: DecimalString | number;
  /** Evaluation instant (Date or ISO string); defaults to current time. */
  now?: Date | string;
}

/** Input options for comprehensive spending validation. */
export interface ValidateBudgetSpendingOptions {
  /** Historical entries used to aggregate spending in the active window. */
  spentHistory?: BudgetHistoryEntry[];
  /** Optional explicit daily limit. */
  dailyLimit?: DecimalString | number;
  /** Asset-specific spending caps (e.g. `{ XLM: '1000.00', USDC: '500.00' }`). */
  assetCaps?: Record<string, DecimalString | number> | Map<string, DecimalString | number>;
  /** Current spent amounts by asset for cap validation. */
  currentSpentByAsset?: Record<string, DecimalString | number> | Map<string, DecimalString | number>;
  /** Evaluation instant (Date or ISO string); defaults to current time. */
  now?: Date | string;
}

/**
 * Check if a value is a valid non-negative finite decimal string or number.
 */
function isValidAmount(val: unknown): boolean {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0;
  }
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (s === '') return false;
  return /^\d+(?:\.\d+)?$/.test(s);
}

/**
 * Validate remaining allowance for a budget against a prospective spend request.
 *
 * Uses precise integer/decimal arithmetic for Stellar amounts. Exact-limit
 * boundaries are permitted (`amount === remaining`).
 *
 * @param budget Budget definition or cached state.
 * @param request Spend request payload (`asset` and `amount`).
 * @param spentHistory Optional history entries to derive spent amount if budget.spent is missing.
 */
export function validateRemainingAllowance(
  budget: Partial<Budget> & Pick<Budget, 'limitAmount'>,
  request: SpendRequest,
  spentHistory?: BudgetHistoryEntry[],
): BudgetSpendingValidationResult {
  const violations: SpendingLimitViolation[] = [];

  const rawAmount = request.amount;
  if (!isValidAmount(rawAmount)) {
    const message = `Invalid spend amount "${String(rawAmount)}". Amount must be a non-negative finite decimal number or string.`;
    violations.push({
      type: 'INVALID_AMOUNT',
      message,
      requestedAmount: String(rawAmount),
    });
    return {
      allowed: false,
      remainingAllowance: '0',
      spentInWindow: '0',
      violations,
      explanation: message,
    };
  }

  const reqAmount = normaliseAmount(rawAmount);

  if (budget.enabled === false) {
    violations.push({
      type: 'DISABLED_BUDGET',
      message: `Budget ${budget.id ?? ''} is disabled.`,
    });
  }

  const budgetCurrency = (budget.currency ?? request.asset).trim().toUpperCase();
  const reqAsset = request.asset.trim().toUpperCase();
  if (budgetCurrency !== reqAsset) {
    violations.push({
      type: 'CURRENCY_MISMATCH',
      message: `Asset mismatch: budget is in ${budgetCurrency}, request is in ${reqAsset}.`,
    });
  }

  const limitAmount = isValidAmount(budget.limitAmount) ? normaliseAmount(budget.limitAmount) : '0';

  let spent = '0';
  const rawSpent = budget.spent;
  if (rawSpent !== undefined && isValidAmount(rawSpent)) {
    spent = normaliseAmount(rawSpent);
  } else if (spentHistory && Array.isArray(spentHistory)) {
    const activeEntries = budget.period && budget.periodStart
      ? spentHistory.filter((entry) => {
          const { start, end } = getWindow(budget.period!, budget.periodStart!);
          const t = new Date(entry.createdAt).getTime();
          return t >= start.getTime() && t < end.getTime();
        })
      : spentHistory;
    spent = decSum(activeEntries.map((e) => normaliseAmount(e.amount)));
  }

  const remaining = decSub(limitAmount, spent);
  const wouldExceed = decGtZero(reqAmount) && decCmp(reqAmount, remaining) === 1;

  if (wouldExceed) {
    violations.push({
      type: 'REMAINING_ALLOWANCE_EXCEEDED',
      message: `Spend of ${reqAmount} exceeds remaining allowance of ${remaining} (limit: ${limitAmount}, spent: ${spent}).`,
      limit: limitAmount,
      currentSpent: spent,
      requestedAmount: reqAmount,
    });
  }

  const allowed = violations.length === 0;
  const remainingAfter = decSub(remaining, reqAmount);

  return {
    allowed,
    remainingAllowance: remainingAfter,
    spentInWindow: spent,
    violations,
    explanation: allowed
      ? `Spend of ${reqAmount} is within remaining allowance of ${remaining}.`
      : violations.map((v) => v.message).join(' '),
  };
}

/**
 * Validate a spend request against daily spending limits.
 *
 * @param budget Budget definition or daily limit options.
 * @param request Spend request payload.
 * @param spentHistory Historical entries to filter within the current daily 24h window.
 * @param options Options specifying an explicit daily limit or evaluation instant.
 */
export function validateDailyLimit(
  budget: Partial<Budget>,
  request: SpendRequest,
  spentHistory?: BudgetHistoryEntry[],
  options: ValidateDailyLimitOptions = {},
): BudgetSpendingValidationResult {
  const violations: SpendingLimitViolation[] = [];

  if (!isValidAmount(request.amount)) {
    const message = `Invalid spend amount "${String(request.amount)}". Amount must be a non-negative finite decimal number or string.`;
    violations.push({
      type: 'INVALID_AMOUNT',
      message,
      requestedAmount: String(request.amount),
    });
    return {
      allowed: false,
      remainingAllowance: '0',
      spentInWindow: '0',
      violations,
      explanation: message,
    };
  }

  const reqAmount = normaliseAmount(request.amount);

  const rawDailyLimit = options.dailyLimit ?? (budget.period === 'DAILY' ? budget.limitAmount : undefined);
  if (rawDailyLimit === undefined || !isValidAmount(rawDailyLimit)) {
    // If no daily limit is configured, pass validation safely
    return {
      allowed: true,
      remainingAllowance: '0',
      spentInWindow: '0',
      violations: [],
      explanation: 'No daily limit configured.',
    };
  }

  const dailyLimit = normaliseAmount(rawDailyLimit);

  const evalDate = options.now ? new Date(options.now) : new Date();
  const dayStart = startOfDay(evalDate);
  const dayEnd = addDays(dayStart, 1);

  let dailySpent = '0';
  const rawBudgetSpent = budget.spent;
  if (spentHistory && Array.isArray(spentHistory)) {
    const dailyEntries = spentHistory.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });
    dailySpent = decSum(dailyEntries.map((e) => normaliseAmount(e.amount)));
  } else if (budget.period === 'DAILY' && rawBudgetSpent !== undefined && isValidAmount(rawBudgetSpent)) {
    dailySpent = normaliseAmount(rawBudgetSpent);
  }

  const remainingDaily = decSub(dailyLimit, dailySpent);
  const wouldExceed = decGtZero(reqAmount) && decCmp(reqAmount, remainingDaily) === 1;

  if (wouldExceed) {
    violations.push({
      type: 'DAILY_LIMIT_EXCEEDED',
      message: `Spend of ${reqAmount} exceeds daily limit of ${dailyLimit} (spent today: ${dailySpent}, remaining today: ${remainingDaily}).`,
      limit: dailyLimit,
      currentSpent: dailySpent,
      requestedAmount: reqAmount,
    });
  }

  const allowed = violations.length === 0;
  const remainingAfter = decSub(remainingDaily, reqAmount);

  return {
    allowed,
    remainingAllowance: remainingAfter,
    spentInWindow: dailySpent,
    violations,
    explanation: allowed
      ? `Spend of ${reqAmount} is within daily limit of ${dailyLimit}.`
      : violations.map((v) => v.message).join(' '),
  };
}

/**
 * Validate asset-specific spending caps.
 *
 * @param request Spend request payload.
 * @param assetCaps Asset cap definition map or record (e.g. `{ XLM: '1000' }`).
 * @param currentSpentByAsset Current spent amount per asset.
 */
export function validateAssetSpendingCap(
  request: SpendRequest,
  assetCaps?: Record<string, DecimalString | number> | Map<string, DecimalString | number>,
  currentSpentByAsset?: Record<string, DecimalString | number> | Map<string, DecimalString | number>,
): BudgetSpendingValidationResult {
  const violations: SpendingLimitViolation[] = [];

  if (!isValidAmount(request.amount)) {
    const message = `Invalid spend amount "${String(request.amount)}". Amount must be a non-negative finite decimal number or string.`;
    violations.push({
      type: 'INVALID_AMOUNT',
      message,
      requestedAmount: String(request.amount),
    });
    return {
      allowed: false,
      remainingAllowance: '0',
      spentInWindow: '0',
      violations,
      explanation: message,
    };
  }

  const reqAmount = normaliseAmount(request.amount);
  const assetKey = request.asset.trim().toUpperCase();

  let capValue: DecimalString | number | undefined;
  if (assetCaps instanceof Map) {
    capValue = assetCaps.get(assetKey) ?? assetCaps.get(request.asset);
  } else if (assetCaps && typeof assetCaps === 'object') {
    capValue = assetCaps[assetKey] ?? assetCaps[request.asset];
  }

  if (capValue === undefined || !isValidAmount(capValue)) {
    return {
      allowed: true,
      remainingAllowance: '0',
      spentInWindow: '0',
      violations: [],
      explanation: `No asset spending cap configured for asset "${request.asset}".`,
    };
  }

  const cap = normaliseAmount(capValue);

  let spentValue: DecimalString | number | undefined;
  if (currentSpentByAsset instanceof Map) {
    spentValue = currentSpentByAsset.get(assetKey) ?? currentSpentByAsset.get(request.asset);
  } else if (currentSpentByAsset && typeof currentSpentByAsset === 'object') {
    spentValue = currentSpentByAsset[assetKey] ?? currentSpentByAsset[request.asset];
  }

  const currentSpent = spentValue !== undefined && isValidAmount(spentValue) ? normaliseAmount(spentValue) : '0';
  const remaining = decSub(cap, currentSpent);
  const wouldExceed = decGtZero(reqAmount) && decCmp(reqAmount, remaining) === 1;

  if (wouldExceed) {
    violations.push({
      type: 'ASSET_CAP_EXCEEDED',
      message: `Spend of ${reqAmount} ${request.asset} exceeds spending cap of ${cap} ${request.asset} (current spent: ${currentSpent}, remaining: ${remaining}).`,
      limit: cap,
      currentSpent,
      requestedAmount: reqAmount,
    });
  }

  const allowed = violations.length === 0;
  const remainingAfter = decSub(remaining, reqAmount);

  return {
    allowed,
    remainingAllowance: remainingAfter,
    spentInWindow: currentSpent,
    violations,
    explanation: allowed
      ? `Spend of ${reqAmount} ${request.asset} is within asset cap of ${cap}.`
      : violations.map((v) => v.message).join(' '),
  };
}

/**
 * Validate a prospective spend request against all budget limits (remaining allowance,
 * daily limit, asset caps).
 *
 * @param budget Budget definition or DTO.
 * @param request Spend request payload.
 * @param options Additional validation options including history, daily limits, asset caps.
 */
export function validateBudgetSpending(
  budget: Partial<Budget> & Pick<Budget, 'limitAmount'>,
  request: SpendRequest,
  options: ValidateBudgetSpendingOptions = {},
): BudgetSpendingValidationResult {
  const allowanceResult = validateRemainingAllowance(budget, request, options.spentHistory);
  const dailyResult = validateDailyLimit(budget, request, options.spentHistory, {
    dailyLimit: options.dailyLimit,
    now: options.now,
  });
  const assetCapResult = validateAssetSpendingCap(request, options.assetCaps, options.currentSpentByAsset);

  const allViolations: SpendingLimitViolation[] = [
    ...allowanceResult.violations,
    ...dailyResult.violations,
    ...assetCapResult.violations,
  ];

  const allowed = allViolations.length === 0;

  return {
    allowed,
    remainingAllowance: allowanceResult.remainingAllowance,
    spentInWindow: allowanceResult.spentInWindow,
    violations: allViolations,
    explanation: allowed
      ? 'Spend request passed all budget spending validations.'
      : allViolations.map((v) => v.message).join(' '),
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Check whether a prospective spend request is within the limits of a
 * budget, using only local arithmetic — no network or database calls.
 *
 * ### How it works
 *
 * 1. The budget's **active window** is derived from `budget.period` and
 *    `budget.periodStart` (normalised to 00:00 UTC for day-level periods).
 * 2. Only `BudgetHistoryEntry` entries whose `createdAt` falls within the
 *    active window are counted.
 * 3. The request's asset must match `budget.currency` — otherwise the
 *    budget simply does not apply and `allowed` is `true` (no restriction
 *    violated).
 * 4. Amount arithmetic uses **string-based / BigInt integer arithmetic**
 *    to avoid floating-point precision hazards.
 *
 * @param budget           The budget definition to validate against.
 * @param spentHistory     Historical consumption entries for the current window.
 * @param request          The prospective spend request.
 * @returns                A {@link BudgetValidationResult} describing whether
 *                         the request is allowed and why.
 */
export function checkBudgetLimit(
  budget: Budget,
  spentHistory: BudgetHistoryEntry[],
  request: SpendRequest,
): BudgetValidationResult {
  const requestAmount = normaliseAmount(request.amount);

  // 1. Compute the active window
  const { start: windowStart, end: windowEnd } = getWindow(budget.period, budget.periodStart);

  // 2. Filter history to entries within the active window
  const activeEntries = spentHistory.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    return t >= windowStart.getTime() && t < windowEnd.getTime();
  });

  // 3. Sum the spent amount within the window (decimal strings)
  const totalSpent = decSum(activeEntries.map((e) => e.amount));

  // 4. Calculate remaining headroom
  const remaining = decSub(budget.limitAmount, totalSpent);

  // 5. Check if the request would exceed the budget
  const wouldExceed = decGtZero(requestAmount) && decCmp(requestAmount, remaining) === 1;

  // 6. Asset mismatch: budget doesn't apply to this asset
  const assetMismatch = request.asset.trim().toUpperCase() !== budget.currency.trim().toUpperCase();

  if (!budget.enabled || assetMismatch) {
    return {
      allowed: true,
      remaining,
      violated: false,
      restriction: null,
      spent: totalSpent,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  if (wouldExceed) {
    return {
      allowed: false,
      remaining,
      violated: true,
      restriction: `Spend of ${requestAmount} ${budget.currency} would exceed the ${budget.period.toLowerCase()} budget limit of ${budget.limitAmount} (remaining: ${remaining}).`,
      spent: totalSpent,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  return {
    allowed: true,
    remaining,
    violated: false,
    restriction: null,
    spent: totalSpent,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}
