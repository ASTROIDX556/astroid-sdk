/**
 * `TransactionsResource` — transaction CRUD built directly on the core
 * {@link Resource} layer.
 *
 * @module
 */

import { Resource, type RequestOptionsExtras } from '@astroid/core';
import type {
  CreateTransactionInput,
  Paginated,
  PaginationParams,
  ProposalStatus,
  Transaction,
  TransactionFeeEstimate,
  TransactionListParams,
  TransactionSimulationOutcome,
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
  async get(transactionId: string, options?: RequestOptionsExtras): Promise<Transaction> {
    return this.getData<Transaction>(
      `/transactions/${encodeURIComponent(transactionId)}`,
      undefined,
      options,
    );
  }

  /** List transactions, filterable by status, asset, wallet, and agent. */
  async list(
    params: TransactionListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Transaction>> {
    return this.listData<Transaction>('/transactions', { ...params }, options);
  }

  /** Iterate every transaction across all pages. */
  iterate(
    params: TransactionListParams = {},
    options?: RequestOptionsExtras,
  ): AsyncGenerator<Transaction, void, void> {
    return this.iterateData<Transaction>('/transactions', { ...params }, options);
  }

  /** Create a transaction envelope for a wallet. */
  async create(
    input: CreateTransactionInput,
    options?: RequestOptionsExtras,
  ): Promise<Transaction> {
    const res = await this.client.post<Transaction>('/transactions', input, options);
    return res.data;
  }

  /**
   * Ask the Astroid API to estimate the fee for a transaction envelope.
   *
   * Delegates to the backend `/transactions/estimate-fee` endpoint, which
   * combines live network fee data with the organization's own configuration.
   */
  async estimateFee(
    input: {
      transactionXdr?: string;
      operationCount?: number;
      network?: string;
    },
    options?: RequestOptionsExtras,
  ): Promise<TransactionFeeEstimate> {
    const res = await this.client.post<TransactionFeeEstimate>(
      '/transactions/estimate-fee',
      input,
      options,
    );
    return res.data;
  }

  /**
   * Run a server-side dry-run of a transaction through the Astroid API before
   * broadcast. Delegates to `/transactions/simulate`.
   */
  async simulate(
    input: {
      transactionXdr: string;
      networkPassphrase?: string;
    },
    options?: RequestOptionsExtras,
  ): Promise<TransactionSimulationOutcome> {
    const res = await this.client.post<TransactionSimulationOutcome>(
      '/transactions/simulate',
      input,
      options,
    );
    return res.data;
  }
}

/** Alias of {@link TransactionsResource} matching the `*Resource` client naming. */
export { TransactionsResource as TransactionResource };
