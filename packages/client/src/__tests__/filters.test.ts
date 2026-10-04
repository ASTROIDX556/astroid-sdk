import { describe, expect, it, vi } from 'vitest';
import type { QueryValue } from '@astroid/core';
import type { PaginatedResponse } from '@astroid/types';
import {
  buildFilterQuery,
  buildListQuery,
  buildListQueryString,
  collectCursorPages,
  iterateCursorPages,
  normalizeFilterDate,
  normalizeFilterString,
  normalizeSortDirection,
  normalizeStatusFilter,
  parsePaginatedResponse,
  type CommonListFilters,
  type ListPageFetcher,
} from '../filters.js';
import { Astroid } from '../index.js';

interface Row {
  id: string;
}

function page(data: Row[], meta?: PaginatedResponse<Row>['meta']): PaginatedResponse<Row> {
  return meta === undefined ? { data } : { data, meta };
}

/* -------------------------------------------------------------------------- */
/* Pagination parameter encoding                                               */
/* -------------------------------------------------------------------------- */

describe('buildFilterQuery — pagination (limit, cursor, direction)', () => {
  it('returns an empty record for missing filters', () => {
    expect(buildFilterQuery(undefined)).toEqual({});
    expect(buildFilterQuery(null)).toEqual({});
    expect(buildFilterQuery({})).toEqual({});
  });

  it('encodes cursor, limit, and order', () => {
    expect(buildFilterQuery({ cursor: 'cur_1', limit: 50, order: 'desc' })).toEqual({
      cursor: 'cur_1',
      limit: 50,
      order: 'desc',
    });
  });

  it('clamps limits into [1, 200]', () => {
    expect(buildFilterQuery({ limit: 0 })).toEqual({ limit: 1 });
    expect(buildFilterQuery({ limit: 999 })).toEqual({ limit: 200 });
    expect(buildFilterQuery({ limit: 10.9 })).toEqual({ limit: 10 });
  });

  it('trims cursors and drops empty ones', () => {
    expect(buildFilterQuery({ cursor: '  cur_1  ', limit: 10 })).toEqual({
      cursor: 'cur_1',
      limit: 10,
    });
    expect(buildFilterQuery({ cursor: '   ' })).toEqual({});
  });

  it('supports direction as an alias for order (explicit order wins)', () => {
    expect(buildFilterQuery({ direction: 'asc' })).toEqual({ order: 'asc' });
    expect(buildFilterQuery({ order: 'desc', direction: 'asc' })).toEqual({ order: 'desc' });
    expect(buildFilterQuery({ direction: 'sideways' as unknown as 'asc' })).toEqual({});
  });

  it('normalizes page numbers (floors, clamps to >= 1)', () => {
    expect(buildFilterQuery({ page: 2 })).toEqual({ page: 2 });
    expect(buildFilterQuery({ page: 0 })).toEqual({ page: 1 });
    expect(buildFilterQuery({ page: 2.7 })).toEqual({ page: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* Common query filters                                                        */
/* -------------------------------------------------------------------------- */

describe('buildFilterQuery — common filters', () => {
  it('trims search/sort and drops empty values', () => {
    expect(buildFilterQuery({ search: '  ops bot  ' })).toEqual({ search: 'ops bot' });
    expect(buildFilterQuery({ search: '   ' })).toEqual({});
    expect(buildFilterQuery({ sort: ' createdAt ' })).toEqual({ sort: 'createdAt' });
  });

  it('serializes a single status as a scalar', () => {
    expect(buildFilterQuery({ status: 'ACTIVE' })).toEqual({ status: 'ACTIVE' });
  });

  it('serializes status lists as arrays (repeat encoding on the wire)', () => {
    expect(buildFilterQuery({ status: ['ACTIVE', 'PAUSED'] })).toEqual({
      status: ['ACTIVE', 'PAUSED'],
    });
  });

  it('trims, dedupes, and drops empty status entries', () => {
    expect(buildFilterQuery({ status: [' ACTIVE ', '', 'ACTIVE', '  '] })).toEqual({
      status: 'ACTIVE',
    });
    expect(buildFilterQuery({ status: '   ' })).toEqual({});
    expect(buildFilterQuery({ status: [] })).toEqual({});
  });

  it('encodes entity scope filters', () => {
    expect(buildFilterQuery({ asset: ' USDC ', walletId: 'w_1', agentId: 'a_1' })).toEqual({
      asset: 'USDC',
      walletId: 'w_1',
      agentId: 'a_1',
    });
    expect(buildFilterQuery({ asset: '' })).toEqual({});
  });

  it('serializes Date instances to ISO strings and passes through ISO strings', () => {
    expect(buildFilterQuery({ startDate: new Date('2026-01-01T00:00:00.000Z') })).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
    });
    expect(buildFilterQuery({ endDate: '2026-02-01T00:00:00.000Z' })).toEqual({
      endDate: '2026-02-01T00:00:00.000Z',
    });
  });

  it('supports from/to aliases and drops invalid dates', () => {
    expect(buildFilterQuery({ from: '2026-01-01T00:00:00.000Z' })).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
    });
    expect(buildFilterQuery({ to: new Date('2026-02-01T00:00:00.000Z') })).toEqual({
      endDate: '2026-02-01T00:00:00.000Z',
    });
    expect(buildFilterQuery({ startDate: new Date('not-a-date') })).toEqual({});
    expect(buildFilterQuery({ endDate: 'not-a-date' })).toEqual({});
  });

  it('passes endpoint-specific extras through (trimmed) and drops nullish values', () => {
    const query = buildFilterQuery({
      status: 'ACTIVE',
      role: 'OPERATIONS',
      minAmount: 100,
      includeArchived: false,
      dropped: undefined,
      nulled: null,
      blank: '',
    } as unknown as CommonListFilters);
    expect(query).toEqual({
      status: 'ACTIVE',
      role: 'OPERATIONS',
      minAmount: 100,
      includeArchived: false,
    });
  });
});

describe('filter normalizers', () => {
  it('normalizeSortDirection accepts only asc/desc', () => {
    expect(normalizeSortDirection('asc')).toBe('asc');
    expect(normalizeSortDirection('desc')).toBe('desc');
    expect(normalizeSortDirection('ASC')).toBeUndefined();
    expect(normalizeSortDirection(null)).toBeUndefined();
  });

  it('normalizeFilterString trims and drops empties', () => {
    expect(normalizeFilterString(' hi ')).toBe('hi');
    expect(normalizeFilterString('')).toBeUndefined();
    expect(normalizeFilterString(42)).toBeUndefined();
  });

  it('normalizeFilterDate handles Dates and strings', () => {
    expect(normalizeFilterDate(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(normalizeFilterDate('2026-01-01')).toBe('2026-01-01');
    expect(normalizeFilterDate(new Date('bad'))).toBeUndefined();
    expect(normalizeFilterDate('bad')).toBeUndefined();
    expect(normalizeFilterDate(null)).toBeUndefined();
  });

  it('normalizeStatusFilter dedupes and drops empties', () => {
    expect(normalizeStatusFilter(['A', ' B ', 'A', ''])).toEqual(['A', 'B']);
    expect(normalizeStatusFilter('ACTIVE')).toEqual(['ACTIVE']);
    expect(normalizeStatusFilter([])).toBeUndefined();
    expect(normalizeStatusFilter(null)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Merging without mutation                                                    */
/* -------------------------------------------------------------------------- */

describe('buildListQuery — merge without mutation', () => {
  it('merges filters over a base query into a fresh record', () => {
    const base: Record<string, QueryValue> = { limit: 10, locale: 'en' };
    const filters: CommonListFilters = { limit: 50, search: 'ops' };
    const merged = buildListQuery(filters, base);
    expect(merged).toEqual({ limit: 50, locale: 'en', search: 'ops' });
    expect(base).toEqual({ limit: 10, locale: 'en' });
    expect(filters).toEqual({ limit: 50, search: 'ops' });
    expect(merged).not.toBe(base);
  });

  it('handles nullish inputs', () => {
    expect(buildListQuery(null, null)).toEqual({});
    expect(buildListQuery(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('buildListQueryString encodes repeats and maps empty to ""', () => {
    expect(buildListQueryString({ status: ['A', 'B'], limit: 10 })).toBe(
      '?limit=10&status=A&status=B',
    );
    expect(buildListQueryString({ limit: 25 })).toBe('?limit=25');
    expect(buildListQueryString()).toBe('');
    expect(buildListQueryString({})).toBe('');
  });

  it('Astroid.buildListQuery delegates without mutating', () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    const filters: CommonListFilters = { status: 'ACTIVE', limit: 500 };
    expect(client.buildListQuery(filters)).toEqual({ status: 'ACTIVE', limit: 200 });
    expect(filters).toEqual({ status: 'ACTIVE', limit: 500 });
    expect(client.buildFilterQuery({ direction: 'asc' })).toEqual({ order: 'asc' });
  });
});

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

describe('parsePaginatedResponse', () => {
  it('passes through enveloped responses', () => {
    expect(
      parsePaginatedResponse<Row>({ data: [{ id: 'a' }], meta: { nextCursor: 'n1' } }),
    ).toEqual({ data: [{ id: 'a' }], meta: { nextCursor: 'n1' } });
  });

  it('wraps bare arrays', () => {
    expect(parsePaginatedResponse<Row>([{ id: 'a' }])).toEqual({ data: [{ id: 'a' }] });
  });

  it('merges header cursors over body meta', () => {
    expect(
      parsePaginatedResponse<Row>(
        { data: [{ id: 'a' }], meta: { nextCursor: 'meta_next' } },
        { next_cursor: 'header_next', prev_cursor: 'header_prev' },
      ),
    ).toEqual({
      data: [{ id: 'a' }],
      meta: { nextCursor: 'header_next', prevCursor: 'header_prev' },
    });
  });

  it('returns { data: [] } for empty or malformed payloads without throwing', () => {
    expect(parsePaginatedResponse<Row>(null)).toEqual({ data: [] });
    expect(parsePaginatedResponse<Row>(undefined)).toEqual({ data: [] });
    expect(parsePaginatedResponse<Row>({ data: 'oops' })).toEqual({ data: [] });
    expect(parsePaginatedResponse<Row>({})).toEqual({ data: [] });
    expect(parsePaginatedResponse<Row>([])).toEqual({ data: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* Cursor iteration over mock fetch handlers                                   */
/* -------------------------------------------------------------------------- */

describe('iterateCursorPages / collectCursorPages', () => {
  it('collects every item across multiple pages via mock fetch handler', async () => {
    const seen: Array<Record<string, QueryValue>> = [];
    const fetchPage: ListPageFetcher<Row> = vi.fn(async (query) => {
      seen.push({ ...query });
      const cursor = query['cursor'];
      if (cursor === undefined)
        return page([{ id: 'w1' }, { id: 'w2' }], { nextCursor: 'c2', hasMore: true });
      if (cursor === 'c2') return page([{ id: 'w3' }], { nextCursor: 'c3', hasMore: true });
      return page([{ id: 'w4' }], { nextCursor: null, hasMore: false });
    });

    const items = await collectCursorPages(fetchPage, { limit: 2, status: 'ACTIVE' });

    expect(items.map((r) => r.id)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    // Filters are forwarded on every page; cursor advances per page.
    expect(seen[0]).toMatchObject({ limit: 2, status: 'ACTIVE' });
    expect(seen[0]?.['cursor']).toBeUndefined();
    expect(seen[1]).toMatchObject({ limit: 2, status: 'ACTIVE', cursor: 'c2' });
    expect(seen[2]).toMatchObject({ cursor: 'c3' });
  });

  it('streams lazily via the async generator', async () => {
    const fetchPage: ListPageFetcher<Row> = async (query) =>
      query['cursor'] === undefined
        ? page([{ id: 'a' }], { nextCursor: 'n1', hasMore: true })
        : page([{ id: 'b' }], { nextCursor: null, hasMore: false });

    const ids: string[] = [];
    for await (const row of iterateCursorPages(fetchPage, { search: 'x' })) ids.push(row.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('stops on empty pages without a cursor and never mutates filters', async () => {
    const filters: CommonListFilters = { limit: 10, status: 'ACTIVE' };
    const fetchPage: ListPageFetcher<Row> = vi.fn(async () => page([]));
    expect(await collectCursorPages(fetchPage, filters)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(filters).toEqual({ limit: 10, status: 'ACTIVE' });
  });

  it('continues past empty pages that still carry a cursor', async () => {
    const fetchPage: ListPageFetcher<Row> = async (query) =>
      query['cursor'] === undefined
        ? page([], { nextCursor: 'n1', hasMore: true })
        : page([{ id: 'w1' }], { nextCursor: null, hasMore: false });
    expect(await collectCursorPages(fetchPage)).toEqual([{ id: 'w1' }]);
  });

  it('stops on a non-advancing cursor instead of looping forever', async () => {
    const fetchPage: ListPageFetcher<Row> = vi.fn(async () =>
      page([{ id: 'x' }], {
        nextCursor: 'same',
        hasMore: true,
      }),
    );
    const items = await collectCursorPages(fetchPage, { cursor: 'same' });
    expect(items).toEqual([{ id: 'x' }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('respects maxPages', async () => {
    const fetchPage: ListPageFetcher<Row> = vi.fn(async (query) => {
      const n = typeof query['cursor'] === 'string' ? Number(query['cursor'].slice(1)) : 1;
      return page([{ id: `r${n}` }], { nextCursor: `c${n + 1}`, hasMore: true });
    });
    const items = await collectCursorPages(fetchPage, undefined, { maxPages: 3 });
    expect(items).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('pages through HttpClient with a mocked transport fetch', async () => {
    const requested: string[] = [];
    const transport = vi.fn(async (url: string | URL | Request) => {
      requested.push(String(url));
      const u = new URL(String(url));
      const cursor = u.searchParams.get('cursor');
      const body =
        cursor === null
          ? { data: [{ id: 'h1' }], meta: { nextCursor: 'hc2', hasMore: true } }
          : { data: [{ id: 'h2' }], meta: { nextCursor: null, hasMore: false } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new Astroid({
      apiKey: 'sk_test_filters',
      baseUrl: 'https://api.astroid.test',
      fetch: transport,
    });

    const items = await collectCursorPages<Row>(
      (query) =>
        client.http
          .get<Row[]>('/wallets', { query })
          .then((res) => ({ data: res.data, meta: res.meta })),
      { limit: 1 },
    );

    expect(items).toEqual([{ id: 'h1' }, { id: 'h2' }]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(requested[0]).toContain('limit=1');
    expect(requested[0]).not.toContain('cursor=');
    expect(requested[1]).toContain('cursor=hc2');
  });
});
