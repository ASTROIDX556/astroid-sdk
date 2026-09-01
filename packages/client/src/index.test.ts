import { describe, expect, it, vi } from 'vitest';

import { Astroid } from './index.js';

const CONFIG = { apiKey: 'sk_test_key', baseUrl: 'https://api.example.test' };

describe('Astroid client', () => {
  it('exposes every resource namespace', () => {
    const astroid = new Astroid(CONFIG);
    expect(astroid.auth).toBeDefined();
    expect(astroid.wallets).toBeDefined();
    expect(astroid.agents).toBeDefined();
    expect(astroid.policies).toBeDefined();
    expect(astroid.budgets).toBeDefined();
    expect(astroid.transactions).toBeDefined();
    expect(astroid.notifications).toBeDefined();
    expect(astroid.analytics).toBeDefined();
    expect(astroid.webhooks).toBeDefined();
    expect(astroid.ai).toBeDefined();
  });

  it('shares one HttpClient across all namespaces', () => {
    const astroid = new Astroid(CONFIG);
    // setAccessToken flows through the single shared client; no throw = wired.
    expect(() => astroid.setAccessToken('at_123')).not.toThrow();
    expect(Astroid.version).toBe('0.1.0');
  });

  it('supports the plugin system', () => {
    const astroid = new Astroid(CONFIG);
    const install = vi.fn();
    astroid.register({ name: 'metrics', install });
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(astroid);
    expect(astroid.installedPlugins).toEqual(['metrics']);
  });

  it('injects static bearer token into request headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    const astroid = new Astroid({ baseUrl: 'https://api.example.test', accessToken: 'static_token_123', fetch: fetchMock });

    await astroid.client.get('/test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['authorization']).toBe('Bearer static_token_123');
  });

  it('evaluates asynchronous dynamic token configuration', async () => {
    const tokenFn = vi.fn().mockResolvedValue('dynamic_token_456');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    const astroid = new Astroid({ baseUrl: 'https://api.example.test', accessToken: tokenFn, fetch: fetchMock });

    await astroid.client.get('/test');
    expect(tokenFn).toHaveBeenCalledOnce();
    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['authorization']).toBe('Bearer dynamic_token_456');
  });

  it('retries request once on 401 Unauthorized when dynamic token function is registered', async () => {
    const tokenFn = vi.fn().mockResolvedValueOnce('old_token').mockResolvedValueOnce('fresh_token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));

    const astroid = new Astroid({ baseUrl: 'https://api.example.test', accessToken: tokenFn, fetch: fetchMock });

    const res = await astroid.client.get('/test');
    expect(res.data).toEqual({ ok: true });
    expect(tokenFn).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['authorization']).toBe('Bearer old_token');
    expect(fetchMock.mock.calls[1][1].headers['authorization']).toBe('Bearer fresh_token');
  });

  it('does not retry 401 when token is static', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }));
    const astroid = new Astroid({ baseUrl: 'https://api.example.test', accessToken: 'static_token', fetch: fetchMock });

    await expect(astroid.client.get('/test')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prevents concurrent identical token refresh invocations by caching pending promise', async () => {
    let resolveToken!: (token: string) => void;
    const tokenFn = vi.fn().mockReturnValue(new Promise((res) => { resolveToken = res; }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));

    const astroid = new Astroid({ baseUrl: 'https://api.example.test', accessToken: tokenFn, fetch: fetchMock });

    const p1 = astroid.client.get('/test1');
    const p2 = astroid.client.get('/test2');

    resolveToken('concurrent_token');
    await Promise.all([p1, p2]);

    expect(tokenFn).toHaveBeenCalledOnce();
  });
});

describe('Astroid event system', () => {
  const envelope = {
    id: 'evt_1',
    event: 'transaction.completed' as const,
    organizationId: 'org_1',
    createdAt: '2026-07-31T00:00:00.000Z',
    data: { id: 'tx_1' } as never,
  };

  it('delivers emitted events to on() listeners with typed data', () => {
    const astroid = new Astroid(CONFIG);
    const seen: string[] = [];
    astroid.on('transaction.completed', (tx) => seen.push(tx.id));
    astroid.emit(envelope);
    astroid.emit(envelope);
    expect(seen).toEqual(['tx_1', 'tx_1']);
  });

  it('on() returns a working unsubscribe', () => {
    const astroid = new Astroid(CONFIG);
    const listener = vi.fn();
    const off = astroid.on('transaction.completed', listener);
    off();
    astroid.emit(envelope);
    expect(listener).not.toHaveBeenCalled();
  });

  it('once() fires exactly one time', () => {
    const astroid = new Astroid(CONFIG);
    const listener = vi.fn();
    astroid.once('transaction.completed', listener);
    astroid.emit(envelope);
    astroid.emit(envelope);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not cross-deliver between event names', () => {
    const astroid = new Astroid(CONFIG);
    const listener = vi.fn();
    astroid.on('wallet.frozen', listener);
    astroid.emit(envelope);
    expect(listener).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears subscriptions', () => {
    const astroid = new Astroid(CONFIG);
    const listener = vi.fn();
    astroid.on('transaction.completed', listener);
    astroid.removeAllListeners();
    astroid.emit(envelope);
    expect(listener).not.toHaveBeenCalled();
  });
});
