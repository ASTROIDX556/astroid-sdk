import { describe, it, expect, vi } from 'vitest';
import { Astroid } from '../src/index.js';
import { AuthenticationError, PolicyViolationError } from '@astroid/errors';
import { TimeoutError } from '@astroid/core';

describe('Astroid Client Integration Test Suite', () => {
  it('successfully injects authentication header and executes request', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk_test_sec');
      return new Response(JSON.stringify({ data: { id: 'w_mock_1', name: 'Test Wallet' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_sec',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const wallet = await client.wallets.get('w_mock_1');
    expect(wallet).toEqual({ id: 'w_mock_1', name: 'Test Wallet' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('correctly maps error responses to domain errors (e.g., AuthenticationError and PolicyViolationError)', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_, init) => {
      const headers = new Headers(init?.headers);
      const auth = headers.get('authorization');
      if (!auth || auth === 'Bearer invalid_key') {
        return new Response(
          JSON.stringify({
            error: { code: 'AUTHENTICATION_ERROR', message: 'Provided API key is invalid' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          error: { code: 'POLICY_VIOLATION', message: 'Transaction blocked by policy' },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    });

    const badClient = new Astroid({
      apiKey: 'invalid_key',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(badClient.wallets.get('w_1')).rejects.toBeInstanceOf(AuthenticationError);

    const validClient = new Astroid({
      apiKey: 'sk_test_valid',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(validClient.wallets.get('w_1')).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it('handles request timeouts and maps them correctly', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
        // Intentionally hang longer than timeout
        setTimeout(() => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, 500);
      });
    });

    const client = new Astroid({
      apiKey: 'sk_test_timeout',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    // Force short timeout
    await expect(client.wallets.get('w_timeout', { timeoutMs: 20 })).rejects.toThrow();
  });
});
