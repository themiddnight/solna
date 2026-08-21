import type { Request, Response } from 'express';
import type { Socket, Namespace } from 'socket.io';
import type { Server } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import type { NamespaceManager } from "@/shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { AudioRoutingHandler } from '@/domains/audio-processing/infrastructure/handlers/AudioRoutingHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '@/domains/arrange-room/infrastructure/storage/AudioRegionStorageService';
import type { PerformEventHandler } from '@/domains/perform-room/infrastructure/handlers/PerformEventHandler';
import type { ArrangeEventHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeEventHandler';
import type { VoiceConnectionHandler } from '@/domains/real-time-communication/infrastructure/handlers/VoiceConnectionHandler';
import type { RoomSettingsService } from '@/domains/room-management/infrastructure/services/RoomSettingsService';
import { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import type { RoomOccupancyOperations } from '@/domains/room-shared/application/RoomOccupancyService';
import { RoomId, UserId } from '@/shared/domain/models/ValueObjects';
import type {
  Room,
  User,
  BandMember,
  Audience,
  UserSession} from '@/types';
import type { PrepareIdentitySwapData, JoinRoomEventData, FinishTourData } from '@jam-band/shared';
import {
  RoomType
} from '@/types';
import type { EventBus } from '@/shared/domain/events/EventBus';
import { ROOM_STATE_EVENTS, ARRANGE_EVENTS, OCCUPANCY_EVENTS, INSTRUMENT_CONSTANTS, CORE_NAMESPACES } from '@jam-band/shared';
import { buildRoomPayload } from '@/shared/utils/roomPayloadUtils';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";
import { validateData, updateRoomSettingsSchema } from '@jam-band/shared';

// Import modular sub-handlers
import { RoomCreationHandler } from './RoomCreationHandler';
import { RoomConnectionHandler } from './RoomConnectionHandler';
import { RoomOwnershipHandler } from './RoomOwnershipHandler';
import { RoomSwitchHandler } from './RoomSwitchHandler';

/**
 * RoomLifecycleHandler - Refactored facade/gateway that delegates room creation, connection,
 * ownership, and switching operations to modular sub-handlers.
 * Requirements: 4.1, 4.6
 */
export class RoomLifecycleHandler {
  /* eslint-disable @typescript-eslint/member-ordering */
  // Modular sub-handlers
  public readonly creationHandler: RoomCreationHandler;
  public readonly connectionHandler: RoomConnectionHandler;
  public readonly ownershipHandler: RoomOwnershipHandler;
  public readonly switchHandler: RoomSwitchHandler;

  /**
   * In-memory timer map for owner grace period (keyed by roomId).
   * Exposed as public so sub-handlers can access and modify it.
   */
  public readonly ownerGracePeriodTimers = new Map<string, NodeJS.Timeout>();
  /**
   * In-memory timer map for non-owner member grace period.
   * Key: roomId → Map<userId, timer> — one entry per user per room.
   * Single nested Map gives O(1) per-user + per-room ops with zero index maintenance.
   */
  public readonly memberGracePeriodTimers = new Map<string, Map<string, NodeJS.Timeout>>();

  /** Register a member grace period timer.
   *  Clears any existing timer for the same room+user first to prevent
   *  orphaned setTimeout on rapid leave/rejoin edge cases. */
  setMemberGracePeriodTimer(roomId: string, userId: string, timer: NodeJS.Timeout): void {
    // Clear existing timer first to prevent orphaned setTimeout
    this.clearMemberGracePeriodTimer(roomId, userId);
    let roomMap = this.memberGracePeriodTimers.get(roomId);
    if (!roomMap) {
      roomMap = new Map();
      this.memberGracePeriodTimers.set(roomId, roomMap);
    }
    roomMap.set(userId, timer);
  }

  /** Clear a specific member grace period timer. */
  clearMemberGracePeriodTimer(roomId: string, userId: string): boolean {
    const roomMap = this.memberGracePeriodTimers.get(roomId);
    if (!roomMap) return false;
    const timer = roomMap.get(userId);
    if (timer) clearTimeout(timer);
    const hasExisted = roomMap.delete(userId);
    if (roomMap.size === 0) this.memberGracePeriodTimers.delete(roomId);
    return hasExisted;
  }

  /** Clear all member grace period timers for a room (O(room_timers)). */
  clearAllMemberGracePeriodTimers(roomId: string): void {
    const roomMap = this.memberGracePeriodTimers.get(roomId);
    if (!roomMap) return;
    for (const timer of roomMap.values()) {
      clearTimeout(timer);
    }
    this.memberGracePeriodTimers.delete(roomId);
  }

  // Domain handlers — set after construction via setters (created after RoomLifecycleHandler)
  public performEventHandler?: PerformEventHandler;
  public arrangeEventHandler?: ArrangeEventHandler;

  constructor(
    public readonly roomLifecycleService: RoomLifecycleService,
    public readonly roomMembershipService: RoomMembershipService,
    public readonly io: Server,
    public readonly namespaceManager: NamespaceManager,
    public readonly roomSessionManager: RoomSessionManager,
    public readonly metronomeService: MetronomeService,
    public readonly audioRoutingHandler?: AudioRoutingHandler,
    public readonly eventBus?: EventBus,
    public readonly arrangeRoomStateService?: ArrangeRoomStateService,
    public readonly audioRegionStorageService?: AudioRegionStorageService,
    public readonly voiceConnectionHandler?: VoiceConnectionHandler,
    public readonly roomSettingsService?: RoomSettingsService
  ) {
    // Instantiate sub-handlers, passing "this" as context
    this.creationHandler = new RoomCreationHandler(this);
    this.connectionHandler = new RoomConnectionHandler(this);
    this.ownershipHandler = new RoomOwnershipHandler(this);
    this.switchHandler = new RoomSwitchHandler(this);
  }

  // ==========================================
  // DELEGATE METHODS (SOCKET & HTTP ENDPOINTS)
  // ==========================================

  /**
   * Handle room creation via HTTP
   */
  async handleCreateRoomHttp(req: Request, res: Response): Promise<void> {
    return this.creationHandler.handleCreateRoomHttp(req, res);
  }

  /**
   * Handle joining a room via Socket
   */
  async handleJoinRoom(socket: Socket, data: JoinRoomEventData): Promise<void> {
    return this.connectionHandler.handleJoinRoom(socket, data);
  }

  /**
   * Handle a prepare-identity-swap request (DEV-208) — records a short-lived handoff so the
   * next join under the new (registered) identity is recognized as continuing this session.
   */
  async handlePrepareIdentitySwap(socket: Socket, data: PrepareIdentitySwapData): Promise<void> {
    return this.connectionHandler.handlePrepareIdentitySwap(socket, data);
  }

  /**
   * Handle a tour-finish request (DEV-221) — un-isolates the guest's tour Perform room and
   * publishes it to the lobby. The caller stays in-room; no musical state is reset (spec §11-3).
   */
  async handleFinishTour(socket: Socket, data: FinishTourData): Promise<void> {
    const session = socket.data as Partial<UserSession>;
    if (session.roomId == null || session.userId == null || session.roomId !== data.roomId) {
      return;
    }
    const room = await this.roomLifecycleService.getRoom(data.roomId);
    if (!room || room.owner !== session.userId) {
      return; // TR-33: only the verified owner may un-isolate their tour room
    }
    if (!room.isIsolated) {
      return; // already un-isolated (e.g. registered swap already ran) — idempotent no-op
    }
    if (!this.roomSettingsService) {
      loggingService.logWarn('handleFinishTour: roomSettingsService unavailable', { roomId: data.roomId });
      return;
    }

    await this.roomSettingsService.updateRoomSettings(data.roomId, {
      isHidden: false,
      isIsolated: false,
    });

    // The room was never broadcast at creation; publish it now so the lobby lists it.
    // `/lobby` is where the lobby client listens — `socket.broadcast` stays inside the
    // socket's own `/room/<id>` namespace, and `/lobby-monitor` has no lobby clients on it.
    const activeBandMemberCount = room.bandMembers.size;
    const audienceCount = room.audiences.size;
    const broadcastData: Record<string, unknown> = {
      id: data.roomId,
      name: room.name,
      roomType: room.roomType === RoomType.ARRANGE ? 'arrange' : 'perform',
      userCount: activeBandMemberCount + audienceCount,
      activeBandMemberCount,
      owner: room.owner,
      isPrivate: false,
      isHidden: false,
      createdAt: room.createdAt.toISOString(),
    };
    const lobbyNamespace = this.namespaceManager.getNamespace(CORE_NAMESPACES.LOBBY);
    if (lobbyNamespace) {
      lobbyNamespace.emit(ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST, broadcastData);
    }
  }

  /**
   * Handle user leaving room - coordinates cleanup and state updates
   */
  async handleLeaveRoom(socket: Socket, isIntendedLeave: boolean = false): Promise<void> {
    return this.connectionHandler.handleLeaveRoom(socket, isIntendedLeave);
  }

  /**
   * Handle room owner initiating a switch to another room.
   */
  async handleInitiateSwitch(socket: Socket, data: { targetRoomId: string; targetRoomType: 'perform' | 'arrange' }): Promise<void> {
    return this.switchHandler.handleInitiateSwitch(socket, data);
  }

  /**
   * Check if user is the project owner for the project associated with this room.
   * Delegated to RoomOwnershipHandler for complete backward compatibility.
   */
  async checkIsProjectOwner(roomId: string, userId: string): Promise<boolean> {
    return this.ownershipHandler.checkIsProjectOwner(roomId, userId);
  }

  // ==========================================
  // SHARED UTILITIES & HELPERS (PUBLIC ACCESSIBLE)
  // ==========================================

  /**
   * Build a room payload with fresh bandMembers, audiences, and pendingMembers from Redis.
   */
  public async buildRoomPayload(room: Room, roomId: string) {
    return buildRoomPayload(this.roomMembershipService, room, roomId, this.roomLifecycleService);
  }

  /**
   * Helper method to ensure RoomId type safety while maintaining backward compatibility
   */
  public ensureRoomId(roomId: string | RoomId): RoomId {
    return typeof roomId === 'string' ? RoomId.fromString(roomId) : roomId;
  }

  /**
   * Helper method to ensure UserId type safety while maintaining backward compatibility
   */
  public ensureUserId(userId: string | UserId): UserId {
    return typeof userId === 'string' ? UserId.fromString(userId) : userId;
  }

  /**
   * Helper method to convert RoomId to string for legacy service calls
   */
  public roomIdToString(roomId: string | RoomId): string {
    return typeof roomId === 'string' ? roomId : roomId.toString();
  }

  /**
   * Helper method to convert UserId to string for legacy service calls
   */
  public userIdToString(userId: string | UserId): string {
    return typeof userId === 'string' ? userId : userId.toString();
  }

  /**
   * Helper to create user object based on role
   */
  public createUserByRole(
    userId: string,
    username: string,
    role: 'room_owner' | 'band_member' | 'audience',
    profilePictureUrl?: string | null,
    userType?: 'REGISTERED' | 'ARTIST' | 'PRO',
    currentInstrument?: string,
    currentCategory?: string
  ): User {
    if (role === 'audience') {
      const audience: Audience = {
        id: userId,
        username,
        role: 'audience',
        profilePictureUrl: profilePictureUrl !== undefined ? profilePictureUrl : null,
        ...(userType !== undefined && { userType }),
        joinedAt: new Date()
      };
      return audience;
    } else {
      const member: BandMember = {
        id: userId,
        username,
        role,
        isReady: false,
        currentInstrument: currentInstrument !== undefined && currentInstrument !== '' ? currentInstrument : INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT,
        currentCategory: currentCategory !== undefined && currentCategory !== '' ? currentCategory : INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY,
        profilePictureUrl: profilePictureUrl !== undefined ? profilePictureUrl : null,
        ...(userType !== undefined && { userType })
      };
      return member;
    }
  }

  /**
   * Lazily-constructed occupancy service for the Arrange domain (DEV-350 M2, Task 14 Part 2),
   * bound to the same Redis-backed `arrangeRoomStateService.getState/saveState` pair
   * `ArrangeRoomHandler` uses for its own `occupancyService` field. A second instance sharing
   * the same underlying state is safe: `RoomOccupancyService`'s mutex is a Redis-distributed
   * lock keyed by roomId (`room-state-mutex:${roomId}`), not per-instance, so both instances
   * serialize against each other correctly.
   */
  private arrangeOccupancyService?: RoomOccupancyOperations;

  private getArrangeOccupancyService(): RoomOccupancyOperations | undefined {
    if (!this.arrangeRoomStateService) {
      return undefined;
    }
    if (!this.arrangeOccupancyService) {
      const stateService = this.arrangeRoomStateService;
      this.arrangeOccupancyService = new RoomOccupancyService(
        (roomId) => stateService.getState(roomId),
        async (roomId, occupancy, state) => {
          // Reuses the snapshot the service read under `room-state-mutex:{roomId}` (TR-2)
          // instead of a second full state read — see ArrangeRoomHandler's identical wiring.
          await stateService.saveState(roomId, { ...state, occupancy, lastUpdated: new Date() });
        },
      );
    }
    return this.arrangeOccupancyService;
  }

  /**
   * Release arrange element-occupancy entries held by a user (DEV-350 M2, Task 14 Part 2).
   *
   * Historically this released `state.locks` entries (the primitive element-lock map) — that
   * system is fully retired now (regions/companion/chord-blocks all migrated to the occupancy
   * queue), so this now releases the user's `RoomOccupancyService` holder entries instead, the
   * same underlying cleanup `ArrangeLockHandler.handleUserLeaveLocks` performs on a full
   * disconnect/leave. This call site covers a DIFFERENT case that leave doesn't: the owner-
   * transfer path (`RoomConnectionHandler`'s project-owner auto-join), where the DEMOTED owner
   * stays connected — no disconnect/leave fires for them, so without this call any occupancy
   * entry they held (e.g. mid-edit on a region/chord-block/companion-region at the moment of
   * transfer) would sit stale until heartbeat/TTL expiry, potentially blocking the new owner.
   * `RoomLeaveExecutor`'s full-leave call site now overlaps with
   * `arrangeEventHandler.handleUserLeave` (also releases occupancy, called earlier in the same
   * function) — not a guaranteed-ordering guarantee so much as a harmless race either way: both
   * ultimately serialize on the same per-room Redis mutex (`room-state-mutex:${roomId}`), and
   * `releaseAllForUser` is idempotent, so whichever call runs second simply finds nothing left
   * for that user and no-ops.
   *
   * Emits both `OCCUPANCY_EVENTS.LEFT` (live — drives `useRoomOccupancyStore`, the current
   * rendering source of truth) and the legacy `ARRANGE_EVENTS.LOCK_RELEASED`. Unlike
   * `LOCK_CONFLICT` (still consumed by `arrangeIncomingSync`'s `handleLockConflict`),
   * `LOCK_RELEASED` now has ZERO FE listeners: Part 3 (Task 14) deleted `useArrangeLockStore`,
   * its only consumer. The emission is retained deliberately as a harmless no-op rather than
   * removed here — retiring the whole dead `arrange:lock_*` wire vocabulary is tracked as its
   * own cleanup, not something to half-do from this call site.
   */
  public async releaseArrangeLocksForUser(roomId: string, userId: string): Promise<void> {
    const occupancyService = this.getArrangeOccupancyService();
    if (!occupancyService) {
      return;
    }

    const released = await occupancyService.releaseAllForUser(roomId, userId);
    if (released.length === 0) {
      return;
    }

    const roomNamespace = this.getOrCreateRoomNamespace(roomId);
    if (!roomNamespace) {
      return;
    }

    released.forEach(({ elementId, holders }) => {
      roomNamespace.to(roomId).emit(OCCUPANCY_EVENTS.LEFT, { elementId, holders });
      roomNamespace.to(roomId).emit(ARRANGE_EVENTS.LOCK_RELEASED, { elementId });
    });
  }

  /**
   * Complete room deletion and dependency cleanups.
   * Returns true if the room was actually isDeleted, false if it was already gone (idempotent).
   */
  public async deleteRoomAndCleanup(roomId: string): Promise<boolean> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    const isArrangeRoom = room?.roomType === RoomType.ARRANGE;

    // Cleanup grace period timers to prevent memory leak
    const existingTimer = this.ownerGracePeriodTimers.get(roomId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.ownerGracePeriodTimers.delete(roomId);
    }
    // Clear all member grace period timers for this room (O(room_timers) via index).
    this.clearAllMemberGracePeriodTimers(roomId);

    const isDeleted = await this.roomLifecycleService.deleteRoom(roomId);
    if (!isDeleted) {
      loggingService.logWarn('deleteRoomAndCleanup: room already deleted (concurrent cleanup race)', {
        roomId,
      });
      return false;
    }
    if (isArrangeRoom) {
      if (this.arrangeRoomStateService) {
        void this.arrangeRoomStateService.clearState(roomId);
      }
      if (this.audioRegionStorageService) {
        void this.audioRegionStorageService.deleteRoomAudio(roomId).catch((error) => {
          loggingService.logError(error as Error, {
            context: 'RoomLifecycleHandler:deleteRoom',
            roomId,
          });
        });
      }
    }

    // Clean up in-memory and Redis session maps for this room
    this.roomSessionManager.cleanupRoomSessions(roomId);

    return true;
  }

  /**
   * Helper method to get or create room namespace
   */
  public getOrCreateRoomNamespace(roomId: string | RoomId): Namespace | null {
    const roomIdTyped = this.ensureRoomId(roomId);
    const roomIdString = this.roomIdToString(roomIdTyped);

    let roomNamespace = this.namespaceManager.getRoomNamespace(roomIdString);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomIdString);
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'RoomLifecycleHandler.createRoomNamespace', roomId: roomIdTyped.toString() });
        return null;
      }
    }
    return roomNamespace;
  }

  /**
   * Auto-request synth parameters from existing synth users for a new user
   */
  public async autoRequestSynthParamsForNewUser(socket: Socket, roomId: string | RoomId, newUserId: string | UserId): Promise<void> {
    const roomIdString = this.roomIdToString(this.ensureRoomId(roomId));
    const newUserIdString = this.userIdToString(this.ensureUserId(newUserId));

    if (this.audioRoutingHandler) {
      await this.audioRoutingHandler.autoRequestSynthParamsForNewUser(socket, roomIdString, newUserIdString);
    }
  }

  /**
   * Auto-request synth parameters via namespace for better reliability
   */
  public async autoRequestSynthParamsForNewUserNamespace(roomNamespace: Namespace, roomId: string | RoomId, newUserId: string | UserId): Promise<void> {
    const roomIdString = this.roomIdToString(this.ensureRoomId(roomId));
    const newUserIdString = this.userIdToString(this.ensureUserId(newUserId));

    if (this.audioRoutingHandler) {
      await this.audioRoutingHandler.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdString, newUserIdString);
    }
  }

  /**
   * Send persisted instrument params to a late-joining user (DEV-317).
   * One-hop read from Redis → joiner, no peer liveness dependency.
   */
  public async sendInstrumentParamsToNewUser(roomNamespace: Namespace, roomId: string | RoomId, newUserId: string | UserId): Promise<void> {
    const roomIdString = this.roomIdToString(this.ensureRoomId(roomId));
    const newUserIdString = this.userIdToString(this.ensureUserId(newUserId));

    if (this.audioRoutingHandler) {
      await this.audioRoutingHandler.sendInstrumentParamsToNewUser(roomNamespace, roomIdString, newUserIdString);
    }
  }

  /**
   * Broadcast a room-list event to the lobby.
   *
   * Target is `/lobby` — the namespace the lobby client actually connects to
   * (`RoomSocketManager.connectToLobby` → `CORE_NAMESPACES.LOBBY`, listeners bound in
   * `lobbyBroadcastBridge.ts`). This previously emitted on the default namespace and on
   * `/lobby-monitor`, neither of which any client joins, so the lobby room list never
   * live-updated.
   */
  public broadcastToLobby(event: string, data: Record<string, unknown>): void {
    const lobbyNamespace = this.namespaceManager.getNamespace(CORE_NAMESPACES.LOBBY);
    if (lobbyNamespace) {
      lobbyNamespace.emit(event, data);
    }
  }

  // ==========================================
  // COMPONENT-LEVEL DIRECT HANDLERS
  // ==========================================

  /**
   * Handle room settings update via HTTP
   */
  async handleUpdateRoomSettingsHttp(req: Request, res: Response): Promise<void> {
    // Validate request body
    const validationResult = validateData(updateRoomSettingsSchema, req.body);
    if (validationResult.error) {
      res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
      return;
    }

    const { roomId } = req.params;
    const { name, description, isPrivate, isHidden } = validationResult.value as {
      name?: string;
      description?: string;
      isPrivate?: boolean;
      isHidden?: boolean;
    };

    // Actor derived from the authenticated JWT (route behind authenticateToken), never from the
    // request body (DEV-180 — prevents spoofing the room-owner check).
    const updatedBy = req.user?.id;

    if (!roomId) {
      res.status(400).json({
        success: false,
        message: 'Room ID is required'
      });
      return;
    }

    if (!updatedBy) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    try {
      // Convert to strongly-typed IDs for internal processing
      const roomIdTyped = this.ensureRoomId(roomId);
      const updatedByTyped = this.ensureUserId(updatedBy);
      const roomIdString = this.roomIdToString(roomIdTyped);
      const updatedByString = this.userIdToString(updatedByTyped);

      const room = await this.roomLifecycleService.getRoom(roomIdString);
      if (!room) {
        res.status(404).json({
          success: false,
          message: 'Room not found'
        });
        return;
      }

      // Check if user is the room owner
      const user = await this.roomMembershipService.findUserInRoom(roomIdString, updatedByString);
      const roomOwnerId = typeof room.owner === 'string' ? room.owner : String(room.owner);
      const userRole = user !== undefined ? user.role : undefined;
      const isRoomOwner: boolean = userRole === 'room_owner' || roomOwnerId === updatedByString;
      if (isRoomOwner !== true) {
        res.status(403).json({
          success: false,
          message: 'Only room owner can update room settings'
        });
        return;
      }

      // Update room settings
      const oldSettings = {
        name: room.name,
        description: room.description,
        isPrivate: room.isPrivate,
        isHidden: room.isHidden
      };

      const settingsUpdate: { name?: string; description?: string; isPrivate?: boolean; isHidden?: boolean } = {};
      if (name !== undefined) settingsUpdate.name = name;
      if (description !== undefined) settingsUpdate.description = description;
      if (isPrivate !== undefined) settingsUpdate.isPrivate = isPrivate;
      if (isHidden !== undefined) settingsUpdate.isHidden = isHidden;

      const hasUpdateSuccess = await this.roomLifecycleService.updateRoomSettings(roomIdString, settingsUpdate);

      if (!hasUpdateSuccess) {
        res.status(500).json({
          success: false,
          message: 'Failed to update room settings'
        });
        return;
      }

      const updatedRoom = await this.roomLifecycleService.getRoom(roomIdString);
      if (!updatedRoom) {
        res.status(500).json({
          success: false,
          message: 'Failed to retrieve updated room'
        });
        return;
      }

      const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
      if (roomNamespace) {
        roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_SETTINGS_UPDATED, {
          roomId: roomIdString,
          updatedBy: updatedByString,
          oldSettings,
          newSettings: {
            name: updatedRoom.name,
            description: updatedRoom.description,
            isPrivate: updatedRoom.isPrivate,
            isHidden: updatedRoom.isHidden
          }
        });

        roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(updatedRoom, roomIdString));
      }

      // Handle privacy changes - create/cleanup approval namespace
      if (oldSettings.isPrivate !== updatedRoom.isPrivate) {
        if (updatedRoom.isPrivate && !oldSettings.isPrivate) {
          this.namespaceManager.createApprovalNamespace(roomIdString);
        } else if (!updatedRoom.isPrivate && oldSettings.isPrivate) {
          this.namespaceManager.cleanupApprovalNamespace(roomIdString);
        }
      }

      // Broadcast room update to lobby
      if (!updatedRoom.isHidden) {
        const activeBandMemberCountUpdate = updatedRoom.bandMembers.size;
        const audienceCountUpdate = updatedRoom.audiences.size;
        const roomUpdateData: Record<string, unknown> = {
          id: roomIdString,
          name: updatedRoom.name,
          description: updatedRoom.description,
          userCount: activeBandMemberCountUpdate + audienceCountUpdate,
          activeBandMemberCount: activeBandMemberCountUpdate,
          owner: updatedRoom.owner,
          isPrivate: updatedRoom.isPrivate,
          isHidden: updatedRoom.isHidden,
          updatedAt: new Date().toISOString()
        };
        if (updatedRoom.roomType === RoomType.PERFORM && updatedRoom.isBroadcasting === true) {
          roomUpdateData['audienceCount'] = audienceCountUpdate;
        }

        this.broadcastToLobby('room_updated_broadcast', roomUpdateData);
      }

      const settingsPayload = await this.buildRoomPayload(updatedRoom, roomIdString);
      res.json({
        success: true,
        message: 'Room settings updated successfully',
        ...settingsPayload
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'RoomLifecycleHandler.updateRoomSettings' });
      res.status(500).json({
        success: false,
        message: 'Failed to update room settings'
      });
    }
  }
}
