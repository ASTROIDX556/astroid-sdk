/**
 * Webhook and event-system payload types.
 *
 * Event names are dot.case and match the `astroid-api` webhook catalog exactly
 * (PRD Doc 5). The same names drive the SDK's reactive event system
 * (`astroid.on('transaction.completed', ...)`).
 */

import type { Budget, Policy, Proposal, Transaction, Wallet } from './entities.js';

/**
 * The canonical webhook/event names. The first eight are the contractually
 * fixed set shared with the backend; the remainder are additional lifecycle
 * events the SDK's event system can carry.
 */
export const WebhookEvent = {
  WALLET_CREATED: 'wallet.created',
  WALLET_UPDATED: 'wallet.updated',
  WALLET_FROZEN: 'wallet.frozen',
  WALLET_ARCHIVED: 'wallet.archived',
  PROPOSAL_CREATED: 'proposal.created',
  PROPOSAL_APPROVED: 'proposal.approved',
  PROPOSAL_REJECTED: 'proposal.rejected',
  PROPOSAL_EXPIRED: 'proposal.expired',
  PROPOSAL_EXECUTED: 'proposal.executed',
  TRANSACTION_SUBMITTED: 'transaction.submitted',
  TRANSACTION_CONFIRMED: 'transaction.confirmed',
  TRANSACTION_COMPLETED: 'transaction.completed',
  TRANSACTION_FAILED: 'transaction.failed',
  POLICY_VIOLATED: 'policy.violated',
  BUDGET_EXCEEDED: 'budget.exceeded',
  BUDGET_WARNING: 'budget.warning',
} as const;
export type WebhookEventName = (typeof WebhookEvent)[keyof typeof WebhookEvent];

/** Payload carried by a `policy.violated` event. */
export interface PolicyViolatedPayload {
  policy: Policy;
  transaction?: Transaction;
  message: string;
}

/** Payload carried by a `budget.exceeded` / `budget.warning` event. */
export interface BudgetThresholdPayload {
  budget: Budget;
  transaction?: Transaction;
  threshold: number;
}

/** Maps each event name to the shape of its `data` field. */
export interface WebhookEventDataMap {
  'wallet.created': Wallet;
  'wallet.updated': Wallet;
  'wallet.frozen': Wallet;
  'wallet.archived': Wallet;
  'proposal.created': Proposal;
  'proposal.approved': Proposal;
  'proposal.rejected': Proposal;
  'proposal.expired': Proposal;
  'proposal.executed': Proposal;
  'transaction.submitted': Transaction;
  'transaction.confirmed': Transaction;
  'transaction.completed': Transaction;
  'transaction.failed': Transaction;
  'policy.violated': PolicyViolatedPayload;
  'budget.exceeded': BudgetThresholdPayload;
  'budget.warning': BudgetThresholdPayload;
}

/**
 * A single delivered event. Generic over the event name so `data` is precisely
 * typed once you narrow `event`.
 */
export interface WebhookEventEnvelope<TName extends WebhookEventName = WebhookEventName> {
  id: string;
  event: TName;
  organizationId: string;
  createdAt: string;
  data: WebhookEventDataMap[TName];
}

/** The discriminated union of every possible delivered event. */
export type AnyWebhookEvent = {
  [K in WebhookEventName]: WebhookEventEnvelope<K>;
}[WebhookEventName];

/** Headers the API sends with each webhook delivery (PRD Doc 10). */
export interface WebhookHeaders {
  /** Hex-encoded HMAC-SHA256 signature of the raw body. */
  'x-astroid-signature': string;
  /** Unix timestamp (seconds) the delivery was signed at. */
  'x-astroid-timestamp': string;
  /** Unique event id, for idempotent processing. */
  'x-astroid-event-id': string;
  'x-astroid-delivery-attempt': string;
}

/**
 * The typed handler map used by the SDK event system. `[event]` payloads match
 * `WebhookEventDataMap`, so `astroid.on('transaction.completed', tx => ...)`
 * gives you a fully-typed `Transaction`.
 */
export type EventHandlerMap = {
  [K in WebhookEventName]: (data: WebhookEventDataMap[K], event: WebhookEventEnvelope<K>) => void;
};
