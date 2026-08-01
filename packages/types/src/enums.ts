/**
 * Enumerations shared across the Astroid platform.
 *
 * These mirror the Prisma enums in `astroid-api` exactly so that the SDK and the
 * backend never disagree on a value. Each enum is expressed as a `const` object
 * plus a union type of its values: this keeps the runtime values tree-shakeable
 * and importable while the type stays a precise string-literal union (no
 * TypeScript `enum`, no `any`).
 */

export const OrganizationPlan = {
  FREE: 'FREE',
  STARTER: 'STARTER',
  GROWTH: 'GROWTH',
  ENTERPRISE: 'ENTERPRISE',
} as const;
export type OrganizationPlan = (typeof OrganizationPlan)[keyof typeof OrganizationPlan];

export const OrganizationStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type OrganizationStatus = (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

export const UserRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  FINANCE: 'FINANCE',
  DEVELOPER: 'DEVELOPER',
  AUDITOR: 'AUDITOR',
  VIEWER: 'VIEWER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const AgentRole = {
  FINANCE: 'FINANCE',
  RESEARCH: 'RESEARCH',
  OPERATIONS: 'OPERATIONS',
  PROCUREMENT: 'PROCUREMENT',
  CUSTOM: 'CUSTOM',
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const AgentStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const WalletType = {
  AGENT: 'AGENT',
  TREASURY: 'TREASURY',
  ESCROW: 'ESCROW',
  SHARED: 'SHARED',
  PERSONAL: 'PERSONAL',
} as const;
export type WalletType = (typeof WalletType)[keyof typeof WalletType];

export const WalletStatus = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WalletStatus = (typeof WalletStatus)[keyof typeof WalletStatus];

export const StellarNetwork = {
  TESTNET: 'TESTNET',
  PUBLIC: 'PUBLIC',
  FUTURENET: 'FUTURENET',
} as const;
export type StellarNetwork = (typeof StellarNetwork)[keyof typeof StellarNetwork];

export const PolicyType = {
  MAX_AMOUNT: 'MAX_AMOUNT',
  MIN_AMOUNT: 'MIN_AMOUNT',
  ALLOWED_ASSETS: 'ALLOWED_ASSETS',
  BLOCKED_ASSETS: 'BLOCKED_ASSETS',
  DAILY_BUDGET: 'DAILY_BUDGET',
  WEEKLY_BUDGET: 'WEEKLY_BUDGET',
  MONTHLY_BUDGET: 'MONTHLY_BUDGET',
  ALLOWED_RECIPIENTS: 'ALLOWED_RECIPIENTS',
  BLOCKED_RECIPIENTS: 'BLOCKED_RECIPIENTS',
  TIME_WINDOW: 'TIME_WINDOW',
  DEPARTMENT_RULE: 'DEPARTMENT_RULE',
  AGENT_RULE: 'AGENT_RULE',
  EMERGENCY_LOCK: 'EMERGENCY_LOCK',
  COMPOSITE: 'COMPOSITE',
} as const;
export type PolicyType = (typeof PolicyType)[keyof typeof PolicyType];

export const BudgetPeriod = {
  ONE_TIME: 'ONE_TIME',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type BudgetPeriod = (typeof BudgetPeriod)[keyof typeof BudgetPeriod];

export const TransactionStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const RiskBand = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type RiskBand = (typeof RiskBand)[keyof typeof RiskBand];

export const ProposalStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  EXECUTED: 'EXECUTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const ApprovalType = {
  SINGLE: 'SINGLE',
  DUAL: 'DUAL',
  MULTISIG: 'MULTISIG',
  ROLE: 'ROLE',
  COMMITTEE: 'COMMITTEE',
  EMERGENCY: 'EMERGENCY',
} as const;
export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export const ApprovalDecision = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DELEGATED: 'DELEGATED',
  EXPIRED: 'EXPIRED',
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const NotificationType = {
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  PROPOSAL_APPROVED: 'PROPOSAL_APPROVED',
  PROPOSAL_REJECTED: 'PROPOSAL_REJECTED',
  WALLET_FUNDED: 'WALLET_FUNDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  RISK_ALERT: 'RISK_ALERT',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  INFO: 'INFO',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  DASHBOARD: 'DASHBOARD',
  EMAIL: 'EMAIL',
  DISCORD: 'DISCORD',
  SLACK: 'SLACK',
  WEBHOOK: 'WEBHOOK',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Sort direction for list endpoints. */
export const SortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const;
export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];
