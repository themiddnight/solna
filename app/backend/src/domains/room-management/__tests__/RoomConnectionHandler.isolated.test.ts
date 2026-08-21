import type { Socket } from 'socket.io';
import { RoomConnectionHandler } from '../infrastructure/handlers/RoomConnectionHandler';
import type { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import type { RoomLifecycleService } from '../application/RoomLifecycleService';
import type { RoomMembershipService } from '../application/RoomMembershipService';
import type { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import type { Room, BandMember, User } from '../../../types';
import type { JoinRoomEventData } from '@jam-band/shared';
import { RoomType } from '../../../types';
import { ERROR_EVENTS, SOCKET_ERROR_CODES } from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';
import { RoomId, UserId } from '@/shared/domain/models/ValueObjects';
import { identitySwapHandoffService } from '../infrastructure/services/IdentitySwapHandoffService';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';

// ── module mocks ─────────────────────────────────────────────────────────────
// Mirrors the mock setup in RoomConnectionHandler.test.ts so handleJoinRoom's
// dependencies (logging, session helpers, join emitter, redis lock) are stubbed
// out and only the isolated-room guard's own branching is under test.

jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  redisStateService: { executeWithLock: jest.fn(), acquireLock: jest.fn(), releaseLock: jest.fn() },
}));

jest.mock('@/domains/arrange-room/infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: { incrementUserCount: jest.fn(), decrementUserCount: jest.fn(), getProjectByActiveRoom: jest.fn() },
}));

jest.mock('../infrastructure/handlers/RoomJoinEmitter', () => ({
  emitJoinComplete: jest.fn(),
}));

jest.mock('../infrastructure/handlers/RoomJoinSessionHelpers', () => ({
  bindMembershipVerification: jest.fn(),
  scheduleDuplicateSessionKick: jest.fn(),
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logError: jest.fn(), logRoomActivity: jest.fn(), logUserActivity: jest.fn() },
}));

jest.mock('@/shared/domain/events/RoomEvents', () => ({
  MemberJoined: jest.fn(),
  MemberLeft: jest.fn(),
}));

jest.mock('@/shared/domain/events/UserOnboardingEvents', () => ({
  UserJoinedRoom: jest.fn(),
}));

jest.mock('@/domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: jest.fn() },
}));

jest.mock('../infrastructure/services/IdentitySwapHandoffService', () => ({
  identitySwapHandoffService: { create: jest.fn(), consume: jest.fn().mockReturnValue(undefined) },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

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
    isHidden: false,
    isIsolated: true,
    createdAt: new Date(),
    metronome: { bpm: 120, beatZeroAt: Date.now() },
    ...overrides,
  };
}

interface MockSocket {
  id: string;
  data: Record<string, unknown>;
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  on: jest.Mock;
  to: jest.Mock;
}

function createMockSocket(overrides: Partial<MockSocket> = {}): MockSocket {
  return {
    id: 'socket-1',
    data: {},
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
    to: jest.fn().mockReturnThis(),
    ...overrides,
  };
}

function authSocketData(userId: string, username: string) {
  return {
    user: {
      id: userId,
      username,
      userType: 'REGISTERED' as const,
      emailVerified: true,
      email: `${userId}@example.com`,
      passwordHash: null,
      profilePictureUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

const DEFAULT_JOIN_DATA: JoinRoomEventData = {
  roomId: 'room-1',
  username: '',
  userId: '',
  role: 'band_member',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RoomConnectionHandler — isolated room join guard (DEV-221)', () => {
  let connectionHandler: RoomConnectionHandler;
  let mockLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockMembershipService: jest.Mocked<RoomMembershipService>;
  let mockSessionManager: jest.Mocked<RoomSessionManager>;
  let mockHandler: jest.Mocked<RoomLifecycleHandler>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
      isUserInGracePeriod: jest.fn().mockReturnValue(false),
      getRoomGracePeriodUsers: jest.fn().mockReturnValue([]),
      hasUserIntentionallyLeft: jest.fn().mockResolvedValue(false),
      shouldCloseRoom: jest.fn().mockResolvedValue(false),
      deleteRoom: jest.fn().mockResolvedValue(true),
      markUserIntentionalLeave: jest.fn(),
      removeFromGracePeriod: jest.fn(),
      removeFromIntentionallyLeft: jest.fn(),
      getGracePeriodUserData: jest.fn(),
      rekeyGracePeriodEntry: jest.fn().mockReturnValue(false),
      transferOwnershipAndUnisolate: jest.fn().mockResolvedValue(undefined),
    });

    mockMembershipService = createPartialMock<RoomMembershipService>({
      findUserInRoom: jest.fn().mockResolvedValue(undefined),
      removeUserFromRoom: jest.fn().mockResolvedValue(null),
      addUserToRoom: jest.fn().mockResolvedValue(true),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getRoomUsers: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
      ensureUserEffectChains: jest.fn(),
    });

    mockSessionManager = createPartialMock<RoomSessionManager>({
      isUserActiveInRoom: jest.fn().mockResolvedValue(false),
      getRoomSession: jest.fn(),
      setRoomSession: jest.fn(),
      removeSession: jest.fn(),
      removeOldSessionsForUser: jest.fn().mockResolvedValue([]),
      findSocketByUserIdAsync: jest.fn().mockResolvedValue(undefined),
    });

    const mockBandMember: BandMember = {
      id: 'guest:owner',
      username: 'tester',
      role: 'band_member',
      isReady: false,
    };

    mockHandler = createPartialMock<RoomLifecycleHandler>({
      roomLifecycleService: mockLifecycleService,
      roomMembershipService: mockMembershipService,
      roomSessionManager: mockSessionManager,
      ensureRoomId: jest.fn((id: string | RoomId) => typeof id === 'string' ? RoomId.fromString(id) : id),
      ensureUserId: jest.fn((id: string | UserId) => typeof id === 'string' ? UserId.fromString(id) : id),
      roomIdToString: jest.fn((id) => id.toString()),
      userIdToString: jest.fn((id) => id.toString()),
      getOrCreateRoomNamespace: jest.fn().mockReturnValue(null),
      releaseArrangeLocksForUser: jest.fn().mockResolvedValue(undefined),
      createUserByRole: jest.fn().mockReturnValue(mockBandMember),
      checkIsProjectOwner: jest.fn().mockResolvedValue(false),
      clearMemberGracePeriodTimer: jest.fn().mockReturnValue(false),
      ownerGracePeriodTimers: new Map(),
    });

    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, cb: () => Promise<void>) => cb(),
    );

    connectionHandler = new RoomConnectionHandler(mockHandler);
  });

  it('rejects a non-owner join to an isolated room', async () => {
    const room = createMockRoom({ isIsolated: true, owner: 'guest:owner' });
    mockLifecycleService.getRoom.mockResolvedValue(room);
    mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
    mockLifecycleService.isUserInGracePeriod.mockReturnValue(false);

    const socket = createMockSocket({ data: authSocketData('guest:stranger', 'S') });

    await connectionHandler.handleJoinRoom(socket as unknown as Socket, {
      ...DEFAULT_JOIN_DATA,
      username: 'S',
      role: 'band_member',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_ISOLATED }),
    );
    expect(mockMembershipService.addUserToRoom).not.toHaveBeenCalled();
  });

  it('allows the owner to (re)join an isolated room', async () => {
    const room = createMockRoom({ isIsolated: true, owner: 'guest:owner' });
    mockLifecycleService.getRoom.mockResolvedValue(room);
    mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
    mockMembershipService.addUserToRoom.mockResolvedValue(true);
    mockLifecycleService.isUserInGracePeriod.mockReturnValue(false);

    const socket = createMockSocket({ data: authSocketData('guest:owner', 'O') });

    await connectionHandler.handleJoinRoom(socket as unknown as Socket, {
      ...DEFAULT_JOIN_DATA,
      username: 'O',
      role: 'band_member',
    });

    expect(socket.emit).not.toHaveBeenCalledWith(
      ERROR_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_ISOLATED }),
    );
  });

  it('registered swap: transfers ownership and clears isolation, keeping hidden', async () => {
    // Isolated room owned by the guest identity being swapped out.
    const room = createMockRoom({ isIsolated: true, isHidden: true, owner: 'guest:old' });
    mockLifecycleService.getRoom.mockResolvedValue(room);
    mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
    mockMembershipService.addUserToRoom.mockResolvedValue(true);

    // A consumed DEV-208 handoff old -> new is pending for this connecting user.
    jest.mocked(identitySwapHandoffService.consume).mockReturnValue({ oldUserId: 'guest:old' });

    // The rekey succeeds and the new socket is now considered in grace period.
    mockLifecycleService.rekeyGracePeriodEntry.mockReturnValue(true);
    mockLifecycleService.isUserInGracePeriod.mockReturnValue(true);
    const gracePeriodUserData: User = {
      id: 'guest:old',
      username: 'N',
      role: 'band_member',
      isReady: false,
    };
    mockLifecycleService.getGracePeriodUserData.mockReturnValue(gracePeriodUserData);

    // transferOwnershipAndUnisolate performs the actual transfer on the room object
    // (mirrors the real service so the guard downstream sees the updated room).
    mockLifecycleService.transferOwnershipAndUnisolate.mockImplementation(async (_roomId, newOwnerId, prevOwnerId) => {
      if (room.isIsolated && room.owner === prevOwnerId) {
        room.owner = newOwnerId;
        room.isIsolated = false;
      }
    });

    const newSocket = createMockSocket({ data: authSocketData('reg:new', 'N') });

    await connectionHandler.handleJoinRoom(newSocket as unknown as Socket, {
      ...DEFAULT_JOIN_DATA,
      username: 'N',
      role: 'band_member',
    });

    expect(mockLifecycleService.transferOwnershipAndUnisolate).toHaveBeenCalledWith(
      'room-1', 'reg:new', 'guest:old',
    );
    expect(room.owner).toBe('reg:new');
    expect(room.isIsolated).toBe(false);
    expect(room.isHidden).toBe(true);
    expect(newSocket.emit).not.toHaveBeenCalledWith(
      ERROR_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_ISOLATED }),
    );
  });
});
