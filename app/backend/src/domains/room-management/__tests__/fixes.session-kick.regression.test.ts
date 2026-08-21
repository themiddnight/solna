/**
 * RoomLifecycleHandler - Cross-Node Session Kick Regression Tests
 * 
 * Regression tests for the same-user multi-device session kicking logic (DEV-109)
 */
import { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import { RoomType } from '../../../types';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ROOM_STATE_EVENTS } from '@jam-band/shared';
import type { Socket, Server } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import type { Room } from '../../../types';
import type { JoinRoomEventData } from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';

// Mock dependencies
jest.mock('@/domains/room-management/application/RoomLifecycleService');
jest.mock('@/domains/room-management/application/RoomMembershipService');
jest.mock('@/shared/infrastructure/namespace/NamespaceManager');
jest.mock('@/domains/room-management/infrastructure/services/RoomSessionManager');
jest.mock('@/domains/room-management/infrastructure/services/MetronomeService');
jest.mock('@/domains/arrange-room/infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    getProjectByActiveRoom: jest.fn().mockResolvedValue(null),
    incrementUserCount: jest.fn(),
    decrementUserCount: jest.fn(),
  },
}));
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: { getInstance: jest.fn() },
  redisStateService: {
    executeWithLock: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));
jest.mock('@/shared/utils/roomPayloadUtils', () => ({
  buildRoomPayload: jest.fn().mockResolvedValue({ room: {}, bandMembers: [], audiences: [], pendingMembers: [] }),
}));
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  }
}));

const createMockRoom = (overrides: Partial<Room> = {}): Room => ({
  id: 'room-1',
  name: 'Test Room',
  roomType: RoomType.PERFORM,
  owner: 'owner-1',
  bandMembers: new Map(),
  audiences: new Map(),
  pendingMembers: new Map(),
  isPrivate: false,
  isHidden: false,
  isIsolated: false,
  createdAt: new Date(),
  metronome: { bpm: 120, beatZeroAt: Date.now() },
  ...overrides,
});

interface MockSocket {
  id: string;
  data: Record<string, unknown>;
  emit: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
  to: jest.Mock;
  removeAllListeners: jest.Mock;
}

interface MockNamespace {
  emit: jest.Mock;
  to: jest.Mock;
  disconnectSockets: jest.Mock;
}

describe('RoomConnectionHandler - Session Kick Regression Tests (DEV-109)', () => {
  let handler: RoomLifecycleHandler;
  let mockRoomLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockRoomMembershipService: jest.Mocked<RoomMembershipService>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let _mockSocket1: MockSocket;
  let mockSocket2: MockSocket;
  let mockIo: Server;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockNamespace: MockNamespace;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn(),
      setRoomSession: jest.fn(),
      removeSession: jest.fn(),
      removeOldSessionsForUser: jest.fn().mockResolvedValue([]),
      findSocketByUserIdAsync: jest.fn(),
      isUserActiveInRoom: jest.fn().mockResolvedValue(true),
    });

    mockRoomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
      isUserInGracePeriod: jest.fn().mockReturnValue(false),
      hasUserIntentionallyLeft: jest.fn().mockResolvedValue(false),
      removeFromGracePeriod: jest.fn(),
    });

    mockRoomMembershipService = createPartialMock<RoomMembershipService>({
      findUserInRoom: jest.fn(),
      addUserToRoom: jest.fn(),
      removeUserFromRoom: jest.fn(),
      ensureUserEffectChains: jest.fn(),
    });

    _mockSocket1 = {
      id: 'socket-A',
      data: {},
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      removeAllListeners: jest.fn(),
    };

    mockSocket2 = {
      id: 'socket-B',
      // DEV-179: identity comes from socket.data.user (set by namespace auth), never the payload.
      data: { user: { id: 'user-1', email: null, username: 'Jammer', userType: 'REGISTERED', emailVerified: true } },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      removeAllListeners: jest.fn(),
    };

    mockNamespace = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      disconnectSockets: jest.fn(),
    };

    mockIo = {
      of: jest.fn(() => mockNamespace),
    } as unknown as Server;

    mockNamespaceManager = createPartialMock<NamespaceManager>({
      getRoomNamespace: jest.fn().mockReturnValue(mockNamespace),
      createRoomNamespace: jest.fn().mockReturnValue(mockNamespace),
      getLobbyMonitorNamespace: jest.fn().mockReturnValue({ emit: jest.fn() }),
    });

    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => {
        return await operation();
      }
    );

    handler = new RoomLifecycleHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      createPartialMock<MetronomeService>({ startMetronome: jest.fn(), stopMetronome: jest.fn(), cleanupRoom: jest.fn() })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should kick the previous device session globally when same user joins room from a new device', async () => {
    const roomId = 'room-1';
    const userId = 'user-1';
    const username = 'Jammer';

    // Room connection lifecycle mocks
    mockRoomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ id: roomId }));
void mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
void mockRoomMembershipService.addUserToRoom.mockResolvedValue(true);

    // Simulate Device A already has an active session
void mockRoomSessionManager.findSocketByUserIdAsync.mockResolvedValue('socket-A');

    // Act: Device B joins the room under the same user
    await handler.handleJoinRoom(mockSocket2 as unknown as Socket, {
      roomId,
      userId,
      username,
      role: 'band_member',
    } as JoinRoomEventData);

    // Run all pending timers (triggers the setTimeout inside handleJoinRoom)
    jest.runAllTimers();

    // 1. Verify we look up active socket globally from Redis
    expect(mockRoomSessionManager.findSocketByUserIdAsync).toHaveBeenCalledWith(roomId, userId);

    // 2. Verify we target Node/Namespace for the roomId
    expect(mockIo.of).toHaveBeenCalledWith(`/room/${roomId}`);

    // 3. Verify old Socket A is addressed via namespace target
    expect(mockNamespace.to).toHaveBeenCalledWith('socket-A');

    // 4. Verify kicked event is emitted with the correct message
    expect(mockNamespace.emit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.KICKED, {
      message: 'You have joined this room from another device.',
    });

    // 5. Verify the old socket A is forcefully disconnected cross-node safe
    expect(mockNamespace.disconnectSockets).toHaveBeenCalledWith(true);

    // 6. Verify the old session is cleaned up
    expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith('socket-A');

    // 7. Verify Device B session gets registered successfully
    expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalledWith(roomId, 'socket-B', expect.any(Object));
    expect(mockSocket2.join).toHaveBeenCalledWith(roomId);
  });

  it('should NOT kick the current session if no old session exists in the room', async () => {
    const roomId = 'room-1';
    const userId = 'user-1';

    mockRoomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ id: roomId }));
void mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
void mockRoomMembershipService.addUserToRoom.mockResolvedValue(true);

    // No old session
void mockRoomSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);

    await handler.handleJoinRoom(mockSocket2 as unknown as Socket, {
      roomId,
      userId,
      username: 'Jammer',
      role: 'band_member',
    } as JoinRoomEventData);

    // Verify no disconnections or kicks were triggered
    expect(mockNamespace.to).not.toHaveBeenCalled();
    expect(mockNamespace.disconnectSockets).not.toHaveBeenCalled();
    expect(mockRoomSessionManager.removeSession).not.toHaveBeenCalled();

    // Current session setup must proceed normally
    expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalledWith(roomId, 'socket-B', expect.any(Object));
    expect(mockSocket2.join).toHaveBeenCalledWith(roomId);
  });
});
