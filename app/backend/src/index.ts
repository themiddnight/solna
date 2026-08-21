import express from "express";

// Import our modular components
import { config } from "./config/environment";
import { createSocketServer } from "./config/socket";
import { RoomRepository } from "./domains/room-management/infrastructure/repositories/RoomRepository";
import { NamespaceManager } from "./shared/infrastructure/namespace/NamespaceManager";
import { namespaceGracePeriodManager } from "./shared/infrastructure/namespace/NamespaceGracePeriodManager";
import { roomSessionManager } from "./domains/room-management/infrastructure/services/RoomSessionManager";
import { projectRoomService } from "./domains/arrange-room/infrastructure/storage/ProjectRoomService";
import { projectApplicationService } from "./domains/arrange-room/application/ProjectApplicationService";
import { loggingService } from './shared/infrastructure/logging/LoggingService';
import { LobbyIntegrationService } from "./domains/lobby-management/infrastructure/LobbyIntegrationService";
import { configureHttpLayer } from "./bootstrap/httpLayer";
import { createHttpServer } from "./bootstrap/server";
import { registerGracefulShutdown } from "./bootstrap/shutdown";

// Composition modules (phase-scoped bootstrap)
import { composeRoomManagement } from "./bootstrap/composition/composeRoomManagement";
import { composeArrangeServices } from "./bootstrap/composition/composeArrangeServices";
import { composeSocketHandlers } from "./bootstrap/composition/composeSocketHandlers";
import { composeMonitoring } from "./bootstrap/composition/composeMonitoring";
import { registerBackgroundJobs } from "./bootstrap/composition/registerBackgroundJobs";
import { restoreRoomNamespaces } from "./bootstrap/composition/restoreRoomNamespaces";

// Event System
import { EventSystemInitializer } from "./shared/infrastructure/events/EventSystemInitializer";

// Clustering and Redis support
import { resetRedisClients } from "./config/redis";
import { isRecoverableConnectionError } from "./shared/utils/errorUtils";

// ============================================
// Global Error Handlers
// ============================================
// These handlers prevent the process from crashing on unhandled errors,
// particularly Redis connection issues (ECONNRESET, etc.)

// Handle unhandled promise rejections (prevents crashes from Redis errors)
process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));

  if (isRecoverableConnectionError(error)) {
    // Log as warning instead of error for recoverable connection issues
    loggingService.logInfo('Recovered from unhandled rejection (connection issue)', {
      errorCode: (error as NodeJS.ErrnoException).code,
      message: error.message,
    });
    // Reset Redis clients to allow reconnection on next operation
    resetRedisClients();
  } else {
    loggingService.logError(error, {
      context: 'UnhandledRejection',
      type: 'unhandledRejection',
    });
  }
});

// Handle uncaught exceptions (last resort - try to keep the process alive for recoverable errors)
process.on('uncaughtException', (error: Error, origin: string) => {
  if (isRecoverableConnectionError(error)) {
    // Don't crash for recoverable connection errors
    loggingService.logInfo('Recovered from uncaught exception (connection issue)', {
      errorCode: (error as NodeJS.ErrnoException).code,
      message: error.message,
      origin,
    });
    // Reset Redis clients to allow reconnection
    resetRedisClients();
  } else {
    // Log the error but don't exit - let the error bubble up naturally
    loggingService.logError(error, {
      context: 'UncaughtException',
      origin,
    });
    // For truly fatal errors, we might want to exit
    // But for now, we'll try to keep running
  }
});

// Main async bootstrap function
async function bootstrap() {

  const app = express();
  const server = createHttpServer(app);

  // Domain Services (Refactored)
  const roomRepository = new RoomRepository();

  // Create Socket.IO server (async to support Redis adapter)
  // Inject dependencies explicitly to avoid module initialization race conditions (MIDD-54/MIDD-77)
  const io = await createSocketServer(server, roomRepository, {
    getGracePeriodUsers: (roomId) => namespaceGracePeriodManager.getRoomGracePeriodUsers(roomId),
    cleanupRoomGracePeriod: (roomId) => namespaceGracePeriodManager.cleanupRoomGracePeriod(roomId),
    clearActiveRoomByRoomId: (roomId) => projectRoomService.clearActiveRoomByRoomId(roomId),
  });

  // Initialize services
  const namespaceManager = new NamespaceManager(io);
  roomSessionManager.setSocketPresenceChecker(async (session) => {
    const namespace = io.of(session.namespacePath);

    // Fast local-process check first.
    const localSocket = namespace.sockets.get(session.socketId);
    if (localSocket?.connected) {
      return true;
    }

    // Cross-worker check via adapter room membership.
    // Room sockets always join roomId after successful room join.
    const socketIds = await namespace.in(session.roomId).allSockets();
    return socketIds.has(session.socketId);
  });

  const services = composeRoomManagement(roomRepository);

  // Initialize event system
  const eventSystemInitializer = new EventSystemInitializer(io, namespaceManager);
  const eventBus = eventSystemInitializer.initialize();

  // Wire lobby-management directly. The old DI container path was never invoked
  // from bootstrap, so the lobby namespace and room-listing event subscribers
  // were inactive until this explicit setup.
  const lobbyIntegrationService = new LobbyIntegrationService(io, services.roomLifecycleService, eventBus);
  lobbyIntegrationService.createLobbyNamespace();
  loggingService.logInfo("Lobby management initialized");

  // Sync rooms from Redis on startup (restore persisted rooms)
  roomRepository.syncFromRedis().then((roomCount) => {
    loggingService.logInfo(`Synced ${roomCount} rooms from Redis on startup`);
  }).catch((error: Error) => {
    loggingService.logError(error, { context: 'repository-sync-from-redis' });
  });

  // Wire Socket.IO into ProjectApplicationService for real-time save progress events
  projectApplicationService.setSocketServer(io);

  const monitoring = composeMonitoring(io, namespaceManager);
  const arrange = composeArrangeServices(io, services.roomLifecycleService);
  const handlers = composeSocketHandlers({ io, namespaceManager, eventBus, roomRepository, services });

  // Set up namespace event handlers
  namespaceManager.setEventHandlers(handlers.namespaceEventHandlers);

  // Set performance monitoring services on namespace event handlers
  if (monitoring.connectionOptimization) {
    handlers.namespaceEventHandlers.setPerformanceServices(
      monitoring.performanceMonitoring,
      monitoring.connectionHealth,
      monitoring.connectionOptimization
    );
  } else {
    handlers.namespaceEventHandlers.setPerformanceServices(
      monitoring.performanceMonitoring,
      monitoring.connectionHealth
    );
  }

  await restoreRoomNamespaces(roomRepository, namespaceManager);

  // Initialize lobby monitor namespace for latency monitoring
  // Requirements: 2.1, 9.1, 9.5
  namespaceManager.createLobbyMonitorNamespace();
  loggingService.logInfo(
    "Lobby monitor namespace initialized for latency monitoring"
  );

  configureHttpLayer(app, {
    roomController: handlers.roomController,
    roomLifecycleHandler: handlers.roomLifecycleHandler,
    audioRegionController: arrange.audioRegionController,
    projectController: arrange.projectController,
    performanceMonitoring: monitoring.performanceMonitoring,
    connectionHealth: monitoring.connectionHealth,
    namespaceCleanup: monitoring.namespaceCleanup,
    connectionOptimization: monitoring.connectionOptimization,
  });

  // Log application startup
  loggingService.logInfo("Application starting up", {
    environment: config.nodeEnv,
    port: config.port,
    sslEnabled: config.ssl.enabled,
    timestamp: new Date().toISOString(),
  });

  registerBackgroundJobs({
    io,
    eventBus,
    namespaceManager,
    roomLifecycleService: services.roomLifecycleService,
    roomLifecycleHandler: handlers.roomLifecycleHandler,
    voiceConnectionHandler: handlers.voiceConnectionHandler,
    metronomeService: handlers.metronomeService,
    notePlayingHandler: handlers.notePlayingHandler,
  });

  server.listen(Number(config.port), "0.0.0.0", () => {
    const protocol =
      config.nodeEnv === "development" && config.ssl.enabled ? "https" : "http";

    loggingService.logInfo("Server started successfully", {
      port: config.port,
      protocol,
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });

    loggingService.logInfo("Security features enabled", {
      features: [
        "Rate limiting",
        "Input validation",
        "WebRTC validation",
        "Comprehensive logging",
        "Performance monitoring",
      ],
      timestamp: new Date().toISOString(),
    });

    if (config.nodeEnv === "development" && config.ssl.enabled) {
      loggingService.logInfo("Development: HTTPS enabled for WebRTC support");
    } else if (config.nodeEnv === "production") {
      loggingService.logInfo("Production: HTTP mode (SSL handled by Railway)");
    } else {
      loggingService.logInfo("Development: HTTP mode");
    }
  });

  registerGracefulShutdown({
    server,
    performanceMonitoring: monitoring.performanceMonitoring,
    connectionHealth: monitoring.connectionHealth,
    namespaceCleanup: monitoring.namespaceCleanup,
    connectionOptimization: monitoring.connectionOptimization,
    lobbyIntegrationService,
    namespaceManager,
    approvalWorkflowHandler: handlers.approvalWorkflowHandler,
    eventSystemInitializer,
  });

} // end bootstrap function

// Run the application
bootstrap().catch((error: unknown) => {
  loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: "Bootstrap failed" });
  process.exit(1);
});
