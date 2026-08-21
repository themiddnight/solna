import type { Socket } from 'socket.io';
import { RoomConnectionHandler } from '../infrastructure/handlers/RoomConnectionHandler';
import type { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import type { RoomLifecycleService } from '../application/RoomLifecycleService';
import type { RoomMembershipService } from '../application/RoomMembershipService';
import type { RoomSessionManager, NamespaceSession } from '../infrastructure/services/RoomSessionManager';
import type { Room, BandMember } from '../../../types';
import type { JoinRoomEventData } from '@jam-band/shared';
import { RoomType } from '../../../types';
import { ERROR_EVENTS, ROOM_STATE_EVENTS, ROOM_LIFECYCLE_EVENTS, SOCKET_ERROR_CODES } from '@jam-band/shared';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { createPartialMock } from '@/testing/mocks';
import { RoomId, UserId } from '@/shared/domain/models/ValueObjects';
import { tokenService } from '@/domains/auth/domain/services/TokenService';
import { identitySwapHandoffService } from '../infrastructure/services/IdentitySwapHandoffService';

// ── module mocks ─────────────────────────────────────────────────────────────

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
  identitySwapHandoffService: { create: jest.fn(), consume: jest.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_JOIN_DATA: JoinRoomEventData = {
  roomId: 'room-1',
  username: '',
  userId: '',
  role: 'band_member',
};

const AUTH_SOCKET_DATA = {
  user: {
    id: 'user-1',
    username: 'tester',
    userType: 'REGISTERED' as const,
    emailVerified: true,
    email: 'tester@example.com',
    passwordHash: null,
    profilePictureUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RoomConnectionHandler', () => {
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
    });

    mockMembershipService = createPartialMock<RoomMembershipService>({
      findUserInRoom: jest.fn(),
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
      removeOldSessionsForUser: jest.fn().mockReturnValue([]),
      findSocketByUserIdAsync: jest.fn(),
    });

    const mockBandMember: BandMember = {
      id: 'user-1',
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
    });

    connectionHandler = new RoomConnectionHandler(mockHandler);
  });

  // ── handleJoinRoom ─────────────────────────────────────────────────────────

  describe('handleJoinRoom', () => {
    it('emits JOIN_ERROR when roomId is empty', async () => {
      const socket = createMockSocket();

      await connectionHandler.handleJoinRoom(socket as unknown as Socket,{ ...DEFAULT_JOIN_DATA, roomId: '' });

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ message: 'Missing required field: roomId' }),
      );
    });

    it('emits JOIN_ERROR when socket has no authenticated identity (DEV-179)', async () => {
      // Under DEV-179 identity is established only from socket.data.user (set by namespace
      // auth middleware). A socket without it can never assert identity via the payload.
      const socket = createMockSocket({ data: {} });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, DEFAULT_JOIN_DATA);

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ message: 'Authentication required' }),
      );
    });

    it('emits JOIN_ERROR when room is not found', async () => {
      mockLifecycleService.getRoom.mockResolvedValue(undefined);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket,DEFAULT_JOIN_DATA);

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ message: 'Room not found' }),
      );
    });

    it('joins a new user to a public room without emitting errors', async () => {
      const room = createMockRoom({ isPrivate: false });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockMembershipService.addUserToRoom.mockResolvedValue(true);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);
      mockSessionManager.removeOldSessionsForUser.mockResolvedValue([]);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, DEFAULT_JOIN_DATA);

      expect(socket.emit).not.toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.anything(),
      );
      // addUserToRoom was called, confirming the user was added to the room
      expect(mockMembershipService.addUserToRoom).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ id: 'user-1' }),
      );
    });

    it('preserves the verified socket.data.user identity after establishing the session', async () => {
      // Regression: downstream room handlers (companion add, track add) read restriction status
      // from socket.data.user. Establishing the session must NOT clobber that identity — a bare
      // `socket.data = session` wiped `.user`, forcing every authenticated user to be treated as a
      // guest (capping verified users at the restricted limit and emitting REGISTER_REQUIRED).
      const room = createMockRoom({ isPrivate: false });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockMembershipService.addUserToRoom.mockResolvedValue(true);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);
      mockSessionManager.removeOldSessionsForUser.mockResolvedValue([]);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, DEFAULT_JOIN_DATA);

      expect((socket.data as { user?: unknown }).user).toEqual(AUTH_SOCKET_DATA.user);
      expect((socket.data as { roomId?: string }).roomId).toBe('room-1');
      expect((socket.data as { userId?: string }).userId).toBe('user-1');
    });

    it('sources the member profile picture from the verified socket identity, not the client payload (TR-33)', async () => {
      // The profile picture is identity-derived data. It must come from the token-verified
      // socket.data.user (DB-backed), never data.profilePictureUrl in the join payload — otherwise
      // an in-room guest→registered swap (which rejoins before the client store updates) shows no
      // picture, and a client could spoof someone else's avatar.
      const room = createMockRoom({ isPrivate: false });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockMembershipService.addUserToRoom.mockResolvedValue(true);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);
      mockSessionManager.removeOldSessionsForUser.mockResolvedValue([]);

      const SERVER_PIC = 'https://cdn.example/verified.png';
      const socket = createMockSocket({
        data: { user: { ...AUTH_SOCKET_DATA.user, profilePictureUrl: SERVER_PIC } },
      });

      // `profilePictureUrl` is not part of joinRoomSchema (Zod already strips it from any real
      // socket payload), so this cast simulates a raw/malformed payload that manages to carry
      // it anyway — the TR-33 override below must ignore it unconditionally either way.
      await connectionHandler.handleJoinRoom(socket as unknown as Socket, {
        ...DEFAULT_JOIN_DATA,
        profilePictureUrl: 'https://evil.example/spoof.png', // client value must be ignored
      } as JoinRoomEventData);

      expect(mockMembershipService.addUserToRoom).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ id: 'user-1', profilePictureUrl: SERVER_PIC }),
      );
    });

    it('uses the token-verified identity, NOT a spoofed userId in the join payload (DEV-179)', async () => {
      // Attack: connect with a valid token for user-1, then emit join_room with
      // { userId: <victim-uuid> } in the payload. The server must ignore the payload
      // userId entirely and use socket.data.user.id (the verified credential).
      const room = createMockRoom({ isPrivate: false });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockMembershipService.addUserToRoom.mockResolvedValue(true);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);
      mockSessionManager.removeOldSessionsForUser.mockResolvedValue([]);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      const VICTIM_UUID = 'victim-9999-aaaa-bbbb-cccccccccccc';
      await connectionHandler.handleJoinRoom(socket as unknown as Socket, {
        ...DEFAULT_JOIN_DATA,
        userId: VICTIM_UUID, // spoofed — must be ignored
        username: 'I-am-the-owner', // spoofed — must be ignored (token username wins)
      });

      // The user added to the room is the token identity (user-1 / tester), never the
      // spoofed victim UUID or spoofed username.
      expect(mockMembershipService.addUserToRoom).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ id: 'user-1', username: 'tester' }),
      );
      expect(mockMembershipService.addUserToRoom).not.toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ id: VICTIM_UUID }),
      );

      // Tighter binding: createUserByRole is mocked to a fixed return, so assert on the
      // real argument that flows out of resolveJoinIdentity — the membership lookup must
      // use the TOKEN-derived id (user-1), never the spoofed payload id.
      expect(mockMembershipService.findUserInRoom).toHaveBeenCalledWith('room-1', 'user-1');
      expect(mockMembershipService.findUserInRoom).not.toHaveBeenCalledWith('room-1', VICTIM_UUID);
    });

    it('ignores a spoofed userType in the join payload, deriving guest status from the token (DEV-179)', async () => {
      // A REGISTERED-token socket cannot self-downgrade or relabel its userType via the
      // payload; the verified token userType is authoritative. Here the token is REGISTERED
      // (verified), so the user joins as a normal member regardless of payload userType.
      const room = createMockRoom({ isPrivate: false });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockMembershipService.addUserToRoom.mockResolvedValue(true);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue(undefined);
      mockSessionManager.removeOldSessionsForUser.mockResolvedValue([]);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, {
        ...DEFAULT_JOIN_DATA,
        userId: 'another-spoofed-id',
      });

      // Identity remains the verified token id; the join succeeds with no auth error.
      expect(socket.emit).not.toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.anything(),
      );
      expect(mockMembershipService.addUserToRoom).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ id: 'user-1' }),
      );

      // Membership lookup uses the token-derived id, never the spoofed payload id.
      expect(mockMembershipService.findUserInRoom).toHaveBeenCalledWith('room-1', 'user-1');
      expect(mockMembershipService.findUserInRoom).not.toHaveBeenCalledWith(
        'room-1',
        'another-spoofed-id',
      );
    });

    // DEV-225 / DEV-221: an isolated onboarding-tour room admits only its owner. Covers the
    // risk previously only in e2e (room-lifecycle/tour-room-isolation.spec.ts join rejection).
    it('rejects a non-owner joining an isolated tour room with ROOM_ISOLATED', async () => {
      // owner is someone else; the token-verified joining user is 'user-1'
      const room = createMockRoom({ isIsolated: true, owner: 'owner-999' });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockLifecycleService.isUserInGracePeriod.mockReturnValue(false);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, DEFAULT_JOIN_DATA);

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_ISOLATED }),
      );
      // The non-owner must never be added to the isolated room.
      expect(mockMembershipService.addUserToRoom).not.toHaveBeenCalled();
    });

    it('lets the owner join their own isolated tour room (no ROOM_ISOLATED)', async () => {
      // owner === the token-verified joining user 'user-1'
      const room = createMockRoom({ isIsolated: true, owner: 'user-1' });
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.findUserInRoom.mockResolvedValue(undefined);
      mockLifecycleService.isUserInGracePeriod.mockReturnValue(false);
      const socket = createMockSocket({ data: AUTH_SOCKET_DATA });

      await connectionHandler.handleJoinRoom(socket as unknown as Socket, DEFAULT_JOIN_DATA);

      expect(socket.emit).not.toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_ISOLATED }),
      );
    });
  });

  // ── handlePrepareIdentitySwap ──────────────────────────────────────────────

  describe('handlePrepareIdentitySwap', () => {
    it('emits JOIN_ERROR when the socket has no active room session', async () => {
      const socket = createMockSocket({ data: {} });

      await connectionHandler.handlePrepareIdentitySwap(socket as unknown as Socket, {
        newAccessToken: 'some-token',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ message: 'Not currently in a room' }),
      );
      expect(identitySwapHandoffService.create).not.toHaveBeenCalled();
    });

    it('emits JOIN_ERROR when the token is invalid or tampered', async () => {
      const socket = createMockSocket({ data: { roomId: 'room-1', userId: 'old-user' } });
      (tokenService.verifyToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid or expired token');
      });

      await connectionHandler.handlePrepareIdentitySwap(socket as unknown as Socket, {
        newAccessToken: 'bad-token',
      });

      expect(socket.emit).toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.objectContaining({ message: 'Invalid identity-swap token' }),
      );
      expect(identitySwapHandoffService.create).not.toHaveBeenCalled();
    });

    it('creates the handoff from the verified token + session (never from the payload) and acks', async () => {
      const socket = createMockSocket({ data: { roomId: 'room-1', userId: 'old-user' } });
      (tokenService.verifyToken as jest.Mock).mockReturnValue({
        userId: 'new-user',
        email: 'new-user@example.com',
        userType: 'REGISTERED',
      });

      await connectionHandler.handlePrepareIdentitySwap(socket as unknown as Socket, {
        newAccessToken: 'good-token',
      });

      expect(identitySwapHandoffService.create).toHaveBeenCalledWith({
        newUserId: 'new-user',
        roomId: 'room-1',
        oldUserId: 'old-user',
      });
      expect(socket.emit).toHaveBeenCalledWith(
        ROOM_LIFECYCLE_EVENTS.PREPARE_IDENTITY_SWAP,
        { acknowledged: true },
      );
      expect(socket.emit).not.toHaveBeenCalledWith(
        ERROR_EVENTS.JOIN_ERROR,
        expect.anything(),
      );
    });
  });

  // ── handleLeaveRoom (socket path) ─────────────────────────────────────────

  describe('handleLeaveRoom', () => {
    it('emits LEAVE_CONFIRMED immediately when socket has no session', async () => {
      mockSessionManager.getRoomSession.mockReturnValue(undefined);
      const socket = createMockSocket();

      await connectionHandler.handleLeaveRoom(socket as unknown as Socket);

      expect(socket.emit).toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.LEAVE_CONFIRMED,
        expect.objectContaining({ message: 'Successfully left the room' }),
      );
    });

    it('emits LEAVE_CONFIRMED and calls socket.leave for non-owner band member', async () => {
      const room = createMockRoom();
      const bandMember: BandMember = {
        id: 'user-1',
        username: 'tester',
        role: 'band_member',
        isReady: false,
      };
      room.bandMembers.set('user-1', bandMember);

      const mockSession: NamespaceSession = {
        roomId: 'room-1',
        userId: 'user-1',
        socketId: 'socket-1',
        namespacePath: '/room',
        connectedAt: new Date(),
        lastActivity: new Date(),
      };
      mockSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockSessionManager.findSocketByUserIdAsync.mockResolvedValue('socket-1');
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.removeUserFromRoom.mockResolvedValue(bandMember);
      mockLifecycleService.shouldCloseRoom.mockResolvedValue(false);

      const socket = createMockSocket({ id: 'socket-1' });

      await connectionHandler.handleLeaveRoom(socket as unknown as Socket);

      expect(socket.emit).toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.LEAVE_CONFIRMED,
        expect.objectContaining({ message: 'Successfully left the room' }),
      );
      expect(socket.leave).toHaveBeenCalledWith('room-1');
    });

    it('skips member removal and stale broadcast when a newer socket registers during the leave lock', async () => {
      // Disconnect/rejoin race: the entry guard passes (no replacement yet), but
      // by the time the leave lock body runs the user has rejoined on a new
      // socket. Removing them + broadcasting the grace-period snapshot would mark
      // the freshly-joined user as "Reconnecting" on their own client.
      const room = createMockRoom();
      const bandMember: BandMember = {
        id: 'user-1',
        username: 'tester',
        role: 'band_member',
        isReady: false,
      };
      room.bandMembers.set('user-1', bandMember);

      const mockSession: NamespaceSession = {
        roomId: 'room-1',
        userId: 'user-1',
        socketId: 'socket-1',
        namespacePath: '/room',
        connectedAt: new Date(),
        lastActivity: new Date(),
      };
      mockSessionManager.getRoomSession.mockReturnValue(mockSession);
      // Entry guard sees the same socket (not yet replaced); the in-lock re-check
      // sees the newer socket that joined during the lock.
      mockSessionManager.findSocketByUserIdAsync
        .mockResolvedValueOnce('socket-1')
        .mockResolvedValueOnce('socket-2');
      mockLifecycleService.getRoom.mockResolvedValue(room);
      mockMembershipService.removeUserFromRoom.mockResolvedValue(bandMember);
      mockLifecycleService.shouldCloseRoom.mockResolvedValue(false);

      const mockNamespace = { emit: jest.fn() };
      mockHandler.getOrCreateRoomNamespace.mockReturnValue(
        mockNamespace as unknown as ReturnType<RoomLifecycleHandler['getOrCreateRoomNamespace']>,
      );

      (redisStateService.executeWithLock as jest.Mock).mockImplementation(
        async (_key: string, _timeout: number, _ttl: number, cb: () => Promise<void>) => cb(),
      );

      const socket = createMockSocket({ id: 'socket-1' });

      await connectionHandler.handleLeaveRoom(socket as unknown as Socket);

      expect(mockMembershipService.removeUserFromRoom).not.toHaveBeenCalled();
      expect(mockNamespace.emit).not.toHaveBeenCalledWith(
        ROOM_STATE_EVENTS.ROOM_STATE_UPDATED,
        expect.anything(),
      );
      expect(mockSessionManager.removeSession).toHaveBeenCalledWith('socket-1');
    });
  });
});
