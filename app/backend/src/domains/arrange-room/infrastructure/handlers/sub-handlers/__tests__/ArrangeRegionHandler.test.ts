/**
 * Task 18 (BE-slices test-coverage plan) — ArrangeRegionHandler unit tests.
 *
 * Exercises the REAL handler methods with a mocked ArrangeRoomStateService
 * (atomic-result variants) + jest fake timers for the TR-10 auto-commit path.
 * Tests document EXISTING behavior — GREEN on first run; a RED here means a
 * discovered bug, not a test bug.
 *
 * Contract covered (mapped to the real socket API):
 * - region:add / region:update / region:move happy paths
 * - region:drag (TR-1 ephemeral) — broadcast-only via socket.to (excludes
 *   sender), auto-commit scheduled; region:drag_end clears the auto-commit
 *   and commits the whole batch under ONE batchUpdateRegions lock (TR-2)
 * - TR-10 auto-commit on disconnect — Math.max(0, start) sanitization,
 *   missing regions and invalid trackIds skipped, REGION_DRAG_COMMITTED via
 *   namespace.to (includes sender)
 * - region:delete with shared-audioUrl reference counting — storage cleanup
 *   only when the deleted region held the LAST reference to the audio file
 * - note:add / note:update / note:delete atomic lock-conflict results
 * - note realtime update (ephemeral) + its auto-commit
 * - track-lock validation with project-owner bypass
 *
 * DEV-350 Round 2, Task 2: the note handlers moved to `ArrangeNoteHandler` (TR-20 800-line
 * cap on ArrangeRegionHandler). Their tests stay in this file — both sub-handlers share the
 * same fixtures/harness and the same region-scoped guards (`arrangeRegionGuards`), and the
 * note-vs-region interaction (a note edit inside a region someone else occupies) is what is
 * actually under test. Note cases call `noteHandler`, region cases call `handler`.
 */
import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS, EPHEMERAL_COMMIT_TIMEOUT_MS, UserType } from '@jam-band/shared';
import type { ElementOccupancy } from '@jam-band/shared';
import { ArrangeRegionHandler } from '../ArrangeRegionHandler';
import { ArrangeNoteHandler } from '../ArrangeNoteHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import type { AudioRegionStorageService } from '@/domains/arrange-room/infrastructure/storage/AudioRegionStorageService';
import type { SocketAuthUser } from '@/config/socket';
import type {
  ArrangeRoomState,
  AudioRegion,
  MidiNote,
  MidiRegion,
  Track,
} from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { UNITY_DB } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const PROJECT_ID = 'project-1';
const TRACK_ID = 'track-1';
const REGION_ID = 'region-1';
const OWNER_USER_ID = 'user-owner-1';
const OWNER_USERNAME = 'owner-tester';
const OTHER_USER_ID = 'user-other-2';
const OTHER_USERNAME = 'other-tester';

/** Matches `BaseRoomHandler.getSession`'s minimal resolved session shape. */
interface MinimalSession {
  roomId: string;
  userId: string;
  username: string;
}

function createSession(overrides: Partial<MinimalSession> = {}): MinimalSession {
  return {
    roomId: ROOM_ID,
    userId: OWNER_USER_ID,
    username: OWNER_USERNAME,
    ...overrides,
  };
}

/** Session whose userType is set — handleRegionAdd stamps `ownerId` for it. */
function registeredSocketUser(overrides: Partial<SocketAuthUser> = {}): SocketAuthUser {
  return {
    id: OWNER_USER_ID,
    email: 'owner@murva.app',
    username: OWNER_USERNAME,
    userType: UserType.REGISTERED,
    emailVerified: true,
    profilePictureUrl: null,
    ...overrides,
  };
}

/** Occupancy entry with a single holder — that holder is `holders[0]`, the owner (DEV-350 M2, Task 14 Part 2). */
function ownerOccupancy(userId: string, username: string): ElementOccupancy {
  return { kind: 'container', holders: [{ userId, username, joinedAt: Date.now() }] };
}

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: TRACK_ID,
    name: 'Track 1',
    type: 'midi',
    volume: UNITY_DB,
    pan: 0,
    color: '#000000',
    regionIds: [],
    ...overrides,
  };
}

function midiRegion(overrides: Partial<MidiRegion> = {}): MidiRegion {
  return {
    id: REGION_ID,
    trackId: TRACK_ID,
    name: 'Region 1',
    start: 0,
    length: 4,
    loopEnabled: false,
    loopIterations: 1,
    type: 'midi',
    notes: [],
    sustainEvents: [],
    ...overrides,
  };
}

function audioRegion(overrides: Partial<AudioRegion> = {}): AudioRegion {
  return {
    id: 'region-audio-1',
    trackId: TRACK_ID,
    name: 'Audio 1',
    start: 0,
    length: 8,
    loopEnabled: false,
    loopIterations: 1,
    type: 'audio',
    audioUrl: 'https://cdn.example.com/audio/region-audio-1/playback.mp3',
    ...overrides,
  };
}

function midiNote(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: 'note-1',
    pitch: 60,
    velocity: 0.8,
    start: 0,
    duration: 1,
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
    selectedTrackId: TRACK_ID,
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

describe('ArrangeRegionHandler (Task 18)', () => {
  let handler: ArrangeRegionHandler;
  let noteHandler: ArrangeNoteHandler;
  let stateService: jest.Mocked<ArrangeRoomStateService>;
  let occupancyService: jest.Mocked<RoomOccupancyService>;
  let arrangeHandler: jest.Mocked<ArrangeRoomHandler>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let socketToEmit: jest.Mock;
  let socketTo: jest.Mock;
  let namespace: Namespace;
  let namespaceEmit: jest.Mock<void, [event: string, payload: unknown]>;
  let namespaceTo: jest.Mock;
  let scheduleEphemeralCommitPublic: jest.Mock;
  let clearEphemeralCommitPublic: jest.Mock;
  let storage: jest.Mocked<AudioRegionStorageService>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(null),
      addRegion: jest.fn().mockResolvedValue(createRoomState()),
      updateRegion: jest.fn().mockResolvedValue(createRoomState()),
      removeRegion: jest.fn().mockResolvedValue(createRoomState()),
      batchUpdateRegions: jest.fn().mockResolvedValue(createRoomState()),
      addNoteAtomic: jest.fn().mockResolvedValue({ result: 'ok', state: createRoomState() }),
      updateNoteAtomic: jest.fn().mockResolvedValue({ result: 'ok', state: createRoomState() }),
      deleteNoteAtomic: jest.fn().mockResolvedValue({ result: 'ok', state: createRoomState() }),
      updateEffectChain: jest.fn().mockResolvedValue(createRoomState()),
    });

    // Mirrors BaseRoomHandler.scheduleEphemeralCommit's TR-10 behavior: the
    // commit handler fires once after EPHEMERAL_COMMIT_TIMEOUT_MS (fake timers).
    scheduleEphemeralCommitPublic = jest.fn(
      (
        _roomId: string,
        _userId: string,
        _fieldName: string,
        _value: unknown,
        commitHandler: () => Promise<void>,
      ) => {
        setTimeout(() => {
          void commitHandler();
        }, EPHEMERAL_COMMIT_TIMEOUT_MS);
      },
    );
    clearEphemeralCommitPublic = jest.fn();

    storage = createPartialMock<AudioRegionStorageService>({
      extractRegionIdFromPlaybackPath: jest.fn().mockReturnValue(null),
      deleteRegionAudio: jest.fn().mockResolvedValue(undefined),
    });

    // DEV-350 M2 (Task 14 Part 2): the CRUD guard reads the region's occupancy entry
    // (`holders[0]` is the owner with edit rights) instead of the retired `state.locks`.
    occupancyService = createPartialMock<RoomOccupancyService>({
      getOccupancy: jest.fn().mockResolvedValue(null),
    });

    arrangeHandler = createPartialMock<ArrangeRoomHandler>({
      getSessionPublic: jest.fn().mockResolvedValue(createSession()),
      getStateService: jest.fn().mockReturnValue(stateService),
      getOccupancyService: jest.fn().mockReturnValue(occupancyService),
      scheduleEphemeralCommitPublic,
      clearEphemeralCommitPublic,
      getAudioRegionStorageService: jest.fn().mockReturnValue(undefined),
    });
    handler = new ArrangeRegionHandler(arrangeHandler);
    noteHandler = new ArrangeNoteHandler(arrangeHandler);

    socketEmit = jest.fn();
    socketToEmit = jest.fn();
    socketTo = jest.fn().mockReturnValue({ emit: socketToEmit });
    socket = createPartialMock<Socket>({
      id: 'socket-1',
      emit: socketEmit,
      to: socketTo,
      data: { user: null },
    });

    namespaceEmit = jest.fn<void, [event: string, payload: unknown]>();
    namespaceTo = jest.fn().mockReturnValue({ emit: namespaceEmit });
    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      to: namespaceTo,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── region add ──────────────────────────────────────────────────────────────

  describe('handleRegionAdd', () => {
    it('persists the region (ownerId stamped from the session for registered users) and broadcasts REGION_ADDED via socket.to', async () => {
      const region = midiRegion();
      socket.data = { user: registeredSocketUser() };
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [] }),
      );

      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region });

      expect(region.ownerId).toBe(OWNER_USER_ID);
      expect(stateService.addRegion).toHaveBeenCalledWith(ROOM_ID, region);
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      // The broadcast carries the same region object reference (stamped in place).
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_ADDED, {
        region,
        userId: OWNER_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
    });

    it('leaves ownerId null for unauthenticated guests (no socket.data.user)', async () => {
      const region = midiRegion();
      socket.data = { user: null };
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [] }),
      );

      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region });

      expect(region.ownerId).toBeNull();
      expect(stateService.addRegion).toHaveBeenCalledWith(ROOM_ID, region);
    });

    it('rejects with a socket error when the room has no state', async () => {
      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region: midiRegion() });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Project state not found' }));
      expect(stateService.addRegion).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('is a silent no-op when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ roomId: 'some-other-room' }));

      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region: midiRegion() });

      expect(stateService.getState).not.toHaveBeenCalled();
      expect(stateService.addRegion).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('surfaces a service failure as a socket error (generic catch)', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ tracks: [track()], regions: [] }));
      stateService.addRegion.mockRejectedValue(new Error('boom'));

      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region: midiRegion() });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Failed to add region' }));
      expect(socketToEmit).not.toHaveBeenCalled();
    });
  });

  // ── region update ───────────────────────────────────────────────────────────

  describe('handleRegionUpdate', () => {
    it('persists the updates and broadcasts REGION_UPDATED via socket.to', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ tracks: [track()], regions: [midiRegion()] }),
      );
      const updates = { start: 8, name: 'Renamed' };

      await handler.handleRegionUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, updates });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, updates);
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_UPDATED, {
        regionId: REGION_ID,
        updates,
        userId: OWNER_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
    });

    it('emits LOCK_CONFLICT when another user holds the region occupancy and never calls updateRegion', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME)]]),
        }),
      );

      await handler.handleRegionUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { start: 8 },
      });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('allows the update when the region occupancy is held by the requester themselves', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OWNER_USER_ID, OWNER_USERNAME)]]),
        }),
      );

      await handler.handleRegionUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { start: 8 },
      });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 8 });
    });

    it('allows the update when nobody holds the region occupancy (no entry)', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { start: 8 },
      });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 8 });
    });

    it('rejects with "Region not found" when the region is missing from state', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ tracks: [track()], regions: [] }));

      await handler.handleRegionUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: 'region-ghost',
        updates: { start: 8 },
      });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Region not found' }));
      expect(stateService.updateRegion).not.toHaveBeenCalled();
    });
  });

  // ── region move ─────────────────────────────────────────────────────────────

  describe('handleRegionMove', () => {
    it('persists start = region.start + deltaBeats and broadcasts REGION_MOVED via socket.to', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion({ start: 2 })] }),
      );

      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: 4 });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 6 });
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_MOVED, {
        regionId: REGION_ID,
        newStart: 6,
        userId: OWNER_USER_ID,
      });
    });

    it('clamps the new start at 0 when the delta would push it negative (Math.max(0, ...))', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion({ start: 4 })] }),
      );

      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: -10 });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 0 });
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_MOVED, {
        regionId: REGION_ID,
        newStart: 0,
        userId: OWNER_USER_ID,
      });
    });

    it('emits LOCK_CONFLICT when the region occupancy is held by another user', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME)]]),
        }),
      );

      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: 4 });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.updateRegion).not.toHaveBeenCalled();
    });

    it('returns silently when the region does not exist in state', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: OWNER_USER_ID, regions: [] }));

      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: 'region-ghost', deltaBeats: 4 });

      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(socketEmit).not.toHaveBeenCalled();
    });
  });

  // ── region drag (TR-1 ephemeral) ───────────────────────────────────────────

  describe('handleRegionDrag (TR-1 ephemeral)', () => {
    const updates = [{ regionId: REGION_ID, newStart: 4 }];

    it('broadcasts REGION_DRAGGED via socket.to (excludes sender) with NO Redis write, and schedules the auto-commit', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionDrag(socket, namespace, { roomId: ROOM_ID, updates });

      // Ephemeral broadcast target: others only (socket.to), never namespace.to.
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DRAGGED, {
        updates,
        userId: OWNER_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
      // Ephemeral: no synchronous state write.
      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(stateService.batchUpdateRegions).not.toHaveBeenCalled();
      // TR-10 safety net keyed by fieldName "regionDrag".
      expect(scheduleEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_USER_ID,
        'regionDrag',
        updates,
        expect.any(Function),
      );
    });

    it('is a no-op for an empty update batch (no state read, no broadcast, no schedule)', async () => {
      await handler.handleRegionDrag(socket, namespace, { roomId: ROOM_ID, updates: [] });

      expect(stateService.getState).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
    });

    it('rejects up front with "Track is locked" for a non-owner dragging on a locked track — no broadcast, no schedule', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));

      await handler.handleRegionDrag(socket, namespace, { roomId: ROOM_ID, updates });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
    });

    it('lets the project owner drag on a locked track (owner bypass)', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );

      await handler.handleRegionDrag(socket, namespace, { roomId: ROOM_ID, updates });

      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DRAGGED, expect.anything());
      expect(scheduleEphemeralCommitPublic).toHaveBeenCalled();
      expect(socketEmit).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('rejects a drag onto a locked TARGET track (trackId move) for non-owners', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track(), track({ id: 'track-2', isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));

      await handler.handleRegionDrag(socket, namespace, {
        roomId: ROOM_ID,
        updates: [{ regionId: REGION_ID, newStart: 4, trackId: 'track-2' }],
      });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
    });
  });

  describe('handleRegionDrag auto-commit (TR-10 disconnect safety net)', () => {
    it('commits the pending drag when the timer fires: clamps negative starts, skips missing regions and invalid trackIds, broadcasts REGION_DRAG_COMMITTED via namespace.to', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track(), track({ id: 'track-2' })],
          regions: [midiRegion({ start: 2 })],
        }),
      );

      await handler.handleRegionDrag(socket, namespace, {
        roomId: ROOM_ID,
        updates: [
          { regionId: REGION_ID, newStart: -5 }, // sanitized to 0
          { regionId: 'region-missing', newStart: 8 }, // region gone from state → skipped
          { regionId: REGION_ID, newStart: 12, trackId: 'track-ghost' }, // trackId not in state → skipped
          { regionId: REGION_ID, newStart: 16, trackId: 'track-1' }, // same track → start-only update
          { regionId: REGION_ID, newStart: 20, trackId: 'track-2' }, // valid track move
        ],
      });

      await jest.advanceTimersByTimeAsync(EPHEMERAL_COMMIT_TIMEOUT_MS);

      expect(stateService.updateRegion).toHaveBeenCalledTimes(3);
      expect(stateService.updateRegion).toHaveBeenNthCalledWith(1, ROOM_ID, REGION_ID, { start: 0 });
      expect(stateService.updateRegion).toHaveBeenNthCalledWith(2, ROOM_ID, REGION_ID, { start: 16 });
      expect(stateService.updateRegion).toHaveBeenNthCalledWith(3, ROOM_ID, REGION_ID, { start: 20, trackId: 'track-2' });
      // Commit broadcast target: namespace.to (includes the sender, like every commit event).
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DRAG_COMMITTED, {
        updates: [
          { regionId: REGION_ID, newStart: 0 },
          { regionId: REGION_ID, newStart: 16 },
          { regionId: REGION_ID, newStart: 20, trackId: 'track-2' },
        ],
        userId: OWNER_USER_ID,
      });
    });

    it('broadcasts nothing when every pending update is invalid', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [] }),
      );

      await handler.handleRegionDrag(socket, namespace, {
        roomId: ROOM_ID,
        updates: [{ regionId: 'region-ghost', newStart: 4 }],
      });

      await jest.advanceTimersByTimeAsync(EPHEMERAL_COMMIT_TIMEOUT_MS);

      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('does nothing when the room state is gone by the time the timer fires', async () => {
      // Outer drag call sees a live state...
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionDrag(socket, namespace, {
        roomId: ROOM_ID,
        updates: [{ regionId: REGION_ID, newStart: 4 }],
      });

      // ...but the auto-commit's own fresh read finds nothing (room expired).
      stateService.getState.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(EPHEMERAL_COMMIT_TIMEOUT_MS);

      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── region drag end (commit) ────────────────────────────────────────────────

  describe('handleRegionDragEnd (commit)', () => {
    it('clears the auto-commit timer, commits the whole batch under ONE batchUpdateRegions lock, and broadcasts via namespace.to', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionDragEnd(socket, namespace, {
        roomId: ROOM_ID,
        updates: [
          { regionId: REGION_ID, newStart: 4 },
          { regionId: REGION_ID, newStart: 8 },
        ],
      });

      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(ROOM_ID, OWNER_USER_ID, 'regionDrag');
      expect(stateService.batchUpdateRegions).toHaveBeenCalledWith(ROOM_ID, [
        { regionId: REGION_ID, updates: { start: 4 } },
        { regionId: REGION_ID, updates: { start: 8 } },
      ]);
      expect(stateService.updateRegion).not.toHaveBeenCalled();
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DRAG_COMMITTED, {
        updates: [
          { regionId: REGION_ID, newStart: 4 },
          { regionId: REGION_ID, newStart: 8 },
        ],
        userId: OWNER_USER_ID,
      });
      expect(socketTo).not.toHaveBeenCalled();
    });

    it('sanitizes the batch exactly like the auto-commit: clamps starts, skips missing regions and invalid trackIds, applies track moves', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track(), track({ id: 'track-2' })],
          regions: [midiRegion({ start: 2 })],
        }),
      );

      await handler.handleRegionDragEnd(socket, namespace, {
        roomId: ROOM_ID,
        updates: [
          { regionId: REGION_ID, newStart: -3 }, // clamped to 0
          { regionId: 'region-missing', newStart: 8 }, // skipped
          { regionId: REGION_ID, newStart: 10, trackId: 'track-ghost' }, // skipped (invalid trackId)
          { regionId: REGION_ID, newStart: 14, trackId: 'track-2' }, // valid track move
        ],
      });

      expect(stateService.batchUpdateRegions).toHaveBeenCalledWith(ROOM_ID, [
        { regionId: REGION_ID, updates: { start: 0 } },
        { regionId: REGION_ID, updates: { start: 14, trackId: 'track-2' } },
      ]);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DRAG_COMMITTED, {
        updates: [
          { regionId: REGION_ID, newStart: 0 },
          { regionId: REGION_ID, newStart: 14, trackId: 'track-2' },
        ],
        userId: OWNER_USER_ID,
      });
    });

    it('is a no-op for an empty update batch — the auto-commit timer is NOT cleared (client sent nothing to commit)', async () => {
      await handler.handleRegionDragEnd(socket, namespace, { roomId: ROOM_ID, updates: [] });

      expect(stateService.getState).not.toHaveBeenCalled();
      expect(clearEphemeralCommitPublic).not.toHaveBeenCalled();
      expect(stateService.batchUpdateRegions).not.toHaveBeenCalled();
    });

    it('returns without writing or broadcasting when every update is invalid', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [] }),
      );

      await handler.handleRegionDragEnd(socket, namespace, {
        roomId: ROOM_ID,
        updates: [{ regionId: 'region-ghost', newStart: 4 }],
      });

      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(ROOM_ID, OWNER_USER_ID, 'regionDrag');
      expect(stateService.batchUpdateRegions).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('rejects a commit for a non-owner on a locked track', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));

      await handler.handleRegionDragEnd(socket, namespace, {
        roomId: ROOM_ID,
        updates: [{ regionId: REGION_ID, newStart: 4 }],
      });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(clearEphemeralCommitPublic).not.toHaveBeenCalled();
      expect(stateService.batchUpdateRegions).not.toHaveBeenCalled();
    });
  });

  // ── region delete ───────────────────────────────────────────────────────────

  describe('handleRegionDelete', () => {
    it('removes the region and broadcasts REGION_DELETED via socket.to', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.removeRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID);
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DELETED, {
        regionId: REGION_ID,
        userId: OWNER_USER_ID,
      });
    });

    it('emits LOCK_CONFLICT when another user holds the region occupancy', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME)]]),
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.removeRegion).not.toHaveBeenCalled();
    });

    it('rejects with "Region not found" when the region is missing', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: OWNER_USER_ID, regions: [] }));

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: 'region-ghost' });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Region not found' }));
      expect(stateService.removeRegion).not.toHaveBeenCalled();
    });
  });

  describe('handleRegionDelete — shared audioUrl reference counting', () => {
    beforeEach(() => {
      arrangeHandler.getAudioRegionStorageService.mockReturnValue(storage);
    });

    it('triggers storage cleanup when the deleted audio region held the LAST reference (audioUrl unique in state)', async () => {
      storage.extractRegionIdFromPlaybackPath.mockReturnValue('stored-region-1');
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [audioRegion()],
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: 'region-audio-1' });

      expect(storage.extractRegionIdFromPlaybackPath).toHaveBeenCalledWith(
        'https://cdn.example.com/audio/region-audio-1/playback.mp3',
      );
      expect(storage.deleteRegionAudio).toHaveBeenCalledWith(ROOM_ID, 'stored-region-1');
    });

    it('skips storage cleanup when another region still references the same audioUrl', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [
            audioRegion(),
            audioRegion({ id: 'region-audio-2', name: 'Audio 2' }),
          ],
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: 'region-audio-1' });

      expect(storage.deleteRegionAudio).not.toHaveBeenCalled();
    });

    it('falls back to the region id when the audioUrl has no playback-path region id', async () => {
      // extractRegionIdFromPlaybackPath returns null for this url.
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [audioRegion({ audioUrl: 'https://cdn.example.com/bare.mp3' })],
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: 'region-audio-1' });

      expect(storage.deleteRegionAudio).toHaveBeenCalledWith(ROOM_ID, 'region-audio-1');
    });

    it('deletes nothing from storage for MIDI regions', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(storage.deleteRegionAudio).not.toHaveBeenCalled();
      expect(storage.extractRegionIdFromPlaybackPath).not.toHaveBeenCalled();
    });

    it('logs the storage failure instead of failing the delete broadcast (fire-and-forget .catch)', async () => {
      storage.deleteRegionAudio.mockRejectedValue(new Error('storage boom'));
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [audioRegion()],
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: 'region-audio-1' });

      // The deletion broadcast already went out; the storage error is only logged.
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.REGION_DELETED, expect.anything());
      await Promise.resolve();
      expect(loggingService.logError).toHaveBeenCalledWith(
        new Error('storage boom'),
        expect.objectContaining({ context: 'ArrangeRegionHandler:handleRegionDeleteAudio' }),
      );
    });
  });

  // ── atomic note add ─────────────────────────────────────────────────────────

  describe('handleNoteAdd (atomic)', () => {
    const note = midiNote();

    beforeEach(() => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );
    });

    it('persists the note atomically and broadcasts NOTE_ADDED via socket.to on "ok"', async () => {
      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(stateService.addNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, note, OWNER_USER_ID);
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_ADDED, {
        regionId: REGION_ID,
        note,
        userId: OWNER_USER_ID,
      });
    });

    it('emits LOCK_CONFLICT on "lock_conflict" and never broadcasts', async () => {
      stateService.addNoteAtomic.mockResolvedValue({ result: 'lock_conflict', lockedBy: OTHER_USERNAME });

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('returns silently on "not_found"', async () => {
      stateService.addNoteAtomic.mockResolvedValue({ result: 'not_found' });

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(socketEmit).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('rejects with "Track is locked" before the atomic call when the region sits on a locked track', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(stateService.addNoteAtomic).not.toHaveBeenCalled();
    });
  });

  // ── atomic note update ──────────────────────────────────────────────────────

  describe('handleNoteUpdate (atomic)', () => {
    const updates = { start: 2, velocity: 0.9 };

    beforeEach(() => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );
    });

    it('persists the note update atomically and broadcasts NOTE_UPDATED via socket.to on "ok"', async () => {
      await noteHandler.handleNoteUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(stateService.updateNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, 'note-1', updates, OWNER_USER_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_UPDATED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
        userId: OWNER_USER_ID,
      });
    });

    it('emits LOCK_CONFLICT on "lock_conflict" and never broadcasts', async () => {
      stateService.updateNoteAtomic.mockResolvedValue({ result: 'lock_conflict', lockedBy: OTHER_USERNAME });

      await noteHandler.handleNoteUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('returns silently on "not_found"', async () => {
      stateService.updateNoteAtomic.mockResolvedValue({ result: 'not_found' });

      await noteHandler.handleNoteUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(socketEmit).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });
  });

  // ── atomic note delete ──────────────────────────────────────────────────────

  describe('handleNoteDelete (atomic)', () => {
    beforeEach(() => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );
    });

    it('deletes the note atomically and broadcasts NOTE_DELETED via socket.to on "ok"', async () => {
      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });

      expect(stateService.deleteNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, 'note-1', OWNER_USER_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_DELETED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        userId: OWNER_USER_ID,
      });
    });

    it('emits LOCK_CONFLICT on "lock_conflict" and never broadcasts', async () => {
      stateService.deleteNoteAtomic.mockResolvedValue({ result: 'lock_conflict', lockedBy: OTHER_USERNAME });

      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('returns silently on "not_found" but logs a warning (the only atomic variant that logs)', async () => {
      stateService.deleteNoteAtomic.mockResolvedValue({ result: 'not_found' });

      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });

      expect(socketEmit).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(loggingService.logWarn).toHaveBeenCalledWith(
        'handleNoteDelete: state or region not found',
        expect.objectContaining({ roomId: ROOM_ID, noteId: 'note-1' }),
      );
    });
  });

  // ── note realtime update (ephemeral + auto-commit) ─────────────────────────

  describe('handleNoteRealtimeUpdate (TR-1 ephemeral + TR-10 auto-commit)', () => {
    const updates = { start: 2, duration: 3 };

    beforeEach(() => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track()], regions: [midiRegion()] }),
      );
    });

    it('broadcasts NOTE_REALTIME_UPDATED via socket.to with NO Redis write and schedules an auto-commit keyed per note', async () => {
      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_REALTIME_UPDATED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
        userId: OWNER_USER_ID,
      });
      expect(stateService.updateNoteAtomic).not.toHaveBeenCalled();
      expect(scheduleEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_USER_ID,
        'noteUpdate:region-1:note-1',
        updates,
        expect.any(Function),
      );
    });

    it('auto-commits on timeout with the atomic update and broadcasts NOTE_UPDATED via namespace.to', async () => {
      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      await jest.advanceTimersByTimeAsync(EPHEMERAL_COMMIT_TIMEOUT_MS);

      expect(stateService.updateNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, 'note-1', updates, OWNER_USER_ID);
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_UPDATED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
        userId: OWNER_USER_ID,
      });
    });

    it('suppresses the commit broadcast when the auto-commit hits a lock conflict', async () => {
      stateService.updateNoteAtomic.mockResolvedValue({ result: 'lock_conflict', lockedBy: OTHER_USERNAME });

      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      await jest.advanceTimersByTimeAsync(EPHEMERAL_COMMIT_TIMEOUT_MS);

      expect(namespaceEmit).not.toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_UPDATED, expect.anything());
    });

    // ── DEV-350 Round 2, Task 2 ──────────────────────────────────────────────
    // The realtime (ephemeral) note path was the last unguarded note mutation: a
    // non-owner's drag was broadcast AND auto-committed by the server's own timer,
    // because `noteUpdate:` had no clear path anywhere in the codebase (TR-1).

    it('rejects handleNoteRealtimeUpdate when another user owns the region occupancy', async () => {
      // Occupancy comes off the room state itself (fix-wave finding 5): the realtime path
      // reads state ONCE and derives both the track-lock and the owner decision from it, so
      // the fixture must live in `state.occupancy`, not in a separate `getOccupancy` mock.
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME)]]),
        }),
      );

      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      // Neither the ephemeral broadcast nor the auto-commit timer may happen.
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
    });

    // DEV-350 final fix wave, finding 5. This event is rate-limited at 30/sec PER USER and
    // `getState` is an uncached Redis GET + full deserialize of every track/region/note, so a
    // second read here is ~30 extra whole-room deserializations per second per dragging user.
    // Fails if anyone re-introduces the `validateTrackLockForRegion` + `getOwnerConflict` pair.
    it('reads the room state exactly ONCE per realtime update — occupancy comes off that same state', async () => {
      // Wire the occupancy mock the way production wires it — `RoomOccupancyService` is
      // constructed with `stateService.getState` (ArrangeRoomHandler.ts:43-44) and
      // `getOccupancy` is literally `(await getState(roomId))?.occupancy.get(elementId)`
      // (RoomOccupancyService.ts:140-143). With that wiring in place the count below is the
      // REAL number of whole-room Redis GET + deserialize round trips: 2 before this fix, 1 now.
      occupancyService.getOccupancy.mockImplementation(
        async (roomId: string, elementId: string) =>
          (await stateService.getState(roomId))?.occupancy.get(elementId) ?? null,
      );

      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(stateService.getState).toHaveBeenCalledTimes(1);
      expect(occupancyService.getOccupancy).not.toHaveBeenCalled();
      // Still guarded, not merely cheaper: the ephemeral broadcast did happen for the owner.
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_REALTIME_UPDATED, expect.anything());
    });

    it('still rejects a non-owner after the single-read consolidation (guard preserved, not dropped)', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: new Map([[REGION_ID, ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME)]]),
        }),
      );

      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(stateService.getState).toHaveBeenCalledTimes(1);
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
    });

    it('clears the noteUpdate ephemeral commit when the note edit is committed', async () => {
      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });
      await noteHandler.handleNoteUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });

      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_USER_ID,
        `noteUpdate:${REGION_ID}:note-1`,
      );
    });

    it('clears the noteUpdate ephemeral commit when the note is deleted', async () => {
      await noteHandler.handleNoteRealtimeUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
        updates,
      });
      await noteHandler.handleNoteDelete(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        noteId: 'note-1',
      });

      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_USER_ID,
        `noteUpdate:${REGION_ID}:note-1`,
      );
    });
  });

  // ── track-lock validation with owner bypass ─────────────────────────────────

  describe('track-lock validation with owner bypass', () => {
    it('lets the project owner add a region onto a locked track (validateTrackLock owner bypass)', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({ projectOwnerId: OWNER_USER_ID, tracks: [track({ isLocked: true })], regions: [] }),
      );

      await handler.handleRegionAdd(socket, namespace, { roomId: ROOM_ID, region: midiRegion() });

      expect(stateService.addRegion).toHaveBeenCalled();
      expect(socketEmit).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('lets the project owner MOVE a region on a locked track but rejects the same move for a non-owner', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );

      // Owner (default session): allowed.
      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: 4 });
      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 4 });

      // Non-owner: rejected before any write.
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));
      await handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: 8 });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(stateService.updateRegion).toHaveBeenCalledTimes(1);
    });

    it('lets the project owner DELETE a region on a locked track but rejects the same delete for a non-owner', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });
      expect(stateService.removeRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID);

      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));
      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(stateService.removeRegion).toHaveBeenCalledTimes(1);
    });

    it('rejects note add/update/delete on a locked track for a non-owner via validateTrackLockForRegion', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ userId: OTHER_USER_ID, username: OTHER_USERNAME }));
      const note = midiNote();

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
      expect(stateService.addNoteAtomic).not.toHaveBeenCalled();

      await noteHandler.handleNoteUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1', updates: { start: 1 } });
      expect(stateService.updateNoteAtomic).not.toHaveBeenCalled();

      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });
      expect(stateService.deleteNoteAtomic).not.toHaveBeenCalled();
    });

    it('lets the project owner perform atomic note ops on a locked track', async () => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track({ isLocked: true })],
          regions: [midiRegion()],
        }),
      );
      const note = midiNote();

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(stateService.addNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, note, OWNER_USER_ID);
      expect(socketEmit).not.toHaveBeenCalledWith('error', expect.anything());
    });
  });

  // ── container-ownership guard (DEV-350 M2, Task 14 Part 2) ─────────────────
  // These tests cover `ownerConflictFromOccupancy`'s own semantics beyond the single-holder
  // cases already exercised per-CRUD-method above — mirrors ArrangeChordTrackHandler's
  // coverage.

  describe('container-ownership guard', () => {
    // DEV-350 review follow-up (findings 5/6): every region and note mutation path now
    // derives the owner decision from the SAME `getState` read that runs the track-lock
    // check, so occupancy fixtures live on the room state — no standalone `getOccupancy`
    // mock is consulted by production code any more.
    const seedOccupancy = (occupancy: ElementOccupancy | null): void => {
      stateService.getState.mockResolvedValue(
        createRoomState({
          projectOwnerId: OWNER_USER_ID,
          tracks: [track()],
          regions: [midiRegion()],
          occupancy: occupancy ? new Map<string, ElementOccupancy>([[REGION_ID, occupancy]]) : new Map<string, ElementOccupancy>(),
        }),
      );
    };

    beforeEach(() => {
      seedOccupancy(null);
    });

    it('a non-owner holder further back in the occupancy queue (holders[1]) is still rejected — only holders[0] may edit', async () => {
      seedOccupancy({
        kind: 'container',
        holders: [
          { userId: OTHER_USER_ID, username: OTHER_USERNAME, joinedAt: 1 },
          { userId: OWNER_USER_ID, username: OWNER_USERNAME, joinedAt: 2 },
        ],
      });

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.removeRegion).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
    });

    it('an occupancy entry with no holders (nobody queued) behaves as unlocked', async () => {
      seedOccupancy({ kind: 'container', holders: [] });

      await handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.removeRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID);
    });

    it('no occupancy entry at all (never joined) behaves as unlocked', async () => {
      seedOccupancy(null);

      await handler.handleRegionUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, updates: { start: 8 } });

      expect(stateService.updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { start: 8 });
    });

    // DEV-350 review follow-up, findings 5/6. `RoomOccupancyService.getOccupancy` is literally
    // `(await getState(roomId))?.occupancy.get(elementId)`, so pairing it with a handler that
    // already holds the state deserialized every track, region and note twice per event.
    // Fails if anyone re-introduces the two-read pattern on these paths.
    it.each([
      ['handleRegionUpdate', () => handler.handleRegionUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, updates: { start: 8 } })],
      ['handleRegionMove', () => handler.handleRegionMove(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, deltaBeats: 4 })],
      ['handleRegionDelete', () => handler.handleRegionDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID })],
      ['handleNoteAdd', () => noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note: midiNote() })],
      ['handleNoteUpdate', () => noteHandler.handleNoteUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1', updates: { start: 1 } })],
      ['handleNoteDelete', () => noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' })],
    ])('%s reads the room state exactly ONCE — occupancy comes off that same state', async (_name, invoke) => {
      // Wire the occupancy mock the way production wires it (ArrangeRoomHandler constructs
      // RoomOccupancyService with stateService.getState), so this count is the REAL number
      // of whole-room GET + deserialize round trips: 2 before this fix, 1 now.
      occupancyService.getOccupancy.mockImplementation(
        async (roomId: string, elementId: string) =>
          (await stateService.getState(roomId))?.occupancy.get(elementId) ?? null,
      );

      await invoke();

      expect(stateService.getState).toHaveBeenCalledTimes(1);
      expect(occupancyService.getOccupancy).not.toHaveBeenCalled();
    });

    // ── note CRUD reads occupancy, not the dead `locks` map (Round 2, Task 1) ──

    it('rejects handleNoteAdd when another user owns the region occupancy', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));
      const note = midiNote();

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.addNoteAtomic).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('allows handleNoteAdd when the acting user is the region occupancy owner (holders[0])', async () => {
      seedOccupancy(ownerOccupancy(OWNER_USER_ID, OWNER_USERNAME));
      const note = midiNote();

      await noteHandler.handleNoteAdd(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, note });

      expect(stateService.addNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, note, OWNER_USER_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_ADDED, {
        regionId: REGION_ID,
        note,
        userId: OWNER_USER_ID,
      });
    });

    it('rejects handleNoteUpdate when another user owns the region occupancy', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await noteHandler.handleNoteUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1', updates: { start: 1 } });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.updateNoteAtomic).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('allows handleNoteUpdate when the acting user is the region occupancy owner (holders[0])', async () => {
      seedOccupancy(ownerOccupancy(OWNER_USER_ID, OWNER_USERNAME));

      await noteHandler.handleNoteUpdate(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1', updates: { start: 1 } });

      expect(stateService.updateNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, 'note-1', { start: 1 }, OWNER_USER_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_UPDATED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        updates: { start: 1 },
        userId: OWNER_USER_ID,
      });
    });

    it('rejects handleNoteDelete when another user owns the region occupancy', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });

      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(stateService.deleteNoteAtomic).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('allows handleNoteDelete when the acting user is the region occupancy owner (holders[0])', async () => {
      seedOccupancy(ownerOccupancy(OWNER_USER_ID, OWNER_USERNAME));

      await noteHandler.handleNoteDelete(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID, noteId: 'note-1' });

      expect(stateService.deleteNoteAtomic).toHaveBeenCalledWith(ROOM_ID, REGION_ID, 'note-1', OWNER_USER_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.NOTE_DELETED, {
        regionId: REGION_ID,
        noteId: 'note-1',
        userId: OWNER_USER_ID,
      });
    });
  });
});
