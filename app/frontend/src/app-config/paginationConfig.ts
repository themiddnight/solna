/**
 * Pagination configuration constants for list APIs
 */

export const PAGINATION_LIMITS = {
  /** Default number of rooms per page */
  ROOMS: 20,
  /** Default number of projects per page */
  PROJECTS: 20,
  /** Default number of bands per page */
  BANDS: 20,
} as const;

export type PaginationLimitKey = keyof typeof PAGINATION_LIMITS;
