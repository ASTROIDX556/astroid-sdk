import { describe, it, expect } from 'vitest';
import { toPrometheusFormat, toOpenTelemetryFormat, type MetricSample } from '../formatters.js';

/* -------------------------------------------------------------------------- */
/* toPrometheusFormat                                                          */
/* -------------------------------------------------------------------------- */

describe('toPrometheusFormat', () => {
  it('serialises a single metric with HELP, TYPE, labels and timestamp', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid_agent_spend_total',
        value: 42.5,
        type: 'counter',
        help: 'Cumulative spend per agent.',
        labels: { agent_id: 'agent_001', asset: 'XLM' },
        timestamp: 1700000000000,
      },
    ];

    expect(toPrometheusFormat(metrics)).toBe(
      '# HELP astroid_agent_spend_total Cumulative spend per agent.\n' +
        '# TYPE astroid_agent_spend_total counter\n' +
        'astroid_agent_spend_total{agent_id="agent_001",asset="XLM"} 42.5 1700000000000\n',
    );
  });

  it('emits HELP and TYPE once per family and keeps sample order', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid_agent_transactions_total',
        value: 10,
        type: 'counter',
        help: 'Transactions executed per agent.',
        labels: { agent_id: 'agent_002' },
      },
      {
        name: 'astroid_agent_transactions_total',
        value: 3,
        type: 'counter',
        labels: { agent_id: 'agent_001' },
      },
    ];

    expect(toPrometheusFormat(metrics)).toBe(
      '# HELP astroid_agent_transactions_total Transactions executed per agent.\n' +
        '# TYPE astroid_agent_transactions_total counter\n' +
        'astroid_agent_transactions_total{agent_id="agent_002"} 10\n' +
        'astroid_agent_transactions_total{agent_id="agent_001"} 3\n',
    );
  });

  it('omits HELP and TYPE when they are not supplied', () => {
    expect(toPrometheusFormat([{ name: 'astroid_agent_risk_score', value: 0.25 }])).toBe(
      'astroid_agent_risk_score 0.25\n',
    );
  });

  it('sorts labels by name and escapes quotes, backslashes and newlines', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid_agent_latency_ms',
        value: 12,
        labels: {
          zeta: 'last',
          alpha: 'a"b\\c\nd',
        },
      },
    ];

    expect(toPrometheusFormat(metrics)).toBe(
      'astroid_agent_latency_ms{alpha="a\\"b\\\\c\\nd",zeta="last"} 12\n',
    );
  });

  it('escapes help text', () => {
    expect(
      toPrometheusFormat([
        {
          name: 'astroid_agent_spend_xlm',
          value: 1,
          help: 'Line one\nLine two \\ end',
        },
      ]),
    ).toBe(
      '# HELP astroid_agent_spend_xlm Line one\\nLine two \\\\ end\nastroid_agent_spend_xlm 1\n',
    );
  });

  it('sanitises metric and label names', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid.agent-spend total',
        value: 7,
        labels: { 'agent/id': 'agent_003' },
      },
    ];

    expect(toPrometheusFormat(metrics)).toBe('astroid_agent_spend_total{agent_id="agent_003"} 7\n');
  });

  it('prefixes names that do not start with a letter, colon or underscore', () => {
    expect(toPrometheusFormat([{ name: '1st.metric', value: 2 }])).toBe('_1st_metric 2\n');
  });

  it('renders non-finite values with Prometheus literals', () => {
    const metrics: MetricSample[] = [
      { name: 'astroid_agent_health', value: 1 },
      { name: 'astroid_agent_health', value: Number.NaN },
      { name: 'astroid_agent_health', value: Number.POSITIVE_INFINITY },
      { name: 'astroid_agent_health', value: Number.NEGATIVE_INFINITY },
    ];

    expect(toPrometheusFormat(metrics)).toBe(
      'astroid_agent_health 1\n' +
        'astroid_agent_health NaN\n' +
        'astroid_agent_health +Inf\n' +
        'astroid_agent_health -Inf\n',
    );
  });

  it('converts ISO-8601 timestamps to epoch milliseconds', () => {
    expect(
      toPrometheusFormat([
        {
          name: 'astroid_agent_spend_xlm',
          value: 5,
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe('astroid_agent_spend_xlm 5 1767225600000\n');
  });

  it('truncates fractional millisecond timestamps to integers', () => {
    expect(
      toPrometheusFormat([
        { name: 'astroid_agent_spend_xlm', value: 5, timestamp: 1700000000123.9 },
      ]),
    ).toBe('astroid_agent_spend_xlm 5 1700000000123\n');
  });

  it('rejects timestamps that cannot be parsed', () => {
    expect(() =>
      toPrometheusFormat([{ name: 'astroid_agent_spend_xlm', value: 5, timestamp: 'not-a-date' }]),
    ).toThrow(RangeError);

    expect(() =>
      toPrometheusFormat([{ name: 'astroid_agent_spend_xlm', value: 5, timestamp: Number.NaN }]),
    ).toThrow('Invalid timestamp for metric "astroid_agent_spend_xlm": NaN');
  });

  it('rejects empty metric and label names', () => {
    expect(() => toPrometheusFormat([{ name: '   ', value: 1 }])).toThrow(TypeError);
    expect(() =>
      toPrometheusFormat([{ name: 'astroid_agent_spend_xlm', value: 1, labels: { ' ': 'x' } }]),
    ).toThrow('Metric label name must be a non-empty string');
  });

  it('returns an empty string for no metrics', () => {
    expect(toPrometheusFormat([])).toBe('');
  });

  it('is pure and deterministic', () => {
    const labels = Object.freeze({ agent_id: 'agent_001' });
    const metrics: readonly MetricSample[] = Object.freeze([
      Object.freeze({ name: 'astroid_agent_spend_xlm', value: 9, labels }),
    ]);

    const first = toPrometheusFormat(metrics);
    const second = toPrometheusFormat(metrics);

    expect(first).toBe(second);
    expect(labels).toEqual({ agent_id: 'agent_001' });
  });
});

/* -------------------------------------------------------------------------- */
/* toOpenTelemetryFormat                                                       */
/* -------------------------------------------------------------------------- */

describe('toOpenTelemetryFormat', () => {
  it('serialises a gauge to an exact OTLP/JSON payload', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid.agent.spend',
        value: 42.5,
        help: 'Spend per agent in XLM.',
        labels: { 'agent.id': 'agent_001' },
        timestamp: 1700000000000,
      },
    ];

    expect(toOpenTelemetryFormat(metrics)).toBe(
      '{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"astroid-agents"}}]},' +
        '"scopeMetrics":[{"scope":{"name":"@astroid/analytics"},"metrics":[{"name":"astroid.agent.spend",' +
        '"description":"Spend per agent in XLM.","gauge":{"dataPoints":[{"attributes":[{"key":"agent.id",' +
        '"value":{"stringValue":"agent_001"}}],"timeUnixNano":"1700000000000000000","asDouble":42.5}]}}]}]}]}',
    );
  });

  it('serialises counters as cumulative, monotonic sums', () => {
    const metrics: MetricSample[] = [
      { name: 'astroid.agent.executions', value: 128, type: 'counter' },
    ];

    expect(toOpenTelemetryFormat(metrics)).toBe(
      '{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"astroid-agents"}}]},' +
        '"scopeMetrics":[{"scope":{"name":"@astroid/analytics"},"metrics":[{"name":"astroid.agent.executions",' +
        '"sum":{"aggregationTemporality":2,"isMonotonic":true,"dataPoints":[{"asDouble":128}]}}]}]}]}',
    );
  });

  it('groups samples sharing a name into one metric with multiple data points', () => {
    const metrics: MetricSample[] = [
      { name: 'astroid.agent.spend', value: 1, labels: { 'agent.id': 'a' } },
      { name: 'astroid.agent.spend', value: 2, labels: { 'agent.id': 'b' } },
    ];

    const payload = JSON.parse(toOpenTelemetryFormat(metrics)) as {
      resourceMetrics: Array<{
        scopeMetrics: Array<{ metrics: Array<{ name: string; gauge: { dataPoints: unknown[] } }> }>;
      }>;
    };

    const otelMetrics = payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics;
    expect(otelMetrics).toHaveLength(1);
    expect(otelMetrics[0]!.name).toBe('astroid.agent.spend');
    expect(otelMetrics[0]!.gauge.dataPoints).toHaveLength(2);
  });

  it('types attribute values and sorts attributes by key', () => {
    const metrics: MetricSample[] = [
      {
        name: 'astroid.agent.executions',
        value: 1,
        labels: { ratio: 0.75, attempts: 3, active: true, agent: 'agent_004' },
      },
    ];

    expect(toOpenTelemetryFormat(metrics)).toContain(
      '"attributes":[{"key":"active","value":{"boolValue":true}},' +
        '{"key":"agent","value":{"stringValue":"agent_004"}},' +
        '{"key":"attempts","value":{"intValue":"3"}},' +
        '{"key":"ratio","value":{"doubleValue":0.75}}]',
    );
  });

  it('omits attributes and timeUnixNano when they are not supplied', () => {
    const payload = JSON.parse(
      toOpenTelemetryFormat([{ name: 'astroid.agent.risk', value: 0.5 }]),
    ) as {
      resourceMetrics: Array<{
        scopeMetrics: Array<{
          metrics: Array<{ gauge: { dataPoints: Array<Record<string, unknown>> } }>;
        }>;
      }>;
    };

    const dataPoint = payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.gauge.dataPoints[0]!;
    expect(dataPoint).toEqual({ asDouble: 0.5 });
  });

  it('converts ISO-8601 timestamps to Unix nanoseconds', () => {
    expect(
      toOpenTelemetryFormat([
        {
          name: 'astroid.agent.spend',
          value: 5,
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toContain('"timeUnixNano":"1767225600000000000"');
  });

  it('renders non-finite values with protobuf JSON literals', () => {
    const output = toOpenTelemetryFormat([
      { name: 'astroid.agent.health', value: Number.NaN },
      { name: 'astroid.agent.health', value: Number.POSITIVE_INFINITY },
      { name: 'astroid.agent.health', value: Number.NEGATIVE_INFINITY },
    ]);

    expect(output).toContain('"asDouble":"NaN"');
    expect(output).toContain('"asDouble":"Infinity"');
    expect(output).toContain('"asDouble":"-Infinity"');
  });

  it('sanitises metric names to the OTel grammar', () => {
    const output = toOpenTelemetryFormat([
      { name: 'astroid agent/spend', value: 1 },
      { name: '9lives', value: 2 },
    ]);

    expect(output).toContain('"name":"astroid_agent_spend"');
    expect(output).toContain('"name":"astroid.9lives"');
  });

  it('rejects empty metric names and unparseable timestamps', () => {
    expect(() => toOpenTelemetryFormat([{ name: '', value: 1 }])).toThrow(TypeError);
    expect(() =>
      toOpenTelemetryFormat([{ name: 'astroid.agent.spend', value: 1, timestamp: 'nope' }]),
    ).toThrow(RangeError);
  });

  it('returns an empty resource metric list for no metrics', () => {
    expect(toOpenTelemetryFormat([])).toBe('{"resourceMetrics":[]}');
    expect(JSON.parse(toOpenTelemetryFormat([]))).toEqual({ resourceMetrics: [] });
  });

  it('is pure and deterministic', () => {
    const labels = Object.freeze({ 'agent.id': 'agent_001' });
    const metrics: readonly MetricSample[] = Object.freeze([
      Object.freeze({ name: 'astroid.agent.spend', value: 9, labels }),
    ]);

    const first = toOpenTelemetryFormat(metrics);
    const second = toOpenTelemetryFormat(metrics);

    expect(first).toBe(second);
    expect(labels).toEqual({ 'agent.id': 'agent_001' });
  });
});
