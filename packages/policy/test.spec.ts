import { describe, it, expect } from 'vitest';
import { simulatePolicyLocal } from '../src/simulator.js';
import type { Policy } from '@astroid/types';

describe('simulatePolicyLocal (Issue #33)', () => {
  const policies: Policy[] = [
    {
      id: 'p1',
      organizationId: 'org1',
      name: 'Asset Allowlist',
      type: 'asset_allowlist',
      configuration: {
        allowedAssets: ['USDC', 'XLM'],
      },
      priority: 1,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'p2',
      organizationId: 'org1',
      name: 'Max Spend Limit',
      type: 'max_amount',
      configuration: {
        maxAmount: 1000,
      },
      priority: 2,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'p3',
      organizationId: 'org1',
      name: 'Blocked Targets',
      type: 'destination_denylist',
      configuration: {
        blockedRecipients: ['GBADDESTINATION12345'],
      },
      priority: 3,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('passes valid transaction', () => {
    const res = simulatePolicyLocal(
      {
        operations: [
          {
            type: 'payment',
            asset: 'USDC',
            amount: '250.00',
            recipient: 'GGOODDESTINATION12345',
          },
        ],
      },
      policies
    );

    expect(res.passed).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('catches multiple policy violations', () => {
    const res = simulatePolicyLocal(
      {
        operations: [
          {
            type: 'payment',
            asset: 'UNKNOWN_COIN',
            amount: 5000,
            recipient: 'GBADDESTINATION12345',
          },
        ],
      },
      policies
    );

    expect(res.passed).toBe(false);
    expect(res.violations).toHaveLength(3);
  });
});