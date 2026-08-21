/**
 * DEV-279 Phase 1 Task 1.4 — `chordTrack` must be present in the STATE_SYNC payload
 * emitted by `ArrangeRoomHandler.handleRequestState` for BOTH branches:
 *  - the "fresh room" branch (no Redis state yet — a brand-new/late-joining room)
 *  - the "populated" branch (existing Redis-backed ArrangeRoomState)
 *
 * Joining/reconnecting clients only ever receive the chord track via this event, so a
 * missing field here means the Chord Track UI silently starts empty for every late joiner.
 */
import type { Socket } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import type { Room, BandMember } from '@/types';
import type { NamespaceSession, RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { ProjectSaveLockService } from '@/domains/arrange-room/infrastructure/services/ProjectSaveLockService';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';
import { ArrangeRoomHandler } from '../ArrangeRoomHandler';
import { projectRoomService } from '@/domains/arrange-room/infrastructure/storage/ProjectRoomService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

jest.mock('@/config/prisma', () => ({
  prisma: {
    savedProject: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/domains/arrange-room/infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    getActiveRoom: jest.fn(),
    getProjectByActiveRoom: jest.fn(),
    trySetActiveRoom: jest.fn(),
  },
}));

const getProjectByActiveRoom = projectRoomService.getProjectByActiveRoom as jest.Mock;

const ROOM_ID = 'room-1';
const USER_ID = 'user-1';
const USERNAME = 'tester';

function makeSession(): NamespaceSession {
  return createPartialMock<NamespaceSession>({
    roomId: ROOM_ID,
    userId: USER_ID,
    username: USERNAME,
    connectedAt: new Date(),
    lastActivity: new Date(),
  });
}

function makeRoom(): Room {
  return createPartialMock<Room>({
    roomType: 'arrange' as Room['roomType'],
    bandMembers: new Map<string, BandMember>([
      [USER_ID, createPartialMock<BandMember>({ username: USERNAME })],
    ]),
    audiences: new Map(),
  });
}

function makeSocket(): Socket & { emit: jest.Mock } {
  return createPartialMock<Socket & { emit: jest.Mock }>({ id: 'sock-1', emit: jest.fn() });
}

function buildHandler(stateService: jest.Mocked<ArrangeRoomStateService>): ArrangeRoomHandler {
  const roomSessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn().mockReturnValue(makeSession()),
  });
  const roomLifecycleService = createPartialMock<RoomLifecycleService>({
    getRoom: jest.fn().mockResolvedValue(makeRoom()),
  });
  const projectSaveLockService = createPartialMock<ProjectSaveLockService>({});

  return new ArrangeRoomHandler(stateService, roomSessionManager, roomLifecycleService, projectSaveLockService);
}

describe('ArrangeRoomHandler.handleRequestState — chordTrack in STATE_SYNC (DEV-279 P1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getProjectByActiveRoom.mockResolvedValue(null);
  });

  it('includes chordTrack in the populated-state STATE_SYNC emit', async () => {
    const chordTrack = {
      id: 'ct-1',
      projectId: 'proj-1',
      blocks: [
        { id: 'b1', start: 0, duration: 4, chord: { kind: 'diatonic' as const, degree: 1 }, color: '#fff' },
      ],
    };
    const state = createPartialMock<ArrangeRoomState>({
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
      chordTrack,
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
    });

    const stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(state),
    });
    const handler = buildHandler(stateService);
    const socket = makeSocket();

    await handler.handleRequestState(socket, { roomId: ROOM_ID });

    expect(socket.emit).toHaveBeenCalledWith(
      ARRANGE_EVENTS.STATE_SYNC,
      expect.objectContaining({ chordTrack }),
    );
  });

  it('includes chordTrack in the fresh-room (no Redis state yet) STATE_SYNC emit', async () => {
    const freshChordTrack = { id: 'ct-fresh', projectId: '', blocks: [] };
    const freshState = createPartialMock<ArrangeRoomState>({
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
      chordTrack: freshChordTrack,
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
    });

    const stateService = createPartialMock<ArrangeRoomStateService>({
      getState: jest.fn().mockResolvedValue(null),
      initializeState: jest.fn().mockResolvedValue(freshState),
    });
    const handler = buildHandler(stateService);
    const socket = makeSocket();

    await handler.handleRequestState(socket, { roomId: ROOM_ID });

    expect(socket.emit).toHaveBeenCalledWith(
      ARRANGE_EVENTS.STATE_SYNC,
      expect.objectContaining({ chordTrack: freshChordTrack }),
    );
  });
});
