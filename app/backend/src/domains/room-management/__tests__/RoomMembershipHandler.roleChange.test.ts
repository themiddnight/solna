/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
/**
 * RoomMembershipHandler — Role Change Unit Tests (W6)
 *
 * Covers:
 *  - handleRequestRoleChange: audience requests promotion (happy path)
 *  - handleRequestRoleChange: room owner cannot self-demote to audience
 *  - handleRequestRoleChange: duplicate pending request is a no-op
 *  - handleRequestRoleChange: band_member self-demotes to audience
 *  - handleApproveRoleChange: non-owner cannot approve
 *  - handleApproveRoleChange: happy path moves user from pending+audience to band_member
 *  - handleApproveRoleChange: approving a user not in pending list is rejected
 */

import { RoomMembershipHandler } from '../infrastructure/handlers/RoomMembershipHandler';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { buildRoomPayload } from '@/shared/utils/roomPayloadUtils';
import { RoomType } from '../../../types';

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: { getInstance: jest.fn() },
  redisStateService: {
    executeWithLock: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));

jest.mock('@/shared/utils/roomPayloadUtils', () => ({
  buildRoomPayload: jest.fn().mockResolvedValue({ room: {} }),
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRoom(overrides: Partial<any> = {}): any {
  return {
    id: 'room-1',
    name: 'Test Room',
    owner: 'owner-1',
    bandMembers: new Map([
      ['owner-1', { id: 'owner-1', username: 'Owner', role: 'room_owner' }],
    ]),
    audiences: new Map([
      ['audience-1', { id: 'audience-1', username: 'AudienceUser', role: 'audience' }],
    ]),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    createdAt: new Date(),
    roomType: RoomType.PERFORM,
    metronome: { bpm: 120, beatZeroAt: Date.now() },
    ...overrides,
  };
}

function makeSocket(overrides: Partial<any> = {}): any {
  return {
    id: 'socket-owner',
    emit: jest.fn(),
    ...overrides,
  };
}

function makeNamespace(sockets: Map<string, any> = new Map()): any {
  return {
    emit: jest.fn(),
    sockets,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoomMembershipHandler — handleRequestRoleChange', () => {
  let handler: RoomMembershipHandler;
  let mockRoomMembershipService: any;
  let mockRoomLifecycleService: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockNamespaceManager: any;

  beforeEach(() => {
    // executeWithLock must execute its callback inline for unit tests
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _ttl: number, _timeout: number, fn: () => Promise<void>) => fn()
    );
    // buildRoomPayload is reset by resetMocks, so set it up each time
    (buildRoomPayload as jest.Mock).mockResolvedValue({ room: {} });

    mockRoomMembershipService = {
      isRoomOwner: jest.fn(),
      findUserInRoom: jest.fn(),
      addPendingMember: jest.fn().mockResolvedValue(undefined),
      changeUserRole: jest.fn().mockResolvedValue(true),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
    };

    mockRoomLifecycleService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn().mockResolvedValue(undefined),
    };

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
      findSocketByUserIdAsync: jest.fn().mockResolvedValue(undefined),
    };

    mockIo = { sockets: { sockets: new Map() } };
    mockNamespaceManager = {};

    handler = new RoomMembershipHandler(
      mockRoomMembershipService,
      mockRoomLifecycleService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  it('emits error when socket has no session', async () => {
void mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);
    const socket = makeSocket();
    const namespace = makeNamespace();

    await handler.handleRequestRoleChange(socket, { targetRole: 'band_member' }, namespace);

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: 'You are not in a room' })
    );
    expect(namespace.emit).not.toHaveBeenCalled();
  });

  it('adds audience user to pendingMembers and notifies namespace on promotion request', async () => {
    const session = { roomId: 'room-1', userId: 'audience-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    mockRoomMembershipService.findUserInRoom.mockResolvedValue({
      id: 'audience-1',
      username: 'AudienceUser',
      role: 'audience',
      profilePictureUrl: null,
      userType: 'REGISTERED',
    });

    const socket = makeSocket({ id: 'socket-audience' });
    const namespace = makeNamespace();

    await handler.handleRequestRoleChange(socket, { targetRole: 'band_member' }, namespace);

    expect(mockRoomMembershipService.addPendingMember).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({ id: 'audience-1', role: 'band_member' })
    );
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('role_change_requested'),
      expect.objectContaining({ userId: 'audience-1', targetRole: 'band_member' })
    );
    // Updated room state is also broadcast
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('state_updated'),
      expect.anything()
    );
  });

  it('does not add to pendingMembers again if user is already pending (idempotent)', async () => {
    const session = { roomId: 'room-1', userId: 'audience-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    // Pre-seed pendingMembers with audience-1
void room.pendingMembers.set('audience-1', { id: 'audience-1', username: 'AudienceUser', role: 'band_member' });
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    mockRoomMembershipService.findUserInRoom.mockResolvedValue({
      id: 'audience-1',
      username: 'AudienceUser',
      role: 'audience',
    });

    const socket = makeSocket({ id: 'socket-audience' });
    const namespace = makeNamespace();

    await handler.handleRequestRoleChange(socket, { targetRole: 'band_member' }, namespace);

    expect(mockRoomMembershipService.addPendingMember).not.toHaveBeenCalled();
    expect(namespace.emit).not.toHaveBeenCalledWith(
      expect.stringContaining('role_change_requested'),
      expect.anything()
    );
  });

  it('allows band_member to self-demote to audience without owner approval', async () => {
    const session = { roomId: 'room-1', userId: 'member-2' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom({
      bandMembers: new Map([
        ['owner-1', { id: 'owner-1', username: 'Owner', role: 'room_owner' }],
        ['member-2', { id: 'member-2', username: 'BandMember2', role: 'band_member' }],
      ]),
    });
    // getRoom called twice: once before lock, once inside lock
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    mockRoomMembershipService.findUserInRoom.mockResolvedValue({
      id: 'member-2',
      username: 'BandMember2',
      role: 'band_member',
    });

    const socket = makeSocket({ id: 'socket-member-2' });
    const namespace = makeNamespace();

    await handler.handleRequestRoleChange(socket, { targetRole: 'audience' }, namespace);

    expect(mockRoomMembershipService.changeUserRole).toHaveBeenCalledWith('room-1', 'member-2', 'audience');
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('user_role_changed'),
      expect.objectContaining({ userId: 'member-2', role: 'audience' })
    );
  });

  it('rejects room owner from self-demoting to audience', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);
    mockRoomMembershipService.findUserInRoom.mockResolvedValue({
      id: 'owner-1',
      username: 'Owner',
      role: 'room_owner',
    });

    const socket = makeSocket({ id: 'socket-owner' });
    const namespace = makeNamespace();

    await handler.handleRequestRoleChange(socket, { targetRole: 'audience' }, namespace);

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: expect.stringContaining('cannot downgrade') })
    );
    expect(mockRoomMembershipService.changeUserRole).not.toHaveBeenCalled();
  });
});

describe('RoomMembershipHandler — handleApproveRoleChange', () => {
  let handler: RoomMembershipHandler;
  let mockRoomMembershipService: any;
  let mockRoomLifecycleService: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockNamespaceManager: any;

  beforeEach(() => {
    // executeWithLock must execute its callback inline for unit tests
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _ttl: number, _timeout: number, fn: () => Promise<void>) => fn()
    );
    // buildRoomPayload is reset by resetMocks, so set it up each time
    (buildRoomPayload as jest.Mock).mockResolvedValue({ room: {} });

    mockRoomMembershipService = {
      isRoomOwner: jest.fn(),
      findUserInRoom: jest.fn(),
      changeUserRole: jest.fn().mockResolvedValue(true),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
    };

    mockRoomLifecycleService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn().mockResolvedValue(undefined),
    };

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
      findSocketByUserIdAsync: jest.fn().mockResolvedValue(undefined),
    };

    mockIo = { sockets: { sockets: new Map() } };
    mockNamespaceManager = {};

    handler = new RoomMembershipHandler(
      mockRoomMembershipService,
      mockRoomLifecycleService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  it('emits error when non-owner tries to approve', async () => {
    const session = { roomId: 'room-1', userId: 'non-owner' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(false);

    const socket = makeSocket();
    const namespace = makeNamespace();

    await handler.handleApproveRoleChange(
      socket,
      { targetUserId: 'audience-1', targetRole: 'band_member' },
      namespace
    );

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: expect.stringContaining('Only room owner') })
    );
    expect(namespace.emit).not.toHaveBeenCalled();
  });

  it('moves user from pendingMembers to band_member on happy path', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(true);

    const room = makeRoom({
      pendingMembers: new Map([
        ['audience-1', { id: 'audience-1', username: 'AudienceUser', role: 'band_member' }],
      ]),
    });
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket({ id: 'socket-owner' });
    const namespace = makeNamespace();

    await handler.handleApproveRoleChange(
      socket,
      { targetUserId: 'audience-1', targetRole: 'band_member' },
      namespace
    );

    expect(mockRoomMembershipService.changeUserRole).toHaveBeenCalledWith('room-1', 'audience-1', 'band_member');
    expect(room.pendingMembers.has('audience-1')).toBe(false);
    expect(mockRoomLifecycleService.saveRoom).toHaveBeenCalledWith(room);
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('user_role_changed'),
      expect.objectContaining({ userId: 'audience-1', role: 'band_member' })
    );
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('state_updated'),
      expect.anything()
    );
  });

  it('emits error if target user is not in pending promotion list', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(true);

    const room = makeRoom(); // pendingMembers is empty
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket({ id: 'socket-owner' });
    const namespace = makeNamespace();

    await handler.handleApproveRoleChange(
      socket,
      { targetUserId: 'unknown-user', targetRole: 'band_member' },
      namespace
    );

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: expect.stringContaining('pending promotion list') })
    );
    expect(mockRoomMembershipService.changeUserRole).not.toHaveBeenCalled();
  });
});

describe('RoomMembershipHandler — handleRejectRoleChange', () => {
  let handler: RoomMembershipHandler;
  let mockRoomMembershipService: any;
  let mockRoomLifecycleService: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockNamespaceManager: any;

  beforeEach(() => {
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _ttl: number, _timeout: number, fn: () => Promise<void>) => fn()
    );
    (buildRoomPayload as jest.Mock).mockResolvedValue({ room: {} });

    mockRoomMembershipService = {
      isRoomOwner: jest.fn(),
      findUserInRoom: jest.fn(),
      changeUserRole: jest.fn().mockResolvedValue(true),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
    };

    mockRoomLifecycleService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn().mockResolvedValue(undefined),
    };

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
      findSocketByUserIdAsync: jest.fn().mockResolvedValue(undefined),
    };

    mockIo = { sockets: { sockets: new Map() } };
    mockNamespaceManager = {};

    handler = new RoomMembershipHandler(
      mockRoomMembershipService,
      mockRoomLifecycleService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  it('emits error when non-owner tries to reject a role change', async () => {
    const session = { roomId: 'room-1', userId: 'non-owner' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(false);

    const socket = makeSocket();
    const namespace = makeNamespace();

    await handler.handleRejectRoleChange(socket, { targetUserId: 'audience-1' }, namespace);

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: expect.stringContaining('Only room owner') })
    );
    expect(namespace.emit).not.toHaveBeenCalled();
  });

  it('emits error if target user is not in pending promotion list', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(true);

    const room = makeRoom(); // pendingMembers is empty
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket();
    const namespace = makeNamespace();

    await handler.handleRejectRoleChange(socket, { targetUserId: 'unknown-user' }, namespace);

    expect(socket.emit).toHaveBeenCalledWith(
      expect.stringContaining('membership_error'),
      expect.objectContaining({ message: expect.stringContaining('pending promotion list') })
    );
    expect(mockRoomLifecycleService.saveRoom).not.toHaveBeenCalled();
  });

  it('removes user from pendingMembers and emits rejection only to that user — not namespace-wide', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
void mockRoomSessionManager.getRoomSession.mockReturnValue(session);
void mockRoomMembershipService.isRoomOwner.mockResolvedValue(true);

    const pendingEntry = { id: 'audience-1', username: 'AudienceUser', role: 'band_member' };
    const room = makeRoom({
      pendingMembers: new Map([['audience-1', pendingEntry]]),
    });
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const targetSocket = makeSocket({ id: 'socket-audience' });
    const namespace = makeNamespace(new Map([['socket-audience', targetSocket]]));
void mockRoomSessionManager.findSocketByUserIdAsync.mockResolvedValue('socket-audience');

    const ownerSocket = makeSocket({ id: 'socket-owner' });

    await handler.handleRejectRoleChange(ownerSocket, { targetUserId: 'audience-1' }, namespace);

    // User removed from pending
    expect(room.pendingMembers.has('audience-1')).toBe(false);
    expect(mockRoomLifecycleService.saveRoom).toHaveBeenCalledWith(room);

    // Rejection emitted only to target socket — not namespace-wide
    expect(targetSocket.emit).toHaveBeenCalledWith(
      expect.stringContaining('role_change_rejected'),
      expect.objectContaining({ userId: 'audience-1', message: expect.any(String) })
    );
    expect(namespace.emit).not.toHaveBeenCalledWith(
      expect.stringContaining('role_change_rejected'),
      expect.anything()
    );

    // Room state broadcast still happens to update pending list for all clients
    expect(namespace.emit).toHaveBeenCalledWith(
      expect.stringContaining('state_updated'),
      expect.anything()
    );

    // changeUserRole is never called — user stays in audience
    expect(mockRoomMembershipService.changeUserRole).not.toHaveBeenCalled();
  });
});
