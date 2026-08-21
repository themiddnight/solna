import type { RoomRepository } from "../../domains/room-management/infrastructure/repositories/RoomRepository";
import { RoomCleanupService } from "../../domains/room-management/domain/services/RoomCleanupService";
import { RoomUserService } from "../../domains/room-management/domain/services/RoomUserService";
import { RoomSettingsService } from "../../domains/room-management/infrastructure/services/RoomSettingsService";
import { EffectChainService } from "../../domains/audio-processing/infrastructure/services/EffectChainService";
import { RoomLifecycleService } from "../../domains/room-management/application/RoomLifecycleService";
import { RoomMembershipService } from "../../domains/room-management/application/RoomMembershipService";
import { roomSessionManager } from "../../domains/room-management/infrastructure/services/RoomSessionManager";
import { namespaceGracePeriodManager } from "../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import { arrangeRoomStateService } from "../../domains/arrange-room/application/ArrangeRoomStateService";
import { performRoomStateService } from "../../domains/perform-room/application/PerformRoomStateService";
import { projectRoomService } from "../../domains/arrange-room/infrastructure/storage/ProjectRoomService";
import { projectStorageService } from "../../domains/arrange-room/infrastructure/storage/ProjectStorageService";
import { loggingService } from "../../shared/infrastructure/logging/LoggingService";

export interface RoomManagementServices {
  roomCleanupService: RoomCleanupService;
  roomUserService: RoomUserService;
  roomSettingsService: RoomSettingsService;
  effectChainService: EffectChainService;
  roomLifecycleService: RoomLifecycleService;
  roomMembershipService: RoomMembershipService;
}

/** Room-management domain services. Construction order preserved from the original bootstrap. */
export function composeRoomManagement(roomRepository: RoomRepository): RoomManagementServices {
  const roomCleanupService = new RoomCleanupService(roomRepository);
  // Wire callback to clear Redis project↔room mapping when a room is deleted during cleanup
  roomCleanupService.setOnRoomDeletedCallback(async (roomId: string) => {
    await projectRoomService.clearActiveRoomByRoomId(roomId);
    // Also clean up perform/arrange room state from Redis (TTL is 24hr but explicit cleanup is better)
    performRoomStateService.deleteState(roomId).catch(err =>
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), { context: 'RoomCleanup.deletePerformState', roomId }));
    arrangeRoomStateService.deleteState(roomId).catch(err =>
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), { context: 'RoomCleanup.deleteArrangeState', roomId }));
    // Clean up in-memory roomProjects Map to prevent memory leak
    projectStorageService.deleteRoomProject(roomId);
  });
  const roomUserService = new RoomUserService(roomRepository, roomCleanupService);
  const roomSettingsService = new RoomSettingsService(roomRepository);
  const effectChainService = new EffectChainService(roomRepository);

  const roomLifecycleService = new RoomLifecycleService(
    roomRepository,
    roomCleanupService,
    roomSessionManager,
    namespaceGracePeriodManager,
    arrangeRoomStateService,
    effectChainService,
    roomUserService,
    roomSettingsService,
    performRoomStateService
  );

  const roomMembershipService = new RoomMembershipService(
    roomRepository,
    roomUserService,
    effectChainService,
    roomSessionManager
  );

  return {
    roomCleanupService,
    roomUserService,
    roomSettingsService,
    effectChainService,
    roomLifecycleService,
    roomMembershipService,
  };
}
