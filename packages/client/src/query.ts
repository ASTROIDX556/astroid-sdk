/**
 * Query parameter serialization helper for @astroid/client.
 *
 * List/search endpoints take filters, pagination cursors and boolean flags in
 * the query string. This module provides a single pure helper,
 * {@link serializeQuery}, that turns a loosely-typed params record into a
 * URL-encoded `?…` suffix:
 *
 * - `string` / `number` / `boolean` are stringified (`true` → `"true"`).
 * - `Date` instances are serialized with `toISOString()` (invalid dates omitted).
 * - Arrays are serialized per `arrayFormat` (`bracket-index` by default,
 *   `repeat` or `comma` on request); `null` / `undefined` / `''` items are dropped.
 * - Nested plain objects are flattened with bracket notation
 *   (`{ filter: { asset: 'USDC' } }` → `filter[asset]=USDC`).
 * - `null`, `undefined` and `''` values are omitted, as are empty arrays /
 *   objects and non-finite numbers (`NaN`, `±Infinity`).
 * - Everything else is encoded with `URLSearchParams`, so special characters
 *   (`&`, `=`, spaces, unicode, …) are percent-encoded correctly.
 *
 * @example
 * ```ts
 * serializeQuery({ search: 'bot 1', limit: 10, active: true });
 * // '?search=bot+1&limit=10&active=true'
 *
 * serializeQuery({ from: new Date('2026-01-01T00:00:00.000Z') });
 * // '?from=2026-01-01T00%3A00%3A00.000Z'
 *
 * serializeQuery({ tag: ['a', 'b'] }, { arrayFormat: 'repeat' });
 * // '?tag=a&tag=b'
 * ```
 *
 * @module
 */

export type QueryParamScalar = string | number | boolean | bigint | Date;

export type QueryParamValue =
  | QueryParamScalar
  | null
  | undefined
  | QueryParamValue[]
  | { [key: string]: QueryParamValue };

export type QueryParams = Record<string, QueryParamValue>;

/** How array values are encoded into the query string. */
export type QueryArrayFormat =
  /** `?tag[0]=a&tag[1]=b` (default; preserves element order explicitly). */
  | 'bracket-index'
  /** `?tag=a&tag=b` (matches `@astroid/core`'s `buildQueryString`). */
  | 'repeat'
  /** `?tag=a,b` (matches the agent-events `eventTypes` convention). */
  | 'comma';

/** Options for {@link serializeQuery}. */
export interface SerializeQueryOptions {
  /**
   * Array encoding. Default `'bracket-index'`.
   *
   * - `'bracket-index'`: `key[0]=a&key[1]=b`
   * - `'repeat'`: `key=a&key=b`
   * - `'comma'`: `key=a,b`
   */
  arrayFormat?: QueryArrayFormat;
}

/**
 * Serializes an object of query parameters into a URL-encoded query string.
 *
 * Pure function: takes a params record, returns `''` or a `?…` string.
 * Omits keys with `null` / `undefined` / `''` values (and empty arrays/objects).
 *
 * @param params Query parameters to serialize.
 * @param options Array encoding (defaults to indexed brackets).
 * @returns `''` when nothing is serializable, otherwise a `?`-prefixed string.
 */
export function serializeQuery(params?: QueryParams, options?: SerializeQueryOptions): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();
  const arrayFormat = options?.arrayFormat ?? 'bracket-index';

  for (const [key, value] of Object.entries(params)) {
    appendParam(searchParams, key, value, arrayFormat);
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}

function appendParam(
  searchParams: URLSearchParams,
  key: string,
  value: QueryParamValue,
  arrayFormat: QueryArrayFormat,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return;
    searchParams.append(key, value.toISOString());
    return;
  }

  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is Exclude<QueryParamValue, null | undefined | ''> =>
        item !== null && item !== undefined && item !== '',
    );
    if (items.length === 0) return;

    if (arrayFormat === 'comma') {
      const parts: string[] = [];
      for (const item of items) {
        const serialized = serializeScalar(item);
        if (serialized !== undefined) parts.push(serialized);
      }
      if (parts.length > 0) searchParams.append(key, parts.join(','));
      return;
    }

    if (arrayFormat === 'repeat') {
      for (const item of items) {
        if (Array.isArray(item) || isPlainObject(item)) {
          // Nested structures under repeat mode fall back to indexed brackets
          // to avoid ambiguous `key=a&key=b` with object values.
          appendParam(searchParams, key, item, 'bracket-index');
        } else {
          const serialized = serializeScalar(item);
          if (serialized !== undefined) searchParams.append(key, serialized);
        }
      }
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as QueryParamValue;
      if (Array.isArray(item) || isPlainObject(item) || item instanceof Date) {
        appendParam(searchParams, `${key}[${i}]`, item, arrayFormat);
      } else {
        const serialized = serializeScalar(item);
        if (serialized !== undefined) searchParams.append(`${key}[${i}]`, serialized);
      }
    }
    return;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return;
    for (const [subKey, subVal] of entries) {
      appendParam(searchParams, `${key}[${subKey}]`, subVal, arrayFormat);
    }
    return;
  }

  const serialized = serializeScalar(value);
  if (serialized === undefined) return;
  if (serialized === '') return;

  searchParams.append(key, serialized);
}

/** Stringify a scalar, or `undefined` when it must be omitted. */
function serializeScalar(value: QueryParamValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return String(value);
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return undefined;
    return value.toISOString();
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, QueryParamValue> {
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
