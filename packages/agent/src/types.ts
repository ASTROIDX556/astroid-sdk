/**
 * Pagination and filtering options for listing agents (@astroid/agent).
 */
import type { AgentRole, AgentStatus, ListAgentsParams } from '@astroid/types';

export type AgentFilterStatus = AgentStatus | 'active' | 'paused' | 'terminated';

export interface ListAgentsOptions extends Omit<ListAgentsParams, 'status'> {
  /** Maximum number of agents to return per page. */
  limit?: number;
  /** Opaque cursor token for keyset pagination. */
  cursor?: string;
  /** Filter agents by operational status (single or list). */
  status?: AgentFilterStatus | AgentFilterStatus[];
  /** Free-text search query matching agent name or metadata. */
  search?: string;
  /** Filter agents by assigned role. */
  role?: AgentRole;
  /** Filter agents by tag. */
  tag?: string;
  /** Filter agents by owner wallet address. */
  walletAddress?: string;
  /** Field to sort by. */
  sort?: string;
  /** Sort direction ('asc' or 'desc'). */
  order?: 'asc' | 'desc';
  /** 1-based page number for offset pagination. */
  page?: number;
}

/** Query parameter type accepted by agent requests. */
export type AgentQuery = Record<string, string | number | boolean | readonly (string | number)[] | undefined | null>;

/**
 * Serialize agent query options into a clean parameter record or query string,
 * omitting undefined/null values and correctly formatting arrays and primitives.
 */
export function serializeAgentQuery(params?: ListAgentsOptions | null): Record<string, string | number | boolean | string[] | number[]> {
  const out: Record<string, string | number | boolean | string[] | number[]> = {};
  if (!params) return out;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') continue;
      out[key] = trimmed;
    } else if (Array.isArray(value)) {
      const cleaned = value
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v !== undefined && v !== null && v !== '');
      if (cleaned.length > 0) {
        out[key] = cleaned as string[] | number[];
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'object') {
      // For any nested/other plain values or serialized objects
      out[key] = String(value);
    }
  }
  return out;
}
