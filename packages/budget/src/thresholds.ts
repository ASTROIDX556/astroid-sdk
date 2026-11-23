/**
 * Budget threshold evaluation and alert triggers.
 *
 * Autonomous agents run against hard financial limits, so the useful moment to
 * warn is *before* the limit blocks a transaction — at 80%, 95% or any other
 * percentage a dashboard configures. This module evaluates a budget's
 * utilization against an arbitrary set of percentage thresholds and exposes a
 * small monitor that fires callbacks once per newly-crossed threshold.
 *
 * Everything here is pure local arithmetic: no network calls, no timers, no
 * globals. Feed it the {@link Budget} (or utilization snapshot) you already
 * hold from `budgets.get()` and it returns alert states immediately.
 *
 * ```ts
 * const monitor = createBudgetThresholdMonitor({ thresholds: [80, 95, 100] });
 * monitor.onThreshold((alert) => {
 *   console.warn(`Budget ${alert.budgetId} crossed ${alert.threshold}%`);
 * });
 *
 * // Call whenever a fresh budget snapshot arrives.
 * const alerts = monitor.evaluate(budget);
 * ```
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import {
  BUDGET_ALERT_THRESHOLDS,
  type Budget,
  type BudgetAllocationState,
  type DecimalString,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** The subset of a {@link Budget} needed to evaluate thresholds. */
export type BudgetThresholdSubject = Pick<Budget, 'id' | 'limitAmount' | 'spent'>;

/** A named threshold definition. */
export interface BudgetThresholdDefinition {
  /** Utilization percentage at which the alert fires (e.g. `80`). */
  percent: number;
  /** Optional human-readable label, echoed on matches and alert events. */
  label?: string;
}

/** A threshold supplied as a bare percentage or a labelled definition. */
export type BudgetThresholdInput = number | BudgetThresholdDefinition;

/** Options for {@link evaluateBudgetThresholds}. */
export interface BudgetThresholdOptions {
  /**
   * Thresholds to evaluate. Defaults to
   * {@link DEFAULT_BUDGET_THRESHOLDS} (`[50, 80, 95, 100]`).
   */
  thresholds?: readonly BudgetThresholdInput[];
  /**
   * Whether a utilization exactly equal to a threshold counts as reached.
   * Defaults to `true`, so spending exactly 80% of an 80% alert fires it.
   */
  inclusive?: boolean;
}

/** One threshold and whether the budget has reached it. */
export interface BudgetThresholdMatch {
  /** The threshold percentage. */
  threshold: number;
  /** Optional label from the threshold definition. */
  label?: string;
  /** Whether utilization has reached the threshold. */
  reached: boolean;
  /** Whether utilization is at or above 100% (the hard limit). */
  exceeded: boolean;
}

/** Bucketed severity derived from utilization percentage. */
export type BudgetThresholdLevel = BudgetAllocationState | 'unknown';

/** The full result of one threshold evaluation. */
export interface BudgetThresholdEvaluation {
  /** The evaluated budget id. */
  budgetId: string;
  /** The active-window limit as a number. */
  limit: number;
  /** Amount consumed in the active window as a number. */
  spent: number;
  /** Headroom left, clamped at zero. */
  remaining: number;
  /** Fraction consumed, clamped to `0`–`1`. */
  utilization: number;
  /**
   * Percentage consumed. Values above `100` are preserved when spending
   * overshoots the limit, so callers can distinguish "at limit" from "over".
   */
  percent: number;
  /** Bucketed severity (`ok` is reported as `healthy`). */
  level: BudgetThresholdLevel;
  /** The highest threshold reached, or `null` when none were. */
  threshold: number | null;
  /** Whether at least one threshold was reached. */
  reached: boolean;
  /** Whether the hard limit (100%) was reached or exceeded. */
  exceeded: boolean;
  /** Per-threshold results, in ascending threshold order. */
  matches: BudgetThresholdMatch[];
}

/** An alert emitted when a threshold is newly reached. */
export interface BudgetThresholdAlert {
  /** The budget that crossed the threshold. */
  budgetId: string;
  /** The threshold that was crossed. */
  threshold: number;
  /** Optional label from the threshold definition. */
  label?: string;
  /** Utilization percentage at evaluation time. */
  percent: number;
  /** The evaluation that produced this alert. */
  evaluation: BudgetThresholdEvaluation;
}

/** Callback invoked by a {@link BudgetThresholdMonitor} for each new crossing. */
export type BudgetThresholdListener = (alert: BudgetThresholdAlert) => void;

/** Options for {@link createBudgetThresholdMonitor}. */
export type BudgetThresholdMonitorOptions = BudgetThresholdOptions;

/** A stateful threshold monitor that de-duplicates crossings per budget. */
export interface BudgetThresholdMonitor {
  /** The resolved, ascending thresholds being monitored. */
  readonly thresholds: readonly number[];
  /**
   * Evaluate a budget and return the alerts for thresholds crossed since the
   * previous evaluation. Each threshold fires once until utilization drops back
   * below it, at which point it re-arms.
   */
  evaluate(budget: BudgetThresholdSubject): BudgetThresholdAlert[];
  /** Register a listener. Returns an unsubscribe function. */
  onThreshold(listener: BudgetThresholdListener): () => void;
  /** Remove a previously registered listener. */
  removeListener(listener: BudgetThresholdListener): void;
  /** Forget crossings for one budget (or all budgets when omitted). */
  reset(budgetId?: string): void;
  /** Remove every listener and forget all crossings. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Default alert thresholds: the platform-recommended 50%/80%/100% milestones
 * plus a 95% "critical" warning immediately before the hard limit.
 */
export const DEFAULT_BUDGET_THRESHOLDS: readonly number[] = Object.freeze(
  [...new Set<number>([...BUDGET_ALERT_THRESHOLDS, 95])].sort((a, b) => a - b),
);

/* -------------------------------------------------------------------------- */
/* Arithmetic helpers                                                          */
/* -------------------------------------------------------------------------- */

function toNumber(value: DecimalString | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? 1 : n;
}

/** Assert a threshold percentage is a finite number greater than zero. */
function assertValidThreshold(percent: number): void {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) {
    throw new ValidationError(
      `Budget threshold must be a finite percentage greater than 0, received ${String(percent)}.`,
      {
        code: 'BUDGET_THRESHOLD_INVALID',
        status: 400,
        details: { field: 'thresholds', received: percent, expected: 'number > 0' },
      },
    );
  }
}

/** Normalise threshold input into a sorted, de-duplicated definition list. */
export function normalizeBudgetThresholds(
  thresholds: readonly BudgetThresholdInput[] = DEFAULT_BUDGET_THRESHOLDS,
): BudgetThresholdDefinition[] {
  if (!Array.isArray(thresholds)) {
    throw new ValidationError('Budget thresholds must be an array of percentages.', {
      code: 'BUDGET_THRESHOLD_INVALID',
      status: 400,
      details: { field: 'thresholds', received: thresholds, expected: 'number[]' },
    });
  }

  const byPercent = new Map<number, BudgetThresholdDefinition>();
  for (const entry of thresholds) {
    const definition =
      typeof entry === 'number' ? { percent: entry } : { percent: entry.percent, label: entry.label };
    assertValidThreshold(definition.percent);
    // Keep the first label supplied for an otherwise duplicated percentage.
    if (!byPercent.has(definition.percent)) {
      byPercent.set(definition.percent, definition);
    }
  }

  return [...byPercent.values()].sort((a, b) => a.percent - b.percent);
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a budget against percentage thresholds.
 *
 * Utilisation is `spent / limit`. A budget with a zero limit has `0%`
 * utilisation while nothing is spent; any positive spend against a zero limit
 * is treated as `100%` (and `exceeded`) because there is no allowance at all.
 * A threshold counts as reached when utilisation is **at or above** it
 * (`inclusive`, the default), so `80%` fires an `80` threshold exactly.
 *
 * @param budget  The budget to evaluate.
 * @param options Thresholds and inclusivity. Defaults to
 *                {@link DEFAULT_BUDGET_THRESHOLDS}.
 * @returns The evaluation, including one {@link BudgetThresholdMatch} per threshold.
 * @throws {ValidationError} When a threshold is not a finite number greater than 0.
 *
 * @example
 * ```ts
 * const result = evaluateBudgetThresholds(budget, { thresholds: [80, 95] });
 * if (result.reached) notify(`Spend at ${result.percent}%`);
 * ```
 */
export function evaluateBudgetThresholds(
  budget: BudgetThresholdSubject,
  options: BudgetThresholdOptions = {},
): BudgetThresholdEvaluation {
  const definitions = normalizeBudgetThresholds(options.thresholds);
  const inclusive = options.inclusive !== false;

  const limit = Math.max(0, toNumber(budget.limitAmount));
  const spent = Math.max(0, toNumber(budget.spent));
  const remaining = Math.max(0, limit - spent);
  const hasAllowance = limit > 0;
  const percent = hasAllowance ? (spent / limit) * 100 : spent > 0 ? 100 : 0;
  const utilization = hasAllowance ? clamp01(spent / limit) : spent > 0 ? 1 : 0;
  const exceeded = hasAllowance ? spent >= limit : spent > 0;

  const matches: BudgetThresholdMatch[] = definitions.map((definition) => ({
    threshold: definition.percent,
    ...(definition.label !== undefined ? { label: definition.label } : {}),
    reached: inclusive ? percent >= definition.percent : percent > definition.percent,
    exceeded,
  }));

  const reachedMatches = matches.filter((match) => match.reached);
  const highest = reachedMatches.at(-1)?.threshold ?? null;

  return {
    budgetId: budget.id,
    limit,
    spent,
    remaining,
    utilization,
    percent,
    level: deriveLevel(percent, exceeded),
    threshold: highest,
    reached: highest !== null,
    exceeded,
    matches,
  };
}

/** Bucket an evaluation into the shared allocation states. */
function deriveLevel(percent: number, exceeded: boolean): BudgetAllocationState {
  if (exceeded || percent >= 100) return 'exhausted';
  if (percent >= 95) return 'critical';
  if (percent >= 80) return 'warning';
  return 'healthy';
}

/* -------------------------------------------------------------------------- */
/* Monitor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create a stateful monitor that turns successive evaluations into
 * one-shot-per-crossing alert callbacks.
 *
 * Each threshold fires once per budget while utilization stays at or above it;
 * if utilization drops below the threshold again (a new period, an increased
 * limit), the threshold re-arms and fires on the next crossing. This avoids the
 * "alert on every poll" problem without hiding genuine re-crossings.
 *
 * @param options Thresholds and inclusivity, as for
 *                {@link evaluateBudgetThresholds}.
 * @returns A {@link BudgetThresholdMonitor}.
 * @throws {ValidationError} When the configured thresholds are invalid.
 *
 * @example
 * ```ts
 * const monitor = createBudgetThresholdMonitor({
 *   thresholds: [{ percent: 80, label: 'warning' }, { percent: 95, label: 'critical' }],
 * });
 * const off = monitor.onThreshold((alert) => sendSlack(alert));
 * monitor.evaluate(budget); // emits nothing below 80%
 * off();
 * ```
 */
export function createBudgetThresholdMonitor(
  options: BudgetThresholdMonitorOptions = {},
): BudgetThresholdMonitor {
  // Validate eagerly so a bad configuration fails at construction, not on the
  // first budget evaluation.
  const definitions = normalizeBudgetThresholds(options.thresholds);
  const thresholds = Object.freeze(definitions.map((definition) => definition.percent));
  const labels = new Map(definitions.map((definition) => [definition.percent, definition.label]));
  const inclusive = options.inclusive !== false;

  const listeners = new Set<BudgetThresholdListener>();
  const crossed = new Map<string, Set<number>>();

  const evaluate = (budget: BudgetThresholdSubject): BudgetThresholdAlert[] => {
    const evaluation = evaluateBudgetThresholds(budget, {
      thresholds: definitions,
      inclusive,
    });
    let budgetCrossings = crossed.get(budget.id);
    if (!budgetCrossings) {
      budgetCrossings = new Set<number>();
      crossed.set(budget.id, budgetCrossings);
    }

    const alerts: BudgetThresholdAlert[] = [];
    for (const match of evaluation.matches) {
      if (!match.reached) {
        // Re-arm the threshold for a future crossing.
        budgetCrossings.delete(match.threshold);
        continue;
      }
      if (budgetCrossings.has(match.threshold)) continue;
      budgetCrossings.add(match.threshold);
      alerts.push({
        budgetId: budget.id,
        threshold: match.threshold,
        ...(labels.get(match.threshold) !== undefined
          ? { label: labels.get(match.threshold) as string }
          : {}),
        percent: evaluation.percent,
        evaluation,
      });
    }

    for (const alert of alerts) {
      for (const listener of [...listeners]) {
        try {
          listener(alert);
        } catch {
          // A faulty notification handler must not break evaluation or the
          // other listeners; alerts are best-effort notifications.
        }
      }
    }

    return alerts;
  };

  return {
    thresholds,
    evaluate,
    onThreshold(listener: BudgetThresholdListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    removeListener(listener: BudgetThresholdListener): void {
      listeners.delete(listener);
    },
    reset(budgetId?: string): void {
      if (budgetId === undefined) crossed.clear();
      else crossed.delete(budgetId);
    },
    dispose(): void {
      listeners.clear();
      crossed.clear();
    },
  };
}

/**
 * Return the highest threshold reached for a budget, or `null` when none were.
 *
 * Convenience wrapper over {@link evaluateBudgetThresholds} for callers that
 * only need the current alert level.
 */
export function getHighestReachedThreshold(
  budget: BudgetThresholdSubject,
  options: BudgetThresholdOptions = {},
): number | null {
  return evaluateBudgetThresholds(budget, options).threshold;
}
