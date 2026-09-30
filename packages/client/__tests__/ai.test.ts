import { describe, expect, it, vi } from 'vitest';

import { Astroid, AstroidTimeoutError } from '../src/index.js';

const RESULT = {
  intentId: 'pi_1',
  status: 'COMPLETED',
  outcome: 'executed',
  explanation: 'Executed against the Stellar test network.',
};

/** A fetch that stays open until its AbortSignal fires, then rejects. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      if (init.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })) as unknown as typeof fetch;
}

function okFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ success: true, data: RESULT }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch): Astroid {
  return new Astroid({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchImpl,
  });
}

describe('AiResource request options (#80)', () => {
  it('forwards a caller-supplied AbortSignal to the transport', async () => {
    const astroid = client(hangingFetch());

    const controller = new AbortController();
    const pending = astroid.ai.requestPayment(
      { intent: 'pay', amount: '10', asset: 'USDC' } as never,
      { signal: controller.signal },
    );

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('forwards a per-request timeoutMs override', async () => {
    const astroid = new Astroid({
      apiKey: 'sk_test',
      baseUrl: 'https://api.example.test',
      retry: false,
      timeout: 60_000,
      fetch: hangingFetch(),
    });

    await expect(
      astroid.ai.requestPayment({ intent: 'pay', amount: '10', asset: 'USDC' } as never, {
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('propagates request options through simulatePayment', async () => {
    const astroid = client(hangingFetch());

    const controller = new AbortController();
    const pending = astroid.ai.simulatePayment(
      { intent: 'pay', amount: '10', asset: 'USDC' } as never,
      { signal: controller.signal },
    );

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still posts the intent body with no request options supplied', async () => {
    const fetchMock = vi.fn(okFetch());
    const astroid = client(fetchMock as unknown as typeof fetch);

    const result = await astroid.ai.requestPayment({
      intent: 'pay',
      amount: '10',
      asset: 'USDC',
    } as never);

    expect(result).toEqual(RESULT);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/ai/request-payment');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('forces simulateOnly on the simulatePayment payload', async () => {
    const fetchMock = vi.fn(okFetch());
    const astroid = client(fetchMock as unknown as typeof fetch);

    await astroid.ai.simulatePayment({ intent: 'pay', amount: '10', asset: 'USDC' } as never);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      simulateOnly: true,
    });
  });
});
