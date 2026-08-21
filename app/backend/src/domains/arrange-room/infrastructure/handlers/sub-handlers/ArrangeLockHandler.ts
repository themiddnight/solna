import type { Socket, Namespace } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { SaveLockInfo } from '@/domains/arrange-room/infrastructure/services/ProjectSaveLockService';
import * as occupancySocketHandlers from '@/domains/room-shared/application/occupancySocketHandlers';

export class ArrangeLockHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle selection change
   */
  async handleSelectionChange(socket: Socket, namespace: Namespace, data: { roomId: string; selectedTrackId?: string | null | undefined; selectedRegionIds?: string[] | undefined }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = await this.handler.getStateService().getState(data.roomId);
      if (!state) {
        return;
      }

      const selectedTrackId = data.selectedTrackId !== undefined ? data.selectedTrackId : state.selectedTrackId;
      const selectedRegionIds = data.selectedRegionIds !== undefined ? data.selectedRegionIds : state.selectedRegionIds;

      await this.handler.getStateService().updateSelection(data.roomId, selectedTrackId, selectedRegionIds);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.SELECTION_CHANGED, {
        selectedTrackId,
        selectedRegionIds,
        userId: session.userId,
        username: session.username,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeLockHandler:handleSelectionChange',
        roomId: data.roomId,
      });
    }
  }

  /**
   * Element occupancy (DEV-350 M2) — thin delegations to the room-agnostic
   * `occupancySocketHandlers` module (`room-shared`), so the orchestration logic is shared
   * verbatim with a future Perform-room handler (Task 24) instead of duplicated.
   */
  async handleOccupancyJoin(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return occupancySocketHandlers.handleOccupancyJoin(
      this.handler.getOccupancyService(),
      (s) => this.handler.getSessionPublic(s),
      socket,
      namespace,
      data,
    );
  }

  async handleOccupancyLeave(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return occupancySocketHandlers.handleOccupancyLeave(
      this.handler.getOccupancyService(),
      (s) => this.handler.getSessionPublic(s),
      socket,
      namespace,
      data,
    );
  }

  async handleOccupancyHeartbeat(socket: Socket, data: { roomId: string; elementId: string }): Promise<void> {
    return occupancySocketHandlers.handleOccupancyHeartbeat(
      this.handler.getOccupancyService(),
      (s) => this.handler.getSessionPublic(s),
      socket,
      data,
    );
  }

  /**
   * Clean up locks when user leaves: release element occupancy (shared orchestration) then
   * this room's save locks (Arrange-specific, out of scope for the room-shared extraction —
   * spec §5).
   */
  async handleUserLeaveLocks(roomId: string, userId: string, namespace: Namespace): Promise<void> {
    await occupancySocketHandlers.releaseAllOccupancyForUser(this.handler.getOccupancyService(), roomId, userId, namespace);

    // Release save locks held by this user
    const releasedSaveLocks = this.handler.getProjectSaveLockService().releaseUserLocks(userId);
    releasedSaveLocks.forEach((projectId) => {
      namespace.to(roomId).emit(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, { 
        projectId,
        reason: 'user_disconnected'
      });
    });
  }

  /**
   * Handle save lock request
   */
  async handleSaveLockRequest(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; projectId: string }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      socket.emit(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: data.projectId,
        reason: 'invalid_session',
      });
      return;
    }

    let lockInfo: SaveLockInfo | null;
    try {
      lockInfo = this.handler.getProjectSaveLockService().acquireLock(
        data.projectId,
        session.userId,
        session.username
      );
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeLockHandler:handleSaveLockRequest',
        roomId: data.roomId,
        projectId: data.projectId,
        userId: session.userId,
      });
      socket.emit(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: data.projectId,
        reason: 'service_error',
      });
      return;
    }

    if (lockInfo) {
      // Lock acquired successfully
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.SAVE_LOCK_ACQUIRED, {
        projectId: data.projectId,
        lockInfo: {
          userId: lockInfo.userId,
          username: lockInfo.username,
        },
      });

      loggingService.logInfo('Save lock acquired', {
        roomId: data.roomId,
        projectId: data.projectId,
        userId: session.userId,
        username: session.username,
      });
    } else {
      // Lock denied - someone else is saving
      const existingLock = this.handler.getProjectSaveLockService().isLocked(data.projectId);
      socket.emit(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: data.projectId,
        reason: 'locked_by_other',
        lockedBy: existingLock.lockInfo?.username || 'Unknown',
      });

      loggingService.logInfo('Save lock denied', {
        roomId: data.roomId,
        projectId: data.projectId,
        userId: session.userId,
        lockedBy: existingLock.lockInfo?.username,
      });
    }
  }

  /**
   * Handle save lock release
   */
  async handleSaveLockRelease(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; projectId: string; isSuccess?: boolean | undefined }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const lockStatus = this.handler.getProjectSaveLockService().isLocked(data.projectId);
    const isReleased = this.handler.getProjectSaveLockService().releaseLock(data.projectId, session.userId);
    
    // COLL-23 / PERM-004 Fix: Always broadcast release when requested by client unless locked by someone else.
    // This handles the case where the API error handler already released it from the map.
    if (isReleased || !lockStatus.locked) {
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: data.projectId,
        success: data.isSuccess ?? true,
      });

      loggingService.logInfo('Save lock released', {
        roomId: data.roomId,
        projectId: data.projectId,
        userId: session.userId,
        success: data.isSuccess,
        wasInMap: isReleased,
      });
    }
  }
}
