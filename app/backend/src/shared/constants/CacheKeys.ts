/**
 * Centralized NodeCache (In-Memory L1) Key Definitions
 *
 * NodeCache is used for fast in-memory caching (per-instance).
 * Keys here are NOT shared across server instances.
 *
 * ## Naming Convention:
 * - **Static keys** (UPPER_SNAKE_CASE): constant string keys
 * - **Dynamic keys** (camelCase functions): key builders that accept parameters
 *
 * ## Key Categories:
 * 1. PREFIXES       - For bulk operations (invalidation, scanning)
 * 2. ROOM_CACHE     - Individual room data and room lists
 */

export const CACHE_KEYS = {
  // ── Prefixes (for bulk operations) ───────────────────────
  /** Prefix for individual room cache keys */
  ROOM_PREFIX: 'room:',

  /** Prefix for room list cache keys */
  ROOMS_LIST_PREFIX: 'rooms:',

  // ── Room Cache (dynamic) ──────────────────────────────────
  /** Individual room data cache */
  room: (roomId: string): string => `room:${roomId}`,

  /** Room list cache (lobby, public rooms, etc.) */
  roomsList: (key: string): string => `rooms:${key}`,

  /** Socket-connection auth-user projection (short TTL) — avoids a DB hit per socket connect */
  socketAuthUser: (userId: string): string => `socket-auth-user:${userId}`,

  // ── Predefined Room List Keys ─────────────────────────────
  /** All rooms for authenticated users */
  ROOMS_LIST_AUTHENTICATED: 'all_rooms_authenticated',

  /** All rooms for public/guest users */
  ROOMS_LIST_PUBLIC: 'all_rooms_public',

} as const;

// ── Type Exports ──────────────────────────────────────────────
/** Union of all static (non-function) cache key values */
export type StaticCacheKey = Extract<typeof CACHE_KEYS[keyof typeof CACHE_KEYS], string>;
