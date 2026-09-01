import { HttpClient } from '@astroid/core';
import type { AstroidClientConfig } from '@astroid/core';
import type { ClientPlugin, EventMap, EventName, EventPayload } from '@astroid/types';
import { AuthService } from '@astroid/auth';
import { WalletService } from '@astroid/wallet';
import { AgentService } from '@astroid/agent';
import { PolicyService } from '@astroid/policy';
import { BudgetService } from '@astroid/budget';
import { TransactionService } from '@astroid/transaction';
import { NotificationService } from '@astroid/notification';
import { AnalyticsService } from '@astroid/analytics';
import { WebhookService } from '@astroid/webhook';
import { parseAstroidError } from './errors.js';

export class Astroid {
  readonly httpClient: HttpClient;
  readonly auth: AuthService;
  readonly wallets: WalletService;
  readonly agents: AgentService;
  readonly policies: PolicyService;
  readonly budgets: BudgetService;
  readonly transactions: TransactionService;
  readonly notifications: NotificationService;
  readonly analytics: AnalyticsService;
  readonly webhooks: WebhookService;
  readonly ai: Record<string, unknown>;

  private readonly plugins: ClientPlugin[] = [];
  private readonly listeners = new Map<string, Set<(data: any) => void>>();

  constructor(config: AstroidClientConfig) {
    this.httpClient = new HttpClient(config);
    
    // Wrap fetch or handle errors via middleware
    this.httpClient.use({
      name: 'astroid-error-mapping',
      onError: (_err, _req) => {
        // Error is already mapped by core or can be enhanced here
      },
      onResponse: async (res, req) => {
        if (res.status >= 400) {
          throw parseAstroidError(
            new Response(res.body ? JSON.stringify(res.body) : null, {
              status: res.status,
              headers: res.headers,
            }),
            res.body,
            res.requestId
          );
        }
      },
    });

    this.auth = new AuthService(this.httpClient);
    this.wallets = new WalletService(this.httpClient);
    this.agents = new AgentService(this.httpClient);
    this.policies = new PolicyService(this.httpClient);
    this.budgets = new BudgetService(this.httpClient);
    this.transactions = new TransactionService(this.httpClient);
    this.notifications = new NotificationService(this.httpClient);
    this.analytics = new AnalyticsService(this.httpClient);
    this.webhooks = new WebhookService(this.httpClient);
    this.ai = {};
  }

  setAccessToken(accessToken: string | undefined): void {
    this.httpClient.setAccessToken(accessToken);
  }

  register(plugin: ClientPlugin): this {
    this.plugins.push(plugin);
    plugin.install(this);
    return this;
  }

  get installedPlugins(): string[] {
    return this.plugins.map((p) => p.name);
  }

  on<K extends EventName>(event: K, listener: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  once<K extends EventName>(event: K, listener: (data: any) => void): () => void {
    const off = this.on(event, (data) => {
      off();
      listener(data);
    });
    return off;
  }

  emit(envelope: EventPayload): void {
    const subs = this.listeners.get(envelope.event);
    if (subs) {
      for (const listener of subs) {
        listener(envelope.data);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  static get version(): string {
    return '0.1.0';
  }

  /**
   * Merge pagination parameters with arbitrary query parameters into a single
   * serialisable record, ready to pass as the `query` option of any request.
   */
  buildQuery(params: PaginationParams & Record<string, QueryValue>): Record<string, QueryValue> {
    return { ...serializePaginationParams(params), ...params };
  }
}

export { parseAstroidError, AstroidHorizonError, AstroidPolicyViolationError } from './errors.js';
