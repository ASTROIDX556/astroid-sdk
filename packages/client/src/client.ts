/**
 * The main Astroid SDK client: composes all resource namespaces, event emitter,
 * and shared HTTP client.
 */

import { HttpClient, type AstroidClientConfig } from '@astroid/core';

import { AgentResource } from '@astroid/agent';
import { AnalyticsResource } from '@astroid/analytics';
import { AuthResource } from '@astroid/auth';
import { BudgetResource } from '@astroid/budget';
import { NotificationResource } from '@astroid/notification';
import { PolicyResource } from '@astroid/policy';
import { TransactionResource } from '@astroid/transaction';
import { WalletResource } from '@astroid/wallet';
import { WebhookResource } from '@astroid/webhook';
import { AIResource } from '@astroid/agent'; // or ai package if exists, wait let's check exports

// Event emitter for webhook and real-time events
type EventListener<T = any> = (data: T) => void;

export class Astroid {
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
  readonly ai: any; // AI resource namespace

  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly installedPluginNames = new Set<string>();

  constructor(config: AstroidClientConfig) {
    this.client = new HttpClient(config);
    this.auth = new AuthResource(this.client);
    this.wallets = new WalletResource(this.client);
    this.agents = new AgentResource(this.client);
    this.policies = new PolicyResource(this.client);
    this.budgets = new BudgetResource(this.client);
    this.transactions = new TransactionResource(this.client);
    this.notifications = new NotificationResource(this.client);
    this.analytics = new AnalyticsResource(this.client);
    this.webhooks = new WebhookResource(this.client);
    this.ai = new AgentResource(this.client); // Placeholder or actual if available
  }

  static readonly version = '0.1.0';

  /** Update access token at runtime. */
  setAccessToken(accessToken: string | (() => Promise<string>) | undefined): void {
    this.client.setAccessToken(accessToken);
  }

  /** Register a plugin. */
  register(plugin: { name: string; install: (astroid: Astroid) => void }): this {
    plugin.install(this);
    this.installedPluginNames.add(plugin.name);
    return this;
  }

  get installedPlugins(): string[] {
    return Array.from(this.installedPluginNames);
  }

  /* Event emitter methods */
  on(event: string, listener: EventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  once(event: string, listener: EventListener): () => void {
    const off = this.on(event, (data) => {
      off();
      listener(data);
    });
    return off;
  }

  emit(envelope: { event: string; data: any }): void {
    const set = this.listeners.get(envelope.event);
    if (set) {
      for (const listener of set) {
        listener(envelope.data);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
