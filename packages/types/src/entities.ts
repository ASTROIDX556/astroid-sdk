/**
 * Core domain entities as returned by the Astroid API.
 *
 * Field names and shapes mirror the `astroid-api` Prisma models. Timestamps are
 * ISO-8601 UTC strings over the wire (the API serialises `DateTime` to JSON).
 * Monetary amounts are strings to preserve decimal precision (Prisma `Decimal`).
 */

import type {
  AgentRole,
  AgentStatus,
  ApprovalDecision,
  ApprovalType,
  BudgetPeriod,
  NotificationChannel,
  NotificationType,
  OrganizationPlan,
  OrganizationStatus,
  PolicyType,
  ProposalStatus,
  RiskBand,
  StellarNetwork,
  TransactionStatus,
  UserRole,
  UserStatus,
  WalletStatus,
  WalletType,
} from './enums.js';

/** ISO-8601 timestamp string (UTC). */
export type IsoDateTime = string;

/** A decimal monetary amount serialised as a string to preserve precision. */
export type DecimalString = string;

/** 1. Organization — the multi-tenant root. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  description?: string | null;
  plan: OrganizationPlan;
  status: OrganizationStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** 2. User — a human member of an organization. */
export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  avatar?: string | null;
  role: UserRole;
  status: UserStatus;
  lastLogin?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** 3. Agent — an autonomous AI financial actor. */
export interface Agent {
  id: string;
  organizationId: string;
  primaryWalletId?: string | null;
  name: string;
  description?: string | null;
  provider?: string | null;
  model?: string | null;
  role: AgentRole;
  status: AgentStatus;
  capabilities: string[];
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** 4. Wallet — a programmable Stellar wallet. */
export interface Wallet {
  id: string;
  organizationId: string;
  agentId?: string | null;
  stellarAddress: string;
  label?: string | null;
  walletType: WalletType;
  network: StellarNetwork;
  status: WalletStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** A single asset balance on a wallet. */
export interface AssetBalance {
  asset: string;
  balance: DecimalString;
  /** Optional issuer for non-native Stellar assets. */
  issuer?: string | null;
}

/** The full balance snapshot for a wallet. */
export interface WalletBalance {
  walletId: string;
  stellarAddress: string;
  network: StellarNetwork;
  balances: AssetBalance[];
  updatedAt: IsoDateTime;
}

/** 5. Policy — a programmable spending rule (JSONB configuration). */
export interface Policy {
  id: string;
  organizationId: string;
  agentId?: string | null;
  name: string;
  description?: string | null;
  type: PolicyType;
  configuration: PolicyConfiguration;
  priority: number;
  enabled: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/**
 * Flexible policy configuration. The backend stores this as JSONB so many
 * policy types share one schema. Common fields are typed; arbitrary extension
 * keys remain available.
 */
export interface PolicyConfiguration {
  maxAmount?: number;
  minAmount?: number;
  asset?: string;
  allowedAssets?: string[];
  blockedAssets?: string[];
  allowedRecipients?: string[];
  blockedRecipients?: string[];
  requiresApproval?: boolean;
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  timeWindow?: { start: string; end: string; timezone?: string };
  [key: string]: unknown;
}

/** 6. Budget — a spending allocation in a hierarchy. */
export interface Budget {
  id: string;
  organizationId: string;
  parentBudgetId?: string | null;
  agentId?: string | null;
  name: string;
  currency: string;
  limitAmount: DecimalString;
  spent: DecimalString;
  /** Convenience: `limitAmount - spent`, provided by the API. */
  remaining: DecimalString;
  period: BudgetPeriod;
  periodStart: IsoDateTime;
  rollover: boolean;
  enabled: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** A single point in a budget's consumption history. */
export interface BudgetHistoryEntry {
  id: string;
  budgetId: string;
  amount: DecimalString;
  spentAfter: DecimalString;
  transactionId?: string | null;
  createdAt: IsoDateTime;
}

/** 7. Transaction — a financial movement and its governance metadata. */
export interface Transaction {
  id: string;
  organizationId: string;
  walletId: string;
  agentId?: string | null;
  policyId?: string | null;
  budgetId?: string | null;
  asset: string;
  amount: DecimalString;
  senderAddress?: string | null;
  recipientAddress: string;
  memo?: string | null;
  purpose?: string | null;
  status: TransactionStatus;
  riskScore: number;
  riskBand: RiskBand;
  requiresApproval: boolean;
  stellarHash?: string | null;
  confirmationCount: number;
  gasEstimate?: DecimalString | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime | null;
}

/** 8. Proposal — an action awaiting approval. */
export interface Proposal {
  id: string;
  organizationId: string;
  transactionId: string;
  title: string;
  description?: string | null;
  approvalType: ApprovalType;
  requiredApprovals: number;
  status: ProposalStatus;
  expiresAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 9. Approval — a single decision on a proposal. */
export interface Approval {
  id: string;
  proposalId: string;
  userId: string;
  decision: ApprovalDecision;
  comment?: string | null;
  createdAt: IsoDateTime;
}

/** 10. Audit Log — an immutable record of an action. */
export interface AuditLog {
  id: string;
  organizationId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
  device?: string | null;
  createdAt: IsoDateTime;
}

/** 11. Notification. */
export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  channel: NotificationChannel;
  read: boolean;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/** Per-channel notification delivery preferences. */
export interface NotificationPreferences {
  channels: Record<NotificationChannel, boolean>;
  types: Partial<Record<NotificationType, boolean>>;
}

/** 12. API Key — the raw `key` is only ever returned once, at creation. */
export interface ApiKey {
  id: string;
  organizationId: string;
  createdById?: string | null;
  name: string;
  prefix: string;
  permissions: string[];
  lastUsedAt?: IsoDateTime | null;
  expiresAt?: IsoDateTime | null;
  revokedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** The response to creating an API key: includes the one-time plaintext key. */
export interface ApiKeyWithSecret extends ApiKey {
  key: string;
}

/** 13. Webhook. */
export interface Webhook {
  id: string;
  organizationId: string;
  url: string;
  /** The signing secret; only returned on create/rotate. */
  secret?: string;
  events: string[];
  enabled: boolean;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

/** 14. Session. */
export interface Session {
  id: string;
  userId: string;
  device?: string | null;
  browser?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  lastActivityAt: IsoDateTime;
  expiresAt: IsoDateTime;
  revokedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** 15. Memory Record — financial memory that powers explainability. */
export interface MemoryRecord {
  id: string;
  organizationId: string;
  agentId?: string | null;
  transactionId?: string | null;
  task?: string | null;
  reason?: string | null;
  conversationId?: string | null;
  policyUsed?: string | null;
  risk?: number | null;
  summary?: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/** An append-only domain event (event-sourcing / immutable ledger). */
export interface DomainEvent {
  id: string;
  organizationId?: string | null;
  name: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  actorId?: string | null;
  sequence: number;
  occurredAt: IsoDateTime;
}

/** An entry in an agent's activity feed. */
export interface AgentActivity {
  id: string;
  agentId: string;
  action: string;
  summary: string;
  transactionId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/** A single log entry from an agent's execution history. */
export interface AgentLog {
  id: string;
  agentId: string;
  level: AgentLogLevel;
  message: string;
  source?: string | null;
  transactionId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

/** Log level for agent execution logs. */
export const AgentLogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;
export type AgentLogLevel = (typeof AgentLogLevel)[keyof typeof AgentLogLevel];

/** Real-time operational status metrics for an agent. */
export interface AgentStatusMetrics {
  agentId: string;
  status: AgentStatus;
  /** Whether the agent is currently executing a task. */
  isActive: boolean;
  /** Total tasks completed since the agent was last resumed. */
  tasksCompleted: number;
  /** Tasks currently in progress. */
  tasksInProgress: number;
  /** Total spending in the current period, as a decimal string. */
  currentSpend: DecimalString;
  /** Budget limit remaining, as a decimal string. */
  budgetRemaining: DecimalString;
  /** ISO-8601 timestamp of the agent's last activity. */
  lastActivityAt: IsoDateTime;
  /** Uptime in seconds since the agent was last started. */
  uptimeSeconds: number;
  /** Error count in the current period. */
  errorCount: number;
  metadata: Record<string, unknown>;
  updatedAt: IsoDateTime;
}
