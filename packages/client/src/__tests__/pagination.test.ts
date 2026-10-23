import { describe, expect, it } from 'vitest';
import type { AstroidResponse } from '@astroid/core';
import {
  buildPaginationQuery,
  buildPaginationQueryString,
  clampPaginationLimit,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGINATION_PARAMS,
  extractNextCursor,
  extractPaginationCursors,
  extractPrevCursor,
  hasNextPage,
  hasPrevPage,
  MAX_PAGE_LIMIT,
  MIN_PAGE_LIMIT,
  normalizePaginatedResponse,
  normalizePaginationCursor,
  normalizePaginationOrder,
  paginateCursor,
  resolvePaginationParams,
  serializePaginationParams,
  unwrapPaginatedResponse,
} from '../pagination.js';
import {
  Astroid,
  buildPaginationQuery as buildPaginationQueryFromEntry,
  buildPaginationQueryString as buildPaginationQueryStringFromEntry,
  paginateCursor as paginateCursorFromEntry,
} from '../index.js';

interface Row {
  id: string;
}

function rawPage(data: Row[], meta?: AstroidResponse<Row[]>['meta']): AstroidResponse<Row[]> {
  return { data, meta, requestId: undefined, status: 200, headers: new Headers() };
}

describe('pagination serialization and helpers', () => {
  it('serializes cursor, limit, and order correctly', () => {
    const params = {
      cursor: 'cur_123',
      limit: 50,
      order: 'asc' as const,
    };
    const serialized = serializePaginationParams(params);
    expect(serialized).toEqual({
      cursor: 'cur_123',
      limit: 50,
      order: 'asc',
    });
  });

  it('omits undefined pagination parameters safely', () => {
    const params = {
      cursor: undefined,
      limit: 10,
    };
    const serialized = serializePaginationParams(params);
    expect(serialized).toEqual({
      limit: 10,
    });
  });

  it('returns empty object when params are undefined', () => {
    expect(serializePaginationParams(undefined)).toEqual({});
  });

  it('unwraps paginated responses correctly', () => {
    const response = {
      data: [{ id: '1' }, { id: '2' }],
      meta: { cursor: 'cur_next', hasMore: true },
    };
    const items = unwrapPaginatedResponse(response);
    expect(items).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('buildPaginationQuery serialises cursor, limit, and order', () => {
    const query = buildPaginationQuery({ cursor: 'cur_123', limit: 50, order: 'asc' });
    expect(query).toBeInstanceOf(URLSearchParams);
    expect(query.get('cursor')).toBe('cur_123');
    expect(query.get('limit')).toBe('50');
    expect(query.get('order')).toBe('asc');
    expect(query.toString()).toBe('cursor=cur_123&limit=50&order=asc');
  });

  it('buildPaginationQuery omits undefined, null, and empty values without empty segments', () => {
    const query = buildPaginationQuery({
      cursor: undefined,
      limit: undefined,
      order: undefined,
      page: undefined,
    });
    expect(query.toString()).toBe('');

    const withNulls = buildPaginationQuery({
      cursor: null as unknown as string,
      limit: null as unknown as number,
      order: null as unknown as 'asc',
    });
    expect(withNulls.toString()).toBe('');
  });

  it('buildPaginationQuery encodes a page-based (offset) request', () => {
    expect(buildPaginationQuery({ page: 2, limit: 25 }).toString()).toBe('limit=25&page=2');
  });

  it('buildPaginationQueryString returns a leading-? query string or empty string', () => {
    expect(buildPaginationQueryString({ limit: 25 })).toBe('?limit=25');
    expect(buildPaginationQueryString()).toBe('');
    expect(buildPaginationQueryString({})).toBe('');
  });

  it('exposes the pagination builders from the package entry point', () => {
    expect(buildPaginationQueryFromEntry).toBe(buildPaginationQuery);
    expect(buildPaginationQueryStringFromEntry).toBe(buildPaginationQueryString);
  });

  it('serializePaginationParams omits null/empty cursor values', () => {
    expect(
      serializePaginationParams({ cursor: '' as unknown as string, limit: 10, page: 3 }),
    ).toEqual({ limit: 10, page: 3 });
  });

  it('client buildQuery combines pagination and custom query parameters', () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
    });
    const query = client.buildQuery({
      cursor: 'c_1',
      limit: 20,
      order: 'desc',
      status: 'ACTIVE',
    });
    expect(query).toEqual({
      cursor: 'c_1',
      limit: 20,
      order: 'desc',
      status: 'ACTIVE',
    });
  });
});

describe('cursor pagination exposed by @astroid/client', () => {
  it('re-exports the shared helper from the package entry point', () => {
    expect(paginateCursorFromEntry).toBe(paginateCursor);
  });

  it('iterates a multi-page API response, following each nextCursor', async () => {
    const cursors: (string | undefined)[] = [];
    const fetchPage = async (cursor: string | undefined): Promise<AstroidResponse<Row[]>> => {
      cursors.push(cursor);
      switch (cursor) {
        case undefined:
          return rawPage([{ id: 'w1' }, { id: 'w2' }], { nextCursor: 'cur_2', hasMore: true });
        case 'cur_2':
          return rawPage([{ id: 'w3' }], { nextCursor: 'cur_3', hasMore: true });
        case 'cur_3':
          return rawPage([{ id: 'w4' }], { nextCursor: null, hasMore: false });
        default:
          return rawPage([], { nextCursor: null, hasMore: false });
      }
    };

    const ids: string[] = [];
    for await (const row of paginateCursor(fetchPage)) {
      ids.push(row.id);
    }

    expect(ids).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(cursors).toEqual([undefined, 'cur_2', 'cur_3']);
  });

  it('surfaces empty pages without stopping the iteration', async () => {
    const fetchPage = async (cursor: string | undefined): Promise<AstroidResponse<Row[]>> =>
      cursor === undefined
        ? rawPage([], { nextCursor: 'cur_2', hasMore: true })
        : rawPage([{ id: 'w1' }], { nextCursor: null, hasMore: false });

    const ids: string[] = [];
    for await (const row of paginateCursor(fetchPage)) {
      ids.push(row.id);
    }

    expect(ids).toEqual(['w1']);
  });
});

describe('pagination limit bounds (clamping 1–200)', () => {
  it(`exposes bounds MIN=${MIN_PAGE_LIMIT} MAX=${MAX_PAGE_LIMIT}`, () => {
    expect(MIN_PAGE_LIMIT).toBe(1);
    expect(MAX_PAGE_LIMIT).toBe(200);
    expect(DEFAULT_PAGINATION_PARAMS.limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('clamps out-of-range limits instead of throwing', () => {
    expect(clampPaginationLimit(0)).toBe(1);
    expect(clampPaginationLimit(-5)).toBe(1);
    expect(clampPaginationLimit(201)).toBe(200);
    expect(clampPaginationLimit(500)).toBe(200);
    expect(clampPaginationLimit(1)).toBe(1);
    expect(clampPaginationLimit(200)).toBe(200);
    expect(clampPaginationLimit(50)).toBe(50);
  });

  it('floors fractional limits and handles numeric strings', () => {
    expect(clampPaginationLimit(10.9)).toBe(10);
    expect(clampPaginationLimit('25')).toBe(25);
    expect(clampPaginationLimit('  30  ')).toBe(30);
  });

  it('returns undefined for missing or non-numeric limits without throwing', () => {
    expect(clampPaginationLimit(undefined)).toBeUndefined();
    expect(clampPaginationLimit(null)).toBeUndefined();
    expect(clampPaginationLimit(Number.NaN)).toBeUndefined();
    expect(clampPaginationLimit(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampPaginationLimit('not-a-number')).toBeUndefined();
    expect(clampPaginationLimit({} as unknown as number)).toBeUndefined();
  });

  it('serializePaginationParams clamps limits in the query record', () => {
    expect(serializePaginationParams({ limit: 0 })).toEqual({ limit: 1 });
    expect(serializePaginationParams({ limit: 999 })).toEqual({ limit: 200 });
    expect(serializePaginationParams({ limit: 7.8 })).toEqual({ limit: 7 });
  });

  it('buildPaginationQuery clamps boundary limits in the query string', () => {
    expect(buildPaginationQuery({ limit: 0 }).get('limit')).toBe('1');
    expect(buildPaginationQuery({ limit: 500 }).get('limit')).toBe('200');
    expect(buildPaginationQueryString({ limit: 500 })).toBe('?limit=200');
  });

  it('resolvePaginationParams applies defaults and clamps', () => {
    expect(resolvePaginationParams(null)).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      order: 'desc',
    });
    expect(resolvePaginationParams({ limit: 500 })).toMatchObject({ limit: 200 });
    expect(resolvePaginationParams({ limit: 0 }, { applyDefaults: false })).toEqual({ limit: 1 });
    expect(resolvePaginationParams(undefined, { applyDefaults: false })).toEqual({});
  });

  it('drops invalid order values and trims cursors', () => {
    expect(normalizePaginationOrder('ASC' as unknown as 'asc')).toBeUndefined();
    expect(normalizePaginationOrder('desc')).toBe('desc');
    expect(normalizePaginationCursor('  cur_1  ')).toBe('cur_1');
    expect(normalizePaginationCursor('   ')).toBeUndefined();
    expect(serializePaginationParams({ order: 'bogus' as unknown as 'asc', limit: 10 })).toEqual({
      limit: 10,
    });
  });

  it('client buildQuery clamps pagination limits while preserving custom params', () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    expect(client.buildQuery({ limit: 999, status: 'ACTIVE' })).toEqual({
      status: 'ACTIVE',
      limit: 200,
    });
    expect(client.buildQuery({ limit: 0 })).toEqual({ limit: 1 });
  });
});

describe('pagination response header extractors', () => {
  it('extracts next_cursor / prev_cursor from plain records', () => {
    expect(extractPaginationCursors({ next_cursor: 'next_1', prev_cursor: 'prev_0' })).toEqual({
      nextCursor: 'next_1',
      prevCursor: 'prev_0',
    });
    expect(extractNextCursor({ next_cursor: 'next_1' })).toBe('next_1');
    expect(extractPrevCursor({ prev_cursor: 'prev_0' })).toBe('prev_0');
  });

  it('is case-insensitive and supports x- prefixed variants', () => {
    expect(extractNextCursor({ 'X-Next-Cursor': 'n1' })).toBe('n1');
    expect(extractPrevCursor({ 'X-Prev-Cursor': 'p1' })).toBe('p1');
    expect(extractNextCursor({ NEXT_CURSOR: 'n2' })).toBe('n2');
  });

  it('reads from a Headers instance', () => {
    const headers = new Headers({ next_cursor: 'h_next', prev_cursor: 'h_prev' });
    expect(extractPaginationCursors(headers)).toEqual({
      nextCursor: 'h_next',
      prevCursor: 'h_prev',
    });
    expect(hasNextPage(headers)).toBe(true);
    expect(hasPrevPage(headers)).toBe(true);
  });

  it('returns null for missing headers without throwing', () => {
    expect(extractPaginationCursors(undefined)).toEqual({ nextCursor: null, prevCursor: null });
    expect(extractPaginationCursors(null)).toEqual({ nextCursor: null, prevCursor: null });
    expect(extractPaginationCursors({})).toEqual({ nextCursor: null, prevCursor: null });
    expect(extractPaginationCursors(new Headers())).toEqual({
      nextCursor: null,
      prevCursor: null,
    });
    expect(extractNextCursor(undefined)).toBeNull();
    expect(extractPrevCursor(null)).toBeNull();
    expect(hasNextPage({})).toBe(false);
    expect(hasPrevPage(undefined)).toBe(false);
  });

  it('treats empty / whitespace / malformed header values as absent', () => {
    expect(extractNextCursor({ next_cursor: '' })).toBeNull();
    expect(extractNextCursor({ next_cursor: '   ' })).toBeNull();
    expect(extractPrevCursor({ prev_cursor: '' })).toBeNull();
    expect(
      extractPaginationCursors({ next_cursor: [], prev_cursor: [null, ''] } as unknown as Record<
        string,
        string
      >),
    ).toEqual({ nextCursor: null, prevCursor: null });
    expect(extractNextCursor({ next_cursor: ['  ', 'fallback'] })).toBe('fallback');
    expect(extractNextCursor({ next_cursor: 123 } as unknown as Record<string, string>)).toBe(
      '123',
    );
  });

  it('client header helpers delegate without throwing on malformed input', () => {
    const client = new Astroid({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
    expect(client.getNextCursor({ next_cursor: 'c_next' })).toBe('c_next');
    expect(client.getPrevCursor({})).toBeNull();
    expect(client.getPaginationCursors(undefined)).toEqual({
      nextCursor: null,
      prevCursor: null,
    });
  });
});

describe('paginated response metadata helpers', () => {
  it('unwrapPaginatedResponse handles empty lists and missing envelopes', () => {
    expect(unwrapPaginatedResponse({ data: [] })).toEqual([]);
    expect(unwrapPaginatedResponse(null)).toEqual([]);
    expect(unwrapPaginatedResponse(undefined)).toEqual([]);
    expect(unwrapPaginatedResponse({ data: 'oops' } as unknown as { data: Row[] })).toEqual([]);
  });

  it('normalizePaginatedResponse merges headers over body meta', () => {
    const merged = normalizePaginatedResponse<Row>(
      [{ id: 'a' }],
      { nextCursor: 'meta_next' },
      { next_cursor: 'header_next', prev_cursor: 'header_prev' },
    );
    expect(merged.data).toEqual([{ id: 'a' }]);
    expect(merged.meta?.nextCursor).toBe('header_next');
    expect(merged.meta?.prevCursor).toBe('header_prev');
  });

  it('normalizePaginatedResponse tolerates empty lists and absent meta/headers', () => {
    expect(normalizePaginatedResponse<Row>([], undefined, undefined)).toEqual({ data: [] });
    expect(normalizePaginatedResponse<Row>('nope' as unknown as Row[], null, {})).toEqual({
      data: [],
    });
    const fromMeta = normalizePaginatedResponse<Row>([{ id: 'a' }], { nextCursor: 'm1' }, {});
    expect(fromMeta.meta?.nextCursor).toBe('m1');
  });
});
