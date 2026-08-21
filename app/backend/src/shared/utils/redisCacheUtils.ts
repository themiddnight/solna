/**
 * Redis cache utilities for room membership
 * Provides efficient caching layer to eliminate DB queries from realtime path
 */

import type { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const MEMBERSHIP_KEY = (roomId: string) => `room:membership:${roomId}`;
const MEMBERSHIP_TTL = 24 * 60 * 60; // 24 hours

/**
 * Cache a user's membership in a room
 * Adds userId to a Redis set for quick membership checks
 */
export async function cacheUserJoin(
  redis: RedisClient,
  roomId: string,
  userId: string
): Promise<void> {
  await redis.sAdd(MEMBERSHIP_KEY(roomId), userId);
  await redis.expire(MEMBERSHIP_KEY(roomId), MEMBERSHIP_TTL);
}

/**
 * Remove a user from room membership cache
 * Called when user leaves or is kicked
 */
export async function cacheUserLeave(
  redis: RedisClient,
  roomId: string,
  userId: string
): Promise<void> {
  await redis.sRem(MEMBERSHIP_KEY(roomId), userId);
}

/**
 * Check if a user is in a room (cached membership check)
 * Returns true if user is a member, false otherwise
 * Used for realtime event authorization
 */
export async function isUserInRoomCache(
  redis: RedisClient,
  roomId: string,
  userId: string
): Promise<boolean> {
  const result = await redis.sIsMember(MEMBERSHIP_KEY(roomId), userId);
  return result === 1;
}

/**
 * Clear all membership cache for a room
 * Called when room is closed or cleaned up
 */
export async function clearRoomMembership(
  redis: RedisClient,
  roomId: string
): Promise<void> {
  await redis.del(MEMBERSHIP_KEY(roomId));
}

/**
 * Get all members cached for a room
 * Useful for debugging or bulk operations
 */
export async function getRoomMembers(
  redis: RedisClient,
  roomId: string
): Promise<string[]> {
  const result = await redis.sMembers(MEMBERSHIP_KEY(roomId));
  return result;
}
