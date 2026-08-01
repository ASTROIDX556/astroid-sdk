/**
 * Auto-paginating async iterator over Astroid list endpoints.
 *
 * `paginate` lets callers stream every item across pages without managing page
 * numbers: `for await (const tx of paginate(params => client.get(...)))`.
 */

import type { PaginationMeta } from '@astroid/types';
import type { AstroidResponse } from './http-types.js';

/** A function that fetches one page for the given 1-based page number. */
export type PageFetcher<TItem> = (page: number) => Promise<AstroidResponse<TItem[]>>;

/** Derive pagination metadata from a response's `meta`, tolerating omissions. */
function readMeta(response: AstroidResponse<unknown>): PaginationMeta | undefined {
  const meta = response.meta;
  if (!meta) return undefined;
  const { page, limit, total, totalPages } = meta as Partial<PaginationMeta>;
  if (page === undefined || limit === undefined) return undefined;
  const resolvedTotalPages = totalPages ?? (total !== undefined && limit > 0 ? Math.ceil(total / limit) : page);
  return {
    page,
    limit,
    total: total ?? 0,
    totalPages: resolvedTotalPages,
    hasNextPage: page < resolvedTotalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Lazily iterate every item across all pages. Stops when a page returns no
 * items or the pagination metadata indicates the last page was reached.
 */
export async function* paginate<TItem>(fetchPage: PageFetcher<TItem>): AsyncGenerator<TItem, void, void> {
  let page = 1;
  // Hard ceiling to avoid an accidental infinite loop against a broken API.
  const maxPages = 10_000;
  while (page <= maxPages) {
    const response = await fetchPage(page);
    const items = response.data ?? [];
    for (const item of items) yield item;

    const meta = readMeta(response);
    if (meta) {
      if (!meta.hasNextPage) return;
    } else if (items.length === 0) {
      return;
    }
    page += 1;
  }
}

/** Collect an entire async iterable into an array (convenience for callers). */
export async function collect<TItem>(iterable: AsyncIterable<TItem>): Promise<TItem[]> {
  const out: TItem[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
