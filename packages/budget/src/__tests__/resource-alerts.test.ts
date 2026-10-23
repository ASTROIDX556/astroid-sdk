import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetAlert } from '@astroid/types';

import { BudgetAlertValidationError } from '../alerts.js';
import { BudgetResource } from '../index.js';

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAlert(overrides: Partial<BudgetAlert> = {}): BudgetAlert {
  return {
    id: 'alt_1',
    budgetId: 'bud_1',
    organizationId: 'org_1',
    thresholdPercent: 80,
    channel: 'WEBHOOK',
    target: 'https://example.com/hook',
    status: 'ACTIVE',
    recurring: true,
    lastTriggeredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function httpOk<T>(data: T) {
  return { data, requestId: undefined, status: 200, headers: new Headers() };
}

describe('BudgetResource threshold alerts (issue #68)', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: BudgetResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new BudgetResource(http as never);
  });

  it('createAlert() POSTs typed payload to /v1/budgets/:id/alerts', async () => {
    const alert = makeAlert();
    http.post.mockResolvedValue(httpOk(alert));

    const input = {
      thresholdPercent: 80,
      channel: 'WEBHOOK' as const,
      target: 'https://example.com/hook',
    };
    const result = await resource.createAlert('bud_1', input);

    expect(result).toEqual(alert);
    expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', input, undefined);
  });

  it('createAlert() rejects invalid payload before calling the transport', async () => {
    await expect(
      resource.createAlert('bud_1', { thresholdPercent: 0, channel: 'WEBHOOK', target: 'x' }),
    ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    await expect(
      resource.createAlert('bud_1', { thresholdPercent: 80, channel: 'EMAIL' }),
    ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('listAlerts() GETs alerts with status/channel filters', async () => {
    http.get.mockResolvedValue(httpOk([makeAlert()]));

    await resource.listAlerts('bud_1', { status: 'ACTIVE', channel: 'WEBHOOK', limit: 10 });

    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
      query: { status: 'ACTIVE', channel: 'WEBHOOK', limit: 10 },
    });
  });

  it('getAlert() GETs a single alert with encoded ids', async () => {
    http.get.mockResolvedValue(httpOk(makeAlert()));
    await resource.getAlert('bud/1', 'alt/1');
    expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud%2F1/alerts/alt%2F1', {});
  });

  it('updateAlert() PATCHes valid changes', async () => {
    http.patch.mockResolvedValue(httpOk(makeAlert({ status: 'PAUSED' })));
    await resource.updateAlert('bud_1', 'alt_1', { status: 'PAUSED', thresholdPercent: 90 });
    expect(http.patch).toHaveBeenCalledWith(
      '/v1/budgets/bud_1/alerts/alt_1',
      {
        status: 'PAUSED',
        thresholdPercent: 90,
      },
      undefined,
    );
  });

  it('deleteAlert() DELETEs the alert path', async () => {
    http.delete.mockResolvedValue(undefined);
    await expect(resource.deleteAlert('bud_1', 'alt_1')).resolves.toBeUndefined();
    expect(http.delete).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1', undefined);
  });
});
