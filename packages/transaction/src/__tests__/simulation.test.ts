/**
 * Unit tests for transaction simulation wrapper methods.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import { simulateTransaction } from '../simulation.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch): { http: HttpClient; fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { http, fetch: fetchMock };
}

describe('simulateTransaction wrapper', () => {
  it('sends the transaction XDR string to /transactions/simulate and returns the result', async () => {
    const simResult = {
      success: true,
      feeCharged: '100',
      resultXdr: 'AAAA==',
      policyCompliance: { compliant: true },
    };
    const { http, fetch } = client(async () => jsonResponse(simResult));

    const res = await simulateTransaction('AAAAFA==', { client: http });

    expect(res).toEqual(simResult);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/transactions/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      transactionXdr: 'AAAAFA==',
    });
  });

  it('accepts a full simulation request object with walletId and networkPassphrase', async () => {
    const simResult = {
      success: false,
      feeCharged: '100',
      diagnostics: { code: 'op_underfunded', message: 'Not enough balance' },
    };
    const { http, fetch } = client(async () => jsonResponse(simResult));

    const res = await simulateTransaction('AAAAFA==', {
      client: http,
      walletId: 'w_1',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    expect(res).toEqual(simResult);
    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      transactionXdr: 'AAAAFA==',
      walletId: 'w_1',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('throws a ValidationError if transactionXdr is missing or empty', async () => {
    const { http } = client(async () => jsonResponse({}));

    await expect(simulateTransaction('', { client: http })).rejects.toThrowError(
      ValidationError,
    );
  });
});
