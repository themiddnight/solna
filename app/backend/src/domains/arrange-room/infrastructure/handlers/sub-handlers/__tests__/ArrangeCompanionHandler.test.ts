import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS, DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import type { ElementOccupancy } from '@jam-band/shared';
import { ArrangeCompanionHandler } from '../ArrangeCompanionHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import type { ArrangeRoomState, CompanionRegion, CompanionRegionConfig, CompanionRegionMetadata, MidiNote, MidiRegion, Track } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { UNITY_DB, toDecibels } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';
const OTHER_USER_ID = 'user-other-2';
const OTHER_USERNAME = 'other-tester';
const REGION_ID = 'companion-region-1';
const TRACK_ID = 'track-1';

interface MinimalSession {
  roomId: string;
  userId: string;
  username: string;
}

function createSession(): MinimalSession {
  return { roomId: ROOM_ID, userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME };
}

function companionTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: TRACK_ID,
    name: 'Companion Track',
    type: 'midi',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#3b82f6',
    regionIds: [REGION_ID],
    ...overrides,
  };
}

function companionRegion(overrides: Partial<CompanionRegion> = {}): CompanionRegion {
  return {
    id: REGION_ID,
    trackId: TRACK_ID,
    name: 'Companion',
    start: 0,
    length: 16,
    loopEnabled: false,
    loopIterations: 1,
    type: 'companion',
    config: { style: 'block', density: 'normal', volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB), isMuted: false },
    ...overrides,
  };
}

const CONVERTED_NOTES: MidiNote[] = [{ id: 'note-1', pitch: 60, velocity: 100, start: 0, duration: 1 }];

function companionMetadata(overrides: Partial<CompanionRegionMetadata> = {}): CompanionRegionMetadata {
  return {
    config: companionRegion().config,
    chordTrackSnapshot: [],
    convertedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

/** A MIDI region carrying `companionMetadata` — i.e. one already converted from a companion region. */
function convertedMidiRegion(overrides: Partial<MidiRegion> = {}): MidiRegion {
  return {
    id: REGION_ID,
    trackId: TRACK_ID,
    name: 'Converted',
    start: 0,
    length: 16,
    loopEnabled: false,
    loopIterations: 1,
    type: 'midi',
    notes: CONVERTED_NOTES,
    sustainEvents: [],
    companionMetadata: companionMetadata(),
    ...overrides,
  };
}

/** Occupancy entry with a single holder — that holder is `holders[0]`, the owner (DEV-350 M2, Task 14 Part 2). */
function ownerOccupancy(userId: string, username: string): ElementOccupancy {
  return { kind: 'container', holders: [{ userId, username, joinedAt: Date.now() }] };
}

function baseState(overrides: Partial<ArrangeRoomState> = {}): ArrangeRoomState {
  return {
    roomId: ROOM_ID,
    roomType: 'arrange',
    tracks: [companionTrack()],
    regions: [companionRegion()],
    occupancy: new Map(),
    selectedTrackId: null,
    selectedRegionIds: [],
    synthStates: {},
    effectChains: {},
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    markers: [],
    chordTrack: { id: 'ct-1', projectId: '', blocks: [] },
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date(),
    ...overrides,
  };
}

describe('ArrangeCompanionHandler (DEV-279 P2, Task 2.8)', () => {
  let handler: ArrangeCompanionHandler;
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
  let seedOccupancy: (occupancy: ElementOccupancy | null, overrides?: Partial<ArrangeRoomState>) => void;

  beforeEach(() => {
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(baseState()),
      updateCompanionRegionConfig: jest.fn().mockResolvedValue(undefined),
      convertCompanionToMidi: jest.fn().mockResolvedValue(undefined),
      // Default: revert resolves to a state whose region is a live companion (the
      // handler reads the applied config off this returned authoritative state).
      revertMidiToCompanion: jest.fn().mockResolvedValue(baseState()),
    });

    scheduleEphemeralCommitPublic = jest.fn();
    clearEphemeralCommitPublic = jest.fn();

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
    });
    handler = new ArrangeCompanionHandler(arrangeHandler);

    socketEmit = jest.fn();
    socketToEmit = jest.fn();
    socketTo = jest.fn().mockReturnValue({ emit: socketToEmit });
    socket = createPartialMock<Socket>({
      id: 'socket-1',
      emit: socketEmit,
      to: socketTo,
    });

    // DEV-350 review follow-up (finding 6): the companion guards derive the owner decision
    // from the SAME `getState` read that resolves the region and runs the track-lock check,
    // so occupancy fixtures must live on the room state — a standalone `getOccupancy` mock
    // is no longer consulted by production code.
    seedOccupancy = (occupancy, overrides = {}) => {
      stateService.getState.mockResolvedValue(
        baseState({
          occupancy: occupancy ? new Map<string, ElementOccupancy>([[REGION_ID, occupancy]]) : new Map<string, ElementOccupancy>(),
          ...overrides,
        }),
      );
    };

    namespaceEmit = jest.fn<void, [event: string, payload: unknown]>();
    namespaceTo = jest.fn().mockReturnValue({ emit: namespaceEmit });
    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      to: namespaceTo,
    });
  });

  // ── ephemeral update ───────────────────────────────────────────────────────

  describe('handleCompanionConfigUpdate (ephemeral)', () => {
    it('broadcasts COMPANION_CONFIG_UPDATED via socket.to (excludes sender) with NO Redis write', async () => {
      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.COMPANION_CONFIG_UPDATED, {
        regionId: REGION_ID,
        updates: { style: 'broken' },
        userId: VERIFIED_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
      // Ephemeral: no synchronous Redis write for the update event itself.
      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
    });

    it('schedules a TR-10 auto-commit fallback keyed by the region id', async () => {
      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { volume: toDecibels(-2) },
      });

      expect(scheduleEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        VERIFIED_USER_ID,
        `companionConfig:${REGION_ID}`,
        { volume: -2 },
        expect.any(Function),
      );
    });

    it('is a no-op when updates is empty (every key was invalid/stripped by validation)', async () => {
      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: {},
      });

      expect(socketToEmit).not.toHaveBeenCalled();
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
    });

    it('is a no-op for a region that is not type "companion"', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ regions: [{ ...companionRegion(), type: 'midi', notes: [], sustainEvents: [] } as never] }),
      );

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('rejects when the track is locked by someone other than the project owner', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ tracks: [companionTrack({ isLocked: true })], projectOwnerId: OTHER_USER_ID }),
      );

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
    });

    it('allows the update when the track is locked but the requester IS the project owner', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ tracks: [companionTrack({ isLocked: true })], projectOwnerId: VERIFIED_USER_ID }),
      );

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).toHaveBeenCalled();
    });

    it('rejects when the region occupancy is held by another user', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
    });

    it('allows the update when the region occupancy is held by the requester themselves', async () => {
      seedOccupancy(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).toHaveBeenCalled();
    });

    it('ignores the event when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleCompanionConfigUpdate(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(socketToEmit).not.toHaveBeenCalled();
    });
  });

  // ── commit ─────────────────────────────────────────────────────────────────

  describe('handleCompanionConfigCommit', () => {
    it('field-merges the patch into Redis (other config fields survive) and broadcasts via namespace.to (incl. sender)', async () => {
      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { style: 'broken' });
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.COMPANION_CONFIG_COMMITTED, {
        regionId: REGION_ID,
        updates: { style: 'broken' },
        userId: VERIFIED_USER_ID,
      });
      // Commit broadcasts via namespace.to — never the ephemeral socket.to path.
      expect(socketTo).not.toHaveBeenCalled();
    });

    it('clears the pending TR-10 auto-commit for this region', async () => {
      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { volume: toDecibels(-8) },
      });

      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID, `companionConfig:${REGION_ID}`);
    });

    it('is a no-op when updates is empty — no Redis write, no broadcast', async () => {
      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: {},
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('rejects (with a socket error) when the region is not type "companion" — no Redis write', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ regions: [{ ...companionRegion(), type: 'midi', notes: [], sustainEvents: [] } as never] }),
      );

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Region not found' }));
    });

    it('rejects when the track is locked by someone other than the project owner', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ tracks: [companionTrack({ isLocked: true })], projectOwnerId: OTHER_USER_ID }),
      );

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
    });

    it('rejects when the region occupancy is held by another user', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
    });

    it('a second user editing a region whose occupancy is held by the first user is rejected', async () => {
      seedOccupancy(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));
      arrangeHandler.getSessionPublic.mockResolvedValue({ roomId: ROOM_ID, userId: OTHER_USER_ID, username: OTHER_USERNAME });

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: VERIFIED_USERNAME,
      });
    });

    it('attributes the broadcast to the session identity (TR-33), never a client-supplied id', async () => {
      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(namespaceEmit).toHaveBeenCalledWith(
        ARRANGE_EVENTS.COMPANION_CONFIG_COMMITTED,
        expect.objectContaining({ userId: VERIFIED_USER_ID }),
      );
    });

    it('ignores the event when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── convert (DEV-279 Phase 3 Task 3.3a, review fix round 1) ─────────────────

  describe('handleCompanionRegionConvert', () => {
    it('happy path: valid session + owned/unlocked track — calls convertCompanionToMidi and broadcasts COMPANION_REGION_CONVERTED via namespace.to (incl. sender) attributed to session.userId', async () => {
      await handler.handleCompanionRegionConvert(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
      });

      expect(stateService.convertCompanionToMidi).toHaveBeenCalledWith(
        ROOM_ID,
        REGION_ID,
        CONVERTED_NOTES,
        companionMetadata(),
      );
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.COMPANION_REGION_CONVERTED, {
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
        userId: VERIFIED_USER_ID,
      });
      // Commit-style: never the ephemeral socket.to path.
      expect(socketTo).not.toHaveBeenCalled();
    });

    it('rejects (with a socket error) when the region is not type "companion" — no service call', async () => {
      stateService.getState.mockResolvedValue(baseState({ regions: [convertedMidiRegion()] }));

      await handler.handleCompanionRegionConvert(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
      });

      expect(stateService.convertCompanionToMidi).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Region not found' }));
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('rejects when the track is locked by someone other than the project owner', async () => {
      stateService.getState.mockResolvedValue(
        baseState({ tracks: [companionTrack({ isLocked: true })], projectOwnerId: OTHER_USER_ID }),
      );

      await handler.handleCompanionRegionConvert(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
      });

      expect(stateService.convertCompanionToMidi).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
    });

    it('rejects when the region occupancy is held by another user', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await handler.handleCompanionRegionConvert(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
      });

      expect(stateService.convertCompanionToMidi).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('ignores the event when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleCompanionRegionConvert(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        notes: CONVERTED_NOTES,
        companionMetadata: companionMetadata(),
      });

      expect(stateService.convertCompanionToMidi).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── revert (DEV-279 Phase 3 Task 3.3a, review fix round 1) ──────────────────

  describe('handleCompanionRegionRevert', () => {
    it('happy path: valid session + owned/unlocked track — calls revertMidiToCompanion and broadcasts COMPANION_REGION_REVERTED with config read from AUTHORITATIVE server state (not the payload, which carries none), attributed to session.userId', async () => {
      const revertedConfig: CompanionRegionConfig = { style: 'strum', density: 'sparse', volume: toDecibels(-15), isMuted: false };
      stateService.getState.mockResolvedValue(
        baseState({ regions: [convertedMidiRegion({ companionMetadata: companionMetadata({ config: revertedConfig }) })] }),
      );
      stateService.revertMidiToCompanion.mockResolvedValue(
        baseState({ regions: [companionRegion({ config: revertedConfig })] }),
      );

      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).toHaveBeenCalledWith(ROOM_ID, REGION_ID);
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.COMPANION_REGION_REVERTED, {
        regionId: REGION_ID,
        config: revertedConfig,
        userId: VERIFIED_USER_ID,
      });
      expect(socketTo).not.toHaveBeenCalled();
    });

    it('rejects (with a socket error) when the region is still type "companion" — no service call', async () => {
      // baseState() default region is a companion region, not yet converted.
      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Region not found' }));
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('reverts a plain MIDI region (no companionMetadata) — symmetric swap: broadcasts the role-default config the mutation applied, attributed to session.userId', async () => {
      const { companionMetadata: _metadata, ...plainMidiRegion } = convertedMidiRegion();
      stateService.getState.mockResolvedValue(baseState({ regions: [plainMidiRegion as MidiRegion] }));
      const roleDefaultConfig: CompanionRegionConfig = { style: 'root-fifth', density: 'normal', volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB), isMuted: false };
      stateService.revertMidiToCompanion.mockResolvedValue(
        baseState({ regions: [companionRegion({ config: roleDefaultConfig })] }),
      );

      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).toHaveBeenCalledWith(ROOM_ID, REGION_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.COMPANION_REGION_REVERTED, {
        regionId: REGION_ID,
        config: roleDefaultConfig,
        userId: VERIFIED_USER_ID,
      });
    });

    it('rejects when the track is locked by someone other than the project owner', async () => {
      stateService.getState.mockResolvedValue(
        baseState({
          tracks: [companionTrack({ isLocked: true })],
          regions: [convertedMidiRegion()],
          projectOwnerId: OTHER_USER_ID,
        }),
      );

      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Track is locked' }));
    });

    it('rejects when the region occupancy is held by another user', async () => {
      seedOccupancy(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME), { regions: [convertedMidiRegion()] });

      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('ignores the event when the session does not match the room', async () => {
      stateService.getState.mockResolvedValue(baseState({ regions: [convertedMidiRegion()] }));
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleCompanionRegionRevert(socket, namespace, { roomId: ROOM_ID, regionId: REGION_ID });

      expect(stateService.revertMidiToCompanion).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── container-ownership guard (DEV-350 M2, Task 14 Part 2) ─────────────────
  // These tests cover `getOwnerConflict`'s own semantics beyond the single-holder cases
  // already exercised per-CRUD-method above — mirrors ArrangeChordTrackHandler/
  // ArrangeRegionHandler's coverage.

  describe('container-ownership guard', () => {
    it('a non-owner holder further back in the occupancy queue (holders[1]) is still rejected — only holders[0] may edit', async () => {
      seedOccupancy({
        kind: 'container',
        holders: [
          { userId: OTHER_USER_ID, username: OTHER_USERNAME, joinedAt: 1 },
          { userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME, joinedAt: 2 },
        ],
      });

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: REGION_ID,
        lockedBy: OTHER_USERNAME,
      });
    });

    it('an occupancy entry with no holders (nobody queued) behaves as unlocked', async () => {
      seedOccupancy({ kind: 'container', holders: [] });

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { style: 'broken' });
    });

    it('no occupancy entry at all (never joined) behaves as unlocked', async () => {
      seedOccupancy(null);

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.updateCompanionRegionConfig).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { style: 'broken' });
    });

    // DEV-350 review follow-up, finding 6. Every companion CRUD guard already holds the room
    // state (it resolved `region` and ran the track-lock check off it), and
    // `RoomOccupancyService.getOccupancy` is literally
    // `(await getState(roomId))?.occupancy.get(elementId)` — so the old private
    // `getOwnerConflict` issued a second Redis GET + full deserialize of every track, region
    // and note for a map already sitting in `state`. Fails if anyone re-introduces it.
    it('reads the room state exactly ONCE per companion mutation — occupancy comes off that same state', async () => {
      // Wire the occupancy mock the way production wires it (ArrangeRoomHandler constructs
      // RoomOccupancyService with stateService.getState), so this count is the REAL number of
      // whole-room GET + deserialize round trips: 2 before this fix, 1 now.
      occupancyService.getOccupancy.mockImplementation(
        async (roomId: string, elementId: string) =>
          (await stateService.getState(roomId))?.occupancy.get(elementId) ?? null,
      );

      await handler.handleCompanionConfigCommit(socket, namespace, {
        roomId: ROOM_ID,
        regionId: REGION_ID,
        updates: { style: 'broken' },
      });

      expect(stateService.getState).toHaveBeenCalledTimes(1);
      expect(occupancyService.getOccupancy).not.toHaveBeenCalled();
      // Cheaper, not unguarded: the mutation still went through for the unlocked owner.
      expect(stateService.updateCompanionRegionConfig).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { style: 'broken' });
    });
  });
});
