import { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import { projectRoomService } from '../../arrange-room/infrastructure/storage/ProjectRoomService';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { buildRoomPayload } from '@/shared/utils/roomPayloadUtils';
import { RoomType, type Room, type BandMember, type Audience } from '../../../types';
import { ROOM_STATE_EVENTS, ARRANGE_EVENTS, OCCUPANCY_EVENTS } from '@jam-band/shared';
import type { JoinRoomEventData, ElementOccupancy } from '@jam-band/shared';
import type { Request, Response } from 'express';
import type { Socket, Server, Namespace } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { MetronomeService } from '@/domains/room-management/infrastructure/services/MetronomeService';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';

// Mock dependencies with factories to avoid singleton instantiation issues
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
      ensureUserEffectChains: jest.fn(),
      getRoomUsers: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
    }))
  };
});

jest.mock('@/shared/infrastructure/namespace/NamespaceManager', () => {
  return {
    NamespaceManager: jest.fn().mockImplementation(() => ({
      getRoomNamespace: jest.fn(),
      createApprovalNamespace: jest.fn(),
      cleanupApprovalNamespace: jest.fn(),
      cleanupRoomNamespace: jest.fn(),
      getLobbyMonitorNamespace: jest.fn(),
    }))
  };
});

jest.mock('@/domains/room-management/infrastructure/services/RoomSessionManager', () => {
  return {
    RoomSessionManager: jest.fn().mockImplementation(() => ({
      getRoomSession: jest.fn(),
      setRoomSession: jest.fn(),
      removeSession: jest.fn(),
      removeOldSessionsForUser: jest.fn().mockReturnValue([]),
      getRoomUsers: jest.fn().mockReturnValue([]),
      findSocketByUserIdAsync: jest.fn(),
    }))
  };
});

jest.mock('@/domains/room-management/infrastructure/services/MetronomeService', () => {
  return {
    MetronomeService: jest.fn().mockImplementation(() => ({}))
  };
});

jest.mock('@/domains/arrange-room/infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    incrementUserCount: jest.fn(),
    decrementUserCount: jest.fn(),
    getProjectByActiveRoom: jest.fn(),
  }
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

interface MockSocket {
  id: string;
  data: Record<string, unknown>;
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  on: jest.Mock;
  removeAllListeners: jest.Mock;
  to: jest.Mock;
  broadcast: {
    emit: jest.Mock;
  };
}

/**
 * Helper factory to create properly-typed mock Room objects for tests.
 * Ensures all required properties are included.
 */
function createMockRoom(overrides: Partial<Room> = {}): Room {
  return {
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
    metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
    ...overrides,
  };
}

describe('RoomLifecycleHandler', () => {
  let handler: RoomLifecycleHandler;
  let mockRoomLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockRoomMembershipService: jest.Mocked<RoomMembershipService>;
  let mockIo: Server;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockMetronomeService: jest.Mocked<MetronomeService>;
  let mockSocket: MockSocket;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRoomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
      shouldCloseRoom: jest.fn().mockResolvedValue(false),
      deleteRoom: jest.fn().mockResolvedValue(true),
      isUserInGracePeriod: jest.fn().mockReturnValue(false),
      hasUserIntentionallyLeft: jest.fn().mockResolvedValue(false),
      getRoomGracePeriodUsers: jest.fn().mockReturnValue([]),
      removeFromGracePeriod: jest.fn(),
      getGracePeriodUserData: jest.fn(),
      removeFromIntentionallyLeft: jest.fn(),
      markUserIntentionalLeave: jest.fn(),
    });

    mockRoomMembershipService = createPartialMock<RoomMembershipService>({
      findUserInRoom: jest.fn(),
      removeUserFromRoom: jest.fn().mockResolvedValue(true),
      addUserToRoom: jest.fn().mockResolvedValue(true),
      ensureUserEffectChains: jest.fn(),
      getRoomUsers: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
    });

    mockIo = { emit: jest.fn() } as unknown as Server;

    const mockRoomNamespace = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      createApprovalNamespace: jest.fn(),
      cleanupApprovalNamespace: jest.fn(),
      cleanupRoomNamespace: jest.fn(),
    };

    mockNamespaceManager = createPartialMock<NamespaceManager>({
      getRoomNamespace: jest.fn().mockReturnValue(mockRoomNamespace),
      getNamespace: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
      getLobbyMonitorNamespace: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    });

    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn(),
      setRoomSession: jest.fn(),
      removeSession: jest.fn(),
      removeOldSessionsForUser: jest.fn().mockReturnValue([]),
      getRoomUsers: jest.fn().mockReturnValue([]),
      isUserActiveInRoom: jest.fn().mockResolvedValue(true),
      findSocketByUserIdAsync: jest.fn(),
      cleanupRoomSessions: jest.fn(),
    });

    mockMetronomeService = createPartialMock<MetronomeService>({
       startMetronome: jest.fn(),
       stopMetronome: jest.fn(),
       cleanupRoom: jest.fn(),
    });

    mockSocket = {
      id: 'socket-123',
      data: {},
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      to: jest.fn().mockReturnThis(),
      broadcast: {
        emit: jest.fn(),
      },
    };

    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => {
        return await operation();
      }
    );

    (buildRoomPayload as jest.Mock).mockResolvedValue({ room: {}, bandMembers: [], audiences: [], pendingMembers: [] });

    handler = new RoomLifecycleHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      mockMetronomeService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleJoinRoom', () => {
    it('should increment active user count when joining a room associated with a project', async () => {
      const roomId = 'room-123';
      const userId = 'user-123';
      const projectId = 'project-123';

      const joinData: Partial<JoinRoomEventData> = {
        roomId,
        userId,
        username: 'testuser',
      };

      const bandMember: BandMember = {
        id: userId,
        username: 'testuser',
        role: 'band_member',
        isReady: false,
      };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: 'owner-123',
        roomType: RoomType.PERFORM,
        createdAt: new Date(),
        bandMembers: new Map([[userId, bandMember]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomLifecycleService.isUserInGracePeriod.mockReturnValue(false);
      mockRoomLifecycleService.hasUserIntentionallyLeft.mockResolvedValue(false);

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue({
        id: projectId,
        name: 'Test Project',
      });

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'testuser', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData as JoinRoomEventData);

      expect(projectRoomService.getProjectByActiveRoom).toHaveBeenCalledWith(roomId);
      expect(projectRoomService.incrementUserCount).toHaveBeenCalledWith(projectId);
    });

    it('should not increment user count if room is NOT associated with a project', async () => {
      const roomId = 'room-independent';
      const userId = 'user-123';

      const joinData: Partial<JoinRoomEventData> = {
        roomId,
        userId,
        username: 'testuser',
      };

      const existingUser: BandMember = {
        id: 'existing-user',
        username: 'Existing User',
        role: 'band_member',
        isReady: false,
      };

      const mockRoom: Room = {
        id: roomId,
        name: 'Independent Room',
        createdAt: new Date(),
        bandMembers: new Map([['existing-user', existingUser]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        owner: 'owner-1',
        roomType: RoomType.PERFORM,
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'testuser', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData as JoinRoomEventData);

      expect(projectRoomService.getProjectByActiveRoom).toHaveBeenCalledWith(roomId);
      expect(projectRoomService.incrementUserCount).not.toHaveBeenCalled();
    });

    it('should emit JOIN_ERROR and call removeSession when addUserToRoom returns false for new user', async () => {
      const roomId = 'room-failure-test';
      const userId = 'user-new';

      const joinData: JoinRoomEventData = { roomId, userId, username: 'newuser', role: 'band_member' };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: 'owner-other',
        roomType: RoomType.PERFORM,
        createdAt: new Date(),
        bandMembers: new Map(),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomLifecycleService.isUserInGracePeriod.mockReturnValue(false);
      mockRoomLifecycleService.hasUserIntentionallyLeft.mockResolvedValue(false);
      mockRoomMembershipService.addUserToRoom.mockResolvedValue(false);
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'newuser', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith(mockSocket.id);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        expect.stringContaining('join_error'),
        expect.anything(),
      );
    });

    it('should emit JOIN_ERROR and call removeSession when addUserToRoom returns false for grace period restore', async () => {
      const roomId = 'room-grace-failure';
      const userId = 'user-grace';

      const joinData: JoinRoomEventData = { roomId, userId, username: 'graceuser', role: 'band_member' };

      const gracePeriodUserData: BandMember = {
        id: userId,
        username: 'graceuser',
        role: 'band_member',
        isReady: false,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
        profilePictureUrl: null,
      };

      const mockRoom: Room = {
        id: roomId,
        name: 'Grace Room',
        owner: 'owner-other',
        roomType: RoomType.PERFORM,
        createdAt: new Date(Date.now() - 60_000),
        bandMembers: new Map(),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomLifecycleService.isUserInGracePeriod.mockReturnValue(true);
      mockRoomLifecycleService.getGracePeriodUserData.mockReturnValue(gracePeriodUserData);
      mockRoomLifecycleService.hasUserIntentionallyLeft.mockResolvedValue(false);
      mockRoomMembershipService.addUserToRoom.mockResolvedValue(false);
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      (redisStateService.executeWithLock as jest.Mock).mockImplementation(
        async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => {
          return await operation();
        }
      );

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'graceuser', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith(mockSocket.id);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        expect.stringContaining('join_error'),
        expect.anything(),
      );
    });
  });

  describe('handleLeaveRoom', () => {
    it('should decrement active user count when leaving a room associated with a project', async () => {
      const roomId = 'room-123';
      const userId = 'user-123';
      const projectId = 'project-123';

      mockRoomSessionManager.getRoomSession.mockReturnValue({
        roomId,
        userId,
        socketId: mockSocket.id,
        namespacePath: `/room/${roomId}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      const audience: Audience = { id: userId, username: 'User', role: 'audience', joinedAt: new Date() };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: 'owner-1',
        roomType: RoomType.PERFORM,
        bandMembers: new Map(),
        audiences: new Map([[userId, audience]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue({
        id: projectId,
        name: 'Test Project',
      });

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, false);

      expect(projectRoomService.getProjectByActiveRoom).toHaveBeenCalledWith(roomId);
      expect(projectRoomService.decrementUserCount).toHaveBeenCalledWith(projectId);
    });

    it('should not decrement user count if room is NOT associated with a project', async () => {
      const roomId = 'room-independent';
      const userId = 'user-123';

      mockRoomSessionManager.getRoomSession.mockReturnValue({
        roomId,
        userId,
        socketId: mockSocket.id,
        namespacePath: `/room/${roomId}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      const member: BandMember = { id: userId, username: 'User', role: 'band_member', isReady: false };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: 'owner-1',
        roomType: RoomType.PERFORM,
        bandMembers: new Map([[userId, member]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, false);

      expect(projectRoomService.getProjectByActiveRoom).toHaveBeenCalledWith(roomId);
      expect(projectRoomService.decrementUserCount).not.toHaveBeenCalled();
    });
  });

  describe('Ownership Transfer', () => {
    const roomId = 'room-transfer-test';
    const ownerId = 'owner-123';
    const memberId = 'member-456';
    let mockRoomNamespace: { emit: jest.Mock; to: jest.Mock };

    const ownerUser: BandMember = {
      id: ownerId,
      username: 'OwnerUser',
      role: 'room_owner',
      isReady: false,
      profilePictureUrl: null,
      userType: 'REGISTERED',
    };

    const memberUser: BandMember = {
      id: memberId,
      username: 'MemberUser',
      role: 'band_member',
      isReady: false,
      profilePictureUrl: null,
      userType: 'REGISTERED',
    };

    beforeEach(() => {
      mockRoomNamespace = {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
      };

      mockNamespaceManager.getRoomNamespace = jest.fn().mockReturnValue(mockRoomNamespace);
      mockNamespaceManager.createRoomNamespace = jest.fn().mockReturnValue(mockRoomNamespace);
      mockNamespaceManager.cleanupRoomNamespace = jest.fn();
      mockNamespaceManager.cleanupApprovalNamespace = jest.fn();

      mockRoomSessionManager.getRoomSession.mockReturnValue({
        roomId,
        userId: ownerId,
        socketId: mockSocket.id,
        namespacePath: `/room/${roomId}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);
      (projectRoomService as unknown as Record<string, jest.Mock>).clearActiveRoomByRoomId = jest.fn().mockResolvedValue(undefined);

      mockRoomMembershipService.getOwnershipCandidate = jest.fn();
      mockRoomMembershipService.transferOwnership = jest.fn();
      mockRoomMembershipService.getBandMembers = jest.fn().mockResolvedValue([]);
      mockRoomMembershipService.getAudiences = jest.fn().mockResolvedValue([]);
      mockRoomMembershipService.getPendingMembers = jest.fn().mockResolvedValue([]);
    });

    it('should transfer ownership immediately when owner intentionally leaves', async () => {
      const room: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(room);
      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);
      mockRoomMembershipService.getOwnershipCandidate = jest.fn().mockResolvedValue(memberUser);
      mockRoomMembershipService.transferOwnership = jest.fn().mockResolvedValue({
        newOwner: { ...memberUser, role: 'room_owner' as const },
        oldOwner: ownerUser,
      });

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, true);

      expect(mockRoomMembershipService.removeUserFromRoom).toHaveBeenCalledWith(
        roomId, ownerId, true
      );

      expect(mockRoomMembershipService.getOwnershipCandidate).toHaveBeenCalledWith(roomId);

      expect(mockRoomMembershipService.transferOwnership).toHaveBeenCalledWith(
        roomId, memberId, expect.objectContaining({ id: ownerId, role: 'room_owner' })
      );

      expect(mockRoomNamespace.emit).toHaveBeenCalledWith(
        'ownership_transferred',
        expect.objectContaining({
          newOwner: expect.objectContaining({ id: memberId }) as unknown,
          oldOwner: expect.objectContaining({ id: ownerId }) as unknown,
        })
      );
    });

    it('should transfer ownership after timeout when owner disconnects unintentionally', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((callback: () => void) => {
        setImmediate(callback);
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout;

      const roomBeforeLeave: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      const roomAfterLeave: Room = {
        ...roomBeforeLeave,
        bandMembers: new Map([
          [memberId, { ...memberUser }],
        ]),
      };

      mockRoomLifecycleService.getRoom
        .mockResolvedValueOnce(roomBeforeLeave)
        .mockResolvedValueOnce(roomBeforeLeave)
        .mockResolvedValueOnce(roomAfterLeave)
        .mockResolvedValueOnce(roomAfterLeave)
        .mockResolvedValueOnce(roomAfterLeave);

      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);
      mockRoomMembershipService.getOwnershipCandidate = jest.fn().mockResolvedValue(memberUser);
      mockRoomMembershipService.transferOwnership = jest.fn().mockResolvedValue({
        newOwner: { ...memberUser, role: 'room_owner' as const },
        oldOwner: ownerUser,
      });

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, false);

      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }

      expect(mockRoomMembershipService.getOwnershipCandidate).toHaveBeenCalledWith(roomId);
      expect(mockRoomMembershipService.transferOwnership).toHaveBeenCalledWith(
        roomId, memberId, expect.objectContaining({ id: ownerId, role: 'room_owner' })
      );

      expect(mockRoomNamespace.emit).toHaveBeenCalledWith(
        'ownership_transferred',
        expect.objectContaining({
          newOwner: expect.objectContaining({ id: memberId }) as unknown,
        })
      );

      global.setTimeout = originalSetTimeout;
    });

    it('should NOT transfer ownership if owner rejoins within grace period', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((callback: () => void) => {
        setImmediate(callback);
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout;

      const roomWithOwner: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      const roomWithOwnerRejoined: Room = {
        ...roomWithOwner,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
      };

      mockRoomLifecycleService.getRoom
        .mockResolvedValueOnce(roomWithOwner)
        .mockResolvedValueOnce(roomWithOwner)
        .mockResolvedValueOnce(roomWithOwnerRejoined);

      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, false);

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      expect(mockRoomMembershipService.getOwnershipCandidate).not.toHaveBeenCalled();
      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();

      global.setTimeout = originalSetTimeout;
    });

    it('should close room when owner leaves and room is empty (no other members)', async () => {
      const roomWithOnlyOwner: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(roomWithOnlyOwner);
      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(true);
      mockRoomLifecycleService.deleteRoom.mockResolvedValue(true);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, true);

      expect(mockRoomNamespace.emit).toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.ROOM_CLOSED,
        expect.objectContaining({ message: expect.any(String) as unknown })
      );

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });

    it('should close room when no eligible ownership candidate exists', async () => {
      const audienceUser: Audience = {
        id: 'audience-789',
        username: 'AudienceUser',
        role: 'audience',
        joinedAt: new Date(),
      };

      const room: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.PERFORM,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
        ]),
        audiences: new Map([
          ['audience-789', audienceUser],
        ]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(room);
      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);
      mockRoomLifecycleService.deleteRoom.mockResolvedValue(true);
      mockRoomMembershipService.getOwnershipCandidate = jest.fn().mockResolvedValue(null);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, true);

      expect(mockRoomMembershipService.getOwnershipCandidate).toHaveBeenCalledWith(roomId);

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();

      expect(mockRoomNamespace.emit).toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.ROOM_CLOSED,
        expect.objectContaining({ message: expect.any(String) as unknown })
      );
    });

    it('should not trigger ownership transfer for non-owner leaving', async () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue({
        roomId,
        userId: memberId,
        socketId: mockSocket.id,
        namespacePath: `/room/${roomId}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      const room: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(room);
      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, true);

      expect(mockRoomMembershipService.removeUserFromRoom).toHaveBeenCalledWith(
        roomId, memberId, true
      );

      expect(mockRoomMembershipService.getOwnershipCandidate).not.toHaveBeenCalled();
      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });

    it('should skip delayed transfer if room was deleted during grace period', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((callback: () => void) => {
        setImmediate(callback);
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout;

      const room: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
          [memberId, { ...memberUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom
        .mockResolvedValueOnce(room)
        .mockResolvedValueOnce(room)
        .mockResolvedValueOnce(undefined);

      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(false);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, false);

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      expect(mockRoomMembershipService.getOwnershipCandidate).not.toHaveBeenCalled();
      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();

      global.setTimeout = originalSetTimeout;
    });

    it('should close room when owner intentionally leaves but disconnect handler already removed them from Redis (race condition)', async () => {
      const roomWithOwner: Room = {
        id: roomId,
        name: 'Test Room',
        owner: ownerId,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([
          [ownerId, { ...ownerUser }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      const roomAfterDisconnectHandlerRan: Room = {
        ...roomWithOwner,
        bandMembers: new Map(),
      };

      mockRoomLifecycleService.getRoom
        .mockResolvedValueOnce(roomWithOwner)
        .mockResolvedValueOnce(roomAfterDisconnectHandlerRan);

      mockRoomLifecycleService.shouldCloseRoom.mockResolvedValue(true);
      mockRoomLifecycleService.deleteRoom.mockResolvedValue(true);

      await handler.handleLeaveRoom(mockSocket as unknown as Socket, true);

      expect(mockRoomMembershipService.removeUserFromRoom).not.toHaveBeenCalled();

      expect(mockRoomNamespace.emit).toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.ROOM_CLOSED,
        expect.objectContaining({ message: expect.any(String) as unknown }),
      );

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });
  });

  describe('BR-2: Project Owner Join Flow', () => {
    const roomId = 'room-br2-test';
    const projectOwnerId = 'project-owner-123';
    const currentRoomOwnerId = 'current-owner-456';
    const projectId = 'project-789';

    beforeEach(() => {
      mockSocket = {
        id: 'socket-project-owner',
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnThis(),
        // DEV-179: identity comes from socket.data.user. Default to the project owner (the
        // common case in this block); tests joining as a different user reassign socket.data.
        data: { user: { id: projectOwnerId, email: null, username: 'Project Owner', userType: 'REGISTERED', emailVerified: true } },
        removeAllListeners: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        broadcast: { emit: jest.fn() },
      };

      const currentOwner: BandMember = {
        id: currentRoomOwnerId,
        username: 'Current Owner',
        role: 'room_owner',
        isReady: false,
      };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: currentRoomOwnerId,
        isPrivate: true,
        roomType: RoomType.ARRANGE,
        createdAt: new Date(),
        bandMembers: new Map([[currentRoomOwnerId, currentOwner]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isHidden: false,
        isIsolated: false,
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomMembershipService.transferOwnership = jest.fn();
      mockRoomLifecycleService.isUserInGracePeriod.mockReturnValue(false);
      mockRoomLifecycleService.hasUserIntentionallyLeft.mockResolvedValue(false);
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);
      mockRoomSessionManager.removeOldSessionsForUser.mockResolvedValue([]);

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue({
        id: projectId,
        ownerId: projectOwnerId,
        name: 'Test Project',
      });

      const mockRoomNamespace = {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
      } as unknown as Namespace;
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace);
    });

    it('should allow project owner to join private room directly without approval', async () => {
      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Project Owner',
        userId: projectOwnerId,
        role: 'band_member',
      };

      jest.spyOn(handler, 'checkIsProjectOwner').mockResolvedValue(true);

      const newOwnerData: BandMember = {
        id: projectOwnerId,
        username: 'Project Owner',
        role: 'room_owner',
        isReady: false,
      };

      const oldOwnerData: BandMember = {
        id: currentRoomOwnerId,
        username: 'Current Owner',
        role: 'band_member',
        isReady: false,
      };

      mockRoomMembershipService.transferOwnership = jest.fn().mockResolvedValue({
        newOwner: newOwnerData,
        oldOwner: oldOwnerData,
      });

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        'redirect_to_approval',
        expect.any(Object)
      );

      expect(mockRoomMembershipService.transferOwnership).toHaveBeenCalledWith(
        roomId,
        projectOwnerId,
        expect.objectContaining({ id: currentRoomOwnerId })
      );

      const mockRoomNamespace = mockNamespaceManager.getRoomNamespace(roomId);
      expect(mockRoomNamespace!.emit).toHaveBeenCalledWith(
        'ownership_transferred',
        expect.objectContaining({
          newOwner: expect.objectContaining({
            id: projectOwnerId,
            role: 'room_owner',
          }) as unknown,
          oldOwner: expect.objectContaining({
            id: currentRoomOwnerId,
          }) as unknown,
        })
      );

      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
    });

    it('should NOT transfer ownership if project owner is already room owner', async () => {
      const projectOwner: BandMember = {
        id: projectOwnerId,
        username: 'Project Owner',
        role: 'room_owner',
        isReady: false,
      };

      const mockRoom: Room = {
        id: roomId,
        name: 'Test Room',
        owner: projectOwnerId,
        isPrivate: true,
        roomType: RoomType.ARRANGE,
        bandMembers: new Map([[projectOwnerId, projectOwner]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      mockRoomLifecycleService.getRoom.mockResolvedValue(mockRoom);

      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Project Owner',
        userId: projectOwnerId,
        role: 'band_member',
      };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();

      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
    });

    it('should NOT bypass approval for non-project-owner in private room', async () => {
      const nonOwnerId = 'non-owner-999';

      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue({
        id: projectId,
        ownerId: projectOwnerId,
        name: 'Test Project',
      });

      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Non Owner',
        userId: nonOwnerId,
        role: 'band_member',
      };

      // Authenticated (non-guest) user — private-room band members go through approval.
      mockSocket.data = {
        user: { id: nonOwnerId, email: 'nonowner@example.com', username: 'Non Owner', userType: 'REGISTERED', emailVerified: true },
      };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'redirect_to_approval',
        expect.objectContaining({ roomId })
      );

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });

    it('should block a guest from joining a private room as band member', async () => {
      jest.spyOn(handler, 'checkIsProjectOwner').mockResolvedValue(false);

      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Guest User',
        userId: 'guest-555',
        role: 'band_member',
      };

      // DEV-179: a guest carries a server-minted guest token (userType 'GUEST', guest:* id),
      // so socket.data.user is set — not null. The handler must block guests from private rooms.
      mockSocket.data = { user: { id: 'guest-555', email: null, username: 'Guest User', userType: 'GUEST', emailVerified: false } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join_error',
        expect.objectContaining({ code: 'PRIVATE_ROOM_REQUIRED' }),
      );
      expect(mockSocket.emit).not.toHaveBeenCalledWith('redirect_to_approval', expect.anything());
      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });

    it('should handle project owner joining when no project is linked to room', async () => {
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Some User',
        userId: projectOwnerId,
        role: 'band_member',
      };

      // Authenticated (non-guest) user — private-room band members go through approval.
      mockSocket.data = {
        user: { id: projectOwnerId, email: 'owner@example.com', username: 'Some User', userType: 'REGISTERED', emailVerified: true },
      };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'redirect_to_approval',
        expect.objectContaining({ roomId })
      );

      expect(mockRoomMembershipService.transferOwnership).not.toHaveBeenCalled();
    });

    it('should demote previous room owner to band_member when project owner joins', async () => {
      const joinData: JoinRoomEventData = {
        roomId,
        username: 'Project Owner',
        userId: projectOwnerId,
        role: 'band_member',
      };

      jest.spyOn(handler, 'checkIsProjectOwner').mockResolvedValue(true);

      const oldOwner: BandMember = {
        id: currentRoomOwnerId,
        username: 'Current Owner',
        role: 'room_owner',
        isReady: false,
      };

      const newOwner: BandMember = {
        id: projectOwnerId,
        username: 'Project Owner',
        role: 'room_owner',
        isReady: false,
      };

      mockRoomMembershipService.transferOwnership = jest.fn().mockResolvedValue({
        newOwner,
        oldOwner: { ...oldOwner, role: 'band_member' as const },
      });

      await handler.handleJoinRoom(mockSocket as unknown as Socket, joinData);

      expect(mockRoomMembershipService.transferOwnership).toHaveBeenCalledWith(
        roomId,
        projectOwnerId,
        expect.objectContaining({
          id: currentRoomOwnerId,
          role: 'room_owner',
        })
      );

      const mockRoomNamespace = mockNamespaceManager.getRoomNamespace(roomId);
      expect(mockRoomNamespace!.emit).toHaveBeenCalledWith(
        'ownership_transferred',
        expect.objectContaining({
          newOwner: expect.objectContaining({
            id: projectOwnerId,
            role: 'room_owner',
          }) as unknown,
          oldOwner: expect.objectContaining({
            id: currentRoomOwnerId,
          }) as unknown,
        })
      );
    });
  });

  describe('Session Sync & Lock Integration (ISSUE-60, 65)', () => {
    it('should complete full join flow with session sync verification', async () => {
      const roomId = 'room-1';
      const userId = 'user-1';

      mockRoomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ id: roomId }));
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomMembershipService.addUserToRoom.mockResolvedValue(true);
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'Test User', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, {
        roomId,
        userId,
        username: 'Test User',
      } as JoinRoomEventData);

      expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalled();

      expect(mockSocket.join).toHaveBeenCalledWith(roomId);

      expect(mockRoomMembershipService.addUserToRoom).toHaveBeenCalled();
    });

    it('should handle concurrent joins without conflict', async () => {
      const roomId = 'room-1';

      mockRoomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ id: roomId }));
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockRoomMembershipService.addUserToRoom.mockResolvedValue(true);
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      // DEV-179: each socket carries its own authenticated identity (set by namespace auth).
      const socket1: MockSocket = { ...mockSocket, id: 'socket-1', data: { user: { id: 'user-1', email: null, username: 'User 1', userType: 'REGISTERED', emailVerified: true } } };
      const socket2: MockSocket = { ...mockSocket, id: 'socket-2', data: { user: { id: 'user-2', email: null, username: 'User 2', userType: 'REGISTERED', emailVerified: true } } };
      const socket3: MockSocket = { ...mockSocket, id: 'socket-3', data: { user: { id: 'user-3', email: null, username: 'User 3', userType: 'REGISTERED', emailVerified: true } } };

      await Promise.all([
        handler.handleJoinRoom(socket1 as unknown as Socket, {
          roomId, userId: 'user-1', username: 'User 1',
        } as JoinRoomEventData),
        handler.handleJoinRoom(socket2 as unknown as Socket, {
          roomId, userId: 'user-2', username: 'User 2',
        } as JoinRoomEventData),
        handler.handleJoinRoom(socket3 as unknown as Socket, {
          roomId, userId: 'user-3', username: 'User 3',
        } as JoinRoomEventData),
      ]);

      expect(mockRoomMembershipService.addUserToRoom).toHaveBeenCalledTimes(3);
      expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalledTimes(6);
    });

    it('should handle grace period restore with lock protection', async () => {
      const roomId = 'room-1';
      const userId = 'user-1';

      const ownerMember: BandMember = { id: userId, username: 'Owner', role: 'room_owner', isReady: false };

      mockRoomLifecycleService.getRoom.mockResolvedValue(createMockRoom({
        id: roomId,
        owner: userId,
        bandMembers: new Map([[userId, ownerMember]]),
      }));

      mockRoomLifecycleService.isUserInGracePeriod.mockReturnValue(true);
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(ownerMember);
      (projectRoomService.getProjectByActiveRoom as jest.Mock).mockResolvedValue(null);

      // DEV-179: identity comes from socket.data.user, never the join payload.
      mockSocket.data = { user: { id: userId, email: null, username: 'Owner', userType: 'REGISTERED', emailVerified: true } };

      await handler.handleJoinRoom(mockSocket as unknown as Socket, {
        roomId,
        userId,
        username: 'Owner',
      } as JoinRoomEventData);

      expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalled();

      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
    });
  });

  describe('releaseArrangeLocksForUser (DEV-350 M2, Task 14 Part 2)', () => {
    /** Minimal valid ArrangeRoomState (only the fields the occupancy release path reads). */
    function createArrangeState(occupancy: Map<string, ElementOccupancy> = new Map()): ArrangeRoomState {
      return {
        roomId: 'room-1',
        roomType: 'arrange',
        tracks: [],
        regions: [],
        occupancy,
        selectedTrackId: null,
        selectedRegionIds: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        synthStates: {},
        effectChains: {},
        markers: [],
        chordTrack: { id: 'ct-1', projectId: '', blocks: [] },
        voiceStates: {},
        broadcastStates: {},
        hasBeenSaved: false,
        lastUpdated: new Date(),
      };
    }

    function createHandlerWithArrangeState(initialState: ArrangeRoomState): {
      handlerWithArrange: RoomLifecycleHandler;
      getState: () => ArrangeRoomState;
    } {
      let state = initialState;
      const arrangeRoomStateService = createPartialMock<ArrangeRoomStateService>({
        getState: jest.fn().mockImplementation(async () => state),
        saveState: jest.fn().mockImplementation(async (_roomId: string, next: ArrangeRoomState) => {
          state = next;
        }),
      });
      const handlerWithArrange = new RoomLifecycleHandler(
        mockRoomLifecycleService,
        mockRoomMembershipService,
        mockIo,
        mockNamespaceManager,
        mockRoomSessionManager,
        mockMetronomeService,
        undefined,
        undefined,
        arrangeRoomStateService,
      );
      return { handlerWithArrange, getState: () => state };
    }

    it('is a no-op when no arrangeRoomStateService was injected (unrelated room types)', async () => {
      // The default `handler` (top-level beforeEach) is constructed without arrangeRoomStateService.
      await expect(handler.releaseArrangeLocksForUser('room-1', 'user-1')).resolves.toBeUndefined();
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
    });

    it('releases only the occupancy entries held by the given user, and emits OCCUPANCY_EVENTS.LEFT + legacy ARRANGE_EVENTS.LOCK_RELEASED per released element', async () => {
      const roomId = 'room-1';
      const demotedOwnerId = 'user-demoted-owner';
      const otherUserId = 'user-other';

      const { handlerWithArrange, getState } = createHandlerWithArrangeState(
        createArrangeState(new Map([
          ['region-1', { kind: 'container', holders: [{ userId: demotedOwnerId, username: 'Demoted Owner', joinedAt: 1 }] }],
          ['chord_block-1', { kind: 'container', holders: [{ userId: demotedOwnerId, username: 'Demoted Owner', joinedAt: 2 }] }],
          ['region-2', { kind: 'container', holders: [{ userId: otherUserId, username: 'Other User', joinedAt: 3 }] }],
        ])),
      );

      await handlerWithArrange.releaseArrangeLocksForUser(roomId, demotedOwnerId);

      const roomNamespace = mockNamespaceManager.getRoomNamespace(roomId);
      expect(roomNamespace?.to).toHaveBeenCalledWith(roomId);
      expect(roomNamespace?.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'region-1', holders: [] });
      expect(roomNamespace?.emit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_RELEASED, { elementId: 'region-1' });
      expect(roomNamespace?.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'chord_block-1', holders: [] });
      expect(roomNamespace?.emit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_RELEASED, { elementId: 'chord_block-1' });

      // The other user's occupancy entry is untouched — only the demoted owner's entries release.
      expect(getState().occupancy.has('region-1')).toBe(false);
      expect(getState().occupancy.has('chord_block-1')).toBe(false);
      expect(getState().occupancy.get('region-2')).toEqual({
        kind: 'container',
        holders: [{ userId: otherUserId, username: 'Other User', joinedAt: 3 }],
      });
      expect(roomNamespace?.emit).not.toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, expect.objectContaining({ elementId: 'region-2' }));
    });

    it('does not touch the room namespace when the user holds no occupancy entries', async () => {
      const { handlerWithArrange } = createHandlerWithArrangeState(createArrangeState());

      await handlerWithArrange.releaseArrangeLocksForUser('room-1', 'user-with-nothing-held');

      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
    });
  });

  describe('handleUpdateRoomSettingsHttp', () => {
    interface MockResponse {
      status: jest.Mock;
      json: jest.Mock;
    }

    const createMockResponse = (): MockResponse => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    });

    it('should allow the persisted room owner when membership lookup is stale', async () => {
      const owner: BandMember = { id: 'owner-1', username: 'Owner', role: 'room_owner', isReady: false };
      const room: Room = {
        id: 'room-1',
        name: 'Test Room',
        description: '',
        roomType: RoomType.PERFORM,
        owner: 'owner-1',
        bandMembers: new Map([['owner-1', owner]]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(),
        metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
      };

      const updatedRoom: Room = { ...room, name: 'Updated Room' };
      const res = createMockResponse();

      mockRoomLifecycleService.getRoom
        .mockResolvedValueOnce(room)
        .mockResolvedValueOnce(updatedRoom);
      mockRoomLifecycleService.updateRoomSettings = jest.fn().mockResolvedValue(true);
      mockRoomMembershipService.findUserInRoom.mockResolvedValue(undefined);

      const req = {
        params: { roomId: 'room-1' },
        body: {
          name: 'Updated Room',
          description: '',
          isPrivate: false,
          isHidden: false,
        },
        // Identity now comes from the authenticated JWT (DEV-180), not the request body.
        user: { id: 'owner-1', email: 'owner@example.com', username: 'Owner', userType: 'REGISTERED', emailVerified: true },
      } as unknown as Request;

      const typedRes = res as unknown as Response;
      await handler.handleUpdateRoomSettingsHttp(req, typedRes);

      expect(mockRoomLifecycleService.updateRoomSettings).toHaveBeenCalledWith('room-1', {
        name: 'Updated Room',
        description: '',
        isPrivate: false,
        isHidden: false,
      });
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Room settings updated successfully',
      }));
    });
  });
});
