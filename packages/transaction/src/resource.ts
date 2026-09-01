/**
 * `TransactionsResource` — transaction CRUD built directly on the core
 * {@link Resource} layer.
 *
 * @module
 */

import { Resource } from '@astroid/core';
import type {
  CreateTransactionInput,
  Paginated,
  PaginationParams,
  ProposalStatus,
  Transaction,
  TransactionListParams,
} from '@astroid/types';

/** Filters accepted by {@link TransactionsResource.list}. */
export type ProposalListParams = PaginationParams & {
  status?: ProposalStatus;
  walletId?: string;
  agentId?: string;
};

/**
 * The `transactions` namespace on the Astroid client.
 */
export class TransactionsResource extends Resource {
  /** Fetch a single transaction by id. */
  async get(transactionId: string): Promise<Transaction> {
    return this.getData<Transaction>(`/transactions/${encodeURIComponent(transactionId)}`);
  }

  /** List transactions, filterable by status, asset, wallet, and agent. */
  async list(params: TransactionListParams = {}): Promise<Paginated<Transaction>> {
    return this.listData<Transaction>('/transactions', { ...params });
  }

  /** Iterate every transaction across all pages. */
  iterate(params: TransactionListParams = {}): AsyncGenerator<Transaction, void, void> {
    return this.iterateData<Transaction>('/transactions', { ...params });
  }

  /** Create a transaction envelope for a wallet. */
  async create(input: CreateTransactionInput): Promise<Transaction> {
    const res = await this.client.post<Transaction>('/transactions', input);
    return res.data;
  }
}

/** Alias of {@link TransactionsResource} matching the `*Resource` client naming. */
export { TransactionsResource as TransactionResource };
