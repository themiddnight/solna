import type { Socket, Namespace } from 'socket.io';
import type { RoomSessionManager, NamespaceSession } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import type {
  VoiceOfferData,
  VoiceAnswerData,
  VoiceIceCandidateData
} from '../../../../types';
import { isUserInRoomCache } from '../../../../shared/utils/redisCacheUtils';
import { VOICE_EVENTS } from '@jam-band/shared';
import { getRedisClient } from '../../../../config/redis';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';

/**
 * VoiceSignalingHandler - WebRTC offer/answer/ICE candidate exchange for the
 * full mesh voice network, split out of VoiceConnectionHandler (TR-20).
 *
 * Handles the namespace-based signaling path used by room namespaces (the
 * non-namespace per-socket path was dead code, removed in FU-1).
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class VoiceSignalingHandler {
  constructor(
    private readonly roomMembershipService: RoomMembershipService,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  /**
   * Resolve the acting user's display name for a voice offer via the Redis
   * membership cache (fast path), falling back to a DB lookup. Returns `null`
   * when the user is not a member of the room (caller must bail out).
   *
   * This is the deduplicated membership-check block that was previously
   * copy-pasted between handleVoiceOffer and handleVoiceOfferNamespace.
   */
  private async resolveOfferUsername(session: NamespaceSession): Promise<string | null> {
    try {
      const redis = await getRedisClient();
      const isMember = await isUserInRoomCache(redis, session.roomId, session.userId);
      if (!isMember) {
        loggingService.logWarn('User not in room', { userId: session.userId, roomId: session.roomId });
        return null;
      }
      // Get username from DB as secondary lookup
      const user = await this.roomMembershipService.findUserInRoom(session.roomId, session.userId);
      return user?.username || 'Unknown';
    } catch (err) {
      // Fall back to DB query if Redis fails
      loggingService.logWarn('Redis cache check hasFailed, using DB fallback', { error: err });
      const user = await this.roomMembershipService.findUserInRoom(session.roomId, session.userId);
      if (!user) {
        loggingService.logWarn('User not in room', { userId: session.userId, roomId: session.roomId });
        return null;
      }
      return user.username;
    }
  }

  // Namespace versions of voice handlers
  /**
   * Handle voice offer through namespace - Requirements: 7.3
   */
  async handleVoiceOfferNamespace(socket: Socket, data: VoiceOfferData, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      loggingService.logWarn('Invalid voice offer', { socketId: socket.id, roomId: data.roomId });
      return;
    }

    const username = await this.resolveOfferUsername(session);
    if (username === null) {
      return;
    }

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket?.connected) {
          targetSocket.emit(VOICE_EVENTS.VOICE_OFFER, {
            offer: data.offer,
            fromUserId: session.userId,
            fromUsername: username,
            roomId: data.roomId
          });
          return;
        }
      }
    }

    // Fallback to a room broadcast — addressed with targetUserId so only the
    // intended peer acts on it. Room key is the plain roomId that sockets join.
    socket.to(session.roomId).emit(VOICE_EVENTS.VOICE_OFFER, {
      offer: data.offer,
      fromUserId: session.userId,
      fromUsername: username,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
  }

  /**
   * Handle voice answer through namespace - Requirements: 7.3
   */
  handleVoiceAnswerNamespace(socket: Socket, data: VoiceAnswerData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      loggingService.logWarn('Invalid voice answer', { socketId: socket.id, roomId: data.roomId });
      return;
    }

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket?.connected) {
          targetSocket.emit(VOICE_EVENTS.VOICE_ANSWER, {
            answer: data.answer,
            fromUserId: session.userId,
            roomId: data.roomId
          });
          return;
        }
      }
    }

    // Fallback to a room broadcast — addressed with targetUserId so only the
    // intended peer acts on it. Room key is the plain roomId that sockets join.
    socket.to(session.roomId).emit(VOICE_EVENTS.VOICE_ANSWER, {
      answer: data.answer,
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
  }

  /**
   * Handle voice ICE candidate through namespace - Requirements: 7.3
   */
  handleVoiceIceCandidateNamespace(socket: Socket, data: VoiceIceCandidateData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket?.connected) {
          targetSocket.emit(VOICE_EVENTS.VOICE_ICE_CANDIDATE, {
            candidate: data.candidate,
            fromUserId: session.userId,
            roomId: data.roomId
          });
          return;
        }
      }
    }

    // Fallback to a room broadcast — addressed with targetUserId so only the
    // intended peer acts on it. Room key is the plain roomId that sockets join.
    socket.to(session.roomId).emit(VOICE_EVENTS.VOICE_ICE_CANDIDATE, {
      candidate: data.candidate,
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
  }
}
/* eslint-enable @typescript-eslint/member-ordering */
