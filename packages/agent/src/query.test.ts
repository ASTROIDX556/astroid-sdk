import { describe, it, expect } from 'vitest';
import { serializeAgentQuery, createAgentQueryString } from './query.js';

describe('Agent Query Serialization', () => {
  it('should omit undefined and null values', () => {
    const query = serializeAgentQuery({
      limit: 10,
      cursor: undefined,
      status: null,
      search: 'trading',
    });
    expect(query).toEqual({
      limit: 10,
      search: 'trading',
    });
  });

  it('should correctly format arrays and primitives', () => {
    const query = serializeAgentQuery({
      status: ['active', 'paused'],
      page: 2,
      active: true,
      tag: 'defi',
    });
    expect(query).toEqual({
      status: ['active', 'paused'],
      page: 2,
      active: true,
      tag: 'defi',
    });
  });

  it('should generate a valid query string with special characters', () => {
    const queryString = createAgentQueryString({
      search: 'agent & test',
      walletAddress: 'GABC123+XYZ',
      limit: 5,
    });
    expect(queryString).toContain('search=agent+%26+test');
    expect(queryString).toContain('walletAddress=GABC123%2BXYZ');
    expect(queryString).toContain('limit=5');
  });
});
