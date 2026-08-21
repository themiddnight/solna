import { v4 as uuidv4 } from "uuid";
import { ROOM_STATE_EVENTS } from "@jam-band/shared";

import { REDIS_KEYS } from "../../shared/constants/RedisKeys";
import { loggingService } from "../../shared/infrastructure/logging/LoggingService";
import type { NamespaceManager } from "../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomLifecycleService } from "../../domains/room-management/application/RoomLifecycleService";
import type { RoomLifecycleHandler } from "../../domains/room-management/infrastructure/handlers";
import type { RoomSessionManager } from "../../domains/room-management/infrastructure/services/RoomSessionManager";
import type { MetronomeService } from "../../domains/room-management/infrastructure/services/MetronomeService";
import type { NotePlayingHandler } from "../../domains/audio-processing/infrastructure/handlers/NotePlayingHandler";

/**
 * DEV-258 — hardened destructive room/session sweeps.
 *
 * The periodic cleanup judges user presence per-process (in-memory session maps +
 * this process's own Socket.IO server). A process nobody can connect to — a zombie
 * dev process, a deploy overlap, an extra replica — sees every occupant in shared
 * Redis as a ghost and would delete live rooms every cycle (FAILURE_PATTERNS
 * Pattern 10). Two guards protect against that:
 *
 *   Guard A — zero-socket sanity fuse: skip all destructive presence judgement when
 *             this process has zero connected sockets while rooms show occupants.
 *             A serving process always holds at least the sockets it's about to judge.
 *   Guard B — single-sweeper Redis lock (TR-2 infrastructure): only one process runs
 *             a destructive sweep at a time; single attempt, skip the cycle when the
 *             lock is held elsewhere or Redis errors (fail closed).
 */

/** Structural view of a Socket.IO namespace — `sockets` holds currently connected sockets. */
export interface SocketNamespaceLike {
  readonly sockets: ReadonlyMap<string, unknown>;
}

/**
 * Structural view of `socket.io` `Server` for socket counting. The composition root
 * passes the real `Server` uncast, so this shape stays compile-checked against the
 * actual library type (FAILURE_PATTERNS Pattern 7 — never sever that link with a cast).
 */
export interface SocketServerLike {
  readonly _nsps: ReadonlyMap<string, SocketNamespaceLike>;
}

/** Sockets currently connected to this process, across all namespaces. */
export function countConnectedSockets(io: SocketServerLike): number {
  let total = 0;
  for (const namespace of io._nsps.values()) {
    total += namespace.sockets.size;
  }
  return total;
}

/** The narrow io shape the orphan-session sweep needs (see OrphanSessionCleanupService). */
export type OrphanSweepIo = NonNullable<Parameters<RoomSessionManager["cleanupOrphanRedisSessions"]>[0]>;

/** Subset of RedisStateService used for the single-sweeper lock (Guard B). */
export interface SweepLockService {
  acquireLock(key: string, lockId: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string, lockId: string): Promise<boolean>;
}

/**
 * Crash backstop only — a healthy sweep finishes in seconds and releases explicitly.
 * Kept under the 5-minute interval so a crashed holder can't block the next cycle.
 */
export const SWEEP_LOCK_TTL_MS = 4 * 60 * 1000;

export interface PeriodicSweepDeps {
  io: OrphanSweepIo;
  /** Guard A input — wired to `countConnectedSockets(io)` by the composition root. */
  countLocalSockets: () => number;
  sweepLock: SweepLockService;
  namespaceManager: NamespaceManager;
  roomLifecycleService: RoomLifecycleService;
  roomLifecycleHandler: RoomLifecycleHandler;
  roomSessionManager: RoomSessionManager;
  metronomeService: MetronomeService;
  notePlayingHandler: NotePlayingHandler;
}

/**
 * Guard A. True when this process may run destructive presence judgement.
 * Checked BEFORE the lock — a fused-off process must not grab the lock and
 * starve the healthy sweeper. Uses only in-process socket state plus room maps,
 * so it cannot fail open on a Redis error.
 */
async function isPresenceSweepSafe(deps: Pick<PeriodicSweepDeps, "countLocalSockets" | "roomLifecycleService">): Promise<boolean> {
  if (deps.countLocalSockets() > 0) return true;
  if (!(await deps.roomLifecycleService.hasAnyRoomOccupants())) return true;

  loggingService.logWarn(
    "Destructive room sweep skipped: this process has zero connected sockets while rooms show occupants — likely a non-serving (zombie/replica) process",
  );
  return false;
}

/** Guard B. Returns a lock id to release later, or null when this cycle must be skipped. */
async function acquireSweepLock(sweepLock: SweepLockService): Promise<string | null> {
  const lockId = uuidv4();
  const isAcquired = await sweepLock.acquireLock(REDIS_KEYS.CLEANUP_SWEEP_LOCK, lockId, SWEEP_LOCK_TTL_MS);
  if (!isAcquired) {
    // Held by another process, or Redis errored (acquireLock returns false then) —
    // either way fail closed and let the lock holder / next cycle do the work.
    loggingService.logInfo("Destructive room sweep skipped: sweep lock not acquired");
    return null;
  }
  return lockId;
}

/**
 * One-shot ghost cleanup after the post-restart reconnection window.
 * Same guards as the periodic sweep (cleanupGhostUsers additionally self-fuses).
 */
export async function runPostRestartGhostCleanup(
  deps: Pick<PeriodicSweepDeps, "countLocalSockets" | "roomLifecycleService" | "sweepLock">,
): Promise<void> {
  if (!(await isPresenceSweepSafe(deps))) return;

  const lockId = await acquireSweepLock(deps.sweepLock);
  if (lockId === null) return;
  try {
    await deps.roomLifecycleService.cleanupGhostUsers();
    loggingService.logInfo("Post-restart ghost user cleanup completed");
  } finally {
    await deps.sweepLock.releaseLock(REDIS_KEYS.CLEANUP_SWEEP_LOCK, lockId);
  }
}

/**
 * The 5-minute destructive sweep (body unchanged from registerBackgroundJobs apart
 * from the DEV-258 guards).
 *
 * DEV-140: Consolidated from triple O(n) scan into a single getAllRooms() pass +
 * targeted re-check. Order: ghost cleanup (all rooms) → grace period expiry (reuses
 * ghost-cleaned state) → orphan session removal → targeted re-check of only rooms
 * affected by orphan removal.
 */
export async function runPeriodicRoomSweep(deps: PeriodicSweepDeps): Promise<void> {
  const {
    io,
    sweepLock,
    namespaceManager,
    roomLifecycleService,
    roomLifecycleHandler,
    roomSessionManager,
    metronomeService,
    notePlayingHandler,
  } = deps;

  if (!(await isPresenceSweepSafe(deps))) return;

  const lockId = await acquireSweepLock(sweepLock);
  if (lockId === null) return;

  try {
    // 1. Run ghost user cleanup once for all rooms (single getAllRooms() pass)
    await roomLifecycleService.cleanupGhostUsers();

    // 2. Clean up expired grace periods and empty rooms
    // (no longer calls cleanupGhostUsers() internally — DEV-140)
    const deletedRooms = await roomLifecycleService.cleanupExpiredGraceTime(true);

    // Clean up namespaces for deleted rooms.
    for (const roomId of deletedRooms) {
      try {
        metronomeService.cleanupRoom(roomId);
        notePlayingHandler.cleanupRoom(roomId);
        namespaceManager.cleanupRoomNamespace(roomId);
        namespaceManager.cleanupApprovalNamespace(roomId);
        const existingTimer = roomLifecycleHandler.ownerGracePeriodTimers.get(roomId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          roomLifecycleHandler.ownerGracePeriodTimers.delete(roomId);
        }
        roomLifecycleHandler.clearAllMemberGracePeriodTimers(roomId);
        // clearActiveRoomByRoomId is already called inside the onRoomDeletedCallback wired
        // in RoomCleanupService.setOnRoomDeletedCallback — no duplicate call needed here.
        roomLifecycleHandler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId });
        loggingService.logInfo(
          "Cleaned up expired room after grace period expiration",
          { roomId, aggressiveMode: true }
        );
      } catch (error: unknown) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
          context: 'periodic-cleanup.room-cleanup',
          roomId,
        });
      }
    }

    // 3. Clean up orphan redis sessions — track which rooms were affected
    const { affectedRoomIds } = await roomSessionManager.cleanupOrphanRedisSessions(
      io,
      async (roomId: string, userId: string) => {
        await roomLifecycleService.removeUserIfGhost(roomId, userId);
      }
    );

    // 4. Targeted re-check: only check rooms affected by orphan removal
    // for closure (orphan removal may have emptied a room). The
    // onOrphanFound callback already called removeUserIfGhost per-user,
    // so we only need to re-check shouldCloseRoom here (DEV-140).
    for (const roomId of affectedRoomIds) {
      try {
        if (await roomLifecycleService.shouldCloseRoom(roomId)) {
          loggingService.logInfo(
            'Closing room that became empty after orphan session cleanup',
            { roomId },
          );
          // Stop metronome + companion scheduler and clean namespaces — same as the
          // grace-period close paths. deleteRoomAndCleanup alone does NOT do this;
          // skipping it leaks the RoomMetronome instance and companion runtime snapshot.
          metronomeService.cleanupRoom(roomId);
          notePlayingHandler.cleanupRoom(roomId);
          namespaceManager.cleanupRoomNamespace(roomId);
          namespaceManager.cleanupApprovalNamespace(roomId);
          // Re-use deleteRoomAndCleanup for consistent post-deletion cleanup
          const hasDeleted = await roomLifecycleHandler.deleteRoomAndCleanup(roomId);
          if (hasDeleted) {
            roomLifecycleHandler.broadcastToLobby(
              ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST,
              { roomId },
            );
          }
        }
      } catch (error: unknown) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
          context: 'periodic-cleanup.orphan-affected-room',
          roomId,
        });
      }
    }
  } finally {
    await sweepLock.releaseLock(REDIS_KEYS.CLEANUP_SWEEP_LOCK, lockId);
  }
}
