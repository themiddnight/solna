import { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import { RoomType, type Room } from '../../../types';
import { ROOM_STATE_EVENTS, CORE_NAMESPACES } from '@jam-band/shared';
import type { Socket, Server, Namespace } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import type { RoomSettingsService } from '@/domains/room-management/infrastructure/services/RoomSettingsService';
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

interface MockSocket {
  id: string;
  data: Record<string, unknown>;
  broadcast: {
    emit: jest.Mock;
  };
}

function createMockRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    name: 'Test Room',
    roomType: RoomType.PERFORM,
    owner: 'guest:owner',
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: true,
    isIsolated: true,
    createdAt: new Date(),
    metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
    ...overrides,
  };
}

describe('RoomLifecycleHandler.handleFinishTour', () => {
  let handler: RoomLifecycleHandler;
  let mockRoomLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockRoomMembershipService: jest.Mocked<RoomMembershipService>;
  let mockIo: Server;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockMetronomeService: jest.Mocked<MetronomeService>;
  let mockRoomSettingsService: jest.Mocked<RoomSettingsService>;
  let ownerSocket: MockSocket;
  let strangerSocket: MockSocket;
  let lobbyNamespaceEmit: jest.Mock;
  let lobbyMonitorNamespaceEmit: jest.Mock;
  let getNamespaceMock: jest.Mock;

  const roomId = 'room-1';

  beforeEach(() => {
    jest.clearAllMocks();

    mockRoomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
    });

    mockRoomMembershipService = createPartialMock<RoomMembershipService>({});

    mockIo = { emit: jest.fn() } as unknown as Server;

    lobbyNamespaceEmit = jest.fn();
    lobbyMonitorNamespaceEmit = jest.fn();
    getNamespaceMock = jest.fn((path: string) =>
      path === CORE_NAMESPACES.LOBBY
        ? createPartialMock<Namespace>({ emit: lobbyNamespaceEmit })
        : undefined
    );
    mockNamespaceManager = createPartialMock<NamespaceManager>({
      getRoomNamespace: jest.fn(),
      getNamespace: getNamespaceMock,
      // Still stubbed so a regression back to the old (wrong) accessor is
      // observable rather than throwing "not a function".
      getLobbyMonitorNamespace: jest.fn().mockReturnValue({
        emit: lobbyMonitorNamespaceEmit,
      }),
    });

    mockRoomSessionManager = createPartialMock<RoomSessionManager>({});
    mockMetronomeService = createPartialMock<MetronomeService>({});
    mockRoomSettingsService = createPartialMock<RoomSettingsService>({
      updateRoomSettings: jest.fn().mockResolvedValue(true),
    });

    ownerSocket = {
      id: 'socket-owner',
      data: { roomId, userId: 'guest:owner' },
      broadcast: { emit: jest.fn() },
    };

    strangerSocket = {
      id: 'socket-stranger',
      data: { roomId, userId: 'guest:stranger' },
      broadcast: { emit: jest.fn() },
    };

    handler = new RoomLifecycleHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      mockMetronomeService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockRoomSettingsService
    );
  });

  it('un-isolates and publishes the room to the lobby, owner stays in-room', async () => {
    const room = createMockRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    await handler.handleFinishTour(ownerSocket as unknown as Socket, { roomId });

    expect(mockRoomSettingsService.updateRoomSettings).toHaveBeenCalledWith(roomId, {
      isHidden: false,
      isIsolated: false,
    });
    expect(lobbyNamespaceEmit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST,
      expect.objectContaining({ id: roomId })
    );
  });

  it('publishes the finish-tour broadcast to /lobby specifically — not /lobby-monitor, not socket.broadcast', async () => {
    const room = createMockRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    await handler.handleFinishTour(ownerSocket as unknown as Socket, { roomId });

    // The one-and-only publish targets namespaceManager.getNamespace('/lobby').
    expect(getNamespaceMock).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY);
    expect(lobbyNamespaceEmit).toHaveBeenCalledTimes(1);
    expect(lobbyNamespaceEmit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_CREATED_BROADCAST,
      expect.objectContaining({ id: roomId })
    );

    // The two buggy variants must not fire: the wrong namespace, and the
    // socket's own (room-scoped) broadcast.
    expect(lobbyMonitorNamespaceEmit).not.toHaveBeenCalled();
    expect(ownerSocket.broadcast.emit).not.toHaveBeenCalled();
  });

  it('ignores finish_tour from a non-owner', async () => {
    const room = createMockRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    await handler.handleFinishTour(strangerSocket as unknown as Socket, { roomId });

    expect(mockRoomSettingsService.updateRoomSettings).not.toHaveBeenCalled();
  });

  it('is a no-op if the room is already un-isolated (idempotent)', async () => {
    const room = createMockRoom({ isIsolated: false });
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    await handler.handleFinishTour(ownerSocket as unknown as Socket, { roomId });

    expect(mockRoomSettingsService.updateRoomSettings).not.toHaveBeenCalled();
  });

  it('ignores finish_tour when the socket session roomId does not match the payload roomId', async () => {
    const room = createMockRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    const mismatchedSocket: MockSocket = {
      id: 'socket-owner',
      data: { roomId: 'other-room', userId: 'guest:owner' },
      broadcast: { emit: jest.fn() },
    };

    await handler.handleFinishTour(mismatchedSocket as unknown as Socket, { roomId });

    expect(mockRoomLifecycleService.getRoom).not.toHaveBeenCalled();
    expect(mockRoomSettingsService.updateRoomSettings).not.toHaveBeenCalled();
  });

  it('no-ops silently when roomSettingsService is unavailable', async () => {
    const room = createMockRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    const handlerWithoutSettings = new RoomLifecycleHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      mockMetronomeService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined // roomSettingsService omitted
    );

    await handlerWithoutSettings.handleFinishTour(ownerSocket as unknown as Socket, { roomId });

    expect(lobbyNamespaceEmit).not.toHaveBeenCalled();
  });
});
