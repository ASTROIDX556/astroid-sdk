import { describe, expect, it } from 'vitest';
import {
  PolicyCreateInputSchema,
  PolicySimulationRequestSchema,
} from '../src/schemas.js';
import { PolicyType } from '@astroid/types';

describe('Policy Schemas', () => {
  describe('PolicyCreateInputSchema', () => {
    it('validates a correct payload', () => {
      const payload = {
        name: 'Max Spend Rule',
        type: PolicyType.MAX_AMOUNT,
        configuration: {
          maxAmount: 1000,
        },
        priority: 1,
        enabled: true,
      };
      
      const result = PolicyCreateInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });



    it('fails when type is invalid', () => {
      const payload = {
        name: 'Test',
        type: 'INVALID_TYPE',
        configuration: {},
        priority: 1,
        enabled: true,
      };
      const result = PolicyCreateInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.type).toBeDefined();
      }
    });

    it('validates configuration types strictly', () => {
      const payload = {
        name: 'Test',
        type: PolicyType.MAX_AMOUNT,
        configuration: {
          maxAmount: '100', // Should be a number
        },
        priority: 1,
        enabled: true,
      };
      const result = PolicyCreateInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['configuration.maxAmount'] || 
               result.error.flatten().fieldErrors['configuration']).toBeDefined();
      }
    });
  });

  describe('PolicySimulationRequestSchema', () => {
    it('validates a correct simulation request', () => {
      const payload = {
        walletId: 'w_1',
        asset: 'USDC',
        amount: '250',
        recipientAddress: 'GABC',
      };
      const result = PolicySimulationRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('fails when asset is missing', () => {
      const payload = {
        amount: 250,
      };
      const result = PolicySimulationRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.asset).toBeDefined();
      }
    });
  });
});
