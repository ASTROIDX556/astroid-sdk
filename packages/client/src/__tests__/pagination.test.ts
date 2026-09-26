import { describe, expect, it } from 'vitest';
import type { AstroidResponse } from '@astroid/core';
import {
  paginateCursor,
  serializePaginationParams,
  unwrapPaginatedResponse,
} from '../pagination.js';
import { Astroid, paginateCursor as paginateCursorFromEntry } from '../index.js';

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
