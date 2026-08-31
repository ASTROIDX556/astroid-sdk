import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetAlert } from '@astroid/types';

import {
  BUDGET_ALERT_THRESHOLDS,
  BudgetAlertValidationError,
  assertValidThresholdPercent,
  createBudgetAlert,
  deleteBudgetAlert,
  getBudgetAlert,
  isValidBudgetAlertChannel,
  listBudgetAlerts,
  updateBudgetAlert,
} from '../alerts.js';
import type { BudgetHttpClient } from '../budget.js';

function createHttpMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } satisfies Record<keyof BudgetHttpClient, ReturnType<typeof vi.fn>>;
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

describe('budget alert helpers', () => {
  let http: ReturnType<typeof createHttpMock>;

  beforeEach(() => {
    http = createHttpMock();
  });

  it('exposes the canonical 50/80/100 thresholds', () => {
    expect([...BUDGET_ALERT_THRESHOLDS]).toEqual([50, 80, 100]);
  });

  describe('createBudgetAlert', () => {
    it('POSTs a valid alert to the budget alerts sub-resource', async () => {
      const alert = makeAlert();
      http.post.mockResolvedValue(alert);
      const result = await createBudgetAlert(http, 'bud_1', {
        thresholdPercent: 80,
        channel: 'WEBHOOK',
        target: 'https://example.com/hook',
      });
      expect(http.post).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
        thresholdPercent: 80,
        channel: 'WEBHOOK',
        target: 'https://example.com/hook',
      });
      expect(result).toBe(alert);
    });

    it('allows a DASHBOARD alert with no target', async () => {
      http.post.mockResolvedValue(makeAlert({ channel: 'DASHBOARD', target: '' }));
      await expect(
        createBudgetAlert(http, 'bud_1', { thresholdPercent: 100, channel: 'DASHBOARD' }),
      ).resolves.toBeDefined();
    });

    it('rejects an out-of-range threshold before calling the transport', async () => {
      await expect(
        createBudgetAlert(http, 'bud_1', { thresholdPercent: 0, channel: 'WEBHOOK', target: 'x' }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
      await expect(
        createBudgetAlert(http, 'bud_1', {
          thresholdPercent: 5000,
          channel: 'WEBHOOK',
          target: 'x',
        }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects an unknown channel and a missing target', async () => {
      await expect(
        createBudgetAlert(http, 'bud_1', {
          thresholdPercent: 80,
          channel: 'CARRIER_PIGEON' as never,
          target: 'x',
        }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
      await expect(
        createBudgetAlert(http, 'bud_1', { thresholdPercent: 80, channel: 'EMAIL' }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    });
  });

  describe('listBudgetAlerts', () => {
    it('GETs with filter params serialized', async () => {
      http.get.mockResolvedValue({ data: [makeAlert()] });
      await listBudgetAlerts(http, 'bud_1', { status: 'ACTIVE', channel: 'WEBHOOK', limit: 10 });
      expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', {
        query: { status: 'ACTIVE', channel: 'WEBHOOK', limit: 10 },
      });
    });

    it('GETs with an empty query when no params are given', async () => {
      http.get.mockResolvedValue({ data: [] });
      await listBudgetAlerts(http, 'bud_1');
      expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts', { query: {} });
    });
  });

  describe('getBudgetAlert', () => {
    it('GETs a single alert', async () => {
      http.get.mockResolvedValue(makeAlert());
      await getBudgetAlert(http, 'bud_1', 'alt_1');
      expect(http.get).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1');
    });
  });

  describe('updateBudgetAlert', () => {
    it('PATCHes valid changes', async () => {
      http.patch.mockResolvedValue(makeAlert({ status: 'PAUSED' }));
      await updateBudgetAlert(http, 'bud_1', 'alt_1', { status: 'PAUSED', thresholdPercent: 90 });
      expect(http.patch).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1', {
        status: 'PAUSED',
        thresholdPercent: 90,
      });
    });

    it('validates a supplied threshold / channel', async () => {
      await expect(
        updateBudgetAlert(http, 'bud_1', 'alt_1', { thresholdPercent: -1 }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
      await expect(
        updateBudgetAlert(http, 'bud_1', 'alt_1', { channel: 'nope' as never }),
      ).rejects.toBeInstanceOf(BudgetAlertValidationError);
    });
  });

  describe('deleteBudgetAlert', () => {
    it('DELETEs the alert and resolves void', async () => {
      http.delete.mockResolvedValue(undefined);
      await expect(deleteBudgetAlert(http, 'bud_1', 'alt_1')).resolves.toBeUndefined();
      expect(http.delete).toHaveBeenCalledWith('/v1/budgets/bud_1/alerts/alt_1');
    });
  });

  describe('validation predicates', () => {
    it('isValidBudgetAlertChannel', () => {
      expect(isValidBudgetAlertChannel('SLACK')).toBe(true);
      expect(isValidBudgetAlertChannel('slack')).toBe(false);
      expect(isValidBudgetAlertChannel(3)).toBe(false);
    });

    it('assertValidThresholdPercent', () => {
      expect(() => assertValidThresholdPercent(50)).not.toThrow();
      expect(() => assertValidThresholdPercent(1000)).not.toThrow();
      expect(() => assertValidThresholdPercent(0)).toThrow(BudgetAlertValidationError);
      expect(() => assertValidThresholdPercent(Number.NaN)).toThrow(BudgetAlertValidationError);
    });
  });
});
