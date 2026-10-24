/**
 * `@astroid/analytics` — observability export formatters.
 *
 * Serialises agent performance and spend metrics into the two formats every
 * production monitoring stack speaks:
 *
 * - **Prometheus** — the text exposition format scraped by Prometheus /
 *   VictoriaMetrics / Grafana Agent (`text/plain; version=0.0.4`).
 * - **OpenTelemetry** — an OTLP/JSON `ExportMetricsServiceRequest` payload for
 *   OTLP collectors and the OTel metrics SDK wire protocol.
 *
 * Both formatters are pure: they never read the clock, the network, or global
 * state, and they never mutate their input. Identical input always produces
 * byte-identical output, which makes the payloads safe to snapshot in tests and
 * to cache before shipping to a collector.
 *
 * ## Metric model
 *
 * A {@link MetricSample} is one observation of a named value with optional
 * labels and an optional timestamp. Agent metrics map onto it naturally:
 *
 * ```ts
 * const sample: MetricSample = {
 *   name: 'astroid_agent_spend_total',
 *   value: 42.5,
 *   type: 'counter',
 *   help: 'Cumulative spend per agent.',
 *   labels: { agent_id: 'agent_001', asset: 'XLM' },
 *   timestamp: 1700000000000, // epoch milliseconds
 * };
 * ```
 *
 * ## Timestamps
 *
 * Timestamps are optional and may be supplied as epoch **milliseconds**
 * (`number`) or an ISO-8601 string (e.g. `2026-01-01T00:00:00.000Z`). They are
 * normalised to whole milliseconds. Prometheus receives the millisecond value;
 * OpenTelemetry receives it converted to Unix nanoseconds (as a decimal string,
 * as required by OTLP/JSON). A timestamp that cannot be parsed throws instead
 * of silently producing a wrong observation time.
 *
 * @module
 */

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** OpenTelemetry metric instrument kind. Defaults to `'gauge'` when omitted. */
export type MetricType = 'counter' | 'gauge';

/** A label / attribute value. OTel attributes are typed; see the notes below. */
export type MetricLabelValue = string | number | boolean;

/**
 * A single metric observation.
 *
 * Several samples may share the same `name`; they are grouped into one metric
 * family (Prometheus) or one metric with multiple data points (OpenTelemetry).
 */
export interface MetricSample {
  /** Metric name, e.g. `astroid_agent_spend_total` or `astroid.agent.spend`. */
  name: string;
  /** Observed value. `NaN` and `±Infinity` are supported. */
  value: number;
  /** Instrument kind. Defaults to `'gauge'`. */
  type?: MetricType;
  /** Human-readable description emitted as `# HELP` / OTel `description`. */
  help?: string;
  /** Dimension labels. Keys are sorted in the output for determinism. */
  labels?: Readonly<Record<string, MetricLabelValue>>;
  /** Observation time as epoch milliseconds or an ISO-8601 string. */
  timestamp?: number | string;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Validate a metric name before it is sanitised for either format. */
function assertMetricName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new TypeError('Metric name must be a non-empty string');
  }
  return trimmed;
}

/** Prometheus metric names: `[a-zA-Z_:][a-zA-Z0-9_:]*`. */
function sanitizePrometheusMetricName(name: string): string {
  const sanitized = assertMetricName(name).replace(/[^a-zA-Z0-9_:]/g, '_');
  return /^[a-zA-Z_:]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

/** Prometheus label names: `[a-zA-Z_][a-zA-Z0-9_]*`. */
function sanitizePrometheusLabelName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new TypeError('Metric label name must be a non-empty string');
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

/** OTel metric names: ASCII, start with a letter, letters/digits/`.`/`_`/`-`. */
function sanitizeOpenTelemetryMetricName(name: string): string {
  const sanitized = assertMetricName(name).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `astroid.${sanitized}`;
}

/** Escape a value for use inside a double-quoted Prometheus label. */
function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Escape `# HELP` text (backslashes and newlines only, per the exposition spec). */
function escapePrometheusHelp(help: string): string {
  return help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** Render a metric value using Prometheus' float literals for non-finite values. */
function formatPrometheusValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  return String(value);
}

/**
 * Normalise a timestamp to epoch milliseconds.
 *
 * @throws {RangeError} When the value is not a finite number or not a parseable
 * ISO-8601 string.
 */
function resolveTimestampMs(timestamp: number | string, metricName: string): number {
  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp)) {
      throw new RangeError(`Invalid timestamp for metric "${metricName}": ${String(timestamp)}`);
    }
    return Math.trunc(timestamp);
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new RangeError(`Invalid timestamp for metric "${metricName}": "${timestamp}"`);
  }
  return parsed;
}

/** Convert epoch milliseconds to a Unix nanosecond decimal string (OTLP/JSON). */
function toUnixNanoString(timestampMs: number): string {
  return (BigInt(timestampMs) * 1_000_000n).toString();
}

/** Render an OTLP/JSON double, using protobuf JSON literals for non-finite values. */
function formatOpenTelemetryDouble(value: number): number | string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return value;
}

/** Normalise labels to a sorted list of `[name, stringValue]` pairs. */
function normalizeLabels(
  labels: Readonly<Record<string, MetricLabelValue>> | undefined,
): Array<[string, string]> {
  if (labels === undefined) return [];
  return Object.entries(labels)
    .filter((entry): entry is [string, MetricLabelValue] => entry[1] !== undefined)
    .map(([name, value]): [string, string] => [
      name,
      typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/* -------------------------------------------------------------------------- */
/* Prometheus text exposition                                                  */
/* -------------------------------------------------------------------------- */

interface PrometheusFamily {
  name: string;
  help: string | undefined;
  type: MetricType | undefined;
  samples: string[];
}

/**
 * Serialise metrics to the Prometheus text exposition format.
 *
 * Output rules:
 * - Samples sharing a metric name form one family; `# HELP` / `# TYPE` are
 *   emitted once, before that family's samples. The first non-`undefined`
 *   `help` / `type` in a family wins.
 * - Labels are sorted by name and rendered as `name="value"` with `\`, `"` and
 *   newlines escaped. Untrusted label values therefore cannot break the payload.
 * - Metric names are sanitised (`[^a-zA-Z0-9_:]` → `_`); label names are
 *   sanitised (`[^a-zA-Z0-9_]` → `_`).
 * - Timestamps are appended as integer epoch milliseconds when provided.
 * - Non-finite values use Prometheus literals: `NaN`, `+Inf`, `-Inf`.
 * - The payload ends with a trailing newline, as the exposition format requires.
 *   An empty input produces an empty string.
 *
 * @param metrics  Metric observations to serialise. Not mutated.
 * @returns The Prometheus text exposition payload.
 * @throws {TypeError} When a metric or label name is empty.
 * @throws {RangeError} When a timestamp is invalid.
 *
 * @example
 * ```ts
 * import { toPrometheusFormat } from '@astroid/analytics';
 *
 * const body = toPrometheusFormat([
 *   {
 *     name: 'astroid_agent_spend_total',
 *     value: 42.5,
 *     type: 'counter',
 *     help: 'Cumulative spend per agent.',
 *     labels: { agent_id: 'agent_001' },
 *     timestamp: 1700000000000,
 *   },
 * ]);
 * // # HELP astroid_agent_spend_total Cumulative spend per agent.
 * // # TYPE astroid_agent_spend_total counter
 * // astroid_agent_spend_total{agent_id="agent_001"} 42.5 1700000000000
 * ```
 */
export function toPrometheusFormat(metrics: readonly MetricSample[]): string {
  const families = new Map<string, PrometheusFamily>();

  for (const sample of metrics) {
    const name = sanitizePrometheusMetricName(sample.name);

    let family = families.get(name);
    if (family === undefined) {
      family = { name, help: undefined, type: undefined, samples: [] };
      families.set(name, family);
    }
    if (family.help === undefined && sample.help !== undefined) family.help = sample.help;
    if (family.type === undefined && sample.type !== undefined) family.type = sample.type;

    const labels = normalizeLabels(sample.labels)
      .map(
        ([key, value]) =>
          `${sanitizePrometheusLabelName(key)}="${escapePrometheusLabelValue(value)}"`,
      )
      .join(',');
    const selector = labels === '' ? '' : `{${labels}}`;

    const timestampSuffix =
      sample.timestamp === undefined ? '' : ` ${resolveTimestampMs(sample.timestamp, name)}`;

    family.samples.push(
      `${name}${selector} ${formatPrometheusValue(sample.value)}${timestampSuffix}`,
    );
  }

  if (families.size === 0) return '';

  const lines: string[] = [];
  for (const family of families.values()) {
    if (family.help !== undefined) {
      lines.push(`# HELP ${family.name} ${escapePrometheusHelp(family.help)}`);
    }
    if (family.type !== undefined) {
      lines.push(`# TYPE ${family.name} ${family.type}`);
    }
    lines.push(...family.samples);
  }

  return `${lines.join('\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* OpenTelemetry (OTLP/JSON)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * OTLP/JSON attribute value. Exactly one member is set, mirroring the protobuf
 * `AnyValue` oneof.
 */
export interface OpenTelemetryAttributeValue {
  stringValue?: string;
  boolValue?: boolean;
  /** 64-bit integers are decimal strings in OTLP/JSON. */
  intValue?: string;
  doubleValue?: number;
}

/** An OTLP/JSON key/value attribute. */
export interface OpenTelemetryAttribute {
  key: string;
  value: OpenTelemetryAttributeValue;
}

/** An OTLP/JSON gauge or sum data point. */
export interface OpenTelemetryDataPoint {
  attributes?: OpenTelemetryAttribute[];
  timeUnixNano?: string;
  /**
   * Observed value. Non-finite values use the protobuf JSON literals
   * `"NaN"`, `"Infinity"` and `"-Infinity"`, since JSON has no such numbers.
   */
  asDouble: number | string;
}

/** An OTLP/JSON metric: exactly one of `gauge` / `sum` is present. */
export interface OpenTelemetryMetric {
  name: string;
  description?: string;
  gauge?: { dataPoints: OpenTelemetryDataPoint[] };
  sum?: {
    aggregationTemporality: number;
    isMonotonic: boolean;
    dataPoints: OpenTelemetryDataPoint[];
  };
}

/** The OTLP/JSON `ExportMetricsServiceRequest` payload returned by the formatter. */
export interface OpenTelemetryExportRequest {
  resourceMetrics: Array<{
    resource: { attributes: OpenTelemetryAttribute[] };
    scopeMetrics: Array<{
      scope: { name: string };
      metrics: OpenTelemetryMetric[];
    }>;
  }>;
}

/** OTLP `AGGREGATION_TEMPORALITY_CUMULATIVE`. */
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

/** Resource `service.name` reported for Astroid agent metrics. */
const OTEL_SERVICE_NAME = 'astroid-agents';

/** Instrumentation scope name reported for this package. */
const OTEL_SCOPE_NAME = '@astroid/analytics';

/** Convert a label value to its OTLP `AnyValue` representation. */
function toOpenTelemetryAttributeValue(value: MetricLabelValue): OpenTelemetryAttributeValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

/** Build sorted OTLP attributes from a sample's label map. */
function toOpenTelemetryAttributes(
  labels: Readonly<Record<string, MetricLabelValue>> | undefined,
): OpenTelemetryAttribute[] {
  if (labels === undefined) return [];
  return Object.entries(labels)
    .filter((entry): entry is [string, MetricLabelValue] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key, value: toOpenTelemetryAttributeValue(value) }));
}

/**
 * Serialise metrics to an OpenTelemetry OTLP/JSON export request.
 *
 * Output rules:
 * - Samples sharing a name become one metric with multiple data points. The
 *   first non-`undefined` `help` in a family becomes the metric `description`.
 * - `type: 'counter'` emits an OTLP `sum` with cumulative temporality and
 *   `isMonotonic: true`; `type: 'gauge'` (or omitted) emits a `gauge`.
 * - Labels become sorted OTLP attributes. Integer numbers become `intValue`
 *   (a decimal string), non-integers `doubleValue`, booleans `boolValue`, and
 *   strings `stringValue`.
 * - Timestamps become `timeUnixNano` decimal strings; omitted timestamps leave
 *   the field out so the collector stamps the observation itself.
 * - Non-finite values use the protobuf JSON literals `"NaN"`, `"Infinity"` and
 *   `"-Infinity"`, keeping the payload valid JSON.
 * - Metric names are sanitised to the OTel grammar (`[a-zA-Z][a-zA-Z0-9_.-]*`).
 * - The result is compact JSON with deterministic key ordering. Empty input
 *   yields `{"resourceMetrics":[]}`.
 *
 * @param metrics  Metric observations to serialise. Not mutated.
 * @returns The OTLP/JSON payload as a string.
 * @throws {TypeError} When a metric name is empty.
 * @throws {RangeError} When a timestamp is invalid.
 *
 * @example
 * ```ts
 * import { toOpenTelemetryFormat } from '@astroid/analytics';
 *
 * const body = toOpenTelemetryFormat([
 *   {
 *     name: 'astroid.agent.spend',
 *     value: 42.5,
 *     labels: { 'agent.id': 'agent_001' },
 *     timestamp: 1700000000000,
 *   },
 * ]);
 * // fetch('http://collector:4318/v1/metrics', { method: 'POST', body });
 * ```
 */
export function toOpenTelemetryFormat(metrics: readonly MetricSample[]): string {
  interface Family {
    name: string;
    description: string | undefined;
    type: MetricType;
    dataPoints: OpenTelemetryDataPoint[];
  }

  const families = new Map<string, Family>();

  for (const sample of metrics) {
    const name = sanitizeOpenTelemetryMetricName(sample.name);

    let family = families.get(name);
    if (family === undefined) {
      family = {
        name,
        description: undefined,
        type: sample.type ?? 'gauge',
        dataPoints: [],
      };
      families.set(name, family);
    }
    if (family.description === undefined && sample.help !== undefined) {
      family.description = sample.help;
    }

    const attributes = toOpenTelemetryAttributes(sample.labels);
    // Key order is documented and snapshot-stable: attributes, timeUnixNano, asDouble.
    const dataPoint: OpenTelemetryDataPoint = {
      ...(attributes.length > 0 ? { attributes } : {}),
      ...(sample.timestamp === undefined
        ? {}
        : { timeUnixNano: toUnixNanoString(resolveTimestampMs(sample.timestamp, name)) }),
      asDouble: formatOpenTelemetryDouble(sample.value),
    };

    family.dataPoints.push(dataPoint);
  }

  if (families.size === 0) {
    const empty: OpenTelemetryExportRequest = { resourceMetrics: [] };
    return JSON.stringify(empty);
  }

  const otelMetrics: OpenTelemetryMetric[] = [];
  for (const family of families.values()) {
    const metric: OpenTelemetryMetric = { name: family.name };
    if (family.description !== undefined) metric.description = family.description;
    if (family.type === 'counter') {
      metric.sum = {
        aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE,
        isMonotonic: true,
        dataPoints: family.dataPoints,
      };
    } else {
      metric.gauge = { dataPoints: family.dataPoints };
    }
    otelMetrics.push(metric);
  }

  const request: OpenTelemetryExportRequest = {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: OTEL_SERVICE_NAME } }],
        },
        scopeMetrics: [
          {
            scope: { name: OTEL_SCOPE_NAME },
            metrics: otelMetrics,
          },
        ],
      },
    ],
  };

  return JSON.stringify(request);
}
