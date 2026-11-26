import type { ListAgentsParams } from '@astroid/types';
import type { AgentCursorListParams } from './agent.js';

/**
 * Serialize agent query parameters into a record suitable for query string generation.
 */
export function serializeAgentQuery(params: ListAgentsParams | AgentCursorListParams): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.join(',');
      } else {
        result[key] = String(value);
      }
    }
  }
  return result;
}

/**
 * Create a query string from agent query parameters.
 */
export function createAgentQueryString(params: ListAgentsParams | AgentCursorListParams): string {
  const serialized = serializeAgentQuery(params);
  const searchParams = new URLSearchParams();
  for (const [key, val] of Object.entries(serialized)) {
    searchParams.append(key, String(val));
  }
  return searchParams.toString();
}
