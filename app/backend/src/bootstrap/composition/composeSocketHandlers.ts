import type { Server } from "socket.io";

import type { EventBus } from "../../shared/domain/events/EventBus";
import type { RoomRepository } from "../../domains/room-management/infrastructure/repositories/RoomRepository";
import type { NamespaceManager } from "../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomManagementServices } from "./composeRoomManagement";

import { VoiceConnectionHandler } from "../../domains/real-time-communication/infrastructure/handlers/VoiceConnectionHandler";
import { AudioRoutingHandler } from "../../domains/audio-processing/infrastructure/handlers";
import { MetronomeService } from "../../domains/room-management/infrastructure/services/MetronomeService";
import {
  RoomLifecycleHandler,
  RoomMembershipHandler,
} from "../../domains/room-management/infrastructure/handlers";
import { ApprovalWorkflowHandler } from "../../domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler";
import { ChatHandler } from "../../domains/real-time-communication/infrastructure/handlers/ChatHandler";
import { MetronomeHandler } from "../../domains/room-management/infrastructure/handlers/MetronomeHandler";
import { NotePlayingHandler } from "../../domains/audio-processing/infrastructure/handlers/NotePlayingHandler";
import { PerformCollaborationHandler } from "../../domains/room-management/infrastructure/handlers/PerformCollaborationHandler";
import { RoomController } from "../../domains/room-management/infrastructure/controllers/RoomController";
import { ArrangeRoomHandler } from "../../domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler";
import { PerformBroadcastHandler } from "../../domains/room-management/infrastructure/handlers/PerformBroadcastHandler";
import { PerformRoomHandler } from "../../domains/perform-room/infrastructure/handlers/PerformRoomHandler";
import { PerformEventHandler } from "../../domains/perform-room/infrastructure/handlers/PerformEventHandler";
import { ArrangeEventHandler } from "../../domains/arrange-room/infrastructure/handlers/ArrangeEventHandler";
import { MetronomeEventHandler } from "../../domains/room-management/infrastructure/handlers/MetronomeEventHandler";
import { NamespaceEventHandlers } from "../../shared/infrastructure/handlers/NamespaceEventHandlers";

import { roomSessionManager } from "../../domains/room-management/infrastructure/services/RoomSessionManager";
import { namespaceGracePeriodManager } from "../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import { arrangeRoomStateService } from "../../domains/arrange-room/application/ArrangeRoomStateService";
import { performRoomStateService } from "../../domains/perform-room/application/PerformRoomStateService";
import { projectSaveLockService } from "../../domains/arrange-room/infrastructure/services/ProjectSaveLockService";
import { audioRegionStorageService } from "../../domains/arrange-room/infrastructure/storage/AudioRegionStorageService";

export interface SocketHandlers {
  voiceConnectionHandler: VoiceConnectionHandler;
  audioRoutingHandler: AudioRoutingHandler;
  metronomeService: MetronomeService;
  roomLifecycleHandler: RoomLifecycleHandler;
  roomMembershipHandler: RoomMembershipHandler;
  approvalWorkflowHandler: ApprovalWorkflowHandler;
  notePlayingHandler: NotePlayingHandler;
  roomController: RoomController;
  namespaceEventHandlers: NamespaceEventHandlers;
}

export interface SocketHandlerDeps {
  io: Server;
  namespaceManager: NamespaceManager;
  eventBus: EventBus;
  roomRepository: RoomRepository;
  services: RoomManagementServices;
}

/**
 * Socket-facing handlers and event wiring. Construction order and arguments
 * preserved from the original bootstrap.
 */
export function composeSocketHandlers(deps: SocketHandlerDeps): SocketHandlers {
  const { io, namespaceManager, eventBus, roomRepository, services } = deps;
  const { roomMembershipService, roomLifecycleService, roomSettingsService } = services;

  // Initialize other domain handlers
  const voiceConnectionHandler = new VoiceConnectionHandler(
    roomMembershipService,
    io,
    roomSessionManager
  );

  const audioRoutingHandler = new AudioRoutingHandler(
    roomLifecycleService,
    io,
    roomSessionManager,
    namespaceManager
  );

  // Initialize services needed by RoomHandlers
  const metronomeService = new MetronomeService(io, roomRepository);

  // Initialize room lifecycle handler with event bus
  const roomLifecycleHandler = new RoomLifecycleHandler(
    roomLifecycleService,
    roomMembershipService,
    io,
    namespaceManager,
    roomSessionManager,
    metronomeService,
    audioRoutingHandler,
    eventBus,
    arrangeRoomStateService,
    audioRegionStorageService,
    voiceConnectionHandler,
    roomSettingsService
  );
  const roomMembershipHandler = new RoomMembershipHandler(
    roomMembershipService,
    roomLifecycleService,
    io,
    namespaceManager,
    roomSessionManager
  );
  const approvalWorkflowHandler = new ApprovalWorkflowHandler(
    roomLifecycleService,
    roomMembershipService,
    io,
    namespaceManager,
    roomSessionManager
  );
  const chatHandler = new ChatHandler(
    roomMembershipService,
    namespaceManager,
    roomSessionManager
  );
  const metronomeHandler = new MetronomeHandler(
    roomLifecycleService,
    metronomeService,
    roomSessionManager,
  );
  const notePlayingHandler = new NotePlayingHandler(
    roomLifecycleService,
    roomMembershipService,
    io,
    namespaceManager,
    roomSessionManager
  );
  const performCollaborationHandler = new PerformCollaborationHandler(
    roomLifecycleService,
    roomMembershipService,
    io,
    namespaceManager,
    roomSessionManager
  );

  const roomController = new RoomController(roomLifecycleService, roomSessionManager, namespaceGracePeriodManager);

  // Initialize arrange room handler
  const arrangeRoomHandler = new ArrangeRoomHandler(
    arrangeRoomStateService,
    roomSessionManager,
    roomLifecycleService,
    projectSaveLockService,
    audioRegionStorageService
  );

  const performBroadcastHandler = new PerformBroadcastHandler(roomLifecycleService, roomSessionManager, namespaceManager);


  const performRoomHandler = new PerformRoomHandler(
    performRoomStateService,
    roomSessionManager,
    roomLifecycleService,
    roomMembershipService,
    eventBus,
  );

  const performEventHandler = new PerformEventHandler(
    performRoomHandler,
    performBroadcastHandler,
    notePlayingHandler,
    audioRoutingHandler,
    performCollaborationHandler,
    roomMembershipHandler
  );

  const arrangeEventHandler = new ArrangeEventHandler(arrangeRoomHandler);

  // Wire domain handlers into RoomLifecycleHandler for consolidated leave cleanup
  roomLifecycleHandler.performEventHandler = performEventHandler;
  roomLifecycleHandler.arrangeEventHandler = arrangeEventHandler;

  const metronomeEventHandler = new MetronomeEventHandler(metronomeHandler);

  const namespaceEventHandlers = new NamespaceEventHandlers(
    roomLifecycleHandler,
    roomMembershipHandler,
    voiceConnectionHandler,
    approvalWorkflowHandler,
    roomSessionManager,
    chatHandler,
    performEventHandler,
    arrangeEventHandler,
    metronomeEventHandler
  );

  return {
    voiceConnectionHandler,
    audioRoutingHandler,
    metronomeService,
    roomLifecycleHandler,
    roomMembershipHandler,
    approvalWorkflowHandler,
    notePlayingHandler,
    roomController,
    namespaceEventHandlers,
  };
}
