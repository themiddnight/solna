/**
 * Centralized Redis Key Definitions
 *
 * This file serves as the single source of truth for all Redis key patterns
 * in the murva application.
 *
 * ## Key Prefix:
 * All keys are automatically namespaced with `collab:` by RedisStateService.buildKey().
 * Do NOT include the prefix here.
 *
 * ## Naming Convention:
 * - **Static keys** (UPPER_SNAKE_CASE): constant string keys used as hash names or standalone keys
 * - **Dynamic keys** (camelCase functions): key builders that accept parameters and return a string
 *
 * ## Key Categories:
 * 1. ROOM_METADATA    - Room data and room ID registry
 * 2. ROOM_USERS       - Per-room band members and audiences
 * 3. ROOM_STATE       - Real-time room state (Perform / Arrange)
 * 4. PROJECT_MAPPING  - Project ↔ active room bi-directional mapping
 * 5. SESSIONS         - Socket session tracking across namespaces
 * 6. RATE_LIMITING    - Distributed rate limit counters
 */

// ============================================================
// ROOM METADATA
// Hash / Set for tracking active rooms and their metadata
// ============================================================

export const REDIS_KEYS = {

  // ── Room Metadata ─────────────────────────────────────────
  /** Hash: roomId → serialized room metadata (RoomRepository) */
  ROOMS_HASH: 'rooms',

  /** Set: all active room IDs (RoomRepository) */
  ROOM_IDS_SET: 'rooms:ids',

  // ── Room Users (dynamic) ──────────────────────────────────
  /** Set: band member user IDs in a room */
  roomMembers: (roomId: string): string => `rooms:${roomId}:members`,

  /** Set: audience user IDs in a room */
  roomAudiences: (roomId: string): string => `rooms:${roomId}:audiences`,

  /** String: individual user data (BandMember | Audience) */
  roomMemberData: (roomId: string, userId: string): string => `rooms:${roomId}:member:${userId}`,

  // ── Room State (dynamic) ──────────────────────────────────
  /** String: serialized PerformRoomState (24h TTL) */
  performState: (roomId: string): string => `perform:state:${roomId}`,

  /** String: serialized ArrangeRoomState (24h TTL) */
  arrangeState: (roomId: string): string => `arrange:state:${roomId}`,

  // ── Project-Room Mapping ──────────────────────────────────
  /** Hash: projectId → roomId (forward lookup) */
  PROJECT_ACTIVE_ROOMS: 'project:active_rooms',

  /** Hash: roomId → projectId (reverse lookup) */
  ROOM_PROJECTS: 'room:projects',

  // ── Sessions (dynamic) ────────────────────────────────────
  /** String: full NamespaceSession data for a socket (24h TTL) */
  sessionSocket: (socketId: string): string => `sessions:socket:${socketId}`,

  /** Hash: socketId → NamespaceSession (per room namespace) */
  sessionRoom: (roomId: string): string => `sessions:room:${roomId}`,

  /** Hash: socketId → NamespaceSession (per approval namespace) */
  sessionApproval: (roomId: string): string => `sessions:approval:${roomId}`,

  /** Hash: roomId → socketId (reverse lookup: user → socket per room) */
  sessionUser: (userId: string): string => `sessions:user:${userId}`,

  /** Hash: socketId → NamespaceSession (lobby namespace) */
  SESSION_LOBBY: 'sessions:lobby',

  // ── Invite Code Reverse Lookup ────────────────────────────
  /** Hash: inviteCode → roomId (O(1) lookup for GET /api/rooms/invite/:code) */
  INVITE_CODE_LOOKUP: 'invite_codes',

  // ── Rate Limiting (dynamic) ───────────────────────────────
  /** String: sliding-window counter for socket rate limiting */
  rateLimit: (eventName: string, userId: string): string => `ratelimit:${eventName}:${userId}`,

  // ── OAuth one-time exchange code (DEV-187) ────────────────
  /** String: one-time OAuth exchange code → issued tokens (short TTL, single-use) */
  oauthExchangeCode: (code: string): string => `oauth:exchange:${code}`,

  // ── Cleanup Sweep Coordination (DEV-258) ──────────────────
  /** String: distributed lock — only one process runs destructive room/session sweeps at a time */
  CLEANUP_SWEEP_LOCK: 'cleanup:sweep:lock',

} as const;

// ── Type Exports ──────────────────────────────────────────────
/** Union of all static (non-function) Redis key values */
export type StaticRedisKey = Extract<typeof REDIS_KEYS[keyof typeof REDIS_KEYS], string>;
