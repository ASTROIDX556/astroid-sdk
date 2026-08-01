import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WebhookResource, WebhookSignatureError } from './index.js';

const SECRET = 'whsec_test_secret';

function sign(payload: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('WebhookResource.verifySignature', () => {
  it('accepts a correctly-signed payload', () => {
    const body = JSON.stringify({ event: 'ping' });
    expect(WebhookResource.verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const body = JSON.stringify({ event: 'ping' });
    const sig = sign(body);
    expect(WebhookResource.verifySignature(body + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const body = JSON.stringify({ event: 'ping' });
    expect(WebhookResource.verifySignature(body, sign(body), 'nope')).toBe(false);
  });

  it('rejects empty signature or secret without throwing', () => {
    expect(WebhookResource.verifySignature('x', '', SECRET)).toBe(false);
    expect(WebhookResource.verifySignature('x', 'abc', '')).toBe(false);
  });

  it('does not throw when signature length differs from expected', () => {
    expect(WebhookResource.verifySignature('x', 'short', SECRET)).toBe(false);
  });
});

describe('WebhookResource.constructEvent', () => {
  const now = 1_700_000_000;

  function deliver(body: string, secret = SECRET, ts = now) {
    return {
      'x-astroid-signature': sign(body, secret),
      'x-astroid-timestamp': String(ts),
    };
  }

  it('parses a valid, fresh, correctly-signed delivery', () => {
    const body = JSON.stringify({
      id: 'evt_1',
      event: 'transaction.completed',
      organizationId: 'org_1',
      createdAt: '2026-07-31T00:00:00.000Z',
      data: { id: 'tx_1' },
    });
    const event = WebhookResource.constructEvent(body, deliver(body), SECRET, { nowSeconds: now });
    expect(event.event).toBe('transaction.completed');
    expect(event.id).toBe('evt_1');
  });

  it('throws WebhookSignatureError on a bad signature', () => {
    const body = JSON.stringify({ event: 'x' });
    expect(() =>
      WebhookResource.constructEvent(
        body,
        { 'x-astroid-signature': 'deadbeef', 'x-astroid-timestamp': String(now) },
        SECRET,
        { nowSeconds: now },
      ),
    ).toThrow(WebhookSignatureError);
  });

  it('throws when the signature header is missing', () => {
    const body = JSON.stringify({ event: 'x' });
    expect(() =>
      WebhookResource.constructEvent(body, { 'x-astroid-timestamp': String(now) }, SECRET, {
        nowSeconds: now,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it('rejects a stale delivery outside the tolerance window', () => {
    const body = JSON.stringify({ event: 'x' });
    expect(() =>
      WebhookResource.constructEvent(body, deliver(body, SECRET, now - 10_000), SECRET, {
        nowSeconds: now,
        toleranceSeconds: 300,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it('honors a case-insensitive header lookup', () => {
    const body = JSON.stringify({ event: 'x', id: 'evt_2' });
    const headers = {
      'X-Astroid-Signature': sign(body),
      'X-Astroid-Timestamp': String(now),
    };
    const event = WebhookResource.constructEvent(body, headers, SECRET, { nowSeconds: now });
    expect(event.id).toBe('evt_2');
  });

  it('throws on a valid signature but non-JSON body', () => {
    const body = 'not json{';
    expect(() =>
      WebhookResource.constructEvent(body, deliver(body), SECRET, { nowSeconds: now }),
    ).toThrow(WebhookSignatureError);
  });

  it('skips the freshness check when toleranceSeconds is 0', () => {
    const body = JSON.stringify({ event: 'x', id: 'evt_3' });
    const event = WebhookResource.constructEvent(body, deliver(body, SECRET, 1), SECRET, {
      toleranceSeconds: 0,
      nowSeconds: now,
    });
    expect(event.id).toBe('evt_3');
  });
});
