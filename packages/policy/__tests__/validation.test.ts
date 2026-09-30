import { describe, expect, it } from 'vitest';
import { ValidationError } from '@astroid/errors';
import { HttpClient } from '@astroid/core';
import { PolicyResource } from '../src/index.js';

function getResource() {
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
  });
  return new PolicyResource(http);
}

describe('Policy Schema Validation', () => {
  const resource = getResource();

  describe('create policy', () => {
    it('validates a correct policy submission successfully', async () => {
      // Not awaiting to avoid hitting actual fetch, we just want to ensure it doesn't throw ValidationError
      // The HTTP call will fail due to no mock, but we catch it or ignore since it passes validation
      let err: any;
      try {
        await resource.create({
          name: 'Max 500 USDC',
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 500 },
          priority: 1,
          enabled: true,
        });
      } catch (e: any) {
        err = e;
      }
      // If it fails with ValidationError, something is wrong with our schema
      expect(err).not.toBeInstanceOf(ValidationError);
    });

    it('rejects missing required fields', async () => {
      let caught: any;
      try {
        await resource.create({} as any);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.fieldErrors).toBeDefined();
      expect(caught.fieldErrors.name).toBeDefined();
      expect(caught.fieldErrors.type).toBeDefined();
      expect(caught.fieldErrors.priority).toBeDefined();
      expect(caught.fieldErrors.enabled).toBeDefined();
    });

    it('rejects invalid policy types', async () => {
      let caught: any;
      try {
        await resource.create({
          name: 'Test',
          type: 'INVALID_TYPE' as any,
          configuration: {},
          priority: 1,
          enabled: true,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.fieldErrors.type).toBeDefined();
    });
  });

  describe('simulate policy', () => {
    it('validates a correct simulation request successfully', async () => {
      let err: any;
      try {
        await resource.simulatePolicy({
          walletId: 'w_1',
          asset: 'USDC',
          amount: 500,
        });
      } catch (e: any) {
        err = e;
      }
      expect(err).not.toBeInstanceOf(ValidationError);
    });

    it('rejects missing required fields in simulate request', async () => {
      let caught: any;
      try {
        await resource.simulatePolicy({} as any);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.fieldErrors.asset).toBeDefined();
      expect(caught.fieldErrors.amount).toBeDefined();
    });

    it('rejects invalid types for fields in simulate request', async () => {
      let caught: any;
      try {
        await resource.simulatePolicy({
          walletId: 123 as any,
          asset: 'USDC',
          amount: { foo: 'bar' } as any,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.fieldErrors.walletId).toBeDefined();
      expect(caught.fieldErrors.amount).toBeDefined();
    });
  });
});
