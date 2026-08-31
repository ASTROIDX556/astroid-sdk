import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { AstroidTimeoutError } from '@astroid/core';
import { Astroid } from '../src/index.js';

describe('Client Timeout and AbortSignal Support', () => {
  it('throws AstroidTimeoutError when request exceeds timeout option', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Network timeout')), 100);
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      timeout: 20,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.get('/wallets/w_1')).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('supports caller-provided AbortSignal to cancel request immediately', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url, init) => new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          return reject(new Error('Aborted'));
        }
        signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/wallets/w_1', { signal: controller.signal })).rejects.toThrow();
  });

  it('respects Astroid client constructor timeout option', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Slow')), 100);
      })
    );

    const client = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test',
      timeout: 10,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.wallets.get('w_1')).rejects.toBeInstanceOf(AstroidTimeoutError);
  });
});
