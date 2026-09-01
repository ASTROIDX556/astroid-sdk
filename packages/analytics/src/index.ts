/**
 * `@astroid/analytics` — read-only reporting resource.
 *
 * Thin, typed wrappers over the `GET /analytics/*` endpoints. Every method
 * returns a chart-ready object (time series, distributions, per-agent and
 * per-budget rows) and accepts the shared {@link AnalyticsQuery} filters.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  AgentAnalytics,
  AgentSpendingRow,
  AnalyticsListParams,
  AnalyticsOverview,
  AnalyticsQuery,
  BudgetAnalytics,
  BudgetUtilizationRow,
  CashflowReport,
  Paginated,
  RiskReport,
} from '@astroid/types';

export {
  exportToCSV,
  exportToJSON,
  formatTransactionForExport,
  flattenRecordForExport,
  escapeCsvValue,
  type CsvColumn,
  type CsvExportOptions,
  type JsonExportOptions,
} from './exporter.js';

/**
 * The `analytics` namespace on the Astroid client.
 *
 * All methods are read-only and safe to call frequently; they aggregate over
 * the organization's transactions, agents, and budgets for the requested window
 * and granularity.
 */
export class AnalyticsResource extends Resource {
  /** Headline dashboard metrics plus the spending trend. */
  async overview(query: AnalyticsQuery = {}): Promise<AnalyticsOverview> {
    return this.getData<AnalyticsOverview>('/analytics/overview', { ...query });
  }

  /** Inflow/outflow/net cashflow over the requested window. */
  async cashflow(query: AnalyticsQuery = {}): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/cashflow', { ...query });
  }

  /** Spending report (alias of the cashflow endpoint's outflow view). */
  async spending(query: AnalyticsQuery = {}): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/spending', { ...query });
  }

  /** Risk distribution, average score, and trend. */
  async risk(query: AnalyticsQuery = {}): Promise<RiskReport> {
    return this.getData<RiskReport>('/analytics/risk', { ...query });
  }

  /** Per-agent spending and risk breakdown. */
  async agents(query: AnalyticsQuery = {}): Promise<AgentAnalytics> {
    return this.getData<AgentAnalytics>('/analytics/agents', { ...query });
  }

  /** Per-budget utilization breakdown. */
  async budgets(query: AnalyticsQuery = {}): Promise<BudgetAnalytics> {
    return this.getData<BudgetAnalytics>('/analytics/budgets', { ...query });
  }

  /**
   * Densely paginated per-agent performance rows.
   *
   * Unlike {@link AnalyticsResource.agents} (which returns the full aggregate
   * in one payload), this endpoint is cursor/page-aware so clients can page
   * through large historical sets without loading everything at once. Accepts
   * the shared {@link AnalyticsListParams} filters plus pagination controls.
   */
  async listAgents(query: AnalyticsListParams = {}): Promise<Paginated<AgentSpendingRow>> {
    return this.listData<AgentSpendingRow>('/analytics/agents', { ...query });
  }

  /**
   * Densely paginated per-budget utilization rows.
   *
   * Use when there are many budgets and you want to page through them with
   * `page`/`limit`/`order` rather than fetch every row in a single response.
   */
  async listBudgets(query: AnalyticsListParams = {}): Promise<Paginated<BudgetUtilizationRow>> {
    return this.listData<BudgetUtilizationRow>('/analytics/budgets', { ...query });
  }
}
