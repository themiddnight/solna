/**
 * Shared pagination utility functions
 */

export interface PaginationParams {
  search: string;
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parse search and pagination params from Express request query.
 * @param query - Express request query object (req.query)
 * @param options - Optional configuration
 * @param options.lowercaseSearch - Whether to lowercase the search string (default: false)
 * @param options.defaultLimit - Default page size (default: 20)
 * @param options.maxLimit - Maximum page size (default: 100)
 */
export function parsePaginationParams(
  query: Record<string, unknown>,
  options?: { lowercaseSearch?: boolean; defaultLimit?: number; maxLimit?: number }
): PaginationParams {
  const { lowercaseSearch: isLowercaseSearch = false, defaultLimit = 20, maxLimit = 100 } = options || {};

  let search = typeof query.search === 'string' ? query.search.trim() : '';
  if (isLowercaseSearch) {
    search = search.toLowerCase();
  }

  const parsedPage = parseInt(String(query.page !== undefined && query.page !== null ? query.page : '1'), 10);
  const page = Math.max(1, Number.isNaN(parsedPage) ? 1 : parsedPage);
  const parsedLimit = parseInt(String(query.limit !== undefined && query.limit !== null ? query.limit : String(defaultLimit)), 10);
  const limit = Math.min(maxLimit, Math.max(1, Number.isNaN(parsedLimit) ? defaultLimit : parsedLimit));
  const skip = (page - 1) * limit;

  return { search, page, limit, skip };
}
