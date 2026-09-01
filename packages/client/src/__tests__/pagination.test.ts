import { describe, expect, it } from 'vitest';
import { serializePaginationParams, unwrapPaginatedResponse } from '../pagination.js';
import { Astroid } from '../index.js';

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
