import type { RoomRepository } from "../../domains/room-management/infrastructure/repositories/RoomRepository";
import type { NamespaceManager } from "../../shared/infrastructure/namespace/NamespaceManager";
import { loggingService } from "../../shared/infrastructure/logging/LoggingService";

/** Restore namespaces for existing rooms from Redis. Logic preserved verbatim from the original bootstrap. */
export async function restoreRoomNamespaces(
  roomRepository: RoomRepository,
  namespaceManager: NamespaceManager
): Promise<void> {
  // Restore namespaces for existing rooms from Redis
  try {
    loggingService.logInfo('Restoring room namespaces from storage...');
    const existingRooms = await roomRepository.getAllRooms();
    let restoredCount = 0;

    for (const room of existingRooms) {
      if (!namespaceManager.getRoomNamespace(room.id)) {
        namespaceManager.createRoomNamespace(room.id);

        // Create approval namespace if room is private
        if (room.isPrivate) {
          namespaceManager.createApprovalNamespace(room.id);
        }
        restoredCount++;
      }
    }

    loggingService.logInfo('Room namespaces restored', {
      totalRooms: existingRooms.length,
      restoredNamespaces: restoredCount
    });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to restore namespaces'), {
      context: 'NamespaceRecovery'
    });
  }
}
