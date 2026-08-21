import { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import { CORE_NAMESPACES, ROOM_STATE_EVENTS } from '@jam-band/shared';
import type { Namespace, Server } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

describe('RoomLifecycleHandler.broadcastToLobby — targets the namespace the lobby client uses', () => {
  function buildHandler(namespaceManager: NamespaceManager, io: Server): RoomLifecycleHandler {
    const roomLifecycleService = createPartialMock<RoomLifecycleService>({});
    const roomMembershipService = createPartialMock<RoomMembershipService>({});
    const roomSessionManager = createPartialMock<RoomSessionManager>({});
    const metronomeService = createPartialMock<MetronomeService>({});

    return new RoomLifecycleHandler(
      roomLifecycleService,
      roomMembershipService,
      io,
      namespaceManager,
      roomSessionManager,
      metronomeService
    );
  }

  it('emits on /lobby, not / or /lobby-monitor', () => {
    const lobbyEmit = jest.fn();
    const lobbyMonitorEmit = jest.fn();
    const rootEmit = jest.fn();

    const namespaceManager = createPartialMock<NamespaceManager>({
      getNamespace: jest.fn((path: string) =>
        path === CORE_NAMESPACES.LOBBY
          ? createPartialMock<Namespace>({ emit: lobbyEmit })
          : createPartialMock<Namespace>({ emit: lobbyMonitorEmit }),
      ),
      getLobbyMonitorNamespace: jest.fn(() => createPartialMock<Namespace>({ emit: lobbyMonitorEmit })),
    });
    const io = createPartialMock<Server>({ emit: rootEmit });

    const handler = buildHandler(namespaceManager, io);

    handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST, { id: 'room-1' });

    expect(lobbyEmit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST,
      { id: 'room-1' },
    );
    expect(rootEmit).not.toHaveBeenCalled();
    expect(lobbyMonitorEmit).not.toHaveBeenCalled();
  });
});
