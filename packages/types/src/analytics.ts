/**
 * Typed analytics result objects, ready to bind directly to charts.
 * Correspond to the `GET /analytics/*` endpoints (PRD Doc 5).
 */

import type { DecimalString } from './entities.js';
import type { RiskBand } from './enums.js';

/** Query parameters accepted by analytics endpoints. */
export interface AnalyticsQuery {
  from?: string;
  to?: string;
  agentId?: string;
  currency?: string;
  granularity?: 'day' | 'week' | 'month';
}

/** A single (timestamp, value) point in a time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/** `GET /analytics/overview`. */
export interface AnalyticsOverview {
  totalSpent: DecimalString;
  currency: string;
  transactionCount: number;
  activeAgents: number;
  activeWallets: number;
  pendingApprovals: number;
  policyViolations: number;
  spendingTrend: TimeSeriesPoint[];
}

/** `GET /analytics/spending` and `GET /analytics/cashflow`. */
export interface CashflowReport {
  currency: string;
  inflow: TimeSeriesPoint[];
  outflow: TimeSeriesPoint[];
  net: TimeSeriesPoint[];
  totalInflow: DecimalString;
  totalOutflow: DecimalString;
}

/** `GET /analytics/risk`. */
export interface RiskReport {
  distribution: Record<RiskBand, number>;
  averageScore: number;
  highRiskTransactions: number;
  trend: TimeSeriesPoint[];
}

/** One agent's line in the agent-performance report. */
export interface AgentSpendingRow {
  agentId: string;
  agentName: string;
  totalSpent: DecimalString;
  transactionCount: number;
  averageRisk: number;
}

/** `GET /analytics/agents`. */
export interface AgentAnalytics {
  currency: string;
  agents: AgentSpendingRow[];
}

/** One budget's line in the budget-utilization report. */
export interface BudgetUtilizationRow {
  budgetId: string;
  budgetName: string;
  limit: DecimalString;
  spent: DecimalString;
  remaining: DecimalString;
  utilization: number;
}

/** `GET /analytics/budgets`. */
export interface BudgetAnalytics {
  currency: string;
  budgets: BudgetUtilizationRow[];
}
