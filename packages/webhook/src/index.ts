/**
 * `@astroid/webhook` — webhook endpoint management and delivery verification.
 *
 * Two concerns live here:
 *
 * 1. **Endpoint CRUD** — register/list/update/delete the URLs Astroid should
 *    POST events to, and rotate their signing secret.
 * 2. **Delivery verification** — {@link WebhookResource.verifySignature} and
 *    {@link WebhookResource.constructEvent} let a server trust an incoming
 *    delivery by recomputing the HMAC-SHA256 over the *raw* request body and
 *    comparing it, in constant time, to the `x-astroid-signature` header.
 *
 * The signing secret is only ever returned on create/rotate; it is never logged
 * and never sent back on subsequent reads.
 *
 * @packageDocumentation
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Resource } from '@astroid/core';
import { AstroidError } from '@astroid/errors';
import type {
  AnyWebhookEvent,
  CreateWebhookInput,
  Paginated,
  PaginationParams,
  UpdateWebhookInput,
  Webhook,
  WebhookHeaders,
} from '@astroid/types';

/** Filters accepted by {@link WebhookResource.list}. */
export interface WebhookListParams extends PaginationParams {
  enabled?: boolean;
}

/** Options for {@link WebhookResource.constructEvent}. */
export interface ConstructEventOptions {
  /**
   * Reject deliveries whose `x-astroid-timestamp` is older than this many
   * seconds (replay-window guard). Set to `0` to disable the freshness check.
   * @default 300
   */
  toleranceSeconds?: number;
  /**
   * Current unix time in **seconds**, injected for deterministic testing.
   * Defaults to `Date.now() / 1000`.
   */
  nowSeconds?: number;
}

/** Raised when an incoming webhook delivery fails verification. */
export class WebhookSignatureError extends AstroidError {}

const SIGNATURE_HEADER = 'x-astroid-signature';
const TIMESTAMP_HEADER = 'x-astroid-timestamp';
const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * The `webhooks` namespace on the Astroid client.
 *
 * Beyond CRUD, this resource exposes the stateless verification helpers used on
 * *your* server to authenticate deliveries. Those helpers need no network call
 * and no credentials beyond the endpoint's signing secret.
 */
export class WebhookResource extends Resource {
  /** Register a new webhook endpoint. The response includes the signing secret. */
  async create(input: CreateWebhookInput): Promise<Webhook> {
    const res = await this.client.post<Webhook>('/webhooks', input);
    return res.data;
  }

  /** Fetch a single webhook endpoint by id (the secret is omitted). */
  async get(webhookId: string): Promise<Webhook> {
    return this.getData<Webhook>(`/webhooks/${encodeURIComponent(webhookId)}`);
  }

  /** List webhook endpoints. */
  async list(params: WebhookListParams = {}): Promise<Paginated<Webhook>> {
    return this.listData<Webhook>('/webhooks', { ...params });
  }

  /** Iterate every webhook endpoint across all pages. */
  iterate(params: WebhookListParams = {}): AsyncGenerator<Webhook, void, void> {
    return this.iterateData<Webhook>('/webhooks', { ...params });
  }

  /** Update a webhook's URL, subscribed events, or enabled state. */
  async update(webhookId: string, input: UpdateWebhookInput): Promise<Webhook> {
    const res = await this.client.patch<Webhook>(
      `/webhooks/${encodeURIComponent(webhookId)}`,
      input,
    );
    return res.data;
  }

  /** Permanently delete a webhook endpoint. */
  async delete(webhookId: string): Promise<void> {
    await this.client.delete<void>(`/webhooks/${encodeURIComponent(webhookId)}`);
  }

  /**
   * Rotate the endpoint's signing secret, returning the webhook with the new
   * `secret` populated. The previous secret stops verifying immediately.
   */
  async rotateSecret(webhookId: string): Promise<Webhook> {
    const res = await this.client.post<Webhook>(
      `/webhooks/${encodeURIComponent(webhookId)}/rotate-secret`,
    );
    return res.data;
  }

  /** Send a test event to the endpoint to confirm connectivity. */
  async test(webhookId: string): Promise<void> {
    await this.client.post<void>(`/webhooks/${encodeURIComponent(webhookId)}/test`);
  }

  /* --------------------------- verification (local) --------------------------- */

  /**
   * Recompute the HMAC-SHA256 of `payload` under `secret` and compare it, in
   * constant time, to `signature` (the `x-astroid-signature` header value).
   *
   * `payload` MUST be the exact raw request body — a re-serialized object will
   * not match. Returns `true`/`false`; it never throws on a plain mismatch.
   */
  static verifySignature(payload: string | Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // timingSafeEqual throws on length mismatch — guard first, still constant-time on equal lengths.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Instance alias for {@link WebhookResource.verifySignature}. */
  verifySignature(payload: string | Buffer, signature: string, secret: string): boolean {
    return WebhookResource.verifySignature(payload, signature, secret);
  }

  /**
   * Verify a delivery and parse it into a typed {@link AnyWebhookEvent}.
   *
   * Throws {@link WebhookSignatureError} if the signature header is missing,
   * the signature does not match, the delivery is older than the tolerance
   * window, or the body is not valid JSON. On success returns the parsed event,
   * discriminated on `event` so `data` is precisely typed.
   */
  static constructEvent(
    payload: string | Buffer,
    headers: Partial<WebhookHeaders> | Record<string, string | undefined>,
    secret: string,
    options: ConstructEventOptions = {},
  ): AnyWebhookEvent {
    const signature = readHeader(headers, SIGNATURE_HEADER);
    if (!signature) {
      throw new WebhookSignatureError('Missing x-astroid-signature header.', {
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    }

    const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    if (toleranceSeconds > 0) {
      const rawTs = readHeader(headers, TIMESTAMP_HEADER);
      const timestamp = rawTs ? Number.parseInt(rawTs, 10) : Number.NaN;
      if (!Number.isFinite(timestamp)) {
        throw new WebhookSignatureError('Missing or invalid x-astroid-timestamp header.', {
          code: 'WEBHOOK_SIGNATURE_INVALID',
        });
      }
      const now = options.nowSeconds ?? Date.now() / 1000;
      if (Math.abs(now - timestamp) > toleranceSeconds) {
        throw new WebhookSignatureError('Webhook timestamp is outside the tolerance window.', {
          code: 'WEBHOOK_TIMESTAMP_INVALID',
        });
      }
    }

    if (!WebhookResource.verifySignature(payload, signature, secret)) {
      throw new WebhookSignatureError('Webhook signature verification failed.', {
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    }

    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    try {
      return JSON.parse(text) as AnyWebhookEvent;
    } catch (cause) {
      throw new WebhookSignatureError('Webhook body is not valid JSON.', {
        code: 'WEBHOOK_PAYLOAD_INVALID',
        cause,
      });
    }
  }

  /** Instance alias for {@link WebhookResource.constructEvent}. */
  constructEvent(
    payload: string | Buffer,
    headers: Partial<WebhookHeaders> | Record<string, string | undefined>,
    secret: string,
    options: ConstructEventOptions = {},
  ): AnyWebhookEvent {
    return WebhookResource.constructEvent(payload, headers, secret, options);
  }
}

/** Case-insensitive header lookup (Node lower-cases, but callers may not). */
function readHeader(
  headers: Partial<WebhookHeaders> | Record<string, string | undefined>,
  name: string,
): string | undefined {
  const direct = (headers as Record<string, string | undefined>)[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return (headers as Record<string, string | undefined>)[key];
    }
  }
  return undefined;
}
