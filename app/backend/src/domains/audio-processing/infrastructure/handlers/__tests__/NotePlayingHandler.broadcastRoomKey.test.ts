import type { Namespace, Server, Socket } from 'socket.io';
import { PERFORM_EVENTS } from '@jam-band/shared';
import { NotePlayingHandler } from '../NotePlayingHandler';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type {
  RoomSessionManager,
  NamespaceSession,
} from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

/**
 * Sockets join the PLAIN roomId (RoomJoinEmitter.ts:44), so a broadcast addressed to
 * `namespace.name` ("/room/<id>") targets a room nobody is in and is silently dropped.
 * STOP_ALL_NOTES must be addressed to session.roomId, not roomNamespace.name — otherwise
 * a stop-all/panic never reaches other participants and their copy of the sender's notes
 * keeps ringing with no way to clear them.
 *
 * NOTE: this file deliberately uses the `to: jest.fn().mockReturnValue({ emit })` idiom
 * rather than `mockReturnThis()`. mockReturnThis funnels broadcasts into the same `emit`
 * spy, so the room key is never asserted — which is exactly why this bug shipped.
 */

const ROOM_ID = 'room-1';
const NAMESPACE_PATH = `/room/${ROOM_ID}`;
const ME = 'user-me';
const ME_SOCKET = 'socket-me';

function session(): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId: ME,
    username: 'me',
    role: 'band_member',
    socketId: ME_SOCKET,
    namespacePath: NAMESPACE_PATH,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

let handler: NotePlayingHandler;
let meSocket: jest.Mocked<Socket>;
let namespace: Namespace;
let toSpy: jest.Mock;
let toEmit: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  const sessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn((_socketId: string) => session()),
  });

  const roomLifecycleService = createPartialMock<RoomLifecycleService>({});
  const roomMembershipService = createPartialMock<RoomMembershipService>({
    updateUserInstrument: jest.fn().mockResolvedValue(undefined),
  });

  toEmit = jest.fn();
  toSpy = jest.fn().mockReturnValue({ emit: toEmit });
  meSocket = createPartialMock<Socket>({ id: ME_SOCKET, to: toSpy });

  namespace = createPartialMock<Namespace>({ name: NAMESPACE_PATH });

  const namespaceManager = createPartialMock<NamespaceManager>({
    getRoomNamespace: jest.fn((_roomId: string) => namespace),
    createRoomNamespace: jest.fn((_roomId: string) => namespace),
  });

  const io = createPartialMock<Server>({});

  handler = new NotePlayingHandler(
    roomLifecycleService,
    roomMembershipService,
    io,
    namespaceManager,
    sessionManager
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NotePlayingHandler — STOP_ALL_NOTES addresses the joined room key', () => {
  it('broadcasts to the plain roomId, never the namespace path', async () => {
    await handler.handleStopAllNotesNamespace(
      meSocket,
      { instrument: 'acoustic_grand_piano', category: 'melodic' },
      namespace,
    );

    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
    expect(toEmit).toHaveBeenCalledWith(
      PERFORM_EVENTS.STOP_ALL_NOTES,
      expect.objectContaining({ userId: ME, instrument: 'acoustic_grand_piano' }),
    );
  });
});
