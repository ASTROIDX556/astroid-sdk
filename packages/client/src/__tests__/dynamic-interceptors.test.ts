import { describe, expect, it, vi } from 'vitest';
import {
  Astroid,
  type ErrorInterceptor,
  type RequestInterceptor,
  type ResponseInterceptor,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(config: Partial<ConstructorParameters<typeof Astroid>[0]> = {}) {
  const seenHeaders: Array<Record<string, string>> = [];
  const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    seenHeaders.push({ ...((init?.headers as Record<string, string>) ?? {}) });
    return jsonResponse({ data: { id: 'w1' } });
  });
  const client = new Astroid({
    apiKey: 'sk_test',
    baseUrl: 'https://api.test/v1',
    fetch: mockFetch as unknown as typeof fetch,
    ...config,
  });
  return { client, mockFetch, seenHeaders };
}

/* -------------------------------------------------------------------------- */
/* Adding and removing request interceptors                                    */
/* -------------------------------------------------------------------------- */

describe('addRequestInterceptor / removeRequestInterceptor', () => {
  it('injects headers from an interceptor added after construction', async () => {
    const { client, seenHeaders } = makeClient();

    client.addRequestInterceptor((config) => ({
      ...config,
      headers: { ...config.headers, 'x-trace-id': 'trace-1' },
    }));
    await client.http.get('/wallets/w1');

    expect(seenHeaders[0]).toMatchObject({ 'x-trace-id': 'trace-1' });
  });

  it('returns the client so calls can be chained', () => {
    const { client } = makeClient();
    expect(client.addRequestInterceptor(() => undefined)).toBe(client);
    expect(client.addResponseInterceptor(() => undefined)).toBe(client);
    expect(client.addErrorInterceptor(() => undefined)).toBe(client);
  });

  it('runs config-time interceptors before dynamically added ones, in order', async () => {
    const order: string[] = [];
    const { client } = makeClient({
      requestInterceptors: [() => void order.push('config')],
    });

    client
      .addRequestInterceptor(() => void order.push('added-1'))
      .addRequestInterceptor(() => void order.push('added-2'));
    await client.http.get('/wallets/w1');

    expect(order).toEqual(['config', 'added-1', 'added-2']);
  });

  it('chains the output of one interceptor into the next', async () => {
    const { client, seenHeaders } = makeClient();

    client.addRequestInterceptor((config) => ({
      ...config,
      headers: { ...config.headers, 'x-step': '1' },
    }));
    client.addRequestInterceptor((config) => ({
      ...config,
      headers: { ...config.headers, 'x-step': `${config.headers['x-step']}-2` },
    }));
    await client.http.get('/wallets/w1');

    expect(seenHeaders[0]).toMatchObject({ 'x-step': '1-2' });
  });

  it('awaits asynchronous interceptors', async () => {
    const { client, seenHeaders } = makeClient();

    client.addRequestInterceptor(async (config) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...config, headers: { ...config.headers, 'x-async': 'done' } };
    });
    await client.http.get('/wallets/w1');

    expect(seenHeaders[0]).toMatchObject({ 'x-async': 'done' });
  });

  it('stops applying an interceptor once it is removed', async () => {
    const { client, seenHeaders } = makeClient();
    const inject: RequestInterceptor = (config) => ({
      ...config,
      headers: { ...config.headers, 'x-removable': 'yes' },
    });

    client.addRequestInterceptor(inject);
    await client.http.get('/wallets/w1');
    expect(client.removeRequestInterceptor(inject)).toBe(true);
    await client.http.get('/wallets/w1');

    expect(seenHeaders[0]).toMatchObject({ 'x-removable': 'yes' });
    expect(seenHeaders[1]).not.toHaveProperty('x-removable');
  });

  it('can remove an interceptor supplied through the config', async () => {
    const config: RequestInterceptor = vi.fn();
    const { client } = makeClient({ requestInterceptors: [config] });

    expect(client.removeRequestInterceptor(config)).toBe(true);
    await client.http.get('/wallets/w1');

    expect(config).not.toHaveBeenCalled();
  });

  it('reports false when removing an interceptor that was never added', () => {
    const { client } = makeClient();
    expect(client.removeRequestInterceptor(() => undefined)).toBe(false);
  });

  it('lets an interceptor remove itself without skipping the next one', async () => {
    const { client } = makeClient();
    const second = vi.fn();
    const once: RequestInterceptor = () => {
      client.removeRequestInterceptor(once);
    };

    client.addRequestInterceptor(once).addRequestInterceptor(second);
    await client.http.get('/wallets/w1');

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the caller options when an interceptor edits them', async () => {
    const { client } = makeClient();
    const headers = { 'x-caller': 'original' };

    client.addRequestInterceptor((config) => {
      if (config.options?.headers) config.options.headers['x-caller'] = 'tampered';
      return config;
    });
    await client.http.request({ method: 'GET', path: '/wallets/w1', headers });

    expect(headers).toEqual({ 'x-caller': 'original' });
  });
});

/* -------------------------------------------------------------------------- */
/* Response interceptors                                                       */
/* -------------------------------------------------------------------------- */

describe('addResponseInterceptor / removeResponseInterceptor', () => {
  it('transforms the response body for the caller', async () => {
    const { client } = makeClient();

    client.addResponseInterceptor((response) => ({
      ...response,
      body: { data: { id: 'rewritten' } },
    }));
    const result = await client.http.get<{ id: string }>('/wallets/w1');

    expect(result.data).toEqual({ id: 'rewritten' });
  });

  it('echoes the originating request to the interceptor', async () => {
    const { client } = makeClient();
    const seen = vi.fn();

    client.addResponseInterceptor((response) => seen(response.status, response.request.method));
    await client.http.get('/wallets/w1');

    expect(seen).toHaveBeenCalledWith(200, 'GET');
  });

  it('runs response interceptors in registration order', async () => {
    const { client } = makeClient();
    const order: string[] = [];

    client
      .addResponseInterceptor(() => void order.push('first'))
      .addResponseInterceptor(() => void order.push('second'));
    await client.http.get('/wallets/w1');

    expect(order).toEqual(['first', 'second']);
  });

  it('stops applying an interceptor once it is removed', async () => {
    const { client } = makeClient();
    const interceptor: ResponseInterceptor = vi.fn();

    client.addResponseInterceptor(interceptor);
    await client.http.get('/wallets/w1');
    expect(client.removeResponseInterceptor(interceptor)).toBe(true);
    await client.http.get('/wallets/w1');

    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(client.removeResponseInterceptor(interceptor)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Error interceptors                                                          */
/* -------------------------------------------------------------------------- */

describe('addErrorInterceptor / removeErrorInterceptor', () => {
  function makeFailingClient(config: Partial<ConstructorParameters<typeof Astroid>[0]> = {}) {
    const mockFetch = vi.fn(async () =>
      jsonResponse({ error: { message: 'No such wallet', code: 'NOT_FOUND' } }, 404),
    );
    return new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      ...config,
    });
  }

  it('invokes error interceptors with the error and the request', async () => {
    const client = makeFailingClient();
    const seen = vi.fn();

    client.addErrorInterceptor((error, request) => {
      seen(error, request.method, request.path);
    });

    await expect(client.http.get('/wallets/missing')).rejects.toBeDefined();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[1]).toBe('GET');
    expect(seen.mock.calls[0]?.[2]).toBe('/wallets/missing');
  });

  it('lets an interceptor replace the error by returning a new one', async () => {
    const client = makeFailingClient();
    const replacement = new Error('wrapped');
    const second = vi.fn();

    client.addErrorInterceptor(() => replacement);
    client.addErrorInterceptor((error) => {
      second(error);
    });

    await expect(client.http.get('/wallets/missing')).rejects.toBe(replacement);
    expect(second).toHaveBeenCalledWith(replacement);
  });

  it('lets an interceptor annotate the thrown error in place', async () => {
    const client = makeFailingClient();

    client.addErrorInterceptor((error) => {
      (error as Record<string, unknown>).handledBy = 'global-handler';
    });

    await expect(client.http.get('/wallets/missing')).rejects.toMatchObject({
      handledBy: 'global-handler',
    });
  });

  it('accepts error interceptors through the client config', async () => {
    const seen = vi.fn();
    const client = makeFailingClient({ errorInterceptors: [seen] });

    await expect(client.http.get('/wallets/missing')).rejects.toBeDefined();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('is not invoked for successful requests', async () => {
    const { client } = makeClient();
    const seen = vi.fn();

    client.addErrorInterceptor(seen);
    await client.http.get('/wallets/w1');

    expect(seen).not.toHaveBeenCalled();
  });

  it('stops applying an interceptor once it is removed', async () => {
    const client = makeFailingClient();
    const interceptor: ErrorInterceptor = vi.fn();

    client.addErrorInterceptor(interceptor);
    expect(client.removeErrorInterceptor(interceptor)).toBe(true);

    await expect(client.http.get('/wallets/missing')).rejects.toBeDefined();
    expect(interceptor).not.toHaveBeenCalled();
    expect(client.removeErrorInterceptor(interceptor)).toBe(false);
  });
});
