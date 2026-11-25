/**
 * Standardized query parameter serialization utility.
 * @packageDocumentation
 */


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
export type QueryParamScalar = string | number | boolean | Date;
export type QueryParamValue = QueryParamScalar | QueryParamScalar[] | null | undefined;
export type QueryParams = Record<string, QueryParamValue>;

export type QueryArrayFormat = 'comma' | 'repeat';

export interface SerializeQueryOptions {
  arrayFormat?: QueryArrayFormat;
}

/**
 * Serializes a parameter record into a URL-encoded query string.
 * Supports strings, numbers, booleans, Date objects (ISO-8601), and arrays.
 * Omit null, undefined, and empty arrays.
 */
export function serializeQuery(
  params?: QueryParams,
  options?: SerializeQueryOptions,
): string;
export function serializeQuery(
  params?: QueryParams | null,
  options?: SerializeQueryOptions,
): string {
  if (!params) return '';
  const arrayFormat = options?.arrayFormat ?? 'bracket-index';
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    appendParam(searchParams, key, value, arrayFormat);
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}
