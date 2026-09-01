import { describe, expect, it, vi } from 'vitest';

import type { Transaction } from '@astroid/types';

import {
  buildTransactionHistoryQuery,
  fetchTransactionHistory,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
} from '../src/history.js';
import type { TransactionHistoryFetcher } from '../src/history.js';

/** Minimal transaction fixture. */
function tx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    organizationId: 'org-1',
    walletId: 'wallet-1',
    asset: 'USDC',
    amount: '10',
    recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    status: 'COMPLETED',
    riskScore: 0,
    riskBand: 'LOW',
    requiresApproval: false,
    metadata: {},
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildTransactionHistoryQuery', () => {
  it('applies defaults (limit 20, desc, no filters)', () => {
    expect(buildTransactionHistoryQuery()).toEqual({
      limit: HISTORY_DEFAULT_LIMIT,
      order: 'desc',
      status: [],
    });
  });

  it('clamps limit to the [1, 100] boundary', () => {
    expect(buildTransactionHistoryQuery({ limit: 0 }).limit).toBe(1);
    expect(buildTransactionHistoryQuery({ limit: 500 }).limit).toBe(HISTORY_MAX_LIMIT);
    expect(buildTransactionHistoryQuery({ limit: 50 }).limit).toBe(50);
  });

  it('normalizes sort order', () => {
    expect(buildTransactionHistoryQuery({ order: 'asc' }).order).toBe('asc');
    expect(buildTransactionHistoryQuery({ order: 'desc' }).order).toBe('desc');
    // @ts-expect-error - invalid order falls back to desc
    expect(buildTransactionHistoryQuery({ order: 'sideways' }).order).toBe('desc');
  });

  it('maps status aliases to enum values and preserves enum values', () => {
    const query = buildTransactionHistoryQuery({
      status: ['pending', 'successful', 'failed', 'APPROVED'],
    });
    expect(query.status).toEqual(['PENDING', 'COMPLETED', 'FAILED', 'APPROVED']);
  });

  it('dedupes repeated statuses', () => {
    const query = buildTransactionHistoryQuery({ status: ['pending', 'PENDING', 'pending'] });
    expect(query.status).toEqual(['PENDING']);
  });

  it('passes through cursor and filter fields', () => {
    const query = buildTransactionHistoryQuery({
      cursor: 'cursor-42',
      asset: 'USDC',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      walletId: 'wallet-9',
    });
    expect(query.cursor).toBe('cursor-42');
    expect(query.asset).toBe('USDC');
    expect(query.recipientAddress).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW');
    expect(query.walletId).toBe('wallet-9');
  });
});

describe('fetchTransactionHistory', () => {
  it('fetches a page through the mocked fetch mechanism with the built query', async () => {
    const fetch = vi.fn<TransactionHistoryFetcher>(async (query) => ({
      data: [tx('tx-1'), tx('tx-2')],
      nextCursor: 'next-1',
      hasMore: true,
    }));

    const result = await fetchTransactionHistory(fetch, {
      limit: 10,
      status: 'pending',
      asset: 'USDC',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        order: 'desc',
        status: ['PENDING'],
        asset: 'USDC',
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.id).toBe('tx-1');
    expect(result.nextCursor).toBe('next-1');
    expect(result.hasMore).toBe(true);
  });

  it('infers hasMore from nextCursor when the page omits it', async () => {
    const fetch = vi.fn<TransactionHistoryFetcher>(async () => ({
      data: [tx('tx-1')],
      nextCursor: 'next-9',
    }));

    const result = await fetchTransactionHistory(fetch, {});

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('next-9');
  });

  it('returns hasMore false and null cursor for the final page', async () => {
    const fetch = vi.fn<TransactionHistoryFetcher>(async () => ({
      data: [tx('tx-1')],
    }));

    const result = await fetchTransactionHistory(fetch, {});

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('supports chaining successive pages via nextCursor', async () => {
    const fetch = vi.fn<TransactionHistoryFetcher>(async (query) => {
      if (!query.cursor) {
        return { data: [tx('tx-1')], nextCursor: 'cursor-2' };
      }
      return { data: [tx('tx-2')], nextCursor: null, hasMore: false };
    });

    const first = await fetchTransactionHistory(fetch, { limit: 1 });
    const second = await fetchTransactionHistory(fetch, { cursor: first.nextCursor ?? undefined });

    expect(first.items.map((t) => t.id)).toEqual(['tx-1']);
    expect(second.items.map((t) => t.id)).toEqual(['tx-2']);
    expect(second.hasMore).toBe(false);
  });
});
