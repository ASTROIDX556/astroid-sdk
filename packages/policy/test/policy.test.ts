import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@astroid/errors';
import type { PolicySimulationRequest } from '@astroid/types';
import { simulatePolicy } from '../src/index.js';

describe('simulatePolicy — policy simulation dry-run helper (#562)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const validPayload: PolicySimulationRequest = {
    asset: 'USDC',
    amount: '100',
    recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
  };

  it('returns allowed=true and empty violations for a passing transaction', async () => {
    const mockAllowedResponse = {
      allowed: true,
      violations: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockAllowedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_123', validPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/policies/simulate');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body as string)).toEqual(validPayload);

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns allowed=false with violation messages for a rejected transaction', async () => {
    const mockRejectedResponse = {
      allowed: false,
      violations: [
        { rule: 'MAX_AMOUNT', message: 'Requested amount 100 exceeds maximum per-transaction limit of 50 USDC.' },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRejectedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_123', validPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/policies/simulate');
    expect(requestInit.method).toBe('POST');

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('exceeds maximum');
  });

  it('throws ValidationError when policyId is missing or empty', async () => {
    await expect(simulatePolicy('', validPayload)).rejects.toThrow(ValidationError);
    await expect(simulatePolicy('   ', validPayload)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when simulation payload contains invalid amount', async () => {
    const invalidPayload = {
      asset: 'USDC',
      amount: '-50',
      recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
    } as unknown as PolicySimulationRequest;

    await expect(simulatePolicy('pol_123', invalidPayload)).rejects.toThrow(ValidationError);
  });
});