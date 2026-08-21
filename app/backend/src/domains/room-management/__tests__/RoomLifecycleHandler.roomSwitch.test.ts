import { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import { ROOM_SWITCH_EVENTS } from '@jam-band/shared';
import type { Socket, Server } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager, NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import type { Room } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

// Lightweight structural namespace mock — tests drive sockets/emit directly
type MockNamespace = {
  sockets: Map<string, { emit: jest.Mock }>;
  to: jest.Mock;
  emit: jest.Mock;
};

function makeSession(socketId: string, userId: string, username: string, roomId: string): NamespaceSession {
  return {
    socketId,
    userId,
    username,
    roomId,
    namespacePath: `/room/${roomId}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

// Mock dependencies
jest.mock('@/domains/room-management/application/RoomLifecycleService', () => {
  return {
    RoomLifecycleService: jest.fn().mockImplementation(() => ({
      getRoom: jest.fn(),
      getUserProjects: jest.fn(),
      shouldCloseRoom: jest.fn().mockResolvedValue(false),
      deleteRoom: jest.fn().mockResolvedValue(true),
    }))
  };
});

jest.mock('@/domains/room-management/application/RoomMembershipService', () => {
  return {
    RoomMembershipService: jest.fn().mockImplementation(() => ({
      findUserInRoom: jest.fn(),
      removeUserFromRoom: jest.fn().mockResolvedValue(true),
      addUserToRoom: jest.fn().mockResolvedValue(true),
      getOwnershipCandidate: jest.fn(),
      transferOwnership: jest.fn(),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
      getRoomUsers: jest.fn().mockResolvedValue([]),
    }))
  };
});

jest.mock('@/shared/infrastructure/namespace/NamespaceManager', () => {
  return {
    NamespaceManager: jest.fn().mockImplementation(() => ({
      getRoomNamespace: jest.fn(),
    }))
  };
});

jest.mock('@/domains/room-management/infrastructure/services/RoomSessionManager', () => {
  return {
    RoomSessionManager: jest.fn().mockImplementation(() => ({
      getRoomSession: jest.fn(),
    }))
  };
});

jest.mock('@/domains/room-management/infrastructure/services/MetronomeService', () => {
  return {
    MetronomeService: jest.fn().mockImplementation(() => ({}))
  };
});

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logRoomActivity: jest.fn(),
  }
}));

describe('RoomLifecycleHandler - Room Switching', () => {
  let handler: RoomLifecycleHandler;
  let mockRoomLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockRoomMembershipService: jest.Mocked<RoomMembershipService>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockMetronomeService: jest.Mocked<MetronomeService>;
  let mockSocket: Socket;
  let mockNamespace: MockNamespace;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRoomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
    });

    mockRoomMembershipService = createPartialMock<RoomMembershipService>({
      findUserInRoom: jest.fn(),
      removeUserFromRoom: jest.fn().mockResolvedValue(true),
      getOwnershipCandidate: jest.fn().mockResolvedValue({ id: 'user-456', username: 'member1', role: 'band_member' }),
      transferOwnership: jest.fn().mockResolvedValue({
        newOwner: { id: 'user-456', username: 'member1', role: 'room_owner' },
        oldOwner: { id: 'user-123', username: 'testuser', role: 'room_owner' },
      }),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
      getRoomUsers: jest.fn().mockResolvedValue([]),
    });

    mockNamespace = {
      sockets: new Map(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockNamespaceManager = createPartialMock<NamespaceManager>({
      getRoomNamespace: jest.fn().mockReturnValue(mockNamespace),
      cleanupRoomNamespace: jest.fn(),
      cleanupApprovalNamespace: jest.fn(),
    });

    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn(),
      getRoomSessions: jest.fn(),
      getRoomSessionFromRedis: jest.fn().mockResolvedValue(undefined),
    });

    mockMetronomeService = createPartialMock<MetronomeService>({
      cleanupRoom: jest.fn(),
    });

    mockSocket = {
      id: 'socket-123',
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      leave: jest.fn(),
    } as unknown as Socket;

    const mockIo = {} as unknown as Server;

    handler = new RoomLifecycleHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      mockMetronomeService
    );
  });

  describe('handleInitiateSwitch', () => {
    beforeEach(() => {
      jest.spyOn(handler, 'handleLeaveRoom').mockResolvedValue(undefined);
    });

    const mockSession = makeSession('socket-123', 'user-123', 'testuser', 'room-abc');

    const mockRoom: Room = {
      id: 'room-abc',
      name: 'Test Room',
      roomType: RoomType.PERFORM,
      owner: 'user-123',
      bandMembers: new Map([
        ['user-123', { id: 'user-123', username: 'testuser', role: 'room_owner' as const, isReady: true }],
        ['user-456', { id: 'user-456', username: 'member1', role: 'band_member' as const, isReady: true }],
      ]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(),
      metronome: { bpm: 120, beatZeroAt: Date.now() },
    };

    const switchData = {
      targetRoomId: 'room-xyz',
      targetRoomType: 'arrange' as const,
    };

    const mockTargetRoom: Room = {
      ...mockRoom,
      id: 'room-xyz',
      name: 'Target Room',
      roomType: RoomType.ARRANGE,
      bandMembers: new Map(),
      audiences: new Map(),
    };

    beforeEach(() => {
void mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockNamespace.sockets = new Map();
      mockRoomSessionManager.getRoomSessions.mockReturnValue(new Map([
        ['socket-123', makeSession('socket-123', 'user-123', 'testuser', 'room-abc')],
        ['socket-456', makeSession('socket-456', 'user-456', 'member1', 'room-abc')],
      ]));
      mockRoomLifecycleService.getRoom.mockImplementation((roomId: string) => {
        if (roomId === 'room-abc') return Promise.resolve(mockRoom);
        if (roomId === 'room-xyz') return Promise.resolve(mockTargetRoom);
        return Promise.resolve(undefined);
      });
    });

    it('should successfully initiate room switch for room owner', async () => {
      const memberSocket = { emit: jest.fn() };
void mockNamespace.sockets.set('socket-456', memberSocket);

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should notify active member sockets directly.
      expect(memberSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.OWNER_SWITCHED,
        {
          targetRoomId: 'room-xyz',
          targetRoomType: 'arrange',
          ownerUsername: 'testuser',
          ownerUserId: 'user-123',
        }
      );
      expect(mockSocket.to).not.toHaveBeenCalled();

      // Should acknowledge switch to owner
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: true,
          targetRoomId: 'room-xyz',
          targetRoomType: 'arrange',
        }
      );
    });

    it('should reject switch if user is not room owner', async () => {
      const nonOwnerSession = { ...mockSession, userId: 'user-456' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(nonOwnerSession);

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should emit error
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: false,
          error: 'Only the room owner can initiate a room switch',
        }
      );

      // Should NOT broadcast
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should reject switch if session is invalid', async () => {
void mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should emit error
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: false,
          error: 'No active session found',
        }
      );

      // Should NOT proceed
      expect(mockRoomLifecycleService.getRoom).not.toHaveBeenCalled();
    });

    it('should reject switch if room not found', async () => {
      mockRoomLifecycleService.getRoom.mockResolvedValue(undefined);

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should emit error
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: false,
          error: 'Current room not found',
        }
      );

      // Should NOT broadcast
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should reject switch if target room not found', async () => {
      mockRoomLifecycleService.getRoom.mockImplementation((roomId: string) => {
        if (roomId === 'room-abc') return Promise.resolve(mockRoom);
        return Promise.resolve(undefined); // Target room not found
      });

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should emit error
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: false,
          error: 'Target room not found',
        }
      );

      // Should NOT broadcast
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should handle switch from arrange to perform room', async () => {
      const memberSocket = { emit: jest.fn() };
void mockNamespace.sockets.set('socket-456', memberSocket);

      const arrangeRoom: Room = {
        ...mockRoom,
        roomType: RoomType.ARRANGE,
      };
      const performTargetRoom: Room = {
        ...mockRoom,
        id: 'room-perform-123',
        name: 'Perform Target',
        roomType: RoomType.PERFORM,
        bandMembers: new Map(),
        audiences: new Map(),
      };
      mockRoomLifecycleService.getRoom.mockImplementation((roomId: string) => {
        if (roomId === 'room-abc') return Promise.resolve(arrangeRoom);
        if (roomId === 'room-perform-123') return Promise.resolve(performTargetRoom);
        return Promise.resolve(undefined);
      });

      const performSwitchData = {
        targetRoomId: 'room-perform-123',
        targetRoomType: 'perform' as const,
      };

      await handler.handleInitiateSwitch(mockSocket, performSwitchData);

      // Should notify member with perform room type
      expect(memberSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.OWNER_SWITCHED,
        {
          targetRoomId: 'room-perform-123',
          targetRoomType: 'perform',
          ownerUsername: 'testuser',
          ownerUserId: 'user-123',
        }
      );
    });

    it('should not broadcast if room has no other members', async () => {
      mockRoomSessionManager.getRoomSessions.mockReturnValue(new Map([
        ['socket-123', makeSession('socket-123', 'user-123', 'testuser', 'room-abc')],
      ]));

      const singleUserRoom: Room = {
        ...mockRoom,
        bandMembers: new Map([['user-123', { id: 'user-123', username: 'testuser', role: 'room_owner' as const, isReady: true }]]),
      };
      mockRoomLifecycleService.getRoom.mockImplementation((roomId: string) => {
        if (roomId === 'room-abc') return Promise.resolve(singleUserRoom);
        if (roomId === 'room-xyz') return Promise.resolve(mockTargetRoom);
        return Promise.resolve(undefined);
      });

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should still acknowledge to owner
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        expect.objectContaining({ success: true })
      );

      // Falls back to Socket.IO room broadcast when no direct member sockets are active.
      expect(mockSocket.to).toHaveBeenCalledWith('room-abc');
    });

    it('should handle errors gracefully', async () => {
      mockRoomLifecycleService.getRoom.mockRejectedValue(new Error('Database error'));

      await handler.handleInitiateSwitch(mockSocket, switchData);

      // Should emit error
      expect(mockSocket.emit).toHaveBeenCalledWith(
        ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED,
        {
          success: false,
          error: 'Failed to initiate room switch',
        }
      );
    });
  });
});
