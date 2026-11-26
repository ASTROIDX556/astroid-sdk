/**
 * Pagination and filtering options for listing agents (@astroid/agent).
 */
import type { AgentRole, AgentStatus, ListAgentsParams } from '@astroid/types';

export type AgentFilterStatus = AgentStatus | 'active' | 'paused' | 'terminated';

export interface AgentFilterOptions {
  status?: AgentFilterStatus;
  search?: string;
  role?: AgentRole;
  tag?: string;
  tags?: string[];
  from?: string;
  to?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface ListAgentsOptions extends Omit<ListAgentsParams, 'status'>, AgentFilterOptions {
  /** Maximum number of agents to return per page. */
  limit?: number;
  /** Opaque cursor token for keyset pagination. */
  cursor?: string;
  /** Filter agents by operational status. */
  status?: AgentFilterStatus;
  /** Free-text search query matching agent name or metadata. */
  search?: string;
  /** Filter agents by assigned role. */
  role?: AgentRole;
  /** Filter agents by tag. */
  tag?: string;
  /** 1-based page number for offset pagination. */
  page?: number;
}
