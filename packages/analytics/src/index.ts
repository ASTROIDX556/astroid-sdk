/**
 * `@astroid/analytics` — read-only reporting resource.
 *
 * Thin, typed wrappers over the `GET /analytics/*` endpoints. Every method
 * returns a chart-ready object (time series, distributions, per-agent and
 * per-budget rows) and accepts the shared {@link AnalyticsQuery} filters.
 *
 * @packageDocumentation
 */

import { Resource, type RequestOptionsExtras } from '@astroid/core';
import type {
  AgentAnalytics,
  AgentMetricsParams,
  AgentMetricsReport,
  AgentSpendingRow,
  AnalyticsCursorParams,
  AnalyticsListParams,
  AnalyticsMetricsResponse,
  AnalyticsOverview,
  AnalyticsQuery,
  BudgetAnalytics,
  BudgetUtilizationRow,
  CashflowReport,
  CursorPaginated,
  GlobalAnalyticsParams,
  Paginated,
  RiskReport,
  SpendingSummaryParams,
  SpendingSummaryReport,
  TransactionVolumeParams,
  TransactionVolumeReport,
  TimeSeriesDataParams,
  TimeSeriesDataResponse,
  MetricsQueryParams,
} from '@astroid/types';
import { getMetricsInRange } from './analytics.js';
import { getAgentMetrics, getGlobalAnalytics } from './metrics.js';
// Re-export the aggregated-metrics query helpers (issue #78) from the package
// entry point so consumers can call them directly as well as through
// {@link AnalyticsResource}. These were previously imported but never used,
// which failed the `dts` build (`TS6192: All imports in import declaration are
// unused`).
export {
  getAgentMetrics,
  getGlobalAnalytics,
} from './metrics.js';

export {
  AnalyticsQueryResource,
  getAgentExecutionCounts,
  getFeeExpenditure,
  getMetricsInRange,
  getTransactionVolume,
  buildAnalyticsPath,
  buildAnalyticsQuery,
  buildTimeRangePath,
  buildTimeRangeQuery,
  resolveTimeRange,
  toIso8601,
  type AgentExecutionCountFilter,
  type AnalyticsGranularity,
  type AnalyticsMetricType,
  type FeeExpenditureFilter,
  type ResolvedTimeRange,
  type TimeRangeFilter,
  type TransactionVolumeFilter,
} from './analytics.js';

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

// Observability export formatters: Prometheus text exposition and OTLP/JSON.
// Both are pure serialisers over the shared {@link MetricSample} model.
export {
  toPrometheusFormat,
  toOpenTelemetryFormat,
  type MetricLabelValue,
  type MetricSample,
  type MetricType,
  type OpenTelemetryAttribute,
  type OpenTelemetryAttributeValue,
  type OpenTelemetryDataPoint,
  type OpenTelemetryExportRequest,
  type OpenTelemetryMetric,
} from './formatters.js';

// Local pure aggregation helpers (issues #269, #442, #386): decimal-safe transaction
// telemetry, time-series metrics aggregation, and query builders.
// Re-exported explicitly — `metrics.ts` also defines an `AnalyticsResource`
// class, so it stays out of the entrypoint to avoid duplicate-export ambiguity.
export {
  aggregateTransactionMetrics,
  aggregateTimeSeriesMetrics,
  type AggregateGranularity,
  type AggregateTelemetryOptions,
  type AggregatedTelemetry,
  type TransactionTelemetryBucket,
  type TimeSeriesResolution,
  type AggregateTimeSeriesOptions,
  type AggregatedTimeSeriesBucket,
  type AggregatedTimeSeriesResult,
  type TimeSeriesInputPoint,
  type TimeSeriesMetricsInput,
} from './aggregations.js';

export {
  computeTelemetrySummary,
  calculateExpenditures,
  calculateSuccessRate,
  type TelemetryRecord,
  type AggregationWindowOptions,
  type TelemetrySummary,
} from './aggregates.js';

export {
  buildTimeSeriesPath,
  buildTimeSeriesQuery,
  validateTimeSeriesQuery,
  TimeSeriesQueryError,
  TimeSeriesResource,
  INTERVAL_TO_TIMEFRAME,
  type TimeSeriesInterval,
  type TimeSeriesQueryParams,
} from './time-series.js';

// Telemetry event tracking (issue #380): non-blocking, batching analytics
// client with graceful failure handling and zero-overhead disabled mode.
export {
  AnalyticsClient,
  normalizeAnalyticsEvent,
  generateEventId,
  DEFAULT_ANALYTICS_ENDPOINT,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_RETRIES_PER_BATCH,
  type AnalyticsClientOptions,
  type AnalyticsFlushResult,
  type AnalyticsQueueStats,
  type AnalyticsTransport,
} from './client.js';

// Wire DTOs for telemetry events, re-exported so consumers can name them
// without reaching into `@astroid/types`.
export type {
  AnalyticsEvent,
  AnalyticsEventBatch,
  AnalyticsEventBatchAck,
  AnalyticsEventContext,
  AnalyticsEventInput,
  AnalyticsEventPropertyValue,
  AnalyticsEventSeverity,
} from '@astroid/types';

// Publicly re-export the metrics aggregation DTOs (issues #86, #442) so consumers can
// name them without reaching into `@astroid/types`.
export type {
  MetricsInterval,
  AgentMetricsParams,
  AgentMetricsReport,
  AgentMetricsRow,
  GlobalAnalyticsParams,
  AnalyticsCursorParams,
  AnalyticsListParams,
  CursorPaginated,
  PaginationMeta,
  SpendingSummaryParams,
  SpendingSummaryReport,
  TransactionVolumeParams,
  TransactionVolumeReport,
  TimeSeriesDataParams,
  TimeSeriesDataPoint,
  TimeSeriesDataResponse,
  TimeSeriesMetric,
  TimeRangeQueryParams,
  MetricsQueryParams,
  TimeSeriesResolution as TypesTimeSeriesResolution,
  AggregateTimeSeriesOptions as TypesAggregateTimeSeriesOptions,
  AggregatedTimeSeriesBucket as TypesAggregatedTimeSeriesBucket,
  AggregatedTimeSeriesResult as TypesAggregatedTimeSeriesResult,
} from '@astroid/types';

/**
 * The `analytics` namespace on the Astroid client.
 *
 * All methods are read-only and safe to call frequently; they aggregate over
 * the organization's transactions, agents, and budgets for the requested window
 * and granularity.
 */
export class AnalyticsResource extends Resource {
  /** Headline dashboard metrics plus the spending trend. */
  async overview(
    query: AnalyticsQuery = {},
    options?: RequestOptionsExtras,
  ): Promise<AnalyticsOverview> {
    return this.getData<AnalyticsOverview>('/analytics/overview', { ...query }, options);
  }

  /** Inflow/outflow/net cashflow over the requested window. */
  async cashflow(
    query: AnalyticsQuery = {},
    options?: RequestOptionsExtras,
  ): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/cashflow', { ...query }, options);
  }

  /** Spending report (alias of the cashflow endpoint's outflow view). */
  async spending(
    query: AnalyticsQuery = {},
    options?: RequestOptionsExtras,
  ): Promise<CashflowReport> {
    return this.getData<CashflowReport>('/analytics/spending', { ...query }, options);
  }

  /** Risk distribution, average score, and trend. */
  async risk(query: AnalyticsQuery = {}, options?: RequestOptionsExtras): Promise<RiskReport> {
    return this.getData<RiskReport>('/analytics/risk', { ...query }, options);
  }

  /** Per-agent spending and risk breakdown. */
  async agents(
    query: AnalyticsQuery = {},
    options?: RequestOptionsExtras,
  ): Promise<AgentAnalytics> {
    return this.getData<AgentAnalytics>('/analytics/agents', { ...query }, options);
  }

  /** Per-budget utilization breakdown. */
  async budgets(
    query: AnalyticsQuery = {},
    options?: RequestOptionsExtras,
  ): Promise<BudgetAnalytics> {
    return this.getData<BudgetAnalytics>('/analytics/budgets', { ...query }, options);
  }

  /**
   * Densely paginated per-agent performance rows.
   *
   * Unlike {@link AnalyticsResource.agents} (which returns the full aggregate
   * in one payload), this endpoint is cursor/page-aware so clients can page
   * through large historical sets without loading everything at once. Accepts
   * the shared {@link AnalyticsListParams} filters plus pagination controls.
   */
  async listAgents(
    query: AnalyticsListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<AgentSpendingRow>> {
    return this.listData<AgentSpendingRow>('/analytics/agents', { ...query }, options);
  }

  /**
   * Densely paginated per-budget utilization rows.
   *
   * Use when there are many budgets and you want to page through them with
   * `page`/`limit`/`order` rather than fetch every row in a single response.
   */
  async listBudgets(
    query: AnalyticsListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<BudgetUtilizationRow>> {
    return this.listData<BudgetUtilizationRow>('/analytics/budgets', { ...query }, options);
  }

  /**
   * Cursor-paginated (keyset) per-agent performance rows.
   *
   * The keyset counterpart to {@link AnalyticsResource.listAgents}: instead of
   * `page`, pass back the `nextCursor` from the previous page. Prefer this over
   * offset paging for long historical windows, where rows are appended
   * continuously and a 1-based page number can skip or duplicate entries as the
   * result set shifts between requests.
   *
   * Stops when `hasMore` is `false` or `nextCursor` is `null`.
   *
   * @example
   * ```ts
   * let cursor: string | undefined;
   * do {
   *   const page = await astroid.analytics.listAgentsByCursor({ limit: 100, cursor });
   *   for (const row of page.items) console.log(row.agentId, row.totalSpent);
   *   cursor = page.nextCursor ?? undefined;
   * } while (cursor);
   * ```
   */
  async listAgentsByCursor(
    query: AnalyticsCursorParams = {},
  ): Promise<CursorPaginated<AgentSpendingRow>> {
    return this.listCursorData<AgentSpendingRow>('/analytics/agents', { ...query });
  }

  /**
   * Cursor-paginated (keyset) per-budget utilization rows.
   *
   * The keyset counterpart to {@link AnalyticsResource.listBudgets}; see
   * {@link AnalyticsResource.listAgentsByCursor} for the paging loop.
   */
  async listBudgetsByCursor(
    query: AnalyticsCursorParams = {},
  ): Promise<CursorPaginated<BudgetUtilizationRow>> {
    return this.listCursorData<BudgetUtilizationRow>('/analytics/budgets', { ...query });
  }

  /* ------------------------- metrics aggregation ------------------------- */

  /**
   * Per-agent metrics (transaction count, volume, average risk) over a time
   * window, bucketed by `interval`.
   *
   * Query parameters are serialised into the URL query string; `undefined`
   * fields are omitted.
   *
   * @example
   * ```ts
   * const report = await astroid.analytics.getAgentMetrics({
   *   startDate: '2026-01-01T00:00:00.000Z',
   *   endDate: '2026-02-01T00:00:00.000Z',
   *   interval: 'day',
   * });
   * ```
   */
  async getAgentMetrics(
    query: AgentMetricsParams = {},
    options?: RequestOptionsExtras,
  ): Promise<AgentMetricsReport> {
    return getAgentMetrics(this.client, query, options);
  }

  /**
   * Fetch global transaction, fee, policy, and success metrics for a time range.
   *
   * @param query Optional reporting window and resolution.
   * @param options Extra request options forwarded to the HTTP client.
   * @returns The global analytics overview.
   */
  async getGlobalAnalytics(
    query: GlobalAnalyticsParams = {},
    options?: RequestOptionsExtras,
  ): Promise<AnalyticsOverview> {
    return getGlobalAnalytics(this.client, query, options);
  }

  /**
   * Aggregated spending summary (total spent, transaction count, trend) over a
   * time window, bucketed by `interval`.
   */
  async getSpendingSummary(
    query: SpendingSummaryParams = {},
    options?: RequestOptionsExtras,
  ): Promise<SpendingSummaryReport> {
    return this.getData<SpendingSummaryReport>(
      '/analytics/spending/summary',
      { ...query },
      options,
    );
  }

  /**
   * Transaction volume and counts over a time window, bucketed by `interval`.
   */
  async getTransactionVolume(
    query: TransactionVolumeParams = {},
  ): Promise<TransactionVolumeReport> {
    return this.getData<TransactionVolumeReport>('/analytics/volume', { ...query });
  }

  /**
   * Multi-metric time series over a time window, bucketed by `interval`.
   *
   * Fetches aggregated transaction volume, fee expenditure, and agent
   * execution counts for a date range and granularity, optionally narrowed to
   * a specific asset, wallet, or agent. `undefined` parameters are omitted from
   * the query string; `metrics` may request several families in one call.
   *
   * @example
   * ```ts
   * const series = await astroid.analytics.getTimeSeriesData({
   *   startDate: '2026-01-01T00:00:00.000Z',
   *   endDate: '2026-02-01T00:00:00.000Z',
   *   interval: 'day',
   *   metrics: ['transaction_volume', 'fee_expenditure'],
   *   agentId: 'agent_123',
   * });
   * console.log(series.points[0]?.metric, series.points[0]?.value);
   * ```
   */
  async getTimeSeriesData(
    query: TimeSeriesDataParams = {},
    options?: RequestOptionsExtras,
  ): Promise<TimeSeriesDataResponse> {
    return this.getData<TimeSeriesDataResponse>(
      '/analytics/time-series',
      serializeTimeSeriesDataQuery(query),
      options,
    );
  }

  /**
   * Strongly typed metrics query with explicit time-range filtering
   * (`startTime`, `endTime`, `interval`) — issue #403.
   *
   * The range parameters are serialised into a `URLSearchParams` and appended
   * to the `/analytics/metrics` endpoint request; invalid or missing dates and
   * `undefined` fields are omitted so the query string stays compact.
   *
   * @example
   * ```ts
   * const report = await astroid.analytics.getMetrics({
   *   startTime: '2026-01-01T00:00:00.000Z',
   *   endTime: '2026-01-08T00:00:00.000Z',
   *   interval: 'day',
   *   metrics: ['transaction_volume'],
   * });
   * ```
   */
  async getMetrics(
    query: MetricsQueryParams = {},
    options?: RequestOptionsExtras,
  ): Promise<AnalyticsMetricsResponse> {
    return getMetricsInRange(this.client, query, options);
  }
}

/**
 * Serialise time-series query parameters, omitting every undefined field so the
 * resulting query string stays compact.
 */
function serializeTimeSeriesDataQuery(
  query: TimeSeriesDataParams,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  if (query.startDate !== undefined) out.startDate = query.startDate;
  if (query.endDate !== undefined) out.endDate = query.endDate;
  if (query.interval !== undefined) out.interval = query.interval;
  if (query.metric !== undefined) out.metric = query.metric;
  if (query.metrics !== undefined && query.metrics.length > 0) out.metrics = query.metrics;
  if (query.agentId !== undefined) out.agentId = query.agentId;
  if (query.walletId !== undefined) out.walletId = query.walletId;
  if (query.asset !== undefined) out.asset = query.asset;
  return out;
}
