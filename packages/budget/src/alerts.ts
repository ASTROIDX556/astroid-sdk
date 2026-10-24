/**
 * Budget threshold alert subscription helpers.
 *
 * Runaway automated spending on Stellar is best caught early. These helpers wrap
 * the Astroid budget-alert endpoints so developers can subscribe webhook / email
 * / Slack notifications to specific budget utilization percentages (commonly
 * `50%`, `80%`, `100%` — see {@link BUDGET_ALERT_THRESHOLDS}).
 *
 * Each function takes a {@link BudgetHttpClient} transport (satisfied by
 * `@astroid/client`) as its first argument, so they compose with
 * {@link BudgetClient} and are trivial to unit-test with a mock.
 *
 * @module
 */

import type {
  BudgetAlert,
  BudgetAlertChannel,
  CreateBudgetAlertInput,
  ListBudgetAlertsParams,
  PaginatedResponse,
  UpdateBudgetAlertInput,
} from '@astroid/types';
import { AstroidError } from '@astroid/errors';

import { toBudgetQuery, type BudgetHttpClient, type BudgetRequestOptions } from './budget.js';

export { BUDGET_ALERT_THRESHOLDS } from '@astroid/types';

/** Channels that require a non-empty `target`. */
const TARGETED_CHANNELS: readonly BudgetAlertChannel[] = ['EMAIL', 'WEBHOOK', 'SLACK'];

const VALID_CHANNELS: readonly BudgetAlertChannel[] = ['EMAIL', 'WEBHOOK', 'SLACK', 'DASHBOARD'];

/** Error thrown when a budget alert payload fails local validation. */
export class BudgetAlertValidationError extends AstroidError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: 'BUDGET_ALERT_VALIDATION_ERROR', status: 400, details });
    this.name = 'BudgetAlertValidationError';
  }
}

/** Whether `value` is a valid {@link BudgetAlertChannel}. */
export function isValidBudgetAlertChannel(value: unknown): value is BudgetAlertChannel {
  return typeof value === 'string' && (VALID_CHANNELS as readonly string[]).includes(value);
}

/**
 * Validate a threshold percentage: a finite number in `(0, 1000]`.
 *
 * @throws {BudgetAlertValidationError} When out of range.
 */
export function assertValidThresholdPercent(percent: number): void {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 1000) {
    throw new BudgetAlertValidationError(
      'thresholdPercent must be a finite number greater than 0 and at most 1000.',
      { thresholdPercent: percent },
    );
  }
}

/**
 * Validate a budget utilization threshold percentage: a finite number in `[1, 100]`.
 *
 * @throws {BudgetAlertValidationError} When out of range [1, 100].
 */
export function assertValidUtilizationThreshold(percent: number): void {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new BudgetAlertValidationError(
      'thresholdPercent must be a finite number between 1 and 100.',
      { thresholdPercent: percent },
    );
  }
}

/** Ensure `budgetId` is a non-empty string. */
function assertValidBudgetId(budgetId: unknown): asserts budgetId is string {
  if (typeof budgetId !== 'string' || budgetId.trim() === '') {
    throw new BudgetAlertValidationError('budgetId is required and must be a non-empty string.', {
      budgetId,
    });
  }
}

function validateCreateInput(input: CreateBudgetAlertInput): void {
  assertValidThresholdPercent(input.thresholdPercent);
  if (!isValidBudgetAlertChannel(input.channel)) {
    throw new BudgetAlertValidationError(
      `Unknown budget alert channel "${String(input.channel)}".`,
      {
        channel: input.channel,
      },
    );
  }
  if (
    (TARGETED_CHANNELS as readonly string[]).includes(input.channel) &&
    (typeof input.target !== 'string' || input.target.trim() === '')
  ) {
    throw new BudgetAlertValidationError(
      `A "${input.channel}" alert requires a non-empty target.`,
      { channel: input.channel },
    );
  }
}

const alertsPath = (budgetId: string): string =>
  `/v1/budgets/${encodeURIComponent(budgetId)}/alerts`;

const alertPath = (budgetId: string, alertId: string): string =>
  `${alertsPath(budgetId)}/${encodeURIComponent(alertId)}`;

/**
 * Create a budget threshold alert subscription.
 *
 * @param http     The HTTP transport.
 * @param budgetId The budget to attach the alert to.
 * @param input    Threshold, channel and destination.
 * @throws {BudgetAlertValidationError} When `input` is structurally invalid.
 */
export async function createBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  input: CreateBudgetAlertInput,
): Promise<BudgetAlert> {
  validateCreateInput(input);
  return http.post<BudgetAlert>(alertsPath(budgetId), input);
}

/** List the threshold alerts configured on a budget. */
export async function listBudgetAlerts(
  http: BudgetHttpClient,
  budgetId: string,
  params?: ListBudgetAlertsParams,
): Promise<PaginatedResponse<BudgetAlert>> {
  return http.get<PaginatedResponse<BudgetAlert>>(alertsPath(budgetId), {
    query: toBudgetQuery(params),
  });
}

/** Retrieve a single budget alert by id. */
export async function getBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
): Promise<BudgetAlert> {
  return http.get<BudgetAlert>(alertPath(budgetId, alertId));
}

/**
 * Update a budget alert.
 *
 * @throws {BudgetAlertValidationError} When a supplied field is invalid.
 */
export async function updateBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
  input: UpdateBudgetAlertInput,
): Promise<BudgetAlert> {
  if (input.thresholdPercent !== undefined) {
    assertValidThresholdPercent(input.thresholdPercent);
  }
  if (input.channel !== undefined && !isValidBudgetAlertChannel(input.channel)) {
    throw new BudgetAlertValidationError(
      `Unknown budget alert channel "${String(input.channel)}".`,
      {
        channel: input.channel,
      },
    );
  }
  return http.patch<BudgetAlert>(alertPath(budgetId, alertId), input);
}

/** Delete a budget alert subscription. */
export async function deleteBudgetAlert(
  http: BudgetHttpClient,
  budgetId: string,
  alertId: string,
): Promise<void> {
  await http.delete<void>(alertPath(budgetId, alertId));
}

/* -------------------------------------------------------------------------- */
/* Utilization alert subscription helper (issue #443)                         */
/* -------------------------------------------------------------------------- */

/** Configuration options for {@link subscribeToBudgetAlerts}. */
export interface BudgetAlertSubscriptionOptions {
  /** Notification channel (e.g. `'WEBHOOK'`, `'EMAIL'`, `'SLACK'`, `'DASHBOARD'`). Defaults to `'WEBHOOK'`. */
  channel?: BudgetAlertChannel;
  /** Destination for notification delivery (e.g. webhook URL, email address, or Slack incoming webhook URL). */
  target?: string;
  /** Explicit webhook URL shortcut (configures channel `'WEBHOOK'`). */
  webhookUrl?: string;
  /** Whether the alert triggers repeatedly on each threshold crossing. Defaults to `true`. */
  recurring?: boolean;
  /** Optional callback invoked when alerts trigger or arrive. */
  onAlert?: (alert: BudgetAlert) => void | Promise<void>;
  /** Optional abort signal forwarded to the transport. */
  signal?: AbortSignal;
}

/** The callback or subscription configuration accepted by {@link subscribeToBudgetAlerts}. */
export type BudgetAlertCallback =
  | string
  | ((alert: BudgetAlert) => void | Promise<void>)
  | BudgetAlertSubscriptionOptions;

/** An active budget utilization alert subscription handle. */
export interface BudgetAlertSubscription extends BudgetAlert {
  /** The created alert entity. */
  alert: BudgetAlert;
  /** Unsubscribe/cancel this alert subscription on the server. */
  unsubscribe: () => Promise<void>;
}

/** Fallback transport that executes HTTP requests using `globalThis.fetch`. */
function createFetchTransport(): BudgetHttpClient {
  return {
    async get<T>(path: string, options?: BudgetRequestOptions): Promise<T> {
      const url = options?.query
        ? `${path}?${new URLSearchParams(options.query as Record<string, string>).toString()}`
        : path;
      const res = await fetch(url, { method: 'GET', signal: options?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      if (!text) return undefined as T;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return text as unknown as T;
      }
      return (json && typeof json === 'object' && 'data' in json
        ? (json as Record<string, unknown>).data
        : json) as T;
    },
    async post<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T> {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      if (!text) return undefined as T;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return text as unknown as T;
      }
      return (json && typeof json === 'object' && 'data' in json
        ? (json as Record<string, unknown>).data
        : json) as T;
    },
    async patch<T>(path: string, body?: unknown, options?: BudgetRequestOptions): Promise<T> {
      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      if (!text) return undefined as T;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return text as unknown as T;
      }
      return (json && typeof json === 'object' && 'data' in json
        ? (json as Record<string, unknown>).data
        : json) as T;
    },
    async delete<T>(path: string, options?: BudgetRequestOptions): Promise<T> {
      const res = await fetch(path, { method: 'DELETE', signal: options?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return undefined as T;
    },
  };
}

/**
 * Subscribe to budget utilization alert milestones.
 *
 * Registers a threshold alert (e.g. at 80% or 100% of the budget) delivering
 * to a webhook URL, email address, or dashboard notification.
 *
 * @param http             Injected HTTP transport.
 * @param budgetId         The target budget ID.
 * @param thresholdPercent Alert threshold percentage between 1 and 100.
 * @param callback         Webhook URL string, callback handler, or subscription configuration.
 * @param options          Optional transport options (abort signal, query).
 * @returns The active {@link BudgetAlertSubscription} containing the alert record and an `.unsubscribe()` method.
 * @throws {BudgetAlertValidationError} When parameters fail local validation.
 */
export async function subscribeToBudgetAlerts(
  http: BudgetHttpClient,
  budgetId: string,
  thresholdPercent: number,
  callback: BudgetAlertCallback,
  options?: BudgetRequestOptions,
): Promise<BudgetAlertSubscription>;

/**
 * Subscribe to budget utilization alert milestones using the global fetch transport.
 *
 * Registers a threshold alert (e.g. at 80% or 100% of the budget) delivering
 * to a webhook URL, email address, or dashboard notification.
 *
 * @param budgetId         The target budget ID.
 * @param thresholdPercent Alert threshold percentage between 1 and 100.
 * @param callback         Webhook URL string, callback handler, or subscription configuration.
 * @param options          Optional transport options (abort signal, query).
 * @returns The active {@link BudgetAlertSubscription} containing the alert record and an `.unsubscribe()` method.
 * @throws {BudgetAlertValidationError} When parameters fail local validation.
 */
export async function subscribeToBudgetAlerts(
  budgetId: string,
  thresholdPercent: number,
  callback: BudgetAlertCallback,
  options?: BudgetRequestOptions,
): Promise<BudgetAlertSubscription>;

export async function subscribeToBudgetAlerts(
  httpOrBudgetId: BudgetHttpClient | string,
  budgetIdOrThreshold: string | number,
  thresholdOrCallback: number | BudgetAlertCallback,
  callbackOrOptions?: BudgetAlertCallback | BudgetRequestOptions,
  maybeOptions?: BudgetRequestOptions,
): Promise<BudgetAlertSubscription> {
  let http: BudgetHttpClient;
  let budgetId: string;
  let thresholdPercent: number;
  let callback: BudgetAlertCallback;
  let requestOptions: BudgetRequestOptions | undefined;

  if (typeof httpOrBudgetId === 'string') {
    http = createFetchTransport();
    budgetId = httpOrBudgetId;
    thresholdPercent = budgetIdOrThreshold as number;
    callback = thresholdOrCallback as BudgetAlertCallback;
    requestOptions = callbackOrOptions as BudgetRequestOptions | undefined;
  } else {
    http = httpOrBudgetId;
    budgetId = budgetIdOrThreshold as string;
    thresholdPercent = thresholdOrCallback as number;
    callback = callbackOrOptions as BudgetAlertCallback;
    requestOptions = maybeOptions;
  }

  assertValidBudgetId(budgetId);
  assertValidUtilizationThreshold(thresholdPercent);

  if (!callback) {
    throw new BudgetAlertValidationError('Callback or alert subscription configuration is required.', {
      callback,
    });
  }

  let channel: BudgetAlertChannel = 'WEBHOOK';
  let target: string | undefined;
  let recurring = true;

  if (typeof callback === 'string') {
    const trimmed = callback.trim();
    if (!trimmed) {
      throw new BudgetAlertValidationError('Alert target cannot be empty.', { target: callback });
    }
    if (trimmed.includes('@')) {
      channel = 'EMAIL';
      target = trimmed;
    } else {
      channel = 'WEBHOOK';
      target = trimmed;
    }
  } else if (typeof callback === 'function') {
    channel = 'DASHBOARD';
    target = undefined;
  } else if (typeof callback === 'object') {
    channel = callback.channel ?? (callback.webhookUrl || callback.target ? 'WEBHOOK' : 'DASHBOARD');
    target = callback.target ?? callback.webhookUrl;
    if (callback.recurring !== undefined) {
      recurring = callback.recurring;
    }
    if (callback.signal && !requestOptions?.signal) {
      requestOptions = { ...requestOptions, signal: callback.signal };
    }
  }

  if (TARGETED_CHANNELS.includes(channel) && (!target || target.trim() === '')) {
    throw new BudgetAlertValidationError(
      `A "${channel}" alert requires a non-empty target.`,
      { channel },
    );
  }

  const payload: CreateBudgetAlertInput = {
    thresholdPercent,
    channel,
    ...(target !== undefined ? { target } : {}),
    recurring,
  };

  const raw = await http.post<BudgetAlert | { data: BudgetAlert }>(
    alertsPath(budgetId),
    payload,
    requestOptions,
  );
  const alert: BudgetAlert =
    raw && typeof raw === 'object' && 'data' in raw && (raw as { data: BudgetAlert }).data
      ? (raw as { data: BudgetAlert }).data
      : (raw as BudgetAlert);

  const subscription: BudgetAlertSubscription = {
    ...alert,
    alert,
    unsubscribe: async () => {
      await http.delete<void>(alertPath(budgetId, alert.id), requestOptions);
    },
  };

  return subscription;
}

// Re-exported for discoverability alongside the alert helpers.
export type {
  BudgetAlert,
  BudgetAlertChannel,
  CreateBudgetAlertInput,
  UpdateBudgetAlertInput,
  ListBudgetAlertsParams,
} from '@astroid/types';
