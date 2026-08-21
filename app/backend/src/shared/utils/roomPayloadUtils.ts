/**
 * Shared room payload utility functions
 */
import { GRACE_PERIOD_MEMBER_MS, GRACE_PERIOD_OWNER_MS } from '@jam-band/shared';

/**
 * Interface for the membership service methods needed by buildRoomPayload.
 * This avoids importing the full RoomMembershipService class.
 */
interface RoomMembershipReader {
  getBandMembers(roomId: string): Promise<unknown[]>;
  getAudiences(roomId: string): Promise<unknown[]>;
  getPendingMembers(roomId: string): Promise<unknown[]>;
}

interface GracePeriodEntry {
  userId: string;
  timestamp: number;
  isIntendedLeave: boolean;
  userData: unknown;
}

interface GracePeriodReader {
  getRoomGracePeriodUsers(roomId: string): GracePeriodEntry[];
}

export interface GracePeriodUserPayload {
  user: unknown;
  status: 'reconnecting';
  disconnectedAt: string;
  expiresAt: string;
  remainingMs: number;
  isIntendedLeave: false;
}

const getGracePeriodMs = (role?: string): number => {
  return role === 'room_owner' ? GRACE_PERIOD_OWNER_MS : GRACE_PERIOD_MEMBER_MS;
};

/**
 * Build a room payload with fresh bandMembers, audiences, and pendingMembers from Redis.
 * Reduces duplicated 3-query pattern across all handlers.
 *
 * @param requestingUserId - When provided, invite codes are stripped unless this user is the room owner.
 */
export async function buildRoomPayload(
  roomMembershipService: RoomMembershipReader,
  room: unknown,
  roomId: string,
  gracePeriodReader?: GracePeriodReader,
  requestingUserId?: string
) {
  const [bandMembers, audiences, pendingMembers] = await Promise.all([
    roomMembershipService.getBandMembers(roomId),
    roomMembershipService.getAudiences(roomId),
    roomMembershipService.getPendingMembers(roomId),
  ]);

  const now = Date.now();
  const activeUserIds = new Set([
    ...bandMembers.map((user) => (user as { id: string }).id),
    ...audiences.map((user) => (user as { id: string }).id),
  ]);
  const gracePeriodUsers: GracePeriodUserPayload[] = gracePeriodReader
    ? gracePeriodReader
        .getRoomGracePeriodUsers(roomId)
        .filter((entry) => !entry.isIntendedLeave && entry.userData != null && !activeUserIds.has(entry.userId))
        .map((entry) => {
          const gracePeriodMs = getGracePeriodMs((entry.userData as { role?: string } | null)?.role);
          const expiresAtMs = entry.timestamp + gracePeriodMs;

          return {
            user: entry.userData,
            status: 'reconnecting',
            disconnectedAt: new Date(entry.timestamp).toISOString(),
            expiresAt: new Date(expiresAtMs).toISOString(),
            remainingMs: Math.max(0, expiresAtMs - now),
            isIntendedLeave: false,
          };
        })
    : [];

  // Only expose invite codes to the room owner.
  // Strip them for all other clients to prevent information leakage.
  const roomRecord = room as Record<string, unknown>;
  const isRoomOwner = requestingUserId != null && roomRecord.owner === requestingUserId;
  const roomData = {
    ...roomRecord,
    bandMembers,
    audiences,
    pendingMembers,
    gracePeriodUsers,
    activeBandMemberCount: bandMembers.length,
  };

  if (!isRoomOwner) {
    delete (roomData as Record<string, unknown>).bandMemberInviteCode;
    delete (roomData as Record<string, unknown>).audienceInviteCode;
  }

  return { room: roomData };
}
