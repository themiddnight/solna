/**
 * Unit tests for the DEV-258 hardened periodic room sweep.
 *
 * Locks the two guards protecting destructive cleanup from non-serving
 * processes (zombie dev process, deploy overlap, extra replica):
 *   Guard A — zero-socket sanity fuse: a process whose own Socket.IO server has
 *             zero connected sockets must not judge presence while rooms show occupants.
 *   Guard B — single-sweeper Redis lock: only one process runs a destructive
 *             sweep at a time; lock denial or Redis error skips the cycle (fail closed).
 */
import {
  countConnectedSockets,
  runPeriodicRoomSweep,
  runPostRestartGhostCleanup,
  SWEEP_LOCK_TTL_MS,
  type PeriodicSweepDeps,
  type SocketServerLike,
} from '../periodicRoomSweep';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';
import type { RoomLifecycleService } from '../../../domains/room-management/application/RoomLifecycleService';
import type { RoomLifecycleHandler } from '../../../domains/room-management/infrastructure/handlers';
import type { RoomSessionManager } from '../../../domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '../../../domains/room-management/infrastructure/services/MetronomeService';
import type { NotePlayingHandler } from '../../../domains/audio-processing/infrastructure/handlers/NotePlayingHandler';
import type { NamespaceManager } from '../../../shared/infrastructure/namespace/NamespaceManager';
import { createPartialMock } from '@/testing/mocks';

describe('countConnectedSockets', () => {
  const buildServer = (sizes: number[]): SocketServerLike => ({
    _nsps: new Map(
      sizes.map((size, index) => [
        `/ns-${index}`,
        { sockets: new Map(Array.from({ length: size }, (_, i) => [`s${i}`, {}])) },
      ]),
    ),
  });

  it('sums connected sockets across all namespaces', () => {
    expect(countConnectedSockets(buildServer([2, 0, 3]))).toBe(5);
  });

  it('returns 0 for a server with no namespaces or no sockets', () => {
    expect(countConnectedSockets(buildServer([]))).toBe(0);
    expect(countConnectedSockets(buildServer([0, 0]))).toBe(0);
  });
});

describe('periodic room sweep guards', () => {
  let deps: PeriodicSweepDeps;
  let mockRoomLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockRoomLifecycleHandler: jest.Mocked<RoomLifecycleHandler>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockMetronomeService: jest.Mocked<MetronomeService>;
  let mockNotePlayingHandler: jest.Mocked<NotePlayingHandler>;
  let acquireLock: jest.Mock<Promise<boolean>, [string, string, number]>;
  let releaseLock: jest.Mock<Promise<boolean>, [string, string]>;

  beforeEach(() => {
    mockRoomLifecycleService = createPartialMock<RoomLifecycleService>({
      cleanupGhostUsers: jest.fn().mockResolvedValue(undefined),
      cleanupExpiredGraceTime: jest.fn().mockResolvedValue([]),
      hasAnyRoomOccupants: jest.fn().mockResolvedValue(false),
      shouldCloseRoom: jest.fn().mockResolvedValue(false),
    });
    mockRoomLifecycleHandler = createPartialMock<RoomLifecycleHandler>({
      deleteRoomAndCleanup: jest.fn().mockResolvedValue(true),
      broadcastToLobby: jest.fn(),
      clearAllMemberGracePeriodTimers: jest.fn(),
    });
    // ownerGracePeriodTimers is a public readonly Map on the real handler
    Object.assign(mockRoomLifecycleHandler, { ownerGracePeriodTimers: new Map<string, NodeJS.Timeout>() });
    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      cleanupOrphanRedisSessions: jest.fn().mockResolvedValue({ orphanCount: 0, affectedRoomIds: [] }),
    });
    mockNamespaceManager = createPartialMock<NamespaceManager>({
      cleanupRoomNamespace: jest.fn(),
      cleanupApprovalNamespace: jest.fn(),
    });
    mockMetronomeService = createPartialMock<MetronomeService>({
      cleanupRoom: jest.fn(),
    });
    mockNotePlayingHandler = createPartialMock<NotePlayingHandler>({
      cleanupRoom: jest.fn(),
    });
    acquireLock = jest.fn<Promise<boolean>, [string, string, number]>().mockResolvedValue(true);
    releaseLock = jest.fn<Promise<boolean>, [string, string]>().mockResolvedValue(true);

    deps = {
      io: { of: () => ({ sockets: { get: () => undefined } }) },
      countLocalSockets: () => 1,
      sweepLock: { acquireLock, releaseLock },
      namespaceManager: mockNamespaceManager,
      roomLifecycleService: mockRoomLifecycleService,
      roomLifecycleHandler: mockRoomLifecycleHandler,
      roomSessionManager: mockRoomSessionManager,
      metronomeService: mockMetronomeService,
      notePlayingHandler: mockNotePlayingHandler,
    };
  });

  describe('runPeriodicRoomSweep — Guard A (zero-socket fuse)', () => {
    it('skips every destructive step when zero local sockets and rooms show occupants', async () => {
      deps.countLocalSockets = () => 0;
      void mockRoomLifecycleService.hasAnyRoomOccupants.mockResolvedValue(true);

      await runPeriodicRoomSweep(deps);

      expect(acquireLock).not.toHaveBeenCalled();
      expect(mockRoomLifecycleService.cleanupGhostUsers).not.toHaveBeenCalled();
      expect(mockRoomLifecycleService.cleanupExpiredGraceTime).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.cleanupOrphanRedisSessions).not.toHaveBeenCalled();
    });

    it('proceeds with zero local sockets when no room has occupants (nothing at stake)', async () => {
      deps.countLocalSockets = () => 0;
      void mockRoomLifecycleService.hasAnyRoomOccupants.mockResolvedValue(false);

      await runPeriodicRoomSweep(deps);

      expect(mockRoomLifecycleService.cleanupGhostUsers).toHaveBeenCalled();
      expect(mockRoomSessionManager.cleanupOrphanRedisSessions).toHaveBeenCalled();
    });

    it('does not even consult Redis occupancy when local sockets exist', async () => {
      deps.countLocalSockets = () => 3;

      await runPeriodicRoomSweep(deps);

      expect(mockRoomLifecycleService.hasAnyRoomOccupants).not.toHaveBeenCalled();
      expect(mockRoomLifecycleService.cleanupGhostUsers).toHaveBeenCalled();
    });
  });

  describe('runPeriodicRoomSweep — Guard B (single-sweeper lock)', () => {
    it('skips the whole cycle when the lock is not acquired (held elsewhere or Redis error)', async () => {
      acquireLock.mockResolvedValue(false);

      await runPeriodicRoomSweep(deps);

      expect(mockRoomLifecycleService.cleanupGhostUsers).not.toHaveBeenCalled();
      expect(mockRoomLifecycleService.cleanupExpiredGraceTime).not.toHaveBeenCalled();
      expect(mockRoomSessionManager.cleanupOrphanRedisSessions).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
    });

    it('acquires with the sweep key + TTL and releases the same lock id after the sweep', async () => {
      await runPeriodicRoomSweep(deps);

      expect(acquireLock).toHaveBeenCalledWith(REDIS_KEYS.CLEANUP_SWEEP_LOCK, expect.any(String), SWEEP_LOCK_TTL_MS);
      const lockId = acquireLock.mock.calls[0]?.[1];
      expect(releaseLock).toHaveBeenCalledWith(REDIS_KEYS.CLEANUP_SWEEP_LOCK, lockId);
    });

    it('releases the lock even when a sweep step throws, and propagates the error', async () => {
      void mockRoomLifecycleService.cleanupGhostUsers.mockRejectedValue(new Error('redis down'));

      await expect(runPeriodicRoomSweep(deps)).rejects.toThrow('redis down');

      expect(releaseLock).toHaveBeenCalled();
    });
  });

  describe('runPeriodicRoomSweep — sweep body (behavior preserved)', () => {
    it('runs ghost cleanup, grace expiry, orphan cleanup, and re-checks affected rooms', async () => {
      void mockRoomLifecycleService.cleanupExpiredGraceTime.mockResolvedValue(['dead-room']);
      void mockRoomSessionManager.cleanupOrphanRedisSessions.mockResolvedValue({
        orphanCount: 1,
        affectedRoomIds: ['affected-room'],
      });
      void mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(true);

      await runPeriodicRoomSweep(deps);

      // Aggressive grace-period expiry
      expect(mockRoomLifecycleService.cleanupExpiredGraceTime).toHaveBeenCalledWith(true);
      // Deleted room gets its runtimes + namespaces cleaned and lobby notified
      expect(mockMetronomeService.cleanupRoom).toHaveBeenCalledWith('dead-room');
      expect(mockNotePlayingHandler.cleanupRoom).toHaveBeenCalledWith('dead-room');
      expect(mockNamespaceManager.cleanupRoomNamespace).toHaveBeenCalledWith('dead-room');
      expect(mockNamespaceManager.cleanupApprovalNamespace).toHaveBeenCalledWith('dead-room');
      // Orphan-affected room re-check closes the room through the full path
      expect(mockRoomLifecycleService.shouldCloseRoom).toHaveBeenCalledWith('affected-room');
      expect(mockRoomLifecycleHandler.deleteRoomAndCleanup).toHaveBeenCalledWith('affected-room');
      expect(mockRoomLifecycleHandler.broadcastToLobby).toHaveBeenCalledTimes(2);
    });

    it('passes io and a ghost-removal callback to the orphan sweep', async () => {
      await runPeriodicRoomSweep(deps);

      expect(mockRoomSessionManager.cleanupOrphanRedisSessions).toHaveBeenCalledWith(deps.io, expect.any(Function));
    });
  });

  describe('runPostRestartGhostCleanup', () => {
    it('runs ghost cleanup under the sweep lock and releases it', async () => {
      await runPostRestartGhostCleanup(deps);

      expect(acquireLock).toHaveBeenCalledWith(REDIS_KEYS.CLEANUP_SWEEP_LOCK, expect.any(String), SWEEP_LOCK_TTL_MS);
      expect(mockRoomLifecycleService.cleanupGhostUsers).toHaveBeenCalled();
      const lockId = acquireLock.mock.calls[0]?.[1];
      expect(releaseLock).toHaveBeenCalledWith(REDIS_KEYS.CLEANUP_SWEEP_LOCK, lockId);
    });

    it('skips ghost cleanup when the lock is denied', async () => {
      acquireLock.mockResolvedValue(false);

      await runPostRestartGhostCleanup(deps);

      expect(mockRoomLifecycleService.cleanupGhostUsers).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
    });
  });
});
