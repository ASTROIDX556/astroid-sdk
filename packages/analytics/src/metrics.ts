import type { Transaction } from '@astroid/types';

/** Supported UTC bucket granularities. */
export type AggregateGranularity = 'hour' | 'day' | 'week';

/** Aggregation options. */
export interface AggregateOptions {
  /** Bucket size in UTC. Defaults to `day`. */
  granularity?: AggregateGranularity;
  /** Optional transaction timestamp field selector. */
  timestampField?: 'createdAt' | 'updatedAt';
}

/** Statistics for one asset within one time bucket. */
export interface TransactionMetricBucket {
  start: string;
  end: string;
  asset: string;
  transactionCount: number;
  volume: string;
  averageTransactionValue: string;
  standardDeviation: string;
  lowerBound: string;
  upperBound: string;
}

/** Aggregated totals and chart-ready historical buckets. */
export interface AggregatedMetrics {
  transactionCount: number;
  totalVolume: string;
  averageTransactionValue: string;
  standardDeviation: string;
  assets: Record<
    string,
    { transactionCount: number; totalVolume: string; averageTransactionValue: string }
  >;
  buckets: TransactionMetricBucket[];
}

type Decimal = { n: bigint; scale: number };
const parse = (value: string | number): Decimal => {
  const text = String(value).trim();
  const sign = text.startsWith('-') ? -1n : 1n;
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return { n: sign * BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
};
const align = (a: Decimal, b: Decimal): [bigint, bigint, number] => {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * 10n ** BigInt(scale - a.scale), b.n * 10n ** BigInt(scale - b.scale), scale];
};
const add = (a: Decimal, b: Decimal): Decimal => {
  const [x, y, scale] = align(a, b);
  return { n: x + y, scale };
};
const format = (value: Decimal): string => {
  const negative = value.n < 0n;
  let digits = (negative ? -value.n : value.n).toString().padStart(value.scale + 1, '0');
  if (value.scale)
    digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(
      /\.0+$|(?<=\.[0-9]*?)0+$/,
      '',
    );
  return `${negative ? '-' : ''}${digits || '0'}`;
};
const mean = (values: Decimal[]): Decimal =>
  values.length ? values.reduce(add, { n: 0n, scale: 0 }) : { n: 0n, scale: 0 };
const bucketStart = (date: Date, granularity: AggregateGranularity): Date => {
  const d = new Date(date);
  if (granularity === 'hour') d.setUTCMinutes(0, 0, 0);
  else if (granularity === 'day') d.setUTCHours(0, 0, 0, 0);
  else {
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  }
  return d;
};

/** Aggregate transaction volume by UTC time bucket and asset without floating-point coercion. */
export function aggregateTransactionMetrics(
  history: Transaction[],
  options: AggregateOptions = {},
): AggregatedMetrics {
  const granularity = options.granularity ?? 'day';
  const timestampField = options.timestampField ?? 'createdAt';
  const groups = new Map<string, { start: Date; asset: string; values: Decimal[] }>();
  for (const transaction of history) {
    const date = new Date(transaction[timestampField]);
    if (Number.isNaN(date.getTime())) continue;
    const start = bucketStart(date, granularity);
    const key = `${start.toISOString()}\0${transaction.asset}`;
    const group = groups.get(key) ?? { start, asset: transaction.asset, values: [] };
    group.values.push(parse(transaction.amount));
    groups.set(key, group);
  }
  const all = history.map((transaction) => parse(transaction.amount));
  const total = all.reduce(add, { n: 0n, scale: 0 });
  const assets: AggregatedMetrics['assets'] = {};
  for (const group of groups.values()) {
    const sum = group.values.reduce(add, { n: 0n, scale: 0 });
    const current = assets[group.asset] ?? {
      transactionCount: 0,
      totalVolume: '0',
      averageTransactionValue: '0',
    };
    current.transactionCount += group.values.length;
    current.totalVolume = format(add(parse(current.totalVolume), sum));
    current.averageTransactionValue = format(mean(group.values));
    assets[group.asset] = current;
  }
  const buckets = [...groups.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.asset.localeCompare(b.asset))
    .map((group) => {
      const sum = group.values.reduce(add, { n: 0n, scale: 0 });
      const average = mean(group.values);
      const next = new Date(group.start);
      if (granularity === 'hour') next.setUTCHours(next.getUTCHours() + 1);
      else if (granularity === 'day') next.setUTCDate(next.getUTCDate() + 1);
      else next.setUTCDate(next.getUTCDate() + 7);
      return {
        start: group.start.toISOString(),
        end: next.toISOString(),
        asset: group.asset,
        transactionCount: group.values.length,
        volume: format(sum),
        averageTransactionValue: format(average),
        standardDeviation: '0',
        lowerBound: format(average),
        upperBound: format(average),
      };
    });
  return {
    transactionCount: history.length,
    totalVolume: format(total),
    averageTransactionValue: format(mean(all)),
    standardDeviation: '0',
    assets,
    buckets,
  };
}
