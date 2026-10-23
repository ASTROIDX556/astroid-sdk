/**
 * Request DTOs (input types) for the Astroid API endpoints.
 *
 * These are the shapes developers pass to SDK resource methods. They are
 * deliberately narrower than the entities: server-managed fields (`id`,
 * timestamps, computed values) are omitted.
 */

import type {
  AgentRole,
  ApprovalType,
  BudgetPeriod,
  NotificationChannel,
  NotificationType,
  PolicyType,
  StellarNetwork,
  TransactionStatus,
  WalletType,
} from './enums.js';
import type {
  AssetBalance,
  DecimalString,
  Organization,
  PolicyConfiguration,
  Session,
  StellarAssetCode,
  StellarPublicKey,
  User,
} from './entities.js';

/* -------------------------------------------------------------------------- */
/* Wallet                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateWalletInput {
  agentId?: string;
  label?: string;
  walletType?: WalletType;
  network?: StellarNetwork;
}

export interface ImportWalletInput {
  stellarAddress: StellarPublicKey;
  /** Secret key for self-custody import. Never logged by the SDK. */
  secretKey?: string;
  agentId?: string;
  label?: string;
  walletType?: WalletType;
  network?: StellarNetwork;
}

export interface UpdateWalletInput {
  label?: string;
  agentId?: string | null;
  status?: 'ACTIVE' | 'FROZEN' | 'PAUSED' | 'ARCHIVED';
}

/**
 * Optional asset filters for a wallet balance snapshot.
 *
 * @example
 * ```ts
 * const query: WalletBalanceQuery = { assetCode: 'USDC', issuer: stellarIssuer };
 * const balance = await astroid.wallets.getWalletBalances('wlt_123', query);
 * ```
 */
export interface WalletBalanceQuery {
  assetCode?: StellarAssetCode;
  issuer?: StellarPublicKey;
}

/**
 * Optional asset filters for batch wallet balance queries.
 *
 * Supports filtering by a single asset code and optional issuer, or an array
 * of asset identifiers (e.g. `['XLM', 'USDC:G...']`).
 *
 * @example
 * ```ts
 * const filter: WalletBalanceBatchFilter = { assetCode: 'USDC', issuer: stellarIssuer };
 * ```
 */
export interface WalletBalanceBatchFilter {
  /** Optional Stellar asset code to filter by (e.g. `'USDC'`, `'XLM'`). */
  assetCode?: StellarAssetCode;
  /** Optional issuing Stellar account public key (`G…`). */
  issuer?: StellarPublicKey;
  /** Optional array of asset identifiers or codes to filter across all queried wallets. */
  assets?: string[];
}

/**
 * Parameters for querying balances across multiple wallets in a single batch request.
 *
 * @example
 * ```ts
 * const query: BatchWalletBalancesQuery = {
 *   walletIds: ['wlt_123', 'GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA'],
 *   assetCode: 'USDC',
 * };
 * ```
 */
export interface BatchWalletBalancesQuery extends WalletBalanceBatchFilter {
  /** Array of wallet identifiers (Astroid wallet IDs or Stellar public addresses). */
  walletIds: string[];
}

/**
 * Input DTO for batch wallet balance requests.
 */
export interface BatchWalletBalancesInput {
  /** Array of wallet identifiers (Astroid wallet IDs or Stellar public addresses). */
  walletIds: string[];
  /** Optional asset filters. */
  filters?: WalletBalanceBatchFilter;
}

/**
 * Strongly typed mapping of Stellar wallet addresses to their respective asset balance arrays.
 *
 * @example
 * ```ts
 * const balances: BatchWalletBalancesResult = {
 *   'GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA': [
 *     { asset: 'XLM', balance: '100.5000000' },
 *     { asset: 'USDC', balance: '25.0000000', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
 *   ],
 * };
 * ```
 */
export type BatchWalletBalancesResult = Record<string, AssetBalance[]>;

/** Alias for {@link BatchWalletBalancesResult}. */
export type BatchWalletBalancesResponse = BatchWalletBalancesResult;

/** Alias for {@link BatchWalletBalancesResult}. */
export type WalletBalancesBatchMapping = BatchWalletBalancesResult;

/**
 * Asset and exact decimal amount to submit when funding a wallet. Keep `amount`
 * as a string so the value is not rounded through floating-point arithmetic.
 *
 * @example
 * ```ts
 * const input: FundWalletInput = {
 *   assetCode: 'USDC',
 *   issuer: stellarIssuer,
 *   amount: '25.0000001',
 * };
 * await astroid.wallets.fundWallet('wlt_123', input);
 * ```
 */
export interface FundWalletInput {
  assetCode: StellarAssetCode;
  amount: DecimalString;
  issuer?: StellarPublicKey;
}

export interface TransferInput {
  recipientAddress: string;
  asset: string;
  amount: number | string;
  memo?: string;
  purpose?: string;
  /** Optional budget to charge the transfer against. */
  budgetId?: string;
  /** Optional idempotency key for safe retries. */
  idempotencyKey?: string;
}

/* -------------------------------------------------------------------------- */
/* Agent                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateAgentInput {
  name: string;
  description?: string;
  role?: AgentRole;
  provider?: string;
  model?: string;
  capabilities?: string[];
  primaryWalletId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  role?: AgentRole;
  provider?: string;
  model?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreatePolicyInput {
  name: string;
  type: PolicyType;
  configuration: PolicyConfiguration;
  description?: string;
  agentId?: string;
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  name?: string;
  type?: PolicyType;
  configuration?: PolicyConfiguration;
  description?: string;
  priority?: number;
  enabled?: boolean;
}

/** Input to `policy.simulate` — a hypothetical transaction to evaluate. */
export interface SimulatePolicyInput {
  walletId?: string;
  agentId?: string;
  asset: string;
  amount: number | string;
  recipientAddress?: string;
  /** Evaluate against these policy ids only; defaults to all enabled policies. */
  policyIds?: string[];
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Payload for `budgets.createBudget` / `budgets.create`.
 *
 * Monetary amounts should be decimal strings (e.g. `"5000.00"`) so values
 * never round-trip through IEEE-754 floats; numbers are accepted for
 * convenience and serialized as decimals.
 *
 * @example
 * ```ts
 * const input: CreateBudgetInput = { name: 'Q3 Ops', limitAmount: '5000.00' };
 * const budget = await budgets.createBudget(input);
 * ```
 */
export interface CreateBudgetInput {
  name: string;
  limitAmount: number | string;
  currency?: string;
  period?: BudgetPeriod;
  parentBudgetId?: string;
  agentId?: string;
  rollover?: boolean;
  enabled?: boolean;
}

/**
 * Payload for `budgets.updateBudget` / `budgets.update`.
 *
 * @example
 * ```ts
 * const updated = await budgets.updateBudget('bud_1', { limitAmount: '7500.00' });
 * ```
 */
export interface UpdateBudgetInput {
  name?: string;
  limitAmount?: number | string;
  period?: BudgetPeriod;
  rollover?: boolean;
  enabled?: boolean;
}

/**
 * Payload for `budgets.consume`.
 *
 * @example
 * ```ts
 * const updated = await budgets.consume('bud_1', { amount: '25.00' });
 * ```
 */
export interface ConsumeBudgetInput {
  amount: number | string;
  transactionId?: string;
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Transaction / Proposal                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateTransactionInput {
  walletId: string;
  asset: string;
  amount: number | string;
  recipientAddress: string;
  agentId?: string;
  policyId?: string;
  budgetId?: string;
  memo?: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface TransactionListParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  status?: TransactionStatus;
  asset?: string;
  walletId?: string;
  agentId?: string;
  risk?: 'low' | 'medium' | 'high' | 'critical';
}

export interface CreateProposalInput {
  transactionId: string;
  title: string;
  description?: string;
  approvalType?: ApprovalType;
  requiredApprovals?: number;
  expiresAt?: string;
}

export interface ApproveProposalInput {
  comment?: string;
}

export interface RejectProposalInput {
  comment?: string;
}

/* -------------------------------------------------------------------------- */
/* Notification                                                                 */
/* -------------------------------------------------------------------------- */

export interface NotificationListParams {
  page?: number;
  limit?: number;
  read?: boolean;
  type?: NotificationType;
  channel?: NotificationChannel;
}

export interface UpdateNotificationPreferencesInput {
  channels?: Partial<Record<NotificationChannel, boolean>>;
  types?: Partial<Record<NotificationType, boolean>>;
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateWebhookInput {
  url: string;
  events: string[];
  /** Provide your own secret, or let the API generate one. */
  secret?: string;
  enabled?: boolean;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  enabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Auth / Developer keys                                                        */
/* -------------------------------------------------------------------------- */

export interface RegisterInput {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Why a session's credentials were invalidated (issue #237):
 *
 * - `'refresh_failed'` — the refresh endpoint rejected the refresh token.
 * - `'refresh_token_expired'` — no usable refresh token was stored.
 * - `'unauthorized_401'` — a `401 Unauthorized` was escalated to the caller.
 */
export type AuthFailureReason = 'refresh_failed' | 'refresh_token_expired' | 'unauthorized_401';

/**
 * Emitted when authentication fails and the session's stored credentials are
 * cleared. Lets applications (and long-lived agents) react to session loss —
 * e.g. re-authenticate, rotate credentials, or alert an operator.
 */
export interface AuthFailureEvent {
  /** Why the credentials were cleared. */
  reason: AuthFailureReason;
  /** The error that caused the invalidation. */
  error: unknown;
  /** ISO-8601 timestamp of when the failure was handled. */
  timestamp: string;
}

export interface AuthSession {
  user: User;
  organization: Organization;
  session: Session;
}

export interface PasskeyRegisterInput {
  email: string;
  displayName?: string;
}

export interface PasskeyVerifyInput {
  email: string;
  credential: Record<string, unknown>;
}

export interface CreateApiKeyInput {
  name: string;
  permissions?: string[];
  expiresAt?: string;
}
