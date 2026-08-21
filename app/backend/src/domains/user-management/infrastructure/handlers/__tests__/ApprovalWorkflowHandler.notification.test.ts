/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * Regression Test for Approval Notification Bug
 *
 * Bug: Room owner not receiving approval request notifications
 * Root Cause: Using roomNamespace.to(roomNamespace.name).emit() instead of roomNamespace.emit()
 *
 * This test ensures that approval notifications are properly sent to all sockets
 * in the room namespace, including the room owner.
 */
import { ApprovalWorkflowHandler } from '../ApprovalWorkflowHandler';
import { ERROR_EVENTS, ROOM_STATE_EVENTS, SOCKET_ERROR_CODES } from '@jam-band/shared';
import type { ApprovalRequestData, Room, RoomType } from '../../../../../types';

// DEV-179: socket identity is established by the namespace auth middleware and read from
// socket.data.user — never the client payload. Every approval request here is the same
// requester; username is null so the handler falls back to each test's data.username.
const REQUESTER_SOCKET_DATA = {
  user: { id: 'requesting-user-id', username: null, userType: 'REGISTERED', emailVerified: true },
};

describe('ApprovalWorkflowHandler - Notification Tests', () => {
  let handler: ApprovalWorkflowHandler;
  let mockRoomLifecycleService: Record<string, jest.Mock>;
  let mockRoomMembershipService: Record<string, jest.Mock>;
  let mockIo: Record<string, unknown>;
  let mockNamespaceManager: Record<string, jest.Mock>;
  let mockRoomSessionManager: Record<string, jest.Mock>;
  let mockApprovalSessionManager: Record<string, jest.Mock>;

  beforeEach(() => {
    // Create mock room factory
    const createMockRoom = (overrides: Partial<Room> = {}): Room => ({
      id: 'test-room-id',
      name: 'Test Room',
      roomType: 'perform' as RoomType,
      owner: 'owner-id',
      isPrivate: true,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map([
        ['owner-id', { id: 'owner-id', username: 'Owner', role: 'room_owner', isReady: true }]
      ]),
      audiences: new Map(),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 },
      ...overrides
    });

    // Mock services
    mockRoomLifecycleService = {
      getRoom: jest.fn(async (roomId: string) => createMockRoom({ id: roomId })),
      getRoomGracePeriodUsers: jest.fn(() => []),
      isUserInGracePeriod: jest.fn(() => false),
    };

    mockRoomMembershipService = {
      findUserInRoom: jest.fn(async () => null),
      addPendingMember: jest.fn(async () => undefined)
    };

    mockIo = {};

    // Mock namespace with proper socket tracking
    const mockRoomNamespace = {
      name: '/room/test-room-id',
      sockets: new Map([
        ['owner-socket-id', { id: 'owner-socket-id' }]
      ]),
      emit: jest.fn(() => undefined),
      to: jest.fn(() => ({
        emit: jest.fn(() => undefined)
      }))
    };

    mockNamespaceManager = {
      getRoomNamespace: jest.fn((_roomId: string) => mockRoomNamespace),
      getApprovalNamespace: jest.fn(() => null)
    };

    mockRoomSessionManager = {
      getRoomSession: jest.fn(() => null),
      isUserActiveInRoom: jest.fn(async () => true),
    };

    mockApprovalSessionManager = {
      hasApprovalSession: jest.fn(() => false),
      removeApprovalSessionByUserId: jest.fn(() => undefined),
      createApprovalSession: jest.fn(() => ({
        socketId: 'approval-socket-id',
        roomId: 'test-room-id',
        userId: 'requesting-user-id',
        username: 'Requester',
        role: 'band_member',
        requestedAt: new Date(),
        timeoutHandle: null
      })),
      getApprovalTimeoutMs: jest.fn(() => 600000)
    };

    handler = new ApprovalWorkflowHandler(
      mockRoomLifecycleService as never,
      mockRoomMembershipService as never,
      mockIo as never,
      mockNamespaceManager as never,
      mockRoomSessionManager as never,
      mockApprovalSessionManager as never
    );
  });

  it('should send approval notification to all sockets in room namespace', async () => {
    // Arrange
    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    const roomNamespace = mockNamespaceManager.getRoomNamespace?.('test-room-id');

    // Verify that emit was called directly on the namespace (not .to().emit())
    expect(roomNamespace?.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.APPROVAL_REQUEST,
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'requesting-user-id',
          username: 'Requester',
          role: 'band_member'
        }),
        requestedAt: expect.any(String)
      })
    );

    // Verify that .to() was NOT used (this was the bug)
    expect(roomNamespace?.to).not.toHaveBeenCalled();
  });

  it('should notify room owner when there are connected sockets', async () => {
    // Arrange
    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    const roomNamespace = mockNamespaceManager.getRoomNamespace?.('test-room-id');

    // Should have called emit on the namespace
     
     
    expect(roomNamespace?.emit).toHaveBeenCalled();
    
    // Should have sent approval_pending to the requesting user
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'approval_pending',
      expect.objectContaining({
        message: 'Waiting for room owner approval'
      })
    );
  });

  it('should add pending member to room membership service', async () => {
    // Arrange
    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    expect(mockRoomMembershipService.addPendingMember).toHaveBeenCalledWith(
      'test-room-id',
      expect.objectContaining({
        id: 'requesting-user-id',
        username: 'Requester',
        role: 'band_member'
      })
    );
  });

  it('should create approval session with timeout', async () => {
    // Arrange
    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    expect(mockApprovalSessionManager.createApprovalSession).toHaveBeenCalledWith(
      'approval-socket-id',
      'test-room-id',
      'requesting-user-id',
      'Requester',
      'band_member',
      expect.any(Function) // timeout callback
    );
  });

  it('should reject approval request for non-private rooms', async () => {
    // Arrange
    mockRoomLifecycleService.getRoom = jest.fn(async () => ({
      id: 'test-room-id',
      name: 'Public Room',
      roomType: 'perform',
      owner: 'owner-id',
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 }
    }));

    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'approval_error',
      {
        code: SOCKET_ERROR_CODES.PRIVATE_ROOM_REQUIRED,
        message: 'Room is not private',
      }
    );

    // Should not have created approval session
    expect(mockApprovalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('should clean up stale approval session and allow a new request from same user', async () => {
    // Arrange
    mockApprovalSessionManager.hasApprovalSession = jest.fn(() => true);

    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined)
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map()
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member'
    };

    // Act
    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never
    );

    // Assert
    expect(mockApprovalSessionManager.removeApprovalSessionByUserId).toHaveBeenCalledWith('requesting-user-id');
    expect(mockApprovalSessionManager.createApprovalSession).toHaveBeenCalledWith(
      'approval-socket-id',
      'test-room-id',
      'requesting-user-id',
      'Requester',
      'band_member',
      expect.any(Function)
    );
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'approval_pending',
      expect.objectContaining({
        message: 'Waiting for room owner approval'
      })
    );
  });

  it('should emit ghost_room_error and skip approval session when room has no active users', async () => {
    mockRoomLifecycleService.getRoom = jest.fn(async () => ({
      id: 'test-room-id',
      name: 'Ghost Private Room',
      roomType: 'perform',
      owner: 'owner-id',
      isPrivate: true,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 }
    }));
    mockRoomLifecycleService.getRoomGracePeriodUsers = jest.fn(() => []);

    const mockSocket = {
      id: 'approval-socket-id',
      data: REQUESTER_SOCKET_DATA,
      emit: jest.fn(() => undefined),
    };

    const mockApprovalNamespace = {
      name: '/approval/test-room-id',
      sockets: new Map(),
    };

    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member',
    };

    await handler.handleApprovalRequest(
      mockSocket as never,
      requestData,
      mockApprovalNamespace as never,
    );

    expect(mockSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({
        roomId: 'test-room-id',
        roomName: 'Ghost Private Room',
      }),
    );
    expect(mockApprovalSessionManager.createApprovalSession).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.addPendingMember).not.toHaveBeenCalled();
  });

  it('should emit ghost_room_error when room has only audience members active (no owner)', async () => {
    // Room has an active audience member but no room_owner — no one can approve.
    mockRoomLifecycleService.getRoom = jest.fn(async () => ({
      id: 'test-room-id',
      name: 'Audience-Only Room',
      roomType: 'perform',
      owner: 'owner-id',
      isPrivate: true,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map(), // no band members, no owner
      audiences: new Map([
        ['audience-id', { id: 'audience-id', username: 'Listener', role: 'audience' as const, joinedAt: new Date() }],
      ]),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 }
    }));
    mockRoomSessionManager.isUserActiveInRoom = jest.fn(async () => true);

    const mockSocket = { id: 'approval-socket-id', data: REQUESTER_SOCKET_DATA, emit: jest.fn() };
    const mockApprovalNamespace = { name: '/approval/test-room-id', sockets: new Map() };
    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member',
    };

    await handler.handleApprovalRequest(mockSocket as never, requestData, mockApprovalNamespace as never);

    expect(mockSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ roomId: 'test-room-id' }),
    );
    expect(mockApprovalSessionManager.createApprovalSession).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.addPendingMember).not.toHaveBeenCalled();
  });

  it('should emit ghost_room_error when room has only band_member active (no owner)', async () => {
    // Room has an active band_member but no room_owner — band_members cannot approve requests.
    mockRoomLifecycleService.getRoom = jest.fn(async () => ({
      id: 'test-room-id',
      name: 'Member-Only Room',
      roomType: 'perform',
      owner: 'owner-id',
      isPrivate: true,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map([
        ['member-id', { id: 'member-id', username: 'Band Member', role: 'band_member' as const, isReady: true }],
      ]),
      audiences: new Map(),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 }
    }));
    mockRoomSessionManager.isUserActiveInRoom = jest.fn(async () => true);

    const mockSocket = { id: 'approval-socket-id', data: REQUESTER_SOCKET_DATA, emit: jest.fn() };
    const mockApprovalNamespace = { name: '/approval/test-room-id', sockets: new Map() };
    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member',
    };

    await handler.handleApprovalRequest(mockSocket as never, requestData, mockApprovalNamespace as never);

    expect(mockSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ roomId: 'test-room-id' }),
    );
    expect(mockApprovalSessionManager.createApprovalSession).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.addPendingMember).not.toHaveBeenCalled();
  });

  it('should emit ghost_room_error when owner exists in room but is not active (and not in grace period)', async () => {
    // Owner is in bandMembers but not connected — inactive owner, requester must not queue.
    mockRoomLifecycleService.getRoom = jest.fn(async () => ({
      id: 'test-room-id',
      name: 'Inactive Owner Room',
      roomType: 'perform',
      owner: 'owner-id',
      isPrivate: true,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map([
        ['owner-id', { id: 'owner-id', username: 'Owner', role: 'room_owner' as const, isReady: true }],
      ]),
      audiences: new Map(),
      pendingMembers: new Map(),
      metronome: { bpm: 120, beatZeroAt: 0 }
    }));
    mockRoomLifecycleService.isUserInGracePeriod = jest.fn(() => false);
    mockRoomSessionManager.isUserActiveInRoom = jest.fn(async () => false);

    const mockSocket = { id: 'approval-socket-id', data: REQUESTER_SOCKET_DATA, emit: jest.fn() };
    const mockApprovalNamespace = { name: '/approval/test-room-id', sockets: new Map() };
    const requestData: ApprovalRequestData = {
      roomId: 'test-room-id',
      userId: 'requesting-user-id',
      username: 'Requester',
      role: 'band_member',
    };

    await handler.handleApprovalRequest(mockSocket as never, requestData, mockApprovalNamespace as never);

    expect(mockSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ roomId: 'test-room-id' }),
    );
    expect(mockApprovalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });
});
