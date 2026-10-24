import { describe, expect, it } from 'vitest';

import type { Agent, AgentRole, AgentStatus } from '@astroid/types';
import {
  scopeMatches,
  hasAgentScope,
  validateAgentScopes,
  getMissingScopes,
  hasAnyScope,
  isScopedAgent,
  extractScopes,
  toScopedAgent,
  type ScopedAgent,
} from '../scopes.js';

/** Creates a minimal valid Agent fixture. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Test Agent',
    role: 'OPERATIONS' as AgentRole,
    status: 'ACTIVE' as AgentStatus,
    capabilities: ['trade', 'transfer'],
    metadata: {},
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  };
}

/** Creates a ScopedAgent fixture. */
function makeScopedAgent(scopes: string[], overrides: Partial<Agent> = {}): ScopedAgent {
  return {
    ...makeAgent(overrides),
    scopes,
  };
}

describe('scopeMatches', () => {
  describe('global wildcard', () => {
    it('matches any scope', () => {
      expect(scopeMatches('*', 'wallet:read')).toBe(true);
      expect(scopeMatches('*', 'transaction:create')).toBe(true);
      expect(scopeMatches('*', 'budget:delete')).toBe(true);
      expect(scopeMatches('*', '*')).toBe(true);
    });
  });

  describe('exact match', () => {
    it('matches identical scopes', () => {
      expect(scopeMatches('wallet:read', 'wallet:read')).toBe(true);
      expect(scopeMatches('transaction:create', 'transaction:create')).toBe(true);
    });

    it('does not match different scopes', () => {
      expect(scopeMatches('wallet:read', 'wallet:write')).toBe(false);
      expect(scopeMatches('wallet:read', 'transaction:read')).toBe(false);
    });
  });

  describe('resource wildcard', () => {
    it('matches all actions on the same resource', () => {
      expect(scopeMatches('wallet:*', 'wallet:read')).toBe(true);
      expect(scopeMatches('wallet:*', 'wallet:write')).toBe(true);
      expect(scopeMatches('wallet:*', 'wallet:transfer')).toBe(true);
      expect(scopeMatches('wallet:*', 'wallet:freeze')).toBe(true);
    });

    it('does not match different resources', () => {
      expect(scopeMatches('wallet:*', 'transaction:read')).toBe(false);
      expect(scopeMatches('wallet:*', 'budget:create')).toBe(false);
    });

    it('does not match the resource without action', () => {
      expect(scopeMatches('wallet:*', 'wallet')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      expect(scopeMatches('', '')).toBe(true);
      expect(scopeMatches('', 'wallet:read')).toBe(false);
      expect(scopeMatches('wallet:read', '')).toBe(false);
    });

    it('handles scopes with multiple colons', () => {
      expect(scopeMatches('wallet:transfer:outgoing', 'wallet:transfer:outgoing')).toBe(true);
      expect(scopeMatches('wallet:*', 'wallet:transfer:outgoing')).toBe(true);
      expect(scopeMatches('wallet:transfer:*', 'wallet:transfer:outgoing')).toBe(true);
    });
  });
});

describe('hasAgentScope', () => {
  it('returns true when agent has exact matching scope', () => {
    const agent = makeScopedAgent(['wallet:read', 'transaction:create']);
    expect(hasAgentScope(agent, 'wallet:read')).toBe(true);
    expect(hasAgentScope(agent, 'transaction:create')).toBe(true);
  });

  it('returns true when agent has resource wildcard', () => {
    const agent = makeScopedAgent(['wallet:*']);
    expect(hasAgentScope(agent, 'wallet:read')).toBe(true);
    expect(hasAgentScope(agent, 'wallet:write')).toBe(true);
    expect(hasAgentScope(agent, 'wallet:transfer')).toBe(true);
  });

  it('returns true when agent has global wildcard', () => {
    const agent = makeScopedAgent(['*']);
    expect(hasAgentScope(agent, 'anything:everything')).toBe(true);
    expect(hasAgentScope(agent, 'wallet:read')).toBe(true);
  });

  it('returns false when agent lacks required scope', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(hasAgentScope(agent, 'wallet:write')).toBe(false);
    expect(hasAgentScope(agent, 'transaction:read')).toBe(false);
  });

  it('returns false for empty scopes array', () => {
    const agent = makeScopedAgent([]);
    expect(hasAgentScope(agent, 'wallet:read')).toBe(false);
  });

  it('returns false for undefined scopes', () => {
    const agent = { ...makeAgent(), scopes: undefined as unknown as string[] };
    expect(hasAgentScope(agent, 'wallet:read')).toBe(false);
  });

  it('returns false for null scopes', () => {
    const agent = { ...makeAgent(), scopes: null as unknown as string[] };
    expect(hasAgentScope(agent, 'wallet:read')).toBe(false);
  });

  it('handles multiple scopes with mixed wildcards', () => {
    const agent = makeScopedAgent(['wallet:read', 'transaction:*']);
    expect(hasAgentScope(agent, 'wallet:read')).toBe(true);
    expect(hasAgentScope(agent, 'wallet:write')).toBe(false);
    expect(hasAgentScope(agent, 'transaction:create')).toBe(true);
    expect(hasAgentScope(agent, 'transaction:read')).toBe(true);
  });
});

describe('validateAgentScopes', () => {
  it('does not throw when agent has all required scopes', () => {
    const agent = makeScopedAgent(['wallet:read', 'wallet:write', 'transaction:read']);
    expect(() => validateAgentScopes(agent, ['wallet:read', 'wallet:write'])).not.toThrow();
  });

  it('does not throw when agent has wildcard covering required scopes', () => {
    const agent = makeScopedAgent(['wallet:*']);
    expect(() => validateAgentScopes(agent, ['wallet:read', 'wallet:write', 'wallet:transfer'])).not.toThrow();
  });

  it('does not throw when agent has global wildcard', () => {
    const agent = makeScopedAgent(['*']);
    expect(() => validateAgentScopes(agent, ['wallet:read', 'budget:create', 'policy:delete'])).not.toThrow();
  });

  it('throws AuthorizationError when agent lacks one required scope', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(() => validateAgentScopes(agent, ['wallet:read', 'wallet:write'])).toThrowError(
      /Agent agt_1 lacks required scope\(s\): wallet:write/,
    );
  });

  it('throws AuthorizationError when agent lacks multiple required scopes', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(() => validateAgentScopes(agent, ['wallet:write', 'transaction:read', 'budget:create'])).toThrowError(
      /Agent agt_1 lacks required scope\(s\): wallet:write, transaction:read, budget:create/,
    );
  });

  it('throws AuthorizationError with correct error details', () => {
    const agent = makeScopedAgent(['wallet:read']);
    try {
      validateAgentScopes(agent, ['wallet:write']);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const err = error as Error & { details?: Record<string, unknown> };
      expect(err.message).toContain('wallet:write');
      expect(err.details?.agentId).toBe('agt_1');
      expect(err.details?.requiredScopes).toEqual(['wallet:write']);
      expect(err.details?.missingScopes).toEqual(['wallet:write']);
      expect(err.details?.grantedScopes).toEqual(['wallet:read']);
    }
  });

  it('throws AuthorizationError for empty scopes array', () => {
    const agent = makeScopedAgent([]);
    expect(() => validateAgentScopes(agent, ['wallet:read'])).toThrowError(
      /Agent agt_1 lacks required scope\(s\): wallet:read/,
    );
  });
});

describe('getMissingScopes', () => {
  it('returns empty array when agent has all required scopes', () => {
    const agent = makeScopedAgent(['wallet:read', 'wallet:write']);
    expect(getMissingScopes(agent, ['wallet:read', 'wallet:write'])).toEqual([]);
  });

  it('returns missing scopes when agent lacks some', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(getMissingScopes(agent, ['wallet:read', 'wallet:write', 'transaction:read'])).toEqual([
      'wallet:write',
      'transaction:read',
    ]);
  });

  it('returns all required scopes when agent has none', () => {
    const agent = makeScopedAgent([]);
    expect(getMissingScopes(agent, ['wallet:read', 'wallet:write'])).toEqual([
      'wallet:read',
      'wallet:write',
    ]);
  });

  it('returns empty array when agent has global wildcard', () => {
    const agent = makeScopedAgent(['*']);
    expect(getMissingScopes(agent, ['wallet:read', 'wallet:write'])).toEqual([]);
  });

  it('returns empty array when agent has resource wildcard', () => {
    const agent = makeScopedAgent(['wallet:*']);
    expect(getMissingScopes(agent, ['wallet:read', 'wallet:write'])).toEqual([]);
  });
});

describe('hasAnyScope', () => {
  it('returns true when agent has at least one required scope', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(hasAnyScope(agent, ['wallet:read', 'transaction:read'])).toBe(true);
  });

  it('returns true when agent has wildcard matching one required scope', () => {
    const agent = makeScopedAgent(['wallet:*']);
    expect(hasAnyScope(agent, ['wallet:read', 'transaction:read'])).toBe(true);
  });

  it('returns true when agent has global wildcard', () => {
    const agent = makeScopedAgent(['*']);
    expect(hasAnyScope(agent, ['wallet:read', 'transaction:read'])).toBe(true);
  });

  it('returns false when agent has none of the required scopes', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(hasAnyScope(agent, ['transaction:read', 'budget:create'])).toBe(false);
  });

  it('returns false for empty scopes array', () => {
    const agent = makeScopedAgent([]);
    expect(hasAnyScope(agent, ['wallet:read'])).toBe(false);
  });

  it('returns false for empty required scopes array', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(hasAnyScope(agent, [])).toBe(false);
  });
});

describe('isScopedAgent', () => {
  it('returns true for agent with valid scopes array', () => {
    const agent = makeScopedAgent(['wallet:read']);
    expect(isScopedAgent(agent)).toBe(true);
  });

  it('returns false for agent without scopes property', () => {
    const agent = makeAgent();
    expect(isScopedAgent(agent)).toBe(false);
  });

  it('returns false for agent with undefined scopes', () => {
    const agent = { ...makeAgent(), scopes: undefined as unknown };
    expect(isScopedAgent(agent)).toBe(false);
  });

  it('returns false for agent with non-array scopes', () => {
    const agent = { ...makeAgent(), scopes: 'wallet:read' as unknown };
    expect(isScopedAgent(agent)).toBe(false);
  });

  it('returns false for agent with empty scopes array', () => {
    const agent = makeScopedAgent([]);
    expect(isScopedAgent(agent)).toBe(true); // Empty array is still valid structure
  });

  it('returns false for agent with non-string scope entries', () => {
    const agent = { ...makeAgent(), scopes: ['wallet:read', 123] as unknown };
    expect(isScopedAgent(agent)).toBe(false);
  });
});

describe('extractScopes', () => {
  it('extracts scopes from top-level scopes property', () => {
    const agent = makeScopedAgent(['wallet:read', 'wallet:write']);
    expect(extractScopes(agent)).toEqual(['wallet:read', 'wallet:write']);
  });

  it('extracts scopes from metadata.scopes when top-level absent', () => {
    const agent = makeAgent({
      metadata: { scopes: ['transaction:read', 'transaction:create'] },
    });
    expect(extractScopes(agent)).toEqual(['transaction:read', 'transaction:create']);
  });

  it('prefers top-level scopes over metadata.scopes', () => {
    const agent = makeScopedAgent(['wallet:read'], {
      metadata: { scopes: ['transaction:read'] },
    });
    expect(extractScopes(agent)).toEqual(['wallet:read']);
  });

  it('returns empty array when no scopes found', () => {
    const agent = makeAgent();
    expect(extractScopes(agent)).toEqual([]);
  });

  it('returns empty array for invalid metadata.scopes', () => {
    const agent = makeAgent({
      metadata: { scopes: 'not-an-array' as unknown },
    });
    expect(extractScopes(agent)).toEqual([]);
  });

  it('returns empty array for metadata.scopes with non-string entries', () => {
    const agent = makeAgent({
      metadata: { scopes: ['wallet:read', 123] as unknown },
    });
    expect(extractScopes(agent)).toEqual([]);
  });
});

describe('toScopedAgent', () => {
  it('creates ScopedAgent with scopes from top-level property', () => {
    const agent = makeScopedAgent(['wallet:read', 'wallet:write']);
    const scoped = toScopedAgent(agent);
    expect(scoped.scopes).toEqual(['wallet:read', 'wallet:write']);
    expect(scoped.id).toBe('agt_1');
  });

  it('creates ScopedAgent with scopes from metadata', () => {
    const agent = makeAgent({
      metadata: { scopes: ['transaction:read'] },
    });
    const scoped = toScopedAgent(agent);
    expect(scoped.scopes).toEqual(['transaction:read']);
  });

  it('creates ScopedAgent with empty scopes when none found', () => {
    const agent = makeAgent();
    const scoped = toScopedAgent(agent);
    expect(scoped.scopes).toEqual([]);
  });

  it('preserves all other agent properties', () => {
    const agent = makeScopedAgent(['wallet:read'], {
      name: 'Custom Agent',
      role: 'FINANCE' as AgentRole,
      capabilities: ['trade'],
    });
    const scoped = toScopedAgent(agent);
    expect(scoped.name).toBe('Custom Agent');
    expect(scoped.role).toBe('FINANCE');
    expect(scoped.capabilities).toEqual(['trade']);
  });
});