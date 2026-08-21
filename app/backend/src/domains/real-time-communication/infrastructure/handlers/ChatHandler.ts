import type { Socket, Namespace } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { ChatMessageData, ChatMessage } from '../../../../types';
import { isUserInRoomCache } from '../../../../shared/utils/redisCacheUtils';
import { getRedisClient } from '../../../../config/redis';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { SHARED_EVENTS } from '@jam-band/shared';

/**
 * ChatHandler - Handles chat message functionality
 * Requirements: 4.1, 4.6
 * 
 * Extracted from RoomHandlers.ts to provide focused chat message handling
 * with proper namespace isolation and message validation.
 */
export class ChatHandler {
  constructor(
    private readonly roomMembershipService: RoomMembershipService,
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  /**
   * Handle chat message - Requirements: 4.1, 4.6
   * Validates user session, creates chat message, and broadcasts to room namespace
   * Uses Redis cache for membership check to avoid DB queries in realtime path
   */
  async handleChatMessage(socket: Socket, data: ChatMessageData): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const roomId = session.roomId;

    // Check membership via Redis cache first (fast path)
    let isMember = false;
    let user = null;
    try {
      const redis = await getRedisClient();
      isMember = await isUserInRoomCache(redis, roomId, session.userId);
    } catch (err) {
      // Fall back to DB query if Redis fails
      loggingService.logWarn('Redis cache check hasFailed, falling back to DB', { error: String(err) });
      user = await this.roomMembershipService.findUserInRoom(roomId, session.userId);
      isMember = !!user;
    }

    if (!isMember) {
      return;
    }

    // Get user object for username only if not already fetched from fallback query
    if (!user) {
      user = await this.roomMembershipService.findUserInRoom(roomId, session.userId);
    }

    if (!user) {
      return;
    }

    // Validate message content
    if (typeof data.message !== 'string' || data.message.trim().length === 0) {
      return;
    }

    // Sanitize message (basic sanitization)
    const sanitizedMessage = data.message.trim().substring(0, 500); // Limit message length

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: sanitizedMessage,
      timestamp: Date.now()
    };

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      // Broadcast chat message to all users in the room
      roomNamespace.emit(SHARED_EVENTS.CHAT_MESSAGE, chatMessage);
    } else {
      loggingService.logWarn('Room namespace not found for room', { roomId });
    }
  }

  /**
   * Handle chat message through namespace - Requirements: 4.1, 4.6
   * Namespace-aware version that broadcasts directly through the provided namespace
   * Uses Redis cache for membership check to avoid DB queries in realtime path
   */
  async handleChatMessageNamespace(socket: Socket, data: ChatMessageData, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const roomId = session.roomId;

    // Check membership via Redis cache first (fast path)
    let isMember = false;
    let user = null;
    try {
      const redis = await getRedisClient();
      isMember = await isUserInRoomCache(redis, roomId, session.userId);
    } catch (err) {
      // Fall back to DB query if Redis fails
      loggingService.logWarn('Redis cache check hasFailed, falling back to DB', { error: String(err) });
      user = await this.roomMembershipService.findUserInRoom(roomId, session.userId);
      isMember = !!user;
    }

    if (!isMember) {
      return;
    }

    // Get user object for username only if not already fetched from fallback query
    if (!user) {
      user = await this.roomMembershipService.findUserInRoom(roomId, session.userId);
    }

    if (!user) {
      return;
    }

    // Validate message content
    if (typeof data.message !== 'string' || data.message.trim().length === 0) {
      return;
    }

    // Sanitize message (basic sanitization)
    const sanitizedMessage = data.message.trim().substring(0, 500); // Limit message length

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: sanitizedMessage,
      timestamp: Date.now()
    };

    // Broadcast chat message to all users in namespace
    namespace.emit(SHARED_EVENTS.CHAT_MESSAGE, chatMessage);
  }
}
