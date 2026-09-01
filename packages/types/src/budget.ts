/**
 * Budget-related DTOs for simulation and utilization queries.
 *
 * These complement the {@link Budget} entity. The budget API lets agents
 * simulate whether a prospective draw would breach their allocation before
 * committing to it, and exposes a per-budget utilization snapshot.
 *
 * @module
 */

import type { DecimalString, IsoDateTime } from './entities.js';
import type { Budget, BudgetPeriod } from './entities.js';

/** A prospective spend draw to simulate against a budget. */
export interface BudgetSimulationInput {
  /** Asset identifier (e.g. `"XLM"`, `"USDC"`, `"USDC:G...Issuer"`). */
  asset: string;
  /** Amount to draw (decimal string or number). */
  amount: DecimalString | number;
}

/** The outcome of simulating a draw against a budget (nothing is committed). */
export interface BudgetSimulationResult {
  /** The budget the simulation ran against. */
  budget: Budget;
  /** Whether the draw is permitted under the budget's rules. */
  allowed: boolean;
  /** Whether the draw would breach the budget's remaining allowance. */
  wouldExceed: boolean;
  /** Remaining headroom after applying the simulated draw (decimal string). */
  remainingAfter: DecimalString;
  /** When `wouldExceed` is true, a human-readable description of the breach. */
  restriction: string | null;
  /** The active window start the simulation was evaluated against (ISO-8601 UTC). */
  windowStart: IsoDateTime;
  /** The active window end the simulation was evaluated against (ISO-8601 UTC). */
  windowEnd: IsoDateTime;
}

/** A utilization snapshot for a single budget. */
export interface BudgetUtilization {
  budgetId: string;
  period: BudgetPeriod;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  /** Configured spend limit for the active window (decimal string). */
  limit: DecimalString;
  /** Total consumption so far in the active window (decimal string). */
  spent: DecimalString;
  /** Headroom left (limit minus spent), as a decimal string. */
  remaining: DecimalString;
  /** Fraction consumed (0..1+), useful for progress bars. */
  utilization: number;
}