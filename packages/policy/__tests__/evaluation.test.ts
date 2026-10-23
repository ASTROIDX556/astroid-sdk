/**
 * Tests for the local policy evaluation engine (issue #17):
 * `evaluatePolicy` and its helpers in `src/evaluation.ts`.
 *
 * Covers destination allow/deny lists (including case and federation
 * variations), time-of-day windows (including wrap-around, timezones and
 * weekdays), signature weight thresholds, the detailed per-check reporting
 * contract, and the `Policy` → `PolicySet` adapter.
 */

import { describe, expect, it } from 'vitest';

import type { Policy, PolicySet, TransactionDetails } from '@astroid/types';

import {
  addressesMatch,
  evaluatePolicy,
  isActionWithinAllowedHours,
  normalizeAddress,
  policySetFromPolicies,
  resolveSignedWeight,
} from '../src/evaluation.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ALPHA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BETA = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const GAMMA = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

const MONDAY_NOON = '2026-09-28T12:00:00.000Z'; // Monday, 12:00 UTC

function tx(overrides: Partial<TransactionDetails> = {}): TransactionDetails {
  return {
    asset: 'USDC',
    amount: '100',
    recipientAddress: ALPHA,
    timestamp: MONDAY_NOON,
    ...overrides,
  };
}

/** Build a minimal `Policy` fixture for the adapter tests. */
function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'pol_1',
    organizationId: 'org_1',
    name: 'Policy',
    type: 'ALLOWED_RECIPIENTS',
    configuration: {},
    priority: 1,
    enabled: true,
    createdAt: MONDAY_NOON,
    updatedAt: MONDAY_NOON,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* normalizeAddress / addressesMatch                                           */
/* -------------------------------------------------------------------------- */

describe('normalizeAddress', () => {
  it('upper-cases Stellar strkeys and trims whitespace', () => {
    expect(normalizeAddress(`  ${ALPHA.toLowerCase()}  `)).toBe(ALPHA);
  });

  it('lower-cases both halves of a federated address', () => {
    expect(normalizeAddress('Alice*Example.COM')).toBe('alice*example.com');
  });

  it('returns an empty string for blank or non-string input', () => {
    expect(normalizeAddress('   ')).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress(null)).toBe('');
  });
});

describe('addressesMatch', () => {
  it('matches Stellar addresses case-insensitively', () => {
    expect(addressesMatch(ALPHA, ALPHA.toLowerCase())).toBe(true);
    expect(addressesMatch(ALPHA, BETA)).toBe(false);
  });

  it('matches federated addresses case-insensitively', () => {
    expect(addressesMatch('alice*example.com', 'ALICE*EXAMPLE.COM')).toBe(true);
    expect(addressesMatch('alice*example.com', 'bob*example.com')).toBe(false);
  });

  it('never matches a blank address, even against another blank', () => {
    expect(addressesMatch('', '')).toBe(false);
    expect(addressesMatch(undefined, '')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* resolveSignedWeight                                                         */
/* -------------------------------------------------------------------------- */

describe('resolveSignedWeight', () => {
  it('sums declared weights, defaulting each signature to 1', () => {
    expect(
      resolveSignedWeight(tx({ signatures: [{ signer: ALPHA }, { signer: BETA, weight: 3 }] })),
    ).toBe(4);
  });

  it('prefers an explicit signedWeight over the signature list', () => {
    expect(resolveSignedWeight(tx({ signatures: [{ signer: ALPHA }], signedWeight: 7 }))).toBe(7);
  });

  it('ignores non-finite and negative weights', () => {
    expect(
      resolveSignedWeight(
        tx({
          signatures: [
            { signer: ALPHA, weight: -5 },
            { signer: BETA, weight: Number.NaN },
            { signer: GAMMA },
          ],
        }),
      ),
    ).toBe(1);
  });

  it('returns 0 for a payload with no signatures', () => {
    expect(resolveSignedWeight(tx())).toBe(0);
    expect(resolveSignedWeight(null)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* isActionWithinAllowedHours                                                  */
/* -------------------------------------------------------------------------- */

describe('isActionWithinAllowedHours', () => {
  const at = (iso: string): Date => new Date(iso);

  it('uses inclusive start and exclusive end hours', () => {
    const window = { startHour: 9, endHour: 17 };
    expect(isActionWithinAllowedHours(window, at('2026-09-28T09:00:00.000Z'))).toBe(true);
    expect(isActionWithinAllowedHours(window, at('2026-09-28T16:59:00.000Z'))).toBe(true);
    expect(isActionWithinAllowedHours(window, at('2026-09-28T17:00:00.000Z'))).toBe(false);
    expect(isActionWithinAllowedHours(window, at('2026-09-28T08:59:00.000Z'))).toBe(false);
  });

  it('supports windows that wrap past midnight', () => {
    const window = { startHour: 22, endHour: 6 };
    expect(isActionWithinAllowedHours(window, at('2026-09-28T23:30:00.000Z'))).toBe(true);
    expect(isActionWithinAllowedHours(window, at('2026-09-28T02:00:00.000Z'))).toBe(true);
    expect(isActionWithinAllowedHours(window, at('2026-09-28T12:00:00.000Z'))).toBe(false);
  });

  it('treats an equal start/end as the whole day', () => {
    expect(isActionWithinAllowedHours({ startHour: 0, endHour: 0 }, at(MONDAY_NOON))).toBe(true);
  });

  it('resolves the hour in the configured timezone', () => {
    const instant = at('2026-09-28T01:30:00.000Z'); // 21:30 Sunday in New York
    expect(
      isActionWithinAllowedHours(
        { startHour: 20, endHour: 23, timezone: 'America/New_York' },
        instant,
      ),
    ).toBe(true);
    expect(isActionWithinAllowedHours({ startHour: 20, endHour: 23 }, instant)).toBe(false);
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(
      isActionWithinAllowedHours(
        { startHour: 11, endHour: 13, timezone: 'Not/AZone' },
        at(MONDAY_NOON),
      ),
    ).toBe(true);
  });

  it('restricts evaluation to the configured weekdays', () => {
    const window = { startHour: 0, endHour: 0, days: [1, 2] }; // Monday, Tuesday
    expect(isActionWithinAllowedHours(window, at(MONDAY_NOON))).toBe(true);
    expect(isActionWithinAllowedHours(window, at('2026-09-27T12:00:00.000Z'))).toBe(false); // Sunday
  });

  it('does not enforce a malformed window', () => {
    expect(
      isActionWithinAllowedHours(
        { startHour: Number.NaN, endHour: 5 } as unknown as { startHour: number; endHour: number },
        at(MONDAY_NOON),
      ),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* evaluatePolicy — address restrictions                                       */
/* -------------------------------------------------------------------------- */

describe('evaluatePolicy — destination allowlists', () => {
  const policySet: PolicySet = {
    rules: [{ name: 'Treasury allowlist', allowedRecipients: [ALPHA, BETA] }],
  };

  it('passes when the destination is on the allowlist', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: BETA }));
    expect(result.allowed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      rule: 'Treasury allowlist',
      check: 'address',
      success: true,
    });
  });

  it('passes case-insensitively', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: ALPHA.toLowerCase() }));
    expect(result.allowed).toBe(true);
  });

  it('passes for a federated address regardless of case', () => {
    const federated: PolicySet = {
      rules: [{ name: 'Federation allowlist', allowedRecipients: ['payments*example.com'] }],
    };
    const result = evaluatePolicy(federated, tx({ recipientAddress: 'Payments*Example.com' }));
    expect(result.allowed).toBe(true);
  });

  it('fails when the destination is not on the allowlist, naming it', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: GAMMA }));
    expect(result.allowed).toBe(false);
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.explanation).toContain(GAMMA);
    expect(result.failedRuleNames).toEqual(['Treasury allowlist']);
  });

  it('fails when an allowlist applies but no recipient was supplied', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: undefined }));
    expect(result.allowed).toBe(false);
    expect(result.results[0]?.explanation).toMatch(/recipient address is required/i);
  });
});

describe('evaluatePolicy — destination denylists', () => {
  const policySet: PolicySet = {
    rules: [{ name: 'Blocked destinations', blockedRecipients: [GAMMA] }],
  };

  it('fails when the destination is blocklisted', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: GAMMA.toLowerCase() }));
    expect(result.allowed).toBe(false);
    expect(result.results[0]?.explanation?.toUpperCase()).toContain(GAMMA);
  });

  it('fails for a blocklisted federated destination', () => {
    const result = evaluatePolicy(
      { rules: [{ name: 'Federation denylist', blockedRecipients: ['bad*example.com'] }] },
      tx({ recipientAddress: 'BAD*example.com' }),
    );
    expect(result.allowed).toBe(false);
  });

  it('passes when the destination is not blocklisted', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: ALPHA }));
    expect(result.allowed).toBe(true);
  });

  it('passes when no destination is supplied (nothing to block)', () => {
    const result = evaluatePolicy(policySet, tx({ recipientAddress: undefined }));
    expect(result.allowed).toBe(true);
  });

  it('reports the allowlist and denylist checks separately', () => {
    const result = evaluatePolicy(
      {
        rules: [
          {
            name: 'Both lists',
            allowedRecipients: [ALPHA, BETA],
            blockedRecipients: [GAMMA],
          },
        ],
      },
      tx({ recipientAddress: ALPHA }),
    );

    expect(result.allowed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.check === 'address' && r.success)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* evaluatePolicy — timing restrictions                                        */
/* -------------------------------------------------------------------------- */

describe('evaluatePolicy — timing restrictions', () => {
  const policySet: PolicySet = {
    rules: [{ name: 'Business hours', allowedHours: { startHour: 9, endHour: 17 } }],
  };

  it('passes when the action falls inside the window', () => {
    const result = evaluatePolicy(policySet, tx({ timestamp: '2026-09-28T10:00:00.000Z' }));
    expect(result.allowed).toBe(true);
    expect(result.results[0]).toMatchObject({
      rule: 'Business hours',
      check: 'time',
      success: true,
    });
  });

  it('fails when the action falls outside the window, explaining the hours', () => {
    const result = evaluatePolicy(policySet, tx({ timestamp: '2026-09-28T20:00:00.000Z' }));
    expect(result.allowed).toBe(false);
    expect(result.results[0]?.explanation).toContain('9:00–17:00');
    expect(result.results[0]?.explanation).toContain('outside the allowed hours');
  });

  it('uses options.now when the payload carries no timestamp', () => {
    const inside = evaluatePolicy(policySet, tx({ timestamp: undefined }), {
      now: '2026-09-28T12:00:00.000Z',
    });
    expect(inside.allowed).toBe(true);

    const outside = evaluatePolicy(policySet, tx({ timestamp: undefined }), {
      now: '2026-09-28T03:00:00.000Z',
    });
    expect(outside.allowed).toBe(false);
  });

  it('honours wrap-around windows through evaluatePolicy', () => {
    const overnight: PolicySet = {
      rules: [{ name: 'Overnight', allowedHours: { startHour: 22, endHour: 6 } }],
    };
    expect(evaluatePolicy(overnight, tx({ timestamp: '2026-09-28T23:00:00.000Z' })).allowed).toBe(
      true,
    );
    expect(evaluatePolicy(overnight, tx({ timestamp: '2026-09-28T12:00:00.000Z' })).allowed).toBe(
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* evaluatePolicy — signature thresholds                                       */
/* -------------------------------------------------------------------------- */

describe('evaluatePolicy — signature thresholds', () => {
  const policySet: PolicySet = {
    rules: [{ name: 'Multisig', requiredSignatures: 3 }],
  };

  it('passes when the collected weight meets the threshold exactly', () => {
    const result = evaluatePolicy(
      policySet,
      tx({ signatures: [{ signer: ALPHA, weight: 2 }, { signer: BETA }] }),
    );
    expect(result.allowed).toBe(true);
    expect(result.results[0]).toMatchObject({
      rule: 'Multisig',
      check: 'signatures',
      success: true,
    });
  });

  it('passes when the collected weight exceeds the threshold', () => {
    const result = evaluatePolicy(policySet, tx({ signedWeight: 10 }));
    expect(result.allowed).toBe(true);
  });

  it('fails when the collected weight is below the threshold, reporting both values', () => {
    const result = evaluatePolicy(policySet, tx({ signatures: [{ signer: ALPHA }] }));
    expect(result.allowed).toBe(false);
    expect(result.results[0]?.explanation).toContain('weight 1');
    expect(result.results[0]?.explanation).toContain('threshold 3');
  });

  it('fails a signature policy when no signatures are present', () => {
    const result = evaluatePolicy(policySet, tx());
    expect(result.allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* evaluatePolicy — reporting contract & robustness                            */
/* -------------------------------------------------------------------------- */

describe('evaluatePolicy — reporting', () => {
  it('reports every rule in declaration order with its name and state', () => {
    const result = evaluatePolicy(
      {
        rules: [
          { name: 'Allowlist', allowedRecipients: [ALPHA] },
          { name: 'Business hours', allowedHours: { startHour: 9, endHour: 17 } },
          { name: 'Multisig', requiredSignatures: 2 },
        ],
      },
      tx({
        recipientAddress: ALPHA,
        timestamp: '2026-09-28T10:00:00.000Z',
        signatures: [{ signer: ALPHA }, { signer: BETA }],
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.results.map((r) => r.rule)).toEqual(['Allowlist', 'Business hours', 'Multisig']);
    expect(result.evaluatedRules).toBe(3);
    expect(result.failedRules).toBe(0);
    expect(result.failedRuleNames).toEqual([]);
  });

  it('aggregates failures across rules and de-duplicates rule names', () => {
    const result = evaluatePolicy(
      {
        rules: [
          { name: 'Destinations', allowedRecipients: [ALPHA], blockedRecipients: [GAMMA] },
          { name: 'Multisig', requiredSignatures: 5 },
        ],
      },
      tx({ recipientAddress: GAMMA, signatures: [{ signer: ALPHA }] }),
    );

    expect(result.allowed).toBe(false);
    expect(result.failedRules).toBe(3); // failed allowlist, denylist and signature checks
    expect(result.failedRuleNames).toEqual(['Destinations', 'Multisig']);
    expect(result.evaluatedRules).toBe(3);
  });

  it('skips disabled rules', () => {
    const result = evaluatePolicy(
      {
        rules: [
          { name: 'Off', enabled: false, allowedRecipients: [BETA] },
          { name: 'On', allowedRecipients: [ALPHA] },
        ],
      },
      tx({ recipientAddress: ALPHA }),
    );

    expect(result.allowed).toBe(true);
    expect(result.results.map((r) => r.rule)).toEqual(['On']);
  });

  it('reports a trivially-passing entry for a rule with no constraints', () => {
    const result = evaluatePolicy({ rules: [{ name: 'Noop' }] }, tx());
    expect(result.allowed).toBe(true);
    expect(result.results[0]).toMatchObject({ rule: 'Noop', check: 'none', success: true });
  });

  it('is deterministic for a fixed payload', () => {
    const policySet: PolicySet = {
      rules: [{ name: 'Mixed', allowedRecipients: [ALPHA], requiredSignatures: 2 }],
    };
    const payload = tx({ signatures: [{ signer: ALPHA }] });
    expect(evaluatePolicy(policySet, payload)).toEqual(evaluatePolicy(policySet, payload));
  });

  it('treats a missing policy set as an empty, passing set', () => {
    expect(evaluatePolicy(undefined, tx())).toMatchObject({
      allowed: true,
      results: [],
      evaluatedRules: 0,
      failedRules: 0,
    });
    expect(evaluatePolicy({ rules: [] }, tx()).allowed).toBe(true);
  });

  it('never throws for malformed input', () => {
    expect(() => evaluatePolicy(null, null)).not.toThrow();
    expect(() =>
      evaluatePolicy(
        { rules: [null, { name: '', allowedRecipients: [ALPHA] }] } as unknown as PolicySet,
        tx(),
      ),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* policySetFromPolicies                                                       */
/* -------------------------------------------------------------------------- */

describe('policySetFromPolicies', () => {
  it('maps enabled policies into evaluable rules', () => {
    const set = policySetFromPolicies(
      [
        policy({
          name: 'Allowlist',
          configuration: { allowedRecipients: [ALPHA] },
        }),
        policy({
          id: 'pol_2',
          name: 'Denylist',
          type: 'BLOCKED_RECIPIENTS',
          configuration: { blockedRecipients: [GAMMA] },
        }),
        policy({
          id: 'pol_3',
          name: 'Hours',
          type: 'TIME_WINDOW',
          configuration: { allowedHours: { startHour: 8, endHour: 18 } },
        }),
        policy({
          id: 'pol_4',
          name: 'Multisig',
          configuration: { requiredSignatures: 2 },
        }),
      ],
      'Treasury',
    );

    expect(set.name).toBe('Treasury');
    expect(set.rules).toHaveLength(4);

    const result = evaluatePolicy(
      set,
      tx({ recipientAddress: ALPHA, timestamp: '2026-09-28T12:00:00.000Z', signedWeight: 2 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.results.map((r) => r.rule)).toEqual([
      'Allowlist',
      'Denylist',
      'Hours',
      'Multisig',
    ]);
  });

  it('drops disabled policies and tolerates a non-array input', () => {
    const set = policySetFromPolicies([
      policy({ enabled: false, configuration: { allowedRecipients: [ALPHA] } }),
    ]);
    expect(set.rules).toEqual([]);
    expect(policySetFromPolicies(null).rules).toEqual([]);
    expect(policySetFromPolicies(undefined).rules).toEqual([]);
  });

  it('retains policies with no locally-evaluable constraint', () => {
    const set = policySetFromPolicies([
      policy({ name: 'Max amount', configuration: { maxAmount: 100 } }),
    ]);
    expect(set.rules).toHaveLength(1);
    expect(evaluatePolicy(set, tx()).allowed).toBe(true);
  });
});
