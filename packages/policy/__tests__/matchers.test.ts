import { describe, expect, it } from 'vitest';

import type { Policy } from '@astroid/types';

import {
  combineMatchers,
  matchPolicies,
  matchesPolicyScope,
  type PolicyMatcher,
} from '../src/matchers.js';

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'pol_1',
    organizationId: 'org_1',
    name: 'Test policy',
    type: 'MAX_AMOUNT',
    configuration: { maxAmount: 500 },
    priority: 1,
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesPolicyScope — enabled handling', () => {
  it('matches an enabled policy against an empty scope', () => {
    expect(matchesPolicyScope(policy(), {})).toBe(true);
  });

  it('excludes disabled policies by default', () => {
    expect(matchesPolicyScope(policy({ enabled: false }), {})).toBe(false);
  });

  it('includes disabled policies when includeDisabled is set', () => {
    expect(matchesPolicyScope(policy({ enabled: false }), { includeDisabled: true })).toBe(true);
  });
});

describe('matchesPolicyScope — agent scoping', () => {
  it('matches a global policy for any agent scope', () => {
    expect(matchesPolicyScope(policy({ agentId: null }), { agentId: 'ag_1' })).toBe(true);
    expect(matchesPolicyScope(policy(), { agentId: 'ag_1' })).toBe(true);
  });

  it('matches an agent-scoped policy only for its agent', () => {
    const scoped = policy({ agentId: 'ag_1' });
    expect(matchesPolicyScope(scoped, { agentId: 'ag_1' })).toBe(true);
    expect(matchesPolicyScope(scoped, { agentId: 'ag_2' })).toBe(false);
  });

  it('does not match an agent-scoped policy when the scope names no agent', () => {
    expect(matchesPolicyScope(policy({ agentId: 'ag_1' }), {})).toBe(false);
  });
});

describe('matchesPolicyScope — asset scoping', () => {
  it('matches a pinned-asset policy only for that asset (code-insensitive)', () => {
    const pinned = policy({ configuration: { asset: 'USDC' } });
    expect(matchesPolicyScope(pinned, { asset: 'USDC' })).toBe(true);
    expect(matchesPolicyScope(pinned, { asset: 'USDC:GABCDEFISSUER' })).toBe(true);
    expect(matchesPolicyScope(pinned, { asset: 'XLM' })).toBe(false);
  });

  it('matches an allowlist policy only for listed assets', () => {
    const listed = policy({ configuration: { allowedAssets: ['XLM', 'USDC'] } });
    expect(matchesPolicyScope(listed, { asset: 'XLM' })).toBe(true);
    expect(matchesPolicyScope(listed, { asset: 'EURC' })).toBe(false);
  });

  it('does not match a pinned-issuer policy for a different issuer', () => {
    const pinned = policy({ configuration: { allowedAssets: ['USDC:GTRUSTEDISSUER'] } });
    expect(matchesPolicyScope(pinned, { asset: 'USDC:GTRUSTEDISSUER' })).toBe(true);
    expect(matchesPolicyScope(pinned, { asset: 'USDC:GOTHERISSUER' })).toBe(false);
  });

  it('matches a bare-code allowlist entry for any issuer', () => {
    const listed = policy({ configuration: { allowedAssets: ['USDC'] } });
    expect(matchesPolicyScope(listed, { asset: 'USDC:GOTHERISSUER' })).toBe(true);
  });

  it('ignores asset constraints when the scope names no asset', () => {
    const listed = policy({ configuration: { allowedAssets: ['XLM'] } });
    expect(matchesPolicyScope(listed, {})).toBe(true);
  });

  it('blocked assets still apply (they report violations, not irrelevance)', () => {
    const blocked = policy({
      type: 'BLOCKED_ASSETS',
      configuration: { blockedAssets: ['EURC'] },
    });
    expect(matchesPolicyScope(blocked, { asset: 'EURC' })).toBe(true);
  });

  it('returns false for malformed inputs without throwing', () => {
    expect(matchesPolicyScope(null, {})).toBe(false);
    expect(matchesPolicyScope(policy(), null)).toBe(false);
    expect(matchesPolicyScope(undefined, undefined)).toBe(false);
  });
});

describe('matchPolicies', () => {
  const GLOBAL = policy({ id: 'pol_global', agentId: null });
  const AGENT_A = policy({ id: 'pol_a', agentId: 'ag_1' });
  const DISABLED = policy({ id: 'pol_off', enabled: false });

  it('selects applicable policies preserving order', () => {
    expect(matchPolicies([GLOBAL, AGENT_A, DISABLED], { agentId: 'ag_1' })).toEqual([
      GLOBAL,
      AGENT_A,
    ]);
  });

  it('drops agent-scoped policies for other agents', () => {
    expect(matchPolicies([GLOBAL, AGENT_A], { agentId: 'ag_2' })).toEqual([GLOBAL]);
  });

  it('returns [] for non-array input without throwing', () => {
    expect(matchPolicies(null, {})).toEqual([]);
    expect(matchPolicies(undefined, {})).toEqual([]);
    expect(matchPolicies([GLOBAL], null)).toEqual([]);
  });

  it('supports a custom matcher', () => {
    const onlyMaxAmount: PolicyMatcher = (candidate) => candidate?.type === 'MAX_AMOUNT';
    const other = policy({ id: 'pol_other', type: 'ALLOWED_ASSETS', configuration: {} });
    expect(matchPolicies([GLOBAL, other], {}, onlyMaxAmount)).toEqual([GLOBAL]);
  });

  it('treats a throwing matcher as a non-match', () => {
    const throwing: PolicyMatcher = () => {
      throw new Error('boom');
    };
    expect(matchPolicies([GLOBAL], {}, throwing)).toEqual([]);
  });
});

describe('combineMatchers', () => {
  const enabled: PolicyMatcher = (candidate) => candidate?.enabled === true;
  const isMax: PolicyMatcher = (candidate) => candidate?.type === 'MAX_AMOUNT';

  it('requires every matcher under "all"', () => {
    const combined = combineMatchers([enabled, isMax], 'all');
    expect(combined(policy(), {})).toBe(true);
    expect(combined(policy({ enabled: false }), {})).toBe(false);
    expect(combined(policy({ type: 'ALLOWED_ASSETS', configuration: {} }), {})).toBe(false);
  });

  it('requires any matcher under "any"', () => {
    const combined = combineMatchers([enabled, isMax], 'any');
    expect(combined(policy({ enabled: false }), {})).toBe(true);
    expect(
      combined(policy({ enabled: false, type: 'ALLOWED_ASSETS', configuration: {} }), {}),
    ).toBe(false);
  });

  it('follows vacuous-truth conventions for empty lists', () => {
    expect(combineMatchers([], 'all')(policy(), {})).toBe(true);
    expect(combineMatchers([], 'any')(policy(), {})).toBe(false);
    expect(combineMatchers(null, 'all')(policy(), {})).toBe(true);
  });
});
