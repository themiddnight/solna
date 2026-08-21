import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS, createSocketErrorPayload } from '@jam-band/shared';
import type { ChordBlock } from '@jam-band/shared';
import { ArrangeMarkerHandler } from '../ArrangeMarkerHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { Track, MidiRegion, TimeMarker, TimeMarkerUpdate, ArrangeRoomState } from '../../../../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../../../../domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const PROJECT_ID = 'project-1';
const PROJECT_OWNER_ID = 'user-owner-0';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';

/** Matches `BaseRoomHandler.getSession`'s minimal resolved session shape. */
interface MinimalSession {
  roomId: string;
  userId: string;
  username: string;
}

function createSession(overrides: Partial<MinimalSession> = {}): MinimalSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
    ...overrides,
  };
}

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    name: 'Lead',
    type: 'midi',
    volume: UNITY_DB,
    pan: 0,
    color: '#3b82f6',
    regionIds: [],
    ...overrides,
  };
}

function createRegion(overrides: Partial<MidiRegion> = {}): MidiRegion {
  return {
    id: 'region-1',
    trackId: 'track-1',
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

function createMarker(overrides: Partial<TimeMarker> = {}): TimeMarker {
  return {
    id: 'marker-1',
    position: 0,
    description: '',
    ...overrides,
  };
}

function createChordBlock(overrides: Partial<ChordBlock> = {}): ChordBlock {
  return {
    id: 'block-1',
    start: 0,
    duration: 4,
    chord: { kind: 'diatonic', degree: 1 },
    color: '#3b82f6',
    ...overrides,
  };
}

/**
 * Full-state payload exactly as the handler's `handleFullStateUpdate` DTO declares it
 * (tracks / regions / markers / chordTrack / bpm / timeSignature).
 * `padBytes` stuffs a padding string into the first marker's description so tests can
 * drive the DEV-32 payload-size thresholds (warn 50 KB, error 200 KB).
 */
interface FullStatePayload {
  tracks: Track[];
  regions: MidiRegion[];
  markers: TimeMarker[];
  chordTrack: ChordBlock[];
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
}

function createFullState(padBytes = 0): FullStatePayload {
  return {
    tracks: [createTrack()],
    regions: [createRegion()],
    markers: [createMarker({ description: 'x'.repeat(padBytes) })],
    chordTrack: [createChordBlock()],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
  };
}

/** Extracts payloadSizeKB from a log call's meta context (unknown at the boundary). */
function payloadSizeKB(meta: unknown): number {
  return meta && typeof meta === 'object' && 'payloadSizeKB' in meta ? (meta as { payloadSizeKB: number }).payloadSizeKB : -1;
}

/** Minimal valid ArrangeRoomState (only the fields the handler under test reads). */
function createRoomState(overrides: Partial<ArrangeRoomState> = {}): ArrangeRoomState {
  return {
    roomId: ROOM_ID,
    roomType: 'arrange',
    tracks: [],
    regions: [],
    occupancy: new Map(),
    selectedTrackId: null,
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

describe('ArrangeMarkerHandler (Task 17)', () => {
  let handler: ArrangeMarkerHandler;
  let stateService: jest.Mocked<ArrangeRoomStateService>;
  let arrangeHandler: jest.Mocked<ArrangeRoomHandler>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let socketToEmit: jest.Mock;
  let socketTo: jest.Mock;
  let namespace: Namespace;
  let namespaceEmit: jest.Mock<void, [event: string, payload: unknown]>;
  let namespaceTo: jest.Mock;
  let logInfoMock: jest.Mock<void, [message: string, context?: unknown]>;
  let logErrorMock: jest.Mock<void, [error: Error, context?: unknown]>;

  beforeEach(() => {
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(null),
      addMarker: jest.fn().mockResolvedValue(undefined),
      updateMarker: jest.fn().mockResolvedValue(undefined),
      removeMarker: jest.fn().mockResolvedValue(undefined),
      setFullState: jest.fn().mockResolvedValue(undefined),
      updateScale: jest.fn().mockResolvedValue(undefined),
    });

    arrangeHandler = createPartialMock<ArrangeRoomHandler>({
      getSessionPublic: jest.fn().mockResolvedValue(createSession()),
      getStateService: jest.fn().mockReturnValue(stateService),
    });
    handler = new ArrangeMarkerHandler(arrangeHandler);

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

    logInfoMock = loggingService.logInfo as jest.Mock<void, [message: string, context?: unknown]>;
    logErrorMock = loggingService.logError as jest.Mock<void, [error: Error, context?: unknown]>;
  });

  // ── marker CRUD ─────────────────────────────────────────────────────────────

  describe('handleMarkerAdd', () => {
    it('persists the marker (description defaulted to "") and broadcasts MARKER_ADDED via socket.to', async () => {
      await handler.handleMarkerAdd(socket, namespace, { roomId: ROOM_ID, marker: { id: 'marker-1', position: 4, color: '#ff0000' } });

      expect(stateService.addMarker).toHaveBeenCalledWith(ROOM_ID, {
        id: 'marker-1',
        position: 4,
        color: '#ff0000',
        description: '',
      });
      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.MARKER_ADDED, {
        marker: { id: 'marker-1', position: 4, color: '#ff0000', description: '' },
        userId: VERIFIED_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
    });

    it('keeps a client-supplied description and attributes the broadcast to the session identity (TR-33)', async () => {
      await handler.handleMarkerAdd(socket, namespace, {
        roomId: ROOM_ID,
        marker: { id: 'marker-1', position: 8, description: 'drop' },
      });

      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.MARKER_ADDED, {
        marker: { id: 'marker-1', position: 8, description: 'drop' },
        userId: VERIFIED_USER_ID,
      });
    });

    it('ignores the event when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession({ roomId: 'some-other-room' }));

      await handler.handleMarkerAdd(socket, namespace, { roomId: ROOM_ID, marker: { id: 'marker-1', position: 0 } });

      expect(stateService.addMarker).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });
  });

  describe('handleMarkerUpdate', () => {
    it('persists the update and broadcasts MARKER_UPDATED via socket.to', async () => {
      const updates: TimeMarkerUpdate = { position: 16, description: 'chorus' };

      await handler.handleMarkerUpdate(socket, namespace, { roomId: ROOM_ID, markerId: 'marker-1', updates });

      expect(stateService.updateMarker).toHaveBeenCalledWith(ROOM_ID, 'marker-1', updates);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.MARKER_UPDATED, {
        markerId: 'marker-1',
        updates,
        userId: VERIFIED_USER_ID,
      });
    });
  });

  describe('handleMarkerDelete', () => {
    it('removes the marker and broadcasts MARKER_DELETED via socket.to', async () => {
      await handler.handleMarkerDelete(socket, namespace, { roomId: ROOM_ID, markerId: 'marker-1' });

      expect(stateService.removeMarker).toHaveBeenCalledWith(ROOM_ID, 'marker-1');
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.MARKER_DELETED, {
        markerId: 'marker-1',
        userId: VERIFIED_USER_ID,
      });
    });
  });

  // ── full-state undo/redo ────────────────────────────────────────────────────

  describe('handleFullStateUpdate (undo/redo)', () => {
    it('persists the full state and broadcasts FULL_STATE_UPDATE via socket.to when the session is the project owner', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: VERIFIED_USER_ID }));
      const payload = createFullState();

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: payload });

      expect(stateService.setFullState).toHaveBeenCalledWith(ROOM_ID, payload);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.FULL_STATE_UPDATE, {
        userId: VERIFIED_USER_ID,
        state: payload,
      });
      expect(socketEmit).not.toHaveBeenCalledWith('error', expect.anything());
    });

    it('allows any band member before first save (no projectOwnerId yet — room owner fallback)', async () => {
      // createRoomState() leaves projectOwnerId unset, mirroring a room before first save.
      stateService.getState.mockResolvedValue(createRoomState());

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: createFullState() });

      expect(stateService.setFullState).toHaveBeenCalled();
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.FULL_STATE_UPDATE, expect.objectContaining({}));
    });

    // AUTHZ REGRESSION POINT: the full-state replace is the widest write a client can make —
    // it overwrites every track/region/marker in the room in one event, so only the project
    // owner may send it. Keep this test: a loosened gate here would let any non-owner wipe or
    // replace the entire Arrange state via forged undo/redo payloads.
    it('rejects a non-owner with a socket error — no state write, no broadcast', async () => {
      // Room's project owner is ANOTHER user; the acting session is a plain band member.
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: PROJECT_OWNER_ID }));
      arrangeHandler.getSessionPublic.mockResolvedValue(createSession());

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: createFullState() });

      expect(socketEmit).toHaveBeenCalledWith('error', createSocketErrorPayload('Only the project owner can perform undo/redo'));
      expect(stateService.setFullState).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('does nothing when the room has no state', async () => {
      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: createFullState() });

      expect(stateService.setFullState).not.toHaveBeenCalled();
      expect(socketToEmit).not.toHaveBeenCalled();
    });

    it('DEV-32: logs a payload-size WARNING (>= 50 KB) but still persists and broadcasts', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: VERIFIED_USER_ID }));
      // ~51 KB of marker description pushes the serialized payload over the 50 KB warn floor.
      const payload = createFullState(51_000);

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: payload });

      expect(logInfoMock).toHaveBeenCalledWith(
        'full_state_update payload size warning',
        expect.objectContaining({ roomId: ROOM_ID }),
      );
      const warningMeta = logInfoMock.mock.calls.find(([message]) => message === 'full_state_update payload size warning')?.[1];
      expect(payloadSizeKB(warningMeta)).toBeGreaterThanOrEqual(49);
      // The warning is non-blocking: the undo/redo still lands.
      expect(stateService.setFullState).toHaveBeenCalledWith(ROOM_ID, payload);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.FULL_STATE_UPDATE, expect.objectContaining({ state: payload }));
    });

    it('DEV-32: logs a payload-size ERROR (>= 200 KB) but still persists and broadcasts', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: VERIFIED_USER_ID }));
      // ~210 KB pushes past the 200 KB error floor.
      const payload = createFullState(210_000);

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: payload });

      expect(logErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ roomId: ROOM_ID }),
      );
      const errorCall = logErrorMock.mock.calls.find(
        ([error]) => error instanceof Error && error.message === 'full_state_update payload size critical',
      );
      expect(errorCall).toBeDefined();
      expect(payloadSizeKB(errorCall?.[1])).toBeGreaterThanOrEqual(195);
      expect(stateService.setFullState).toHaveBeenCalledWith(ROOM_ID, payload);
    });

    it('does not log any size warning for a small payload', async () => {
      stateService.getState.mockResolvedValue(createRoomState({ projectOwnerId: VERIFIED_USER_ID }));

      await handler.handleFullStateUpdate(socket, namespace, { roomId: ROOM_ID, state: createFullState() });

      expect(logInfoMock).not.toHaveBeenCalledWith('full_state_update payload size warning', expect.anything());
      expect(logErrorMock).not.toHaveBeenCalled();
    });
  });

  // ── project scale ───────────────────────────────────────────────────────────

  describe('handleProjectScaleChange', () => {
    it('persists the scale and broadcasts PROJECT_SCALE_CHANGED via namespace.to (incl. sender)', async () => {
      await handler.handleProjectScaleChange(socket, namespace, { roomId: ROOM_ID, rootNote: 'C', scale: 'minor' });

      expect(stateService.updateScale).toHaveBeenCalledWith(ROOM_ID, 'C', 'minor');
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.PROJECT_SCALE_CHANGED, {
        rootNote: 'C',
        scale: 'minor',
      });
    });
  });
});
