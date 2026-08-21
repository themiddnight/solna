import type { Server } from "socket.io";
import { ROOM_STATE_EVENTS } from "@jam-band/shared";

import type { EventBus } from "../../shared/domain/events/EventBus";
import type { NamespaceManager } from "../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomLifecycleService } from "../../domains/room-management/application/RoomLifecycleService";
import type { RoomLifecycleHandler } from "../../domains/room-management/infrastructure/handlers";
import type { VoiceConnectionHandler } from "../../domains/real-time-communication/infrastructure/handlers/VoiceConnectionHandler";
import type { MetronomeService } from "../../domains/room-management/infrastructure/services/MetronomeService";
import type { NotePlayingHandler } from "../../domains/audio-processing/infrastructure/handlers/NotePlayingHandler";
import { GracePeriodsExpired } from "../../domains/room-management/domain/events/GracePeriodsExpired";
import { namespaceGracePeriodManager } from "../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import { roomSessionManager } from "../../domains/room-management/infrastructure/services/RoomSessionManager";
import { cleanupExpiredRateLimits } from "../../middleware/rateLimit";
import { loggingService } from "../../shared/infrastructure/logging/LoggingService";
import { redisStateService } from "../../shared/infrastructure/caching/RedisStateService";
import {
  countConnectedSockets,
  runPeriodicRoomSweep,
  runPostRestartGhostCleanup,
  type PeriodicSweepDeps,
} from "./periodicRoomSweep";

export interface BackgroundJobDeps {
  io: Server;
  eventBus: EventBus;
  namespaceManager: NamespaceManager;
  roomLifecycleService: RoomLifecycleService;
  roomLifecycleHandler: RoomLifecycleHandler;
  voiceConnectionHandler: VoiceConnectionHandler;
  metronomeService: MetronomeService;
  notePlayingHandler: NotePlayingHandler;
}

/**
 * Register all background timers and event subscriptions in one place.
 *
 * Ordering note (behavior-preserving): in the original bootstrap these
 * registrations were interleaved with construction. They only register future
 * work (timers/subscriptions) — the earliest timer fires at 30s, long after
 * bootstrap completes — so consolidating them here does not change runtime
 * behavior. Nothing that runs synchronously is included.
 */
export function registerBackgroundJobs(deps: BackgroundJobDeps): void {
  const {
    io,
    eventBus,
    namespaceManager,
    roomLifecycleService,
    roomLifecycleHandler,
    voiceConnectionHandler,
    metronomeService,
    notePlayingHandler,
  } = deps;

  // DEV-258 Guard A wiring: give the lifecycle service a live view of this process's
  // own connected-socket count so cleanupGhostUsers can refuse to judge presence
  // from a process nobody is connected to (zombie dev process, extra replica).
  roomLifecycleService.setLocalSocketCounter(() => countConnectedSockets(io));

  const sweepDeps: PeriodicSweepDeps = {
    io,
    countLocalSockets: () => countConnectedSockets(io),
    sweepLock: redisStateService,
    namespaceManager,
    roomLifecycleService,
    roomLifecycleHandler,
    roomSessionManager,
    metronomeService,
    notePlayingHandler,
  };

  // Schedule ghost user cleanup after reconnection window (2 minutes)
  // This gives users time to reconnect after a server restart before removing them
  setTimeout(async () => {
    try {
      await runPostRestartGhostCleanup(sweepDeps);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'ghost-user-cleanup' });
    }
  }, 2 * 60 * 1000); // 2 minutes

  setInterval(() => {
    voiceConnectionHandler.cleanupStaleVoiceConnections();
  }, 30_000);

  // Wire the 60s grace-period expiry interval to room cleanup via EventBus.
  // NamespaceGracePeriodManager publishes GracePeriodsExpired when in-memory
  // grace period entries expire; we subscribe here to close empty rooms promptly.
  namespaceGracePeriodManager.setEventBus(eventBus);
  eventBus.subscribe(GracePeriodsExpired.name, async (event: GracePeriodsExpired) => {
    for (const roomId of event.roomIds) {
      try {
        if (await roomLifecycleService.shouldCloseRoom(roomId)) {
          loggingService.logInfo('Closing room after grace period expired (60s cycle)', { roomId });
          metronomeService.cleanupRoom(roomId);
          notePlayingHandler.cleanupRoom(roomId);
          namespaceManager.cleanupRoomNamespace(roomId);
          namespaceManager.cleanupApprovalNamespace(roomId);
          const hasDeleted = await roomLifecycleHandler.deleteRoomAndCleanup(roomId);
          if (hasDeleted) {
            roomLifecycleHandler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId });
          }
        }
      } catch (error: unknown) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'grace-period-cleanup-subscriber', roomId });
      }
    }
  });

  // Periodic cleanup tasks with aggressive mode
  // Runs every 5 minutes to force cleanup rooms older than 5 minutes with no active users
  // Clean up orphan Redis sessions (sessions in Redis but no active Socket.IO connection)
  // Also removes stale users from room map, runs ghost user cleanup, and cleans up expired grace periods
  // Sweep body + DEV-140 ordering live in runPeriodicRoomSweep, guarded by the DEV-258
  // zero-socket fuse and single-sweeper Redis lock (see periodicRoomSweep.ts).
  setInterval(async () => {
    try {
      await runPeriodicRoomSweep(sweepDeps);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'room-cleanup-interval' });
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  // Clean up expired rate limit entries
  setInterval(() => {
    void cleanupExpiredRateLimits();
    void loggingService.cleanupOldLogs();
  }, 60 * 60 * 1000); // Run every hour
}
