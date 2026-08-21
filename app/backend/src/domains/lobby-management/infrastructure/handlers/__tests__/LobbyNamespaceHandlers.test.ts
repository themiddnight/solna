import type { Namespace, Socket } from 'socket.io';
import { LOBBY_EVENTS } from '@jam-band/shared';
import { LobbyNamespaceHandlers } from '../LobbyNamespaceHandlers';
import type { LobbyApplicationService } from '../../../application/LobbyApplicationService';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logError: jest.fn(), logWarn: jest.fn() },
}));

jest.mock('@/shared/infrastructure/socket/socketErrors', () => ({
  decorateSocketErrorEmits: jest.fn(),
}));

const VERIFIED_ID = 'verified-user-1';
const SPOOFED_ID = 'victim-9999';

describe('LobbyNamespaceHandlers — acting identity from the verified token (DEV-179)', () => {
  let recordView: jest.Mock;
  let recordJoin: jest.Mock;
  let socketEvents: Map<string, (data: unknown) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    recordView = jest.fn().mockResolvedValue(undefined);
    recordJoin = jest.fn().mockResolvedValue(undefined);

    const service = createPartialMock<LobbyApplicationService>({
      recordRoomDetailsView: recordView,
      recordRoomJoinAttempt: recordJoin,
    });
    const handlers = new LobbyNamespaceHandlers(service);

    // Capture the socket.on(...) registrations made during connection binding.
    socketEvents = new Map();
    const onMock = jest.fn();
    const socket = createPartialMock<Socket>({
      id: 'socket-1',
      // The verified user set by authenticateSocket on the lobby namespace.
      data: { user: { id: VERIFIED_ID, email: null, username: 'v', userType: 'REGISTERED', emailVerified: true } },
      emit: jest.fn(),
      on: onMock,
    });
    onMock.mockImplementation((event: string, cb: (data: unknown) => void) => {
      socketEvents.set(event, cb);
      return socket;
    });

    // Drive the namespace 'connection' callback so the per-socket handlers get bound.
    const nsOn = jest.fn();
    const namespace = createPartialMock<Namespace>({ name: '/lobby', on: nsOn });
    let connectionCb: ((s: Socket) => void) | undefined;
    nsOn.mockImplementation((event: string, cb: (s: Socket) => void) => {
      if (event === 'connection') connectionCb = cb;
      return namespace;
    });

    handlers.setupLobbyNamespaceHandlers(namespace);
    connectionCb?.(socket);
  });

  it('records a room-details view under the verified id, ignoring the spoofed payload userId', () => {
    const handler = socketEvents.get(LOBBY_EVENTS.VIEW_ROOM_DETAILS);
    expect(handler).toBeDefined();

    // recordRoomDetailsView is invoked synchronously (before the handler's first await).
    handler?.({ userId: SPOOFED_ID, roomId: 'room-1', viewSource: 'browse' });

    expect(recordView).toHaveBeenCalledWith(
      expect.objectContaining({ value: VERIFIED_ID }),
      'room-1',
      'browse',
    );
    expect(recordView).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: SPOOFED_ID }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('records a room-join attempt under the verified id, ignoring the spoofed payload userId', () => {
    const handler = socketEvents.get(LOBBY_EVENTS.ATTEMPT_ROOM_JOIN);
    expect(handler).toBeDefined();

    handler?.({ userId: SPOOFED_ID, roomId: 'room-1', joinMethod: 'direct' });

    expect(recordJoin).toHaveBeenCalledWith(
      expect.objectContaining({ value: VERIFIED_ID }),
      'room-1',
      'direct',
    );
    expect(recordJoin).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: SPOOFED_ID }),
      expect.anything(),
      expect.anything(),
    );
  });
});
