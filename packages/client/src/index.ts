/**
 * `@astroid/client` — Typed HTTP client for the Astroid REST API.
 */

export * from './errors.js';

import { HttpClient, type AstroidClientConfig } from '@astroid/core';
import { AuthResource } from '@astroid/auth';
import { WalletResource } from '@astroid/wallet';
import { AgentResource } from '@astroid/agent';
import { PolicyResource } from '@astroid/policy';
import { BudgetResource } from '@astroid/budget';
import { TransactionResource } from '@astroid/transaction';
import { NotificationResource } from '@astroid/notification';
import { AnalyticsResource } from '@astroid/analytics';
import { WebhookResource } from '@astroid/webhook';
import type { ClientPlugin, EventMap, EventPayload, EventName } from '@astroid/types';
import { parseAstroidError } from './errors.js';

export class Astroid {
  public static readonly version = '0.1.0';

  readonly client: HttpClient;
  readonly auth: AuthResource;
  readonly wallets: WalletResource;
  readonly agents: AgentResource;
  readonly policies: PolicyResource;
  readonly budgets: BudgetResource;
  readonly transactions: TransactionResource;
  readonly notifications: NotificationResource;
  readonly analytics: AnalyticsResource;
  readonly webhooks: WebhookResource;
  readonly ai: { evaluatePrompt: (prompt: string) => Promise<string> };

  private readonly listeners = new Map<string, Set<Function>>();
  private readonly plugins: ClientPlugin[] = [];

  constructor(config: AstroidClientConfig) {
    this.client = new HttpClient(config);

    // Wrap or wire custom error parsing middleware if needed or use core client
    this.client.use({
      name: 'astroid-error-mapping',
      onError: (err, req) => {
        // Error is already mapped by core or can be enhanced here
      }
    });

    this.auth = new AuthResource(this.client);
    this.wallets = new WalletResource(this.client);
    this.agents = new AgentResource(this.client);
    this.policies = new PolicyResource(this.client);
    this.budgets = new BudgetResource(this.client);
    this.transactions = new TransactionResource(this.client);
    this.notifications = new NotificationResource(this.client);
    this.analytics = new AnalyticsResource(this.client);
    this.webhooks = new WebhookResource(this.client);

    this.ai = {
      evaluatePrompt: async (prompt: string) => {
        const res = await this.client.post<{ result: string }>('/ai/evaluate', { prompt });
        return res.data.result;
      },
    };
  }

  setAccessToken(token: string | undefined): void {
    this.client.setAccessToken(token);
  }

  register(plugin: ClientPlugin): this {
    this.plugins.push(plugin);
    plugin.install(this);
    return this;
  }

  get installedPlugins(): string[] {
    return this.plugins.map((p) => p.name);
  }

  on<TEvent extends EventName>(
    event: TEvent,
    listener: (data: EventPayload<TEvent>) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  once<TEvent extends EventName>(
    event: TEvent,
    listener: (data: EventPayload<TEvent>) => void,
  ): () => void {
    const off = this.on(event, (data) => {
      off();
      listener(data);
    });
    return off;
  }

  emit<TEvent extends EventName>(envelope: EventMap[TEvent]): void {
    const set = this.listeners.get(envelope.event);
    if (!set) return;
    for (const listener of set) {
      listener(envelope.data);
    }
  }

  removeAllListeners(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
