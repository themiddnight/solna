import type { Server } from "socket.io";

import type { RoomLifecycleService } from "../../domains/room-management/application/RoomLifecycleService";
import { AudioRegionController } from "../../domains/arrange-room/infrastructure/controllers/AudioRegionController";
import { ProjectController } from "../../domains/arrange-room/infrastructure/controllers/ProjectController";
import { ProjectImportService } from "../../domains/arrange-room/domain/services/ProjectImportService";
import { ProjectRetrievalService } from "../../domains/arrange-room/domain/services/ProjectRetrievalService";
import { audioRegionStorageService } from "../../domains/arrange-room/infrastructure/storage/AudioRegionStorageService";
import { arrangeRoomStateService } from "../../domains/arrange-room/application/ArrangeRoomStateService";
import { projectStorageService } from "../../domains/arrange-room/infrastructure/storage/ProjectStorageService";

export interface ArrangeServices {
  audioRegionController: AudioRegionController;
  projectImportService: ProjectImportService;
  projectRetrievalService: ProjectRetrievalService;
  projectController: ProjectController;
}

/** Arrange-room services. Construction order and arguments preserved from the original bootstrap. */
export function composeArrangeServices(
  io: Server,
  roomLifecycleService: RoomLifecycleService
): ArrangeServices {
  // Initialize arrange room services (before room lifecycle handler)
  // Use singleton AudioRegionStorageService instance
  const audioRegionController = new AudioRegionController(
    roomLifecycleService,
    audioRegionStorageService,
    arrangeRoomStateService
  );


  // Use singleton projectStorageService instance

  const projectImportService = new ProjectImportService(
    audioRegionStorageService,
    arrangeRoomStateService,
    projectStorageService
  );

  const projectRetrievalService = new ProjectRetrievalService(
    arrangeRoomStateService,
    projectStorageService,
    audioRegionStorageService
  );

  const projectController = new ProjectController(
    projectImportService,
    projectRetrievalService,
    io
  );

  return {
    audioRegionController,
    projectImportService,
    projectRetrievalService,
    projectController,
  };
}
