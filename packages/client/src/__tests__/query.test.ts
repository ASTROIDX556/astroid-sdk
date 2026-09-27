import { describe, it, expect } from 'vitest';
import { serializeQuery } from '../query.js';

describe('serializeQuery', () => {
  it('returns empty string for undefined or empty params', () => {
    expect(serializeQuery(undefined)).toBe('');
    expect(serializeQuery({})).toBe('');
  });

  it('serializes strings, numbers, and booleans', () => {
    const query = serializeQuery({
      search: 'agent-1',
      limit: 10,
      active: true,
      disabled: false,
    });
    expect(query).toBe('?search=agent-1&limit=10&active=true&disabled=false');
  });

  it('omits null, undefined, and empty string values', () => {
    const query = serializeQuery({
      name: 'test',
      missing: null,
      absent: undefined,
      emptyStr: '',
    });
    expect(query).toBe('?name=test');
  });

  it('serializes arrays with bracket notation', () => {
    const query = serializeQuery({
      status: ['active', 'pending'],
      tags: ['ai', null, 'stellar', ''],
    });
    // Null/empty items are omitted and indices are compacted.
    expect(query).toBe(
      '?status%5B0%5D=active&status%5B1%5D=pending&tags%5B0%5D=ai&tags%5B1%5D=stellar',
    );
  });

  it('serializes nested objects recursively', () => {
    const query = serializeQuery({
      filter: {
        asset: 'USDC',
        minAmount: 100,
        nested: {
          deep: true,
        },
      },
    });
    expect(query).toBe(
      '?filter%5Basset%5D=USDC&filter%5BminAmount%5D=100&filter%5Bnested%5D%5Bdeep%5D=true',
    );
  });

  it('serializes Dates to ISO strings and drops invalid dates', () => {
    const query = serializeQuery({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('not-a-date'),
    });
    expect(query).toBe('?from=2026-01-01T00%3A00%3A00.000Z');
  });

  it('serializes Date arrays and nested Dates', () => {
    const query = serializeQuery({
      filter: { since: new Date('2026-02-01T00:00:00.000Z') },
    });
    expect(query).toBe('?filter%5Bsince%5D=2026-02-01T00%3A00%3A00.000Z');
  });

  it('supports repeat and comma array formats', () => {
    expect(serializeQuery({ tag: ['a', 'b'] }, { arrayFormat: 'repeat' })).toBe('?tag=a&tag=b');
    expect(serializeQuery({ tag: ['a', 'b'] }, { arrayFormat: 'comma' })).toBe('?tag=a%2Cb');
  });

  it('percent-encodes special characters', () => {
    const query = serializeQuery({ search: 'a&b=c d/e+ü' });
    expect(query).toBe(`?${new URLSearchParams({ search: 'a&b=c d/e+ü' }).toString()}`);
    expect(query).toContain('search=');
    expect(query).not.toContain(' ');
  });

  it('omits empty arrays, empty objects and non-finite numbers', () => {
    expect(serializeQuery({ tags: [], filter: {}, a: Number.NaN, b: Infinity })).toBe('');
    expect(serializeQuery({ page: 0, active: false })).toBe('?page=0&active=false');
  });
});
