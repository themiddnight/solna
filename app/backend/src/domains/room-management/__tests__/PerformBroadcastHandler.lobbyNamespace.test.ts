import { PerformBroadcastHandler } from '../infrastructure/handlers/PerformBroadcastHandler';
import { CORE_NAMESPACES, ROOM_STATE_EVENTS, SHARED_EVENTS } from '@jam-band/shared';
import type { Namespace, Socket } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import { createPartialMock } from '@/testing/mocks';
import { hlsBroadcastService } from '@/domains/perform-room/infrastructure/services/HLSBroadcastService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

jest.mock('@/domains/perform-room/infrastructure/services/HLSBroadcastService', () => ({
  hlsBroadcastService: {
    startBroadcast: jest.fn(),
    stopBroadcast: jest.fn(),
    getPlaylistUrl: jest.fn(),
  },
}));

describe('PerformBroadcastHandler — targets the namespace the lobby client uses', () => {
  const ROOM_ID = 'room-1';
  const USER_ID = 'user-1';

  // Jest config sets `resetMocks: true`, which wipes any implementation given to jest.fn()
  // at module-mock-factory time before every test runs — so the defaults must be re-applied here.
  beforeEach(() => {
    jest.mocked(hlsBroadcastService.startBroadcast).mockReturnValue(true);
    jest.mocked(hlsBroadcastService.getPlaylistUrl).mockReturnValue('https://example.test/playlist.m3u8');
  });

  function buildHandler(namespaceManager: NamespaceManager, room: { owner: string; isBroadcasting?: boolean }) {
    const roomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn().mockResolvedValue(room),
      toggleBroadcast: jest.fn().mockResolvedValue(undefined),
    });
    const roomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn((_socketId: string) => ({
        socketId: 'socket-1',
        namespacePath: `/room/${ROOM_ID}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
        roomId: ROOM_ID,
        userId: USER_ID,
        username: 'test-user',
      })),
    });

    return {
      handler: new PerformBroadcastHandler(roomLifecycleService, roomSessionManager, namespaceManager),
      roomLifecycleService,
    };
  }

  function buildNamespaceManager(lobbyEmit: jest.Mock, lobbyMonitorEmit: jest.Mock): NamespaceManager {
    return createPartialMock<NamespaceManager>({
      getNamespace: jest.fn((path: string) =>
        path === CORE_NAMESPACES.LOBBY
          ? createPartialMock<Namespace>({ emit: lobbyEmit })
          : createPartialMock<Namespace>({ emit: lobbyMonitorEmit }),
      ),
      getLobbyMonitorNamespace: jest.fn(() => createPartialMock<Namespace>({ emit: lobbyMonitorEmit })),
    });
  }

  it('broadcast start: emits ROOM_BROADCAST_CHANGED on /lobby, not /lobby-monitor', async () => {
    const lobbyEmit = jest.fn();
    const lobbyMonitorEmit = jest.fn();
    const namespaceManager = buildNamespaceManager(lobbyEmit, lobbyMonitorEmit);
    const { handler, roomLifecycleService } = buildHandler(namespaceManager, { owner: USER_ID, isBroadcasting: false });

    const roomNamespace = createPartialMock<Namespace>({
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    });
    const socket = createPartialMock<Socket>({ emit: jest.fn() });

    await handler.handleToggleBroadcast(socket, { isBroadcasting: true }, roomNamespace);

    expect(roomLifecycleService.toggleBroadcast).toHaveBeenCalledWith(ROOM_ID, true);
    expect(lobbyEmit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_BROADCAST_CHANGED,
      { roomId: ROOM_ID, isBroadcasting: true },
    );
    expect(lobbyMonitorEmit).not.toHaveBeenCalled();
    expect(roomNamespace.to).toHaveBeenCalledWith(ROOM_ID);
    expect(roomNamespace.emit).toHaveBeenCalledWith(
      SHARED_EVENTS.BROADCAST_STATE_CHANGED,
      { isBroadcasting: true, playlistUrl: 'https://example.test/playlist.m3u8' },
    );
  });

  it('broadcast stop: emits ROOM_BROADCAST_CHANGED on /lobby, not /lobby-monitor', async () => {
    const lobbyEmit = jest.fn();
    const lobbyMonitorEmit = jest.fn();
    const namespaceManager = buildNamespaceManager(lobbyEmit, lobbyMonitorEmit);
    const { handler, roomLifecycleService } = buildHandler(namespaceManager, { owner: USER_ID, isBroadcasting: true });

    const roomNamespace = createPartialMock<Namespace>({
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    });
    const socket = createPartialMock<Socket>({ emit: jest.fn() });

    await handler.handleToggleBroadcast(socket, { isBroadcasting: false }, roomNamespace);

    expect(roomLifecycleService.toggleBroadcast).toHaveBeenCalledWith(ROOM_ID, false);
    expect(lobbyEmit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_BROADCAST_CHANGED,
      { roomId: ROOM_ID, isBroadcasting: false },
    );
    expect(lobbyMonitorEmit).not.toHaveBeenCalled();
    expect(roomNamespace.to).toHaveBeenCalledWith(ROOM_ID);
    expect(roomNamespace.emit).toHaveBeenCalledWith(
      SHARED_EVENTS.BROADCAST_STATE_CHANGED,
      { isBroadcasting: false, playlistUrl: null },
    );
  });
});
