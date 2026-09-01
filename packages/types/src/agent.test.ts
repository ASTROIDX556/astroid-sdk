import { describe, it, expect, expectTypeOf } from 'vitest';

import {
  AgentStatus,
  AgentRole,
  AGENT_STATUS_VALUES,
  isAgentStatus,
  isAgentRole,
  isAgentEntity,
  parseAgentEntity,
  normalizeCreateAgentDto,
  type AgentEntity,
  type CreateAgentDto,
  type UpdateAgentDto,
  type CreateAgentParams,
} from './index.js';

const validEntity: AgentEntity = {
  id: 'agt_1',
  organizationId: 'org_1',
  primaryWalletId: null,
  name: 'Treasury Bot',
  description: null,
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  role: AgentRole.FINANCE,
  status: AgentStatus.ACTIVE,
  capabilities: ['transfer', 'trade'],
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('@astroid/types — agent DTOs', () => {
  it('exposes AgentStatus / AgentRole enum values', () => {
    expect(AgentStatus.ACTIVE).toBe('ACTIVE');
    expect(AgentStatus.ARCHIVED).toBe('ARCHIVED');
    expect(AgentRole.FINANCE).toBe('FINANCE');
    expect(AGENT_STATUS_VALUES).toContain('PAUSED');
  });

  it('CreateAgentParams is structurally identical to CreateAgentDto', () => {
    expectTypeOf<CreateAgentParams>().toEqualTypeOf<CreateAgentDto>();
  });

  it('typechecks a minimal create payload', () => {
    const dto: CreateAgentDto = {
      name: 'Bot',
      capabilities: ['transfer'],
      initialBudget: { currency: 'USDC', amount: '100.00' },
    };
    expect(dto.name).toBe('Bot');
  });

  it('typechecks a partial update payload', () => {
    const patch: UpdateAgentDto = { status: AgentStatus.PAUSED };
    expect(patch.status).toBe('PAUSED');
  });

  it('isAgentStatus / isAgentRole narrow unknown values', () => {
    expect(isAgentStatus('ACTIVE')).toBe(true);
    expect(isAgentStatus('NOPE')).toBe(false);
    expect(isAgentStatus(42)).toBe(false);
    expect(isAgentRole('OPERATIONS')).toBe(true);
    expect(isAgentRole('operations')).toBe(false);
  });

  it('isAgentEntity accepts a well-formed entity and rejects malformed ones', () => {
    expect(isAgentEntity(validEntity)).toBe(true);
    expect(isAgentEntity({ ...validEntity, status: 'BOGUS' })).toBe(false);
    expect(isAgentEntity({ ...validEntity, capabilities: [1, 2] })).toBe(false);
    expect(isAgentEntity(null)).toBe(false);
    expect(isAgentEntity('agt_1')).toBe(false);
  });

  it('parseAgentEntity round-trips JSON and throws on bad input', () => {
    const json = JSON.stringify(validEntity);
    const parsed = parseAgentEntity(json);
    expect(parsed).toEqual(validEntity);
    expect(parseAgentEntity(validEntity)).toEqual(validEntity);
    expect(() => parseAgentEntity('{"id":"x"}')).toThrow(TypeError);
    expect(() => parseAgentEntity('not json')).toThrow();
  });

  it('normalizeCreateAgentDto trims strings and drops undefined optionals', () => {
    const out = normalizeCreateAgentDto({
      name: '  Bot  ',
      capabilities: [' transfer ', '', 'trade'],
      initialBudget: { currency: ' USDC ', amount: 100 as unknown as string },
      description: '  does things  ',
    });
    expect(out).toEqual({
      name: 'Bot',
      capabilities: ['transfer', 'trade'],
      initialBudget: { currency: 'USDC', amount: '100' },
      description: 'does things',
    });
    expect('role' in out).toBe(false);
  });
});
