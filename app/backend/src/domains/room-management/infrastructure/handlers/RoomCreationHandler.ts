import type { Request, Response } from 'express';
import { isRestrictedUserTier } from '@jam-band/shared';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';
import { RoomCreated } from '@/shared/domain/events/RoomEvents';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";
import { ROOM_STATE_EVENTS } from '@jam-band/shared';
import { validateData, createRoomSchema } from '@jam-band/shared';
import type { CreateRoomData } from '@/types';
import { RoomType } from '@/types';

/**
 * RoomCreationHandler - Manages HTTP room creation workflows.
 * Extracted from RoomLifecycleHandler to comply with Single Responsibility Principle.
 */
export class RoomCreationHandler {
  constructor(private readonly handler: RoomLifecycleHandler) {}

  /**
   * Handle room creation via HTTP
   */
  async handleCreateRoomHttp(req: Request, res: Response): Promise<void> {
    // Validate request body
    const validationResult = validateData(createRoomSchema, req.body);
    if (validationResult.error) {
      res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
      return;
    }

    // Identity comes from the verified token (registered or guest) — never the client payload
    // (TR-33). The `isGuest`/`userId` fields in the body are ignored here; a client can no longer
    // assert its own tier to bypass this gate.
    const authUser = req.user;
    if (!authUser) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { name, username, isPrivate = false, isHidden = false, description, roomType = RoomType.PERFORM, currentInstrument, currentCategory, templateId, profilePictureUrl, isTourRoom } =
      validationResult.value as CreateRoomData;

    const finalUserId = authUser.id;
    const finalUsername = (authUser.username != null && authUser.username.length > 0)
      ? authUser.username
      : (typeof username === 'string' && username.length > 0) ? username : `User_${authUser.id.slice(0, 6)}`;

    // DEV-221: the onboarding tour creates the guest's room through THIS REST path (lobby modal),
    // so the isolated tour-room rules live here — a solo, join-locked, unlisted room, capped at
    // one per user.
    const isTourRoomRequest = isTourRoom === true;

    // Guests and unverified registered users cannot create private or hidden rooms (FC-2/BR-4),
    // EXCEPT the bounded, server-owned isolated tour room (DEV-221).
    const isRestricted = isRestrictedUserTier(authUser);
    if (!isTourRoomRequest && isRestricted && (isPrivate || isHidden)) {
      res.status(403).json({
        success: false,
        message: 'Guest users cannot create private or hidden rooms. Please login to access these features.'
      });
      return;
    }

    try {
      // Convert to strongly-typed IDs for internal processing
      const userIdTyped = this.handler.ensureUserId(finalUserId);

      // Cap = 1: a user may hold only one isolated tour room at a time. Drop any stale one this
      // user still owns before creating the new one (raw scan — isolated rooms are filtered out of
      // the normal room list, so getIsolatedRoomsOwnedBy reads the unfiltered repository).
      if (isTourRoomRequest) {
        const existingIsolated = await this.handler.roomLifecycleService.getIsolatedRoomsOwnedBy(finalUserId);
        for (const staleRoom of existingIsolated) {
          await this.handler.roomLifecycleService.deleteRoom(staleRoom.id);
        }
      }

      const { room, user } = await this.handler.roomLifecycleService.createRoom(
        name,
        finalUsername,
        this.handler.userIdToString(userIdTyped), // Convert back to string for legacy service
        isTourRoomRequest ? false : isPrivate,
        isTourRoomRequest ? true : isHidden,
        description,
        roomType,
        currentInstrument,
        currentCategory,
        profilePictureUrl,
        isTourRoomRequest // isIsolated
      );

      // Convert room.id to RoomId for type safety
      const roomIdTyped = this.handler.ensureRoomId(room.id);

      // Create room namespace and start metronome ONLY for PERFORM rooms
      const roomNamespace = this.handler.namespaceManager.createRoomNamespace(this.handler.roomIdToString(roomIdTyped));

      if (roomType === RoomType.PERFORM) {
        this.handler.metronomeService.initializeRoomMetronome(this.handler.roomIdToString(roomIdTyped), roomNamespace);
      }

      // Initialize arrange room state if it's an arrange room
      if (roomType === RoomType.ARRANGE && this.handler.arrangeRoomStateService) {
        await this.handler.arrangeRoomStateService.initializeState(this.handler.roomIdToString(roomIdTyped), templateId);
        loggingService.logInfo(`Initialized arrange room state for room ${this.handler.roomIdToString(roomIdTyped)}`);
      }

      // Create approval namespace for private rooms
      if (room.isPrivate) {
        this.handler.namespaceManager.createApprovalNamespace(this.handler.roomIdToString(roomIdTyped));
      }

      // Publish domain event for room creation. Skipped for isolated tour rooms (DEV-221): they must
      // not be advertised anywhere while the tour is active.
      if (!isTourRoomRequest && this.handler.eventBus) {
        const roomCreatedEvent = new RoomCreated(
          roomIdTyped.toString(),
          this.handler.userIdToString(userIdTyped),
          room.name,
          room.isPrivate,
          roomType
        );
        await this.handler.eventBus.publish(roomCreatedEvent);
      }

      // Broadcast to all clients that a new room was created (via main namespace)
      // Hidden rooms are NOT broadcasted to lobby (only accessible via invite link)
      if (!room.isHidden) {
        const activeBandMemberCount = room.bandMembers.size;
        const audienceCount = room.audiences.size;
        const broadcastData: Record<string, unknown> = {
          id: roomIdTyped.toString(),
          name: room.name,
          roomType: roomType === RoomType.ARRANGE ? 'arrange' : 'perform',
          userCount: activeBandMemberCount + audienceCount,
          activeBandMemberCount,
          owner: room.owner,
          isPrivate: room.isPrivate,
          isHidden: room.isHidden,
          createdAt: room.createdAt.toISOString()
        };
        // Only include audienceCount for perform rooms that are broadcasting
        if (room.roomType === RoomType.PERFORM && room.isBroadcasting) {
          broadcastData.audienceCount = audienceCount;
        }
        this.handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST, broadcastData);
      }

      const createPayload = await this.handler.buildRoomPayload(room, this.handler.roomIdToString(roomIdTyped));
      res.status(201).json({
        success: true,
        ...createPayload,
        user
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'RoomLifecycleHandler.createRoom' });
      res.status(500).json({
        success: false,
        message: 'Failed to create room'
      });
    }
  }
}
