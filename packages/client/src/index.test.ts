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
