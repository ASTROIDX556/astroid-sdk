import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Astroid, AstroidHttpClient } from '../index.js';
import type { AstroidClientConfig } from '../index.js';

describe('Issue #398 — Core HTTP client retry configuration options', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('accepts retryOptions configuration interface on client initialization', () => {
    const config: AstroidClientConfig = {
      apiKey: 'test-key',
      retryOptions: {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        retryableStatusCodes: [429, 502, 503, 504],
        jitter: false,
      },
    };

    const client = new Astroid(config);
    expect(client).toBeDefined();
    expect(client.http.config.retry?.maxRetries).toBe(3);
    expect(client.http.config.retry?.baseDelayMs).toBe(100);
    expect(client.http.config.retry?.maxDelayMs).toBe(1000);
    expect(client.http.config.retry?.retryableStatusCodes).toEqual([429, 502, 503, 504]);
    expect(client.http.config.retry?.jitter).toBe(false);
  });

  it('retries transient 502, 503, and 504 gateway/server errors with exponential backoff', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ message: 'Bad Gateway' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (callCount === 2) {
        return new Response(JSON.stringify({ message: 'Service Unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (callCount === 3) {
        return new Response(JSON.stringify({ message: 'Gateway Timeout' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new AstroidHttpClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      retryOptions: {
        maxRetries: 4,
        baseDelayMs: 50,
        maxDelayMs: 500,
        jitter: false,
      },
    });

    const requestPromise = client.request({
      method: 'GET',
      path: '/v1/status',
    });

    // Advance fake timers through retry backoffs
    await vi.runAllTimersAsync();

    const response = await requestPromise;
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true });
    expect(callCount).toBe(4);
  });

  it('retries transient 429 Too Many Requests errors', async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      retryOptions: {
        maxRetries: 2,
        baseDelayMs: 100,
        jitter: false,
      },
    });

    const promise = client.request({
      method: 'GET',
      path: '/v1/health',
    });

    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it('fails immediately without retrying on client errors (400, 401, 403, 404, 422)', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      retryOptions: {
        maxRetries: 3,
        baseDelayMs: 50,
      },
    });

    await expect(
      client.request({
        method: 'GET',
        path: '/v1/nonexistent',
      }),
    ).rejects.toThrow();

    expect(callCount).toBe(1);
  });

  it('exhausts all retries and rethrows final error when server remains unavailable', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ message: 'Service Unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new Astroid({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      retryOptions: {
        maxRetries: 2,
        baseDelayMs: 50,
        jitter: false,
      },
    });

    const reqPromise = client.request({
      method: 'GET',
      path: '/v1/unavailable',
    });

    // Run timers for the retries
    const failExpectation = expect(reqPromise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await failExpectation;

    // 1 initial + 2 retries = 3 total attempts
    expect(callCount).toBe(3);
  });
});
