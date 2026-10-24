import { describe, expect, expectTypeOf, it } from 'vitest';

import { ValidationError } from '@astroid/errors';

import {
  PolicyBuilder,
  PolicyRuleBuilder,
  assertValidPolicyRule,
  isValidPolicyAddress,
  isValidPolicyAsset,
  policy,
  validatePolicyRule,
  type PolicyDraft,
  type PolicyRuleBuilderOptions,
  type PolicyRuleBuildResult,
  type PolicyRuleValidationResult,
} from '../src/builder.js';
import { PolicyRuleBuilder as ExportedPolicyRuleBuilder } from '../src/index.js';
import { PolicyCreateInputSchema } from '../src/schemas.js';

/** A format-valid Stellar public key (`G` + 55 base-32 chars). */
const ADDRESS_A = `G${'A'.repeat(55)}`;
const ADDRESS_B = `G${'B'.repeat(55)}`;
const ISSUER = `G${'C'.repeat(55)}`;

/** Run `fn` expecting a structured ValidationError, and return it. */
function captureValidationError(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error('Expected a ValidationError, but the function returned normally.');
}

describe('PolicyBuilder', () => {
  it('builds a single-condition rule and infers its type', () => {
    const draft = new PolicyBuilder('Max transfer').maxAmount(500).build();

    expect(draft).toEqual({
      name: 'Max transfer',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 500 },
      priority: 1,
      enabled: true,
    });
  });

  it('infers COMPOSITE when several rule families are configured', () => {
    const draft = PolicyBuilder.create('Treasury guardrails')
      .allowDestinations(ADDRESS_A, ADDRESS_B)
      .allowAssets('XLM', `USDC:${ISSUER}`)
      .maxAmount(1_000)
      .dailyLimit(5_000)
      .build();

    expect(draft.type).toBe('COMPOSITE');
    expect(draft.configuration.allowedRecipients).toEqual([ADDRESS_A, ADDRESS_B]);
    expect(draft.configuration.allowedAssets).toEqual(['XLM', `USDC:${ISSUER}`]);
    expect(draft.configuration.maxAmount).toBe(1_000);
    expect(draft.configuration.dailyLimit).toBe(5_000);
  });

  it('honours an explicit type override', () => {
    const draft = new PolicyBuilder({ name: 'Custom', type: 'AGENT_RULE' })
      .forAgent('agent_123')
      .maxAmount(10)
      .build();

    expect(draft.type).toBe('AGENT_RULE');
    expect(draft.agentId).toBe('agent_123');
  });

  it('supports the policy() factory alias', () => {
    const draft = policy('Alias').maxAmount(1).build();
    expect(draft.name).toBe('Alias');
  });

  it('carries priority, enabled and description through build()', () => {
    const draft = new PolicyBuilder('Scoped')
      .withDescription('Desc')
      .withPriority(7)
      .enabled(false)
      .minAmount(2)
      .build();

    expect(draft.description).toBe('Desc');
    expect(draft.priority).toBe(7);
    expect(draft.enabled).toBe(false);
  });

  it('rejects invalid destinations during rule construction', () => {
    expect(() => new PolicyBuilder('Bad').allowDestination('not-a-key')).toThrowError(
      ValidationError,
    );
    try {
      new PolicyBuilder('Bad').denyDestination('nope');
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect((err as ValidationError).code).toBe('INVALID_POLICY_ADDRESS');
    }
  });

  it('rejects invalid assets', () => {
    expect(() => new PolicyBuilder('Bad').allowAsset('USDC:not-an-issuer')).toThrowError(
      ValidationError,
    );
    expect(() => new PolicyBuilder('Bad').denyAsset('')).toThrowError(ValidationError);
  });

  it('rejects non-positive amounts', () => {
    expect(() => new PolicyBuilder('Bad').maxAmount(0)).toThrowError(ValidationError);
    expect(() => new PolicyBuilder('Bad').dailyLimit(-5)).toThrowError(ValidationError);
  });

  it('rejects an unordered time window', () => {
    expect(() =>
      new PolicyBuilder('Window').timeWindow({
        start: '2026-12-31T00:00:00.000Z',
        end: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrowError(ValidationError);

    const draft = new PolicyBuilder('Window')
      .timeWindow({ start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' })
      .build();
    expect(draft.type).toBe('TIME_WINDOW');
  });

  it('throws on build() with no conditions and no explicit type', () => {
    expect(() => new PolicyBuilder('Empty').build()).toThrowError(ValidationError);
  });

  it('supports restrictAsset and restrictAssets fluent methods', () => {
    const draft = new PolicyBuilder('Asset policy')
      .restrictAsset('XLM')
      .restrictAssets(`USDC:${ISSUER}`)
      .build();

    expect(draft.type).toBe('ALLOWED_ASSETS');
    expect(draft.configuration.allowedAssets).toEqual(['XLM', `USDC:${ISSUER}`]);
  });

  it('supports requiresApproval', () => {
    const draft = new PolicyBuilder('Approval required')
      .maxAmount(1000)
      .requiresApproval()
      .build();

    expect(draft.configuration.requiresApproval).toBe(true);
  });

  it('provides validate() and isValid() to inspect validity before building', () => {
    const emptyBuilder = new PolicyBuilder('');
    expect(emptyBuilder.isValid()).toBe(false);
    const issues = emptyBuilder.validate();
    expect(issues.some((i) => i.field === 'name')).toBe(true);
    expect(issues.some((i) => i.field === 'type')).toBe(true);

    const validBuilder = new PolicyBuilder('Valid rule').maxAmount(50);
    expect(validBuilder.isValid()).toBe(true);
    expect(validBuilder.validate()).toEqual([]);
  });

  it('rejects a minAmount greater than maxAmount', () => {
    expect(() => new PolicyBuilder('Bad').maxAmount(10).minAmount(20)).toThrowError(
      ValidationError,
    );
  });
});

describe('policy validation utilities', () => {
  it('validates address and asset formats', () => {
    expect(isValidPolicyAddress(ADDRESS_A)).toBe(true);
    expect(isValidPolicyAddress('lowercase')).toBe(false);
    expect(isValidPolicyAsset('XLM')).toBe(true);
    expect(isValidPolicyAsset('USDC')).toBe(true);
    expect(isValidPolicyAsset(`USDC:${ISSUER}`)).toBe(true);
    expect(isValidPolicyAsset('TOO-LONG-CODE')).toBe(false);
    expect(isValidPolicyAsset(`USDC:${ADDRESS_A}:extra`)).toBe(false);
  });

  it('reports every issue without throwing', () => {
    const draft: PolicyDraft = {
      name: '',
      type: 'ALLOWED_ASSETS',
      configuration: {
        allowedAssets: ['bad asset'],
        maxAmount: -1,
      },
      priority: 1,
      enabled: true,
    };

    const issues = validatePolicyRule(draft);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.map((i) => i.field)).toContain('name');
    expect(issues.map((i) => i.field)).toContain('configuration.maxAmount');
  });

  it('assertValidPolicyRule throws a structured ValidationError', () => {
    const draft: PolicyDraft = {
      name: 'Broken',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 0 },
      priority: 1,
      enabled: true,
    };

    try {
      assertValidPolicyRule(draft);
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('INVALID_POLICY_RULE');
    }
  });

  it('returns a valid draft unchanged', () => {
    const draft: PolicyDraft = {
      name: 'Valid',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 100 },
      priority: 1,
      enabled: true,
    };
    expect(assertValidPolicyRule(draft)).toBe(draft);
    expect(validatePolicyRule(draft)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* PolicyRuleBuilder                                                           */
/* -------------------------------------------------------------------------- */

/** A fully configured builder used by the serialization tests. */
function fullBuilder(): PolicyRuleBuilder {
  return new PolicyRuleBuilder('Treasury guardrails')
    .withDescription('Payroll')
    .forAgent('agent_123')
    .allowDestination(ADDRESS_A, ADDRESS_B)
    .allowAsset('XLM', `USDC:${ISSUER}`)
    .maxAmount(500)
    .dailyLimit(2_500)
    .requireApproval();
}

describe('PolicyRuleBuilder — serialization', () => {
  it('serializes a fully configured rule to the expected payload', () => {
    expect(fullBuilder().build()).toEqual({
      name: 'Treasury guardrails',
      description: 'Payroll',
      agentId: 'agent_123',
      type: 'COMPOSITE',
      configuration: {
        allowedRecipients: [ADDRESS_A, ADDRESS_B],
        allowedAssets: ['XLM', `USDC:${ISSUER}`],
        maxAmount: 500,
        dailyLimit: 2_500,
        requiresApproval: true,
      },
      priority: 1,
      enabled: true,
    });
  });

  it('supports JSON.stringify through toJSON', () => {
    const builder = fullBuilder();
    expect(JSON.parse(JSON.stringify(builder))).toEqual(builder.build());
  });

  it('returns a new builder from every chainable call', () => {
    const base = new PolicyRuleBuilder('Chain');
    expect(base.maxAmount(1)).not.toBe(base);
    expect(base.maxAmount(1)).toBeInstanceOf(PolicyRuleBuilder);
    expect(base.withDescription('d')).toBeInstanceOf(PolicyRuleBuilder);
    expect(base.allowDestination(ADDRESS_A)).toBeInstanceOf(PolicyRuleBuilder);
    expect(base.requireApproval()).toBeInstanceOf(PolicyRuleBuilder);
  });

  it('produces the same payload regardless of method order', () => {
    const first = new PolicyRuleBuilder('Order')
      .allowDestination(ADDRESS_A, ADDRESS_B)
      .maxAmount(100);
    const second = new PolicyRuleBuilder('Order')
      .maxAmount(100)
      .allowDestination(ADDRESS_A)
      .allowDestination(ADDRESS_B);

    expect(first.build()).toEqual(second.build());
  });

  it('keeps PolicyBuilder as a working alias', () => {
    expect(PolicyBuilder).toBe(PolicyRuleBuilder);
    const draft = new PolicyBuilder('Alias').maxAmount(1).build();
    expect(draft.type).toBe('MAX_AMOUNT');
    expect(draft.configuration.maxAmount).toBe(1);
  });
});

describe('PolicyRuleBuilder — destination whitelists', () => {
  it('accumulates repeated calls and multiple arguments', () => {
    const rule = new PolicyRuleBuilder('Whitelist')
      .allowDestination(ADDRESS_A)
      .allowDestination(ADDRESS_B, ADDRESS_A)
      .build();

    expect(rule.type).toBe('ALLOWED_RECIPIENTS');
    expect(rule.configuration.allowedRecipients).toEqual([ADDRESS_A, ADDRESS_B]);
  });

  it('deduplicates addresses and trims surrounding whitespace', () => {
    const rule = new PolicyRuleBuilder('Dedupe')
      .allowDestination(` ${ADDRESS_A} `, ADDRESS_A, ADDRESS_B)
      .build();

    expect(rule.configuration.allowedRecipients).toEqual([ADDRESS_A, ADDRESS_B]);
  });

  it('keeps allowed and blocked lists separate', () => {
    const rule = new PolicyRuleBuilder('Lists')
      .allowDestination(ADDRESS_A)
      .denyDestination(ADDRESS_B)
      .build();

    expect(rule.configuration.allowedRecipients).toEqual([ADDRESS_A]);
    expect(rule.configuration.blockedRecipients).toEqual([ADDRESS_B]);
    expect(rule.type).toBe('COMPOSITE');
  });

  it('does not create an empty whitelist when called with no addresses', () => {
    const base = new PolicyRuleBuilder('Noop').maxAmount(1);
    expect(base.allowDestination().build()).toEqual(base.build());
  });

  it('rejects malformed addresses and names the field', () => {
    const error = captureValidationError(() =>
      new PolicyRuleBuilder('Bad').allowDestination('not-a-key'),
    );
    expect(error.code).toBe('INVALID_POLICY_ADDRESS');
    expect(error.message).toContain('allowedRecipients');
    expect(error.message).toContain('Stellar public key');

    const blocked = captureValidationError(() =>
      new PolicyRuleBuilder('Bad').denyDestination(ADDRESS_A.slice(0, -1)),
    );
    expect(blocked.message).toContain('blockedRecipients');
  });
});

describe('PolicyRuleBuilder — amounts', () => {
  it('accepts valid seven-decimal limits', () => {
    const rule = new PolicyRuleBuilder('Limits')
      .maxAmount(0.1234567)
      .minAmount(0.0000001)
      .dailyLimit(1)
      .weeklyLimit(2)
      .monthlyLimit(3)
      .build();

    expect(rule.configuration).toMatchObject({
      maxAmount: 0.1234567,
      minAmount: 0.0000001,
      dailyLimit: 1,
      weeklyLimit: 2,
      monthlyLimit: 3,
    });
    expect(rule.type).toBe('COMPOSITE');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid maxAmount %s',
    (amount) => {
      const error = captureValidationError(() => new PolicyRuleBuilder('Bad').maxAmount(amount));
      expect(error.code).toBe('INVALID_POLICY_AMOUNT');
      expect(error.message).toContain('maxAmount');
      expect(error.message).toContain('positive finite number');
    },
  );

  it.each([
    ['an empty string', ''],
    ['a numeric string', '100'],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s passed as an amount', (_label, amount) => {
    const error = captureValidationError(() =>
      new PolicyRuleBuilder('Bad').maxAmount(amount as unknown as number),
    );
    expect(error.code).toBe('INVALID_POLICY_AMOUNT');
    expect(error.message).toContain('maxAmount');
  });

  it('rejects amounts with more than seven decimal places', () => {
    const error = captureValidationError(() => new PolicyRuleBuilder('Bad').maxAmount(0.12345678));
    expect(error.code).toBe('INVALID_POLICY_AMOUNT');
    expect(error.message).toContain('maxAmount');
    expect(error.message).toContain('at most 7 decimal places');
    expect(error.message).toContain('received 8');
  });

  const invalidLimitCalls: Array<
    readonly [string, (builder: PolicyRuleBuilder) => PolicyRuleBuilder]
  > = [
    ['maxAmount', (builder) => builder.maxAmount(0)],
    ['minAmount', (builder) => builder.minAmount(-1)],
    ['dailyLimit', (builder) => builder.dailyLimit(Number.NaN)],
    ['weeklyLimit', (builder) => builder.weeklyLimit(0)],
    ['monthlyLimit', (builder) => builder.monthlyLimit(-5)],
  ];

  it.each(invalidLimitCalls)('rejects an invalid %s and names the field', (field, apply) => {
    const error = captureValidationError(() => apply(new PolicyRuleBuilder('Bad')));
    expect(error.message).toContain(field);
  });

  it('rejects a minAmount greater than maxAmount', () => {
    const error = captureValidationError(() =>
      new PolicyRuleBuilder('Bad').maxAmount(10).minAmount(20),
    );
    expect(error.code).toBe('INVALID_POLICY_AMOUNT');
    expect(error.message).toContain('minAmount');
    expect(error.message).toContain('maxAmount');
  });
});

describe('PolicyRuleBuilder — approval settings', () => {
  it('requires approval by default', () => {
    const rule = new PolicyRuleBuilder('Approval').maxAmount(1).requireApproval().build();
    expect(rule.configuration.requiresApproval).toBe(true);
    expect(rule.configuration.requiredSignatures).toBeUndefined();
  });

  it('can explicitly disable approval', () => {
    const rule = new PolicyRuleBuilder('Approval').maxAmount(1).requireApproval(false).build();
    expect(rule.configuration.requiresApproval).toBe(false);
  });

  it('stores a signing threshold alongside approval', () => {
    const rule = new PolicyRuleBuilder('Approval').maxAmount(1).requireApproval(true, 2).build();
    expect(rule.configuration.requiresApproval).toBe(true);
    expect(rule.configuration.requiredSignatures).toBe(2);
  });

  it('supports the requiredSignatures method', () => {
    const rule = new PolicyRuleBuilder('Approval')
      .maxAmount(1)
      .requiredSignatures(3)
      .requireApproval()
      .build();
    expect(rule.configuration.requiredSignatures).toBe(3);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid requiredSignatures %s',
    (count) => {
      const error = captureValidationError(() =>
        new PolicyRuleBuilder('Bad').requiredSignatures(count),
      );
      expect(error.code).toBe('INVALID_POLICY_APPROVAL');
      expect(error.message).toContain('requiredSignatures');
      expect(error.message).toContain('positive integer');
    },
  );

  it('reports contradictory approval settings from validate and build', () => {
    const builder = new PolicyRuleBuilder('Contradiction')
      .maxAmount(10)
      .requireApproval(false)
      .requiredSignatures(2);

    const result = builder.validate();
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain('configuration.requiredSignatures');
    expect(result.issues.some((issue) => issue.message.includes('requiresApproval is false'))).toBe(
      true,
    );
    expect(() => builder.build()).toThrowError(/requiresApproval is false/);
  });

  it('rejects a non-boolean approval flag at runtime', () => {
    const error = captureValidationError(() =>
      new PolicyRuleBuilder('Bad').requireApproval(1 as unknown as boolean),
    );
    expect(error.code).toBe('INVALID_POLICY_APPROVAL');
    expect(error.message).toContain('requiresApproval');
  });
});

describe('PolicyRuleBuilder — incomplete rules', () => {
  it('validate reports name, type and condition issues for an empty builder', () => {
    const result = new PolicyRuleBuilder().validate();
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['name', 'type', 'configuration']),
    );
  });

  it('validate reports missing type and conditions for a named builder', () => {
    const result = new PolicyRuleBuilder('Incomplete').validate();
    expect(result.valid).toBe(false);
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['type', 'configuration']));
    expect(fields).not.toContain('name');
  });

  it('build throws one ValidationError listing every issue', () => {
    const error = captureValidationError(() => new PolicyRuleBuilder().build());
    expect(error.code).toBe('INVALID_POLICY_RULE');
    expect(error.message).toContain('name:');
    expect(error.message).toContain('type:');
    expect(error.message).toContain('configuration:');
  });

  it('rejects a typed limit without its amount', () => {
    const incomplete = new PolicyRuleBuilder({ name: 'Limit', type: 'MAX_AMOUNT' });
    const result = incomplete.validate();
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain('configuration.maxAmount');
    expect(
      result.issues.some((issue) => issue.message.includes('MAX_AMOUNT requires maxAmount')),
    ).toBe(true);
    expect(() => incomplete.build()).toThrowError(/requires maxAmount/);
  });

  it('safeBuild reports problems without throwing and returns the rule when valid', () => {
    const invalid = new PolicyRuleBuilder('Bad').safeBuild();
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error('Expected safeBuild to report issues.');
    expect(invalid.issues.length).toBeGreaterThan(0);

    const valid = new PolicyRuleBuilder('Good').maxAmount(1).safeBuild();
    expect(valid.valid).toBe(true);
    if (!valid.valid) throw new Error('Expected safeBuild to succeed.');
    expect(valid.rule.type).toBe('MAX_AMOUNT');
    expect(valid.rule.configuration.maxAmount).toBe(1);
  });

  it('toJSON throws for an invalid builder', () => {
    expect(() => JSON.stringify(new PolicyRuleBuilder())).toThrowError(ValidationError);
  });
});

describe('PolicyRuleBuilder — immutability and snapshots', () => {
  it('does not mutate the receiver when chaining', () => {
    const base = new PolicyRuleBuilder('Base').maxAmount(10);
    const extended = base.allowDestination(ADDRESS_A);

    expect(base.build()).toEqual({
      name: 'Base',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 10 },
      priority: 1,
      enabled: true,
    });
    expect(extended.build().configuration.allowedRecipients).toEqual([ADDRESS_A]);
  });

  it('returns independent drafts from repeated build calls', () => {
    const builder = new PolicyRuleBuilder('Snapshot').allowDestination(ADDRESS_A);
    const first = builder.build();
    const second = builder.build();

    expect(first.configuration.allowedRecipients).not.toBe(second.configuration.allowedRecipients);
    first.configuration.allowedRecipients?.push(ADDRESS_B);
    expect(second.configuration.allowedRecipients).toEqual([ADDRESS_A]);
  });

  it('copies caller arrays passed via spread', () => {
    const addresses = [ADDRESS_A];
    const rule = new PolicyRuleBuilder('Args').allowDestination(...addresses).build();

    addresses.push(ADDRESS_B);
    expect(rule.configuration.allowedRecipients).toEqual([ADDRESS_A]);
  });

  it('leaves previously built drafts unchanged when continuing a chain', () => {
    const base = new PolicyRuleBuilder('Chain').maxAmount(10);
    const first = base.build();
    const second = base.allowDestination(ADDRESS_A).build();

    expect(first.configuration.allowedRecipients).toBeUndefined();
    expect(second.configuration.allowedRecipients).toEqual([ADDRESS_A]);
  });
});

describe('PolicyRuleBuilder — type surface', () => {
  it('exposes strict chain and terminal types', () => {
    expectTypeOf(new PolicyRuleBuilder('x').maxAmount(1)).toEqualTypeOf<PolicyRuleBuilder>();
    expectTypeOf(
      new PolicyRuleBuilder('x').allowDestination(ADDRESS_A),
    ).toEqualTypeOf<PolicyRuleBuilder>();
    expectTypeOf(new PolicyRuleBuilder('x').requireApproval()).toEqualTypeOf<PolicyRuleBuilder>();
    expectTypeOf<ReturnType<PolicyRuleBuilder['build']>>().toEqualTypeOf<PolicyDraft>();
    expectTypeOf(new PolicyRuleBuilder('x').validate()).toEqualTypeOf<PolicyRuleValidationResult>();
    expectTypeOf(new PolicyRuleBuilder('x').safeBuild()).toEqualTypeOf<PolicyRuleBuildResult>();
    expectTypeOf(PolicyRuleBuilder.create('x')).toEqualTypeOf<PolicyRuleBuilder>();
    expectTypeOf(policy('x')).toEqualTypeOf<PolicyRuleBuilder>();

    const options: PolicyRuleBuilderOptions = { name: 'x', priority: 2 };
    expectTypeOf(options).toMatchTypeOf<PolicyRuleBuilderOptions>();
  });
});

describe('PolicyRuleBuilder — schema integration', () => {
  it('is exported from the package entrypoint', () => {
    expect(ExportedPolicyRuleBuilder).toBe(PolicyRuleBuilder);
  });

  it('produces a payload accepted by the package schema', () => {
    const rule = new PolicyRuleBuilder('Schema')
      .maxAmount(100)
      .allowDestination(ADDRESS_A)
      .requireApproval(true, 1)
      .build();

    const parsed = PolicyCreateInputSchema.safeParse(rule);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('Expected the built rule to satisfy the schema.');
    expect(parsed.data).toEqual(rule);
  });

  it('produces JSON accepted by the schema', () => {
    const builder = new PolicyRuleBuilder('JSON schema').maxAmount(5);
    const parsed = PolicyCreateInputSchema.safeParse(JSON.parse(JSON.stringify(builder)));
    expect(parsed.success).toBe(true);
  });
});
