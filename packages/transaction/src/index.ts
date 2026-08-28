/**
 * `@astroid/transaction` — transaction lifecycle and proposal/approval resource.
 *
 * Covers creating transactions (which may enter an approval flow), reading and
 * listing them, and the human-in-the-loop proposal surface: listing pending
 * proposals and approving/rejecting them. Every monetary field is a decimal
 * string; nothing here logs recipient secrets or private keys.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  Approval,
  ApproveProposalInput,
  CreateProposalInput,
  CreateTransactionInput,
  Paginated,
  PaginationParams,
  Proposal,
  ProposalStatus,
  RejectProposalInput,
  Transaction,
  TransactionListParams,
} from '@astroid/types';

/** Filters accepted by {@link TransactionResource.listProposals}. */
export interface ProposalListParams extends PaginationParams {
  status?: ProposalStatus;
  transactionId?: string;
}

/**
 * The `transactions` namespace on the Astroid client.
 *
 * A created transaction is evaluated against policy and risk: it either
 * proceeds or is parked as a {@link Proposal} awaiting approval. This resource
 * exposes both the transaction read model and the proposal/approval workflow.
 */
export class TransactionResource extends Resource {
  /**
   * Create a transaction. Depending on policy it may be submitted immediately
   * or returned in a `PENDING` state requiring approval.
   */
  async create(input: CreateTransactionInput): Promise<Transaction> {
    const res = await this.client.post<Transaction>('/transactions', input);
    return res.data;
  }

  /** Fetch a single transaction by id. */
  async get(transactionId: string): Promise<Transaction> {
    return this.getData<Transaction>(`/transactions/${encodeURIComponent(transactionId)}`);
  }

  /** List transactions, with rich filters (status, asset, risk, …) and paging. */
  async list(params: TransactionListParams = {}): Promise<Paginated<Transaction>> {
    return this.listData<Transaction>('/transactions', { ...params });
  }

  /** Iterate every transaction across all pages. */
  iterate(params: TransactionListParams = {}): AsyncGenerator<Transaction, void, void> {
    return this.iterateData<Transaction>('/transactions', { ...params });
  }

  /** Cancel a not-yet-submitted transaction. */
  async cancel(transactionId: string): Promise<Transaction> {
    const res = await this.client.post<Transaction>(
      `/transactions/${encodeURIComponent(transactionId)}/cancel`,
    );
    return res.data;
  }

  /* ------------------------------ proposals ------------------------------- */

  /** Open a proposal for a transaction that needs approval. */
  async createProposal(input: CreateProposalInput): Promise<Proposal> {
    const res = await this.client.post<Proposal>('/proposals', input);
    return res.data;
  }

  /** Fetch a single proposal by id. */
  async getProposal(proposalId: string): Promise<Proposal> {
    return this.getData<Proposal>(`/proposals/${encodeURIComponent(proposalId)}`);
  }

  /** List proposals, filterable by status or originating transaction. */
  async listProposals(params: ProposalListParams = {}): Promise<Paginated<Proposal>> {
    return this.listData<Proposal>('/proposals', { ...params });
  }

  /** Iterate every proposal across all pages. */
  iterateProposals(params: ProposalListParams = {}): AsyncGenerator<Proposal, void, void> {
    return this.iterateData<Proposal>('/proposals', { ...params });
  }

  /** Approve a proposal; returns the recorded approval decision. */
  async approve(proposalId: string, input: ApproveProposalInput = {}): Promise<Approval> {
    const res = await this.client.post<Approval>(
      `/proposals/${encodeURIComponent(proposalId)}/approve`,
      input,
    );
    return res.data;
  }

  /** Reject a proposal; returns the recorded rejection decision. */
  async reject(proposalId: string, input: RejectProposalInput = {}): Promise<Approval> {
    const res = await this.client.post<Approval>(
      `/proposals/${encodeURIComponent(proposalId)}/reject`,
      input,
    );
    return res.data;
  }

  /** The approvals recorded against a proposal. */
  async approvals(proposalId: string): Promise<Approval[]> {
    const res = await this.client.get<Approval[]>(
      `/proposals/${encodeURIComponent(proposalId)}/approvals`,
    );
    return res.data ?? [];
  }
}

export * from './decoder';
