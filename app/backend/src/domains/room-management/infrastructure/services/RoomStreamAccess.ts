import type { Request } from 'express';
import { tokenService } from '@/domains/auth/domain/services/TokenService';
import type { Room } from '@/types';

/** Verify the Bearer token on the request and return its userId, or null when absent/invalid. */
export const resolveTokenUserId = (req: Request): string | null => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token === undefined || token === '') return null;
  try {
    return tokenService.verifyToken(token).userId;
  } catch {
    return null;
  }
};

/**
 * Streaming access gate (DEV-190).
 *
 * Private-room media — the live HLS broadcast and recorded audio regions — must only be served to
 * verified room members; public rooms stay open (their content is public). Guests only ever exist
 * in public rooms (private rooms require approval / a registered account), so a registered-JWT
 * membership check fully protects private rooms without ever blocking a legitimate guest, and so
 * does not depend on the socket-auth guest-token work.
 *
 * Membership is enforced from the verified token, never from a client-supplied `userId` param (the
 * previous `if (userId)` form was bypassable by simply omitting the param).
 */
export const canStreamRoomMedia = (
  room: Pick<Room, 'isPrivate' | 'bandMembers' | 'audiences'>,
  req: Request,
): boolean => {
  if (!room.isPrivate) return true;
  const userId = resolveTokenUserId(req);
  if (userId === null) return false;
  return room.bandMembers.has(userId) || room.audiences.has(userId);
};
