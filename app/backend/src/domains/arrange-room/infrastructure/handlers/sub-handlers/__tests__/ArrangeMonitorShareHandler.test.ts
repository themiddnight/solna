import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { ArrangeMonitorShareHandler } from '../ArrangeMonitorShareHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';
const SPOOFED_USER_ID = 'victim-9999-aaaa';
const SPOOFED_USERNAME = 'I-am-the-victim';

function createSession(): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
    role: 'band_member',
    socketId: 'socket-attacker',
    namespacePath: `/room/${ROOM_ID}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ArrangeMonitorShareHandler — sharer identity comes from the session (DEV-179)', () => {
  let handler: ArrangeMonitorShareHandler;
  let stateService: jest.Mocked<ArrangeRoomStateService>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let namespace: Namespace;

  beforeEach(() => {
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      setMonitorShareState: jest.fn().mockResolvedValue(undefined),
    });

    const arrangeHandler = createPartialMock<ArrangeRoomHandler>({
      getSessionPublic: jest.fn().mockReturnValue(createSession()),
      getStateService: jest.fn().mockReturnValue(stateService),
    });
    handler = new ArrangeMonitorShareHandler(arrangeHandler);

    socketEmit = jest.fn();
    socket = createPartialMock<Socket>({
      id: 'socket-attacker',
      emit: socketEmit,
      to: jest.fn().mockReturnThis(),
    });
    namespace = createPartialMock<Namespace>({ name: `/room/${ROOM_ID}` });
  });

  it('handleMonitorShareState attributes state to the session id/username, ignoring the payload', async () => {
    await handler.handleMonitorShareState(socket, namespace, {
      roomId: ROOM_ID,
      userId: SPOOFED_USER_ID, // spoofed — must be ignored
      username: SPOOFED_USERNAME, // spoofed — must be ignored
      sharing: true,
      trackId: 'track-1',
    });

    expect(stateService.setMonitorShareState).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID, {
      username: VERIFIED_USERNAME,
      trackId: 'track-1',
    });
    expect(stateService.setMonitorShareState).not.toHaveBeenCalledWith(
      ROOM_ID,
      SPOOFED_USER_ID,
      expect.anything(),
    );

    expect(socketEmit).toHaveBeenCalledWith(
      ARRANGE_EVENTS.MONITOR_SHARE_STATE,
      expect.objectContaining({ userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME }),
    );
    expect(socketEmit).not.toHaveBeenCalledWith(
      ARRANGE_EVENTS.MONITOR_SHARE_STATE,
      expect.objectContaining({ userId: SPOOFED_USER_ID }),
    );
  });

  it('handleMonitorShareNote attributes the note to the session id, ignoring the payload userId', async () => {
    await handler.handleMonitorShareNote(socket, namespace, {
      roomId: ROOM_ID,
      userId: SPOOFED_USER_ID, // spoofed — must be ignored
      trackId: 'track-1',
      noteData: { note: 60, velocity: 100, type: 'noteon' },
      timestamp: 1,
    });

    expect(socketEmit).toHaveBeenCalledWith(
      ARRANGE_EVENTS.MONITOR_SHARE_NOTE,
      expect.objectContaining({ userId: VERIFIED_USER_ID, trackId: 'track-1' }),
    );
    expect(socketEmit).not.toHaveBeenCalledWith(
      ARRANGE_EVENTS.MONITOR_SHARE_NOTE,
      expect.objectContaining({ userId: SPOOFED_USER_ID }),
    );
  });
});
