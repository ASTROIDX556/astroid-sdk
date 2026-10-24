import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetAlert } from '@astroid/types';
import {
  BudgetAlertValidationError,
  BudgetClient,
  BudgetResource,
  assertValidUtilizationThreshold,
  subscribeToBudgetAlerts,
  type BudgetAlertSubscription,
  type BudgetHttpClient,
} from '../index.js';

function makeAlert(overrides: Partial<BudgetAlert> = {}): BudgetAlert {
  return {
    id: 'alt_sub_1',
    budgetId: 'bud_123',
    organizationId: 'org_1',
    thresholdPercent: 80,
    channel: 'WEBHOOK',
    target: 'https://agent.example.com/alerts',
    status: 'ACTIVE',
    recurring: true,
    lastTriggeredAt: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('subscribeToBudgetAlerts helper (issue #443)', () => {
  describe('validation', () => {
    it('accepts valid thresholds between 1 and 100', () => {
      expect(() => assertValidUtilizationThreshold(1)).not.toThrow();
      expect(() => assertValidUtilizationThreshold(50)).not.toThrow();
      expect(() => assertValidUtilizationThreshold(80)).not.toThrow();
      expect(() => assertValidUtilizationThreshold(100)).not.toThrow();
    });

    it('rejects thresholds less than 1 or greater than 100', () => {
      expect(() => assertValidUtilizationThreshold(0)).toThrowError(BudgetAlertValidationError);
      expect(() => assertValidUtilizationThreshold(-10)).toThrowError(BudgetAlertValidationError);
      expect(() => assertValidUtilizationThreshold(101)).toThrowError(BudgetAlertValidationError);
      expect(() => assertValidUtilizationThreshold(200)).toThrowError(BudgetAlertValidationError);
      expect(() => assertValidUtilizationThreshold(NaN)).toThrowError(BudgetAlertValidationError);
      expect(() => assertValidUtilizationThreshold(Infinity)).toThrowError(
        BudgetAlertValidationError,
      );
    });

    it('rejects empty or missing budgetId', async () => {
      await expect(
        subscribeToBudgetAlerts('', 80, 'https://example.com/hook'),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);

      await expect(
        subscribeToBudgetAlerts('   ', 80, 'https://example.com/hook'),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    });

    it('rejects missing or empty callback target', async () => {
      await expect(
        subscribeToBudgetAlerts('bud_1', 80, null as never),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);

      await expect(
        subscribeToBudgetAlerts('bud_1', 80, ''),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);

      await expect(
        subscribeToBudgetAlerts('bud_1', 80, { channel: 'WEBHOOK', target: '' }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    });
  });

  describe('standalone with fetch mocks', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('registers a webhook alert via fetch and returns a subscription with unsubscribe()', async () => {
      const mockAlert = makeAlert({
        id: 'alt_fetch_1',
        budgetId: 'bud_456',
        thresholdPercent: 75,
        channel: 'WEBHOOK',
        target: 'https://webhook.example.com/endpoint',
      });

      const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 201,
            statusText: 'Created',
            text: async () => JSON.stringify({ data: mockAlert }),
          };
        }
        if (init?.method === 'DELETE') {
          return {
            ok: true,
            status: 204,
            statusText: 'No Content',
            text: async () => '',
          };
        }
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => '',
        };
      });

      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const sub: BudgetAlertSubscription = await subscribeToBudgetAlerts(
        'bud_456',
        75,
        'https://webhook.example.com/endpoint',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0]!;
      const [url, init] = firstCall;
      expect(url).toBe('/v1/budgets/bud_456/alerts');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        thresholdPercent: 75,
        channel: 'WEBHOOK',
        target: 'https://webhook.example.com/endpoint',
        recurring: true,
      });

      expect(sub.id).toBe('alt_fetch_1');
      expect(sub.thresholdPercent).toBe(75);
      expect(sub.channel).toBe('WEBHOOK');
      expect(sub.alert).toEqual(mockAlert);

      // Test unsubscription calling DELETE
      await sub.unsubscribe();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCall = fetchMock.mock.calls[1]!;
      const [delUrl, delInit] = secondCall;
      expect(delUrl).toBe('/v1/budgets/bud_456/alerts/alt_fetch_1');
      expect(delInit?.method).toBe('DELETE');
    });

    it('infers EMAIL channel when callback contains an email address', async () => {
      const emailAlert = makeAlert({
        channel: 'EMAIL',
        target: 'finance-bot@stellar.org',
        thresholdPercent: 90,
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(emailAlert),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const sub = await subscribeToBudgetAlerts('bud_123', 90, 'finance-bot@stellar.org');

      expect(sub.channel).toBe('EMAIL');
      const firstCall = fetchMock.mock.calls[0]!;
      const body = JSON.parse(String(firstCall[1]?.body));
      expect(body.channel).toBe('EMAIL');
      expect(body.target).toBe('finance-bot@stellar.org');
    });

    it('configures DASHBOARD channel when given a function callback', async () => {
      const dashboardAlert = makeAlert({
        channel: 'DASHBOARD',
        target: undefined,
        thresholdPercent: 100,
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: dashboardAlert }),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const onAlertHandler = vi.fn();
      const sub = await subscribeToBudgetAlerts('bud_123', 100, onAlertHandler);

      expect(sub.channel).toBe('DASHBOARD');
      const firstCall = fetchMock.mock.calls[0]!;
      const body = JSON.parse(String(firstCall[1]?.body));
      expect(body.channel).toBe('DASHBOARD');
      expect(body.target).toBeUndefined();
    });

    it('accepts a full BudgetAlertSubscriptionOptions configuration', async () => {
      const customAlert = makeAlert({
        channel: 'SLACK',
        target: 'https://hooks.slack.com/services/T00/B00/X00',
        thresholdPercent: 60,
        recurring: false,
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(customAlert),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const sub = await subscribeToBudgetAlerts('bud_123', 60, {
        channel: 'SLACK',
        target: 'https://hooks.slack.com/services/T00/B00/X00',
        recurring: false,
      });

      expect(sub.channel).toBe('SLACK');
      const firstCall = fetchMock.mock.calls[0]!;
      const body = JSON.parse(String(firstCall[1]?.body));
      expect(body).toEqual({
        thresholdPercent: 60,
        channel: 'SLACK',
        target: 'https://hooks.slack.com/services/T00/B00/X00',
        recurring: false,
      });
    });

    it('propagates transport error when fetch fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Internal error',
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        subscribeToBudgetAlerts('bud_123', 80, 'https://example.com/webhook'),
      ).rejects.toThrowError('HTTP 500: Internal Server Error');
    });
  });

  describe('with injected BudgetHttpClient transport', () => {
    let http: BudgetHttpClient;
    let postMock: ReturnType<typeof vi.fn>;
    let deleteMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      postMock = vi.fn();
      deleteMock = vi.fn();
      http = {
        get: vi.fn(),
        post: postMock,
        patch: vi.fn(),
        delete: deleteMock,
      };
    });

    it('calls http.post and http.delete on unsubscribe', async () => {
      const alert = makeAlert({ id: 'alt_custom_1' });
      postMock.mockResolvedValue(alert);
      deleteMock.mockResolvedValue(undefined);

      const sub = await subscribeToBudgetAlerts(
        http,
        'bud_123',
        80,
        'https://example.com/webhook',
      );

      expect(postMock).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts',
        {
          thresholdPercent: 80,
          channel: 'WEBHOOK',
          target: 'https://example.com/webhook',
          recurring: true,
        },
        undefined,
      );

      await sub.unsubscribe();
      expect(deleteMock).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts/alt_custom_1',
        undefined,
      );
    });
  });

  describe('BudgetClient.subscribeToBudgetAlerts', () => {
    it('delegates to subscribeToBudgetAlerts on the client instance', async () => {
      const alert = makeAlert({ id: 'alt_client_1', thresholdPercent: 50 });
      const http: BudgetHttpClient = {
        get: vi.fn(),
        post: vi.fn().mockResolvedValue(alert),
        patch: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const client = new BudgetClient(http);
      const sub = await client.subscribeToBudgetAlerts(
        'bud_123',
        50,
        'https://example.com/webhook',
      );

      expect(sub.id).toBe('alt_client_1');
      expect(sub.thresholdPercent).toBe(50);
      expect(http.post).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts',
        {
          thresholdPercent: 50,
          channel: 'WEBHOOK',
          target: 'https://example.com/webhook',
          recurring: true,
        },
        undefined,
      );

      await sub.unsubscribe();
      expect(http.delete).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts/alt_client_1',
        undefined,
      );
    });
  });

  describe('BudgetResource.subscribeToBudgetAlerts', () => {
    it('delegates through Resource.client and unwraps data', async () => {
      const alert = makeAlert({ id: 'alt_resource_1', thresholdPercent: 95 });
      const clientMock = {
        get: vi.fn(),
        post: vi.fn().mockResolvedValue({ data: alert }),
        patch: vi.fn(),
        delete: vi.fn().mockResolvedValue({ data: undefined }),
      };

      const resource = new BudgetResource(clientMock as never);
      const sub = await resource.subscribeToBudgetAlerts(
        'bud_123',
        95,
        'https://example.com/hook',
      );

      expect(sub.id).toBe('alt_resource_1');
      expect(sub.thresholdPercent).toBe(95);
      expect(clientMock.post).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts',
        {
          thresholdPercent: 95,
          channel: 'WEBHOOK',
          target: 'https://example.com/hook',
          recurring: true,
        },
        undefined,
      );

      await sub.unsubscribe();
      expect(clientMock.delete).toHaveBeenCalledWith(
        '/v1/budgets/bud_123/alerts/alt_resource_1',
        undefined,
      );
    });
  });
});
