import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS, OCCUPANCY_EVENTS } from '@jam-band/shared';
import { ArrangeLockHandler } from '../ArrangeLockHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import type { ProjectSaveLockService, SaveLockInfo } from '@/domains/arrange-room/infrastructure/services/ProjectSaveLockService';
import type { ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const PROJECT_ID = 'project-1';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';
const OTHER_USER_ID = 'user-other-2';
const OTHER_USERNAME = 'other-tester';

/** Matches `BaseRoomHandler.getSession`'s minimal resolved session shape. */
interface MinimalSession {
  roomId: string;
  userId: string;
  username: string;
}

function createSession(): MinimalSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
  };
}

function createSaveLockInfo(overrides: Partial<SaveLockInfo> = {}): SaveLockInfo {
  return {
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
    lockedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Minimal valid ArrangeRoomState (only the fields the handler under test reads). */
function createRoomState(overrides: Partial<ArrangeRoomState> = {}): ArrangeRoomState {
  return {
    roomId: ROOM_ID,
    roomType: 'arrange',
    tracks: [],
    regions: [],
    occupancy: new Map(),
    selectedTrackId: 'track-1',
    selectedRegionIds: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    synthStates: {},
    effectChains: {},
    markers: [],
    chordTrack: { id: 'chord-track-1', projectId: PROJECT_ID, blocks: [] },
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: true,
    lastUpdated: new Date(),
    ...overrides,
  };
}

describe('ArrangeLockHandler (Task 17)', () => {
  let handler: ArrangeLockHandler;
  let stateService: jest.Mocked<ArrangeRoomStateService>;
  let saveLockService: jest.Mocked<ProjectSaveLockService>;
  let occupancyService: jest.Mocked<RoomOccupancyService>;
  let arrangeHandler: jest.Mocked<ArrangeRoomHandler>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let socketToEmit: jest.Mock;
  let socketTo: jest.Mock;
  let namespace: Namespace;
  let namespaceEmit: jest.Mock<void, [event: string, payload: unknown]>;
  let namespaceTo: jest.Mock;

  /** Matches the brief's Step 2 `setup()` shape — returns the beforeEach-initialized mocks. */
  function setup() {
    return { handler, socket, namespace, occupancyService };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(null),
      updateSelection: jest.fn().mockResolvedValue(undefined),
    });

    saveLockService = createPartialMock<ProjectSaveLockService>({
      acquireLock: jest.fn().mockReturnValue(createSaveLockInfo()),
      releaseLock: jest.fn().mockReturnValue(true),
      releaseUserLocks: jest.fn().mockReturnValue([]),
      isLocked: jest.fn().mockReturnValue({ locked: false }),
    });

    occupancyService = createPartialMock<RoomOccupancyService>({
      join: jest.fn(),
      leave: jest.fn(),
      heartbeat: jest.fn(),
      releaseAllForUser: jest.fn().mockResolvedValue([]),
    });

    arrangeHandler = createPartialMock<ArrangeRoomHandler>({
      getSessionPublic: jest.fn().mockResolvedValue(createSession()),
      getStateService: jest.fn().mockReturnValue(stateService),
      getProjectSaveLockService: jest.fn().mockReturnValue(saveLockService),
      getOccupancyService: jest.fn().mockReturnValue(occupancyService),
    });
    handler = new ArrangeLockHandler(arrangeHandler);

    socketEmit = jest.fn();
    socketToEmit = jest.fn();
    socketTo = jest.fn().mockReturnValue({ emit: socketToEmit });
    socket = createPartialMock<Socket>({
      id: 'socket-1',
      emit: socketEmit,
      to: socketTo,
    });

    namespaceEmit = jest.fn<void, [event: string, payload: unknown]>();
    namespaceTo = jest.fn().mockReturnValue({ emit: namespaceEmit });
    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      to: namespaceTo,
    });
  });

  // ── selection change ────────────────────────────────────────────────────────

  describe('handleSelectionChange', () => {
    it('persists the selection and broadcasts SELECTION_CHANGED via socket.to (excludes sender)', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ selectedTrackId: 'track-1', selectedRegionIds: [] }));

      await handler.handleSelectionChange(socket, namespace, { roomId: ROOM_ID });

      expect(stateService.updateSelection).toHaveBeenCalledWith(ROOM_ID, 'track-1', []);
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SELECTION_CHANGED, {
        selectedTrackId: 'track-1',
        selectedRegionIds: [],
        userId: VERIFIED_USER_ID,
        username: VERIFIED_USERNAME,
      });
    });

    it('does nothing when the room has no state', async () => {
      await handler.handleSelectionChange(socket, namespace, { roomId: ROOM_ID, selectedTrackId: 'track-9' });

      expect(stateService.updateSelection).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });
  });

  // ── occupancy join/leave/heartbeat (DEV-350 M2, Task 7) ──────────────────────
  // These are thin-wrapper tests: they confirm ArrangeLockHandler pulls
  // getOccupancyService()/getSessionPublic() and delegates to the shared
  // `occupancySocketHandlers` module (room-shared) — the module's own orchestration logic is
  // covered directly in `occupancySocketHandlers.test.ts`.

  describe('handleOccupancyJoin', () => {
    it('broadcasts JOINED with the updated holders on success', async () => {
      const { handler, socket, namespace, occupancyService } = setup();
      occupancyService.join.mockResolvedValue({ accepted: true, holders: [{ userId: 'u1', username: 'Alice', joinedAt: 1 }] });

      await handler.handleOccupancyJoin(socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOINED, {
        elementId: 'track:t1:volume',
        holders: [{ userId: 'u1', username: 'Alice', joinedAt: 1 }],
      });
    });

    it('unicasts JOIN_DENIED with heldBy when rejected', async () => {
      const { handler, socket, namespace, occupancyService } = setup();
      occupancyService.join.mockResolvedValue({ accepted: false, holders: [{ userId: 'other', username: 'Bob', joinedAt: 1 }] });

      await handler.handleOccupancyJoin(socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(socketEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOIN_DENIED, {
        elementId: 'track:t1:volume',
        heldBy: { userId: 'other', username: 'Bob', joinedAt: 1 },
      });
    });
  });

  describe('handleOccupancyLeave', () => {
    it('broadcasts LEFT with the post-removal holders', async () => {
      const { handler, socket, namespace, occupancyService } = setup();
      occupancyService.leave.mockResolvedValue({ holders: [] });

      await handler.handleOccupancyLeave(socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'track:t1:volume', holders: [] });
    });
  });

  describe('handleOccupancyHeartbeat', () => {
    it('delegates to the occupancy service with the verified session identity', async () => {
      const { handler, socket, occupancyService } = setup();

      await handler.handleOccupancyHeartbeat(socket, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.heartbeat).toHaveBeenCalledWith(ROOM_ID, 'track:t1:volume', VERIFIED_USER_ID);
    });
  });

  // ── user-leave lock cleanup ─────────────────────────────────────────────────

  describe('handleUserLeaveLocks', () => {
    it('broadcasts LEFT for every element the disconnecting user held', async () => {
      const { handler, namespace, occupancyService } = setup();
      occupancyService.releaseAllForUser.mockResolvedValue([
        { elementId: 'track:t1:volume', holders: [] },
        { elementId: 'region-1', holders: [{ userId: 'u2', username: 'Bob', joinedAt: 2 }] },
      ]);

      await handler.handleUserLeaveLocks(ROOM_ID, VERIFIED_USER_ID, namespace);

      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'track:t1:volume', holders: [] });
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, {
        elementId: 'region-1',
        holders: [{ userId: 'u2', username: 'Bob', joinedAt: 2 }],
      });
    });

    it('releases every save lock held by the leaving user and broadcasts SAVE_LOCK_RELEASED per project', async () => {
      saveLockService.releaseUserLocks.mockReturnValue([PROJECT_ID, 'project-2']);

      await handler.handleUserLeaveLocks(ROOM_ID, VERIFIED_USER_ID, namespace);

      expect(saveLockService.releaseUserLocks).toHaveBeenCalledWith(VERIFIED_USER_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: PROJECT_ID,
        reason: 'user_disconnected',
      });
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: 'project-2',
        reason: 'user_disconnected',
      });
    });

    it('broadcasts nothing when the leaving user held no occupancy or save locks', async () => {
      await handler.handleUserLeaveLocks(ROOM_ID, VERIFIED_USER_ID, namespace);

      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── save lock request ───────────────────────────────────────────────────────

  describe('handleSaveLockRequest', () => {
    it('acquires the save lock and broadcasts SAVE_LOCK_ACQUIRED via namespace.to', async () => {
      await handler.handleSaveLockRequest(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(saveLockService.acquireLock).toHaveBeenCalledWith(PROJECT_ID, VERIFIED_USER_ID, VERIFIED_USERNAME);
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_ACQUIRED, {
        projectId: PROJECT_ID,
        lockInfo: { userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME },
      });
      expect(socketEmit).not.toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_DENIED, expect.anything());
    });

    it('denies the request to the requester only when another user holds the lock', async () => {
      saveLockService.acquireLock.mockReturnValue(null);
      saveLockService.isLocked.mockReturnValue({
        locked: true,
        lockInfo: createSaveLockInfo({ userId: OTHER_USER_ID, username: OTHER_USERNAME }),
      });

      await handler.handleSaveLockRequest(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: PROJECT_ID,
        reason: 'locked_by_other',
        lockedBy: OTHER_USERNAME,
      });
      expect(namespaceEmit).not.toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_ACQUIRED, expect.anything());
    });

    it('rejects a session that does not match the room before touching the lock service', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleSaveLockRequest(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: PROJECT_ID,
        reason: 'invalid_session',
      });
      expect(saveLockService.acquireLock).not.toHaveBeenCalled();
    });

    it('denies with service_error when the lock service throws', async () => {
      saveLockService.acquireLock.mockImplementation(() => {
        throw new Error('boom');
      });

      await handler.handleSaveLockRequest(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_DENIED, {
        projectId: PROJECT_ID,
        reason: 'service_error',
      });
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── save lock release ───────────────────────────────────────────────────────

  describe('handleSaveLockRelease', () => {
    it('releases the save lock and broadcasts SAVE_LOCK_RELEASED via namespace.to with the success flag', async () => {
      await handler.handleSaveLockRelease(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID, isSuccess: true });

      expect(saveLockService.releaseLock).toHaveBeenCalledWith(PROJECT_ID, VERIFIED_USER_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: PROJECT_ID,
        success: true,
      });
    });

    it('COLL-23: still broadcasts the release when the lock was already gone from the map (API error handler released it first)', async () => {
      // The COLL-23 / PERM-004 rule: when the client asks to release, always broadcast —
      // even if releaseLock() reports false because the map no longer holds the lock.
      // This covers the case where the REST error handler already removed it: without the
      // broadcast, every other client would keep showing the save lock as held.
      saveLockService.releaseLock.mockReturnValue(false);
      saveLockService.isLocked.mockReturnValue({ locked: false });

      await handler.handleSaveLockRelease(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(saveLockService.releaseLock).toHaveBeenCalledWith(PROJECT_ID, VERIFIED_USER_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: PROJECT_ID,
        success: true,
      });
    });

    it('defaults the success flag to true when the client omits it', async () => {
      await handler.handleSaveLockRelease(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.SAVE_LOCK_RELEASED, {
        projectId: PROJECT_ID,
        success: true,
      });
    });

    it('does NOT broadcast when the lock is held by someone else (release false, still locked)', async () => {
      saveLockService.releaseLock.mockReturnValue(false);
      saveLockService.isLocked.mockReturnValue({
        locked: true,
        lockInfo: createSaveLockInfo({ userId: OTHER_USER_ID, username: OTHER_USERNAME }),
      });

      await handler.handleSaveLockRelease(socket, namespace, { roomId: ROOM_ID, projectId: PROJECT_ID });

      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });
});
