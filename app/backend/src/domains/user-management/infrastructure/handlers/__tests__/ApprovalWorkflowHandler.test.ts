/**
 * ApprovalWorkflowHandler — owner-only gate and ghost-room validation.
 *
 * Documents the load-bearing approval-flow behavior (no production changes):
 * - validateRoomIsJoinableForApproval ghost-room pre-check — 30s new-room
 *   grace plus owner-in-grace-period vs active-owner determination, exercised
 *   through the real handleApprovalRequest with fabricated session states.
 * - Owner-only approve: session.userId (verified token, TR-33) is the acting
 *   identity; the payload userId is the *target*. A non-owner approve is
 *   rejected and never reaches approveMember.
 * - Request paths: room-not-found / not-private / already-in-room /
 *   stale-session cleanup.
 * - Cancel cross-checks approvalSession.userId === authUser.id AND roomId
 *   (anti-spoof).
 * - Approve broadcasts the exact event names from @jam-band/shared:
 *   APPROVAL_GRANTED ('approval_granted') + USER_JOINED ('user_joined') +
 *   ROOM_STATE_UPDATED ('room:state_updated').
 * - Timeout/disconnect cleanup removes the pending member.
 *
 * Pattern: mocked socket/namespace + mocked services (mirrors the
 * RoomLifecycleHandler tests). ApprovalSessionManager is mocked, so no real
 * timers start here — no NODE_ENV=test guard needed.
 */
import { ApprovalWorkflowHandler } from '../ApprovalWorkflowHandler';
import { APPROVAL_BE_EVENTS, APPROVAL_EVENTS, ERROR_EVENTS, ROOM_STATE_EVENTS } from '@jam-band/shared';
import type { Namespace, Server, Socket } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { ApprovalSessionManager } from '@/domains/room-management/infrastructure/services/ApprovalSessionManager';
import type { NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { GracePeriodEntry } from '@/shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import { createPartialMock } from '@/testing/mocks';
import type { ApprovalRequestData, ApprovalSession, BandMember, Room } from '@/types';
import { RoomType } from '@/types';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

const ROOM_ID = 'room-1';
const OWNER_ID = 'owner-1';
const REQUESTER_ID = 'requester-1';
const TARGET_ID = 'target-user';
const REQUESTER_SOCKET_ID = 'requester-approval-socket-id';
const TARGET_SOCKET_ID = 'target-approval-socket-id';
const OWNER_SOCKET_ID = 'owner-socket-id';

/** Older than the 30s new-room grace period, so ghost validation runs. */
function createMockRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: ROOM_ID,
    name: 'Test Room',
    roomType: RoomType.PERFORM,
    owner: OWNER_ID,
    isPrivate: true,
    isHidden: false,
    isIsolated: false,
    createdAt: new Date(Date.now() - 60_000),
    bandMembers: new Map([
      [OWNER_ID, { id: OWNER_ID, username: 'Owner', role: 'room_owner', isReady: true }],
    ]),
    audiences: new Map(),
    pendingMembers: new Map(),
    metronome: { bpm: 120, beatZeroAt: 0 },
    ...overrides,
  };
}

const APPROVAL_SESSION: ApprovalSession = {
  roomId: ROOM_ID,
  userId: REQUESTER_ID,
  username: 'Requester',
  role: 'band_member',
  requestedAt: new Date('2026-08-15T12:00:00.000Z'),
};

const APPROVED_USER: BandMember = {
  id: TARGET_ID,
  username: 'Target',
  role: 'band_member',
  isReady: true,
};

/** Socket mock: id + data.user mirror the verified-token identity (DEV-179/TR-33). */
function createSocket(id: string, user?: { id: string; username: string | null }): jest.Mocked<Socket> {
  return createPartialMock<Socket>({
    id,
    data: user !== undefined ? { user } : {},
    emit: jest.fn(),
    disconnect: jest.fn(),
  });
}

function graceEntry(role: 'room_owner' | 'band_member'): GracePeriodEntry {
  const id = role === 'room_owner' ? OWNER_ID : 'member-1';
  return {
    userId: id,
    roomId: ROOM_ID,
    namespacePath: `/room/${ROOM_ID}`,
    timestamp: Date.now(),
    isIntendedLeave: false,
    userData: { id, username: role === 'room_owner' ? 'Owner' : 'Member', role, isReady: true },
  };
}

interface HarnessOptions {
  room?: Room;
  roomSockets?: Map<string, Socket>;
  approvalSockets?: Map<string, Socket>;
}

interface Harness {
  handler: ApprovalWorkflowHandler;
  roomLifecycleService: jest.Mocked<RoomLifecycleService>;
  roomMembershipService: jest.Mocked<RoomMembershipService>;
  roomSessionManager: jest.Mocked<RoomSessionManager>;
  approvalSessionManager: jest.Mocked<ApprovalSessionManager>;
  namespaceManager: jest.Mocked<NamespaceManager>;
  roomNamespace: jest.Mocked<Namespace>;
  approvalNamespace: jest.Mocked<Namespace>;
}

function buildHarness(options: HarnessOptions = {}): Harness {
  const room = options.room ?? createMockRoom();
  const roomSockets = options.roomSockets ?? new Map<string, Socket>([[OWNER_SOCKET_ID, createSocket(OWNER_SOCKET_ID)]]);
  const approvalSockets = options.approvalSockets ?? new Map<string, Socket>();

  const roomNamespace = createPartialMock<Namespace>({
    name: `/room/${ROOM_ID}`,
    sockets: roomSockets,
    emit: jest.fn(),
  });
  const approvalNamespace = createPartialMock<Namespace>({
    name: `/approval/${ROOM_ID}`,
    sockets: approvalSockets,
    emit: jest.fn(),
  });

  const roomLifecycleService = createPartialMock<RoomLifecycleService>({
    getRoom: jest.fn(async (_roomId: string) => room),
    getRoomGracePeriodUsers: jest.fn((_roomId: string) => []),
    isUserInGracePeriod: jest.fn((_userId: string, _roomId: string) => false),
  });

  const roomMembershipService = createPartialMock<RoomMembershipService>({
    findUserInRoom: jest.fn(async (_roomId: string, _userId: string) => undefined),
    addPendingMember: jest.fn(async (_roomId: string, _member: BandMember) => true),
    approveMember: jest.fn(async (_roomId: string, _userId: string) => APPROVED_USER),
    rejectMember: jest.fn(async (_roomId: string, _userId: string) => APPROVED_USER),
    getRoomUsers: jest.fn(async (_roomId: string) => []),
    getPendingMembers: jest.fn(async (_roomId: string) => []),
    isRoomOwner: jest.fn(async (_roomId: string, _userId: string) => true),
  });

  const roomSessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn((_socketId: string) => undefined),
    isUserActiveInRoom: jest.fn(async (_roomId: string, _userId: string) => true),
  });

  const approvalSessionManager = createPartialMock<ApprovalSessionManager>({
    hasApprovalSession: jest.fn((_userId: string) => false),
    removeApprovalSessionByUserId: jest.fn((_userId: string) => undefined),
    createApprovalSession: jest.fn(
      (
        _socketId: string,
        _roomId: string,
        _userId: string,
        _username: string,
        _role: 'band_member' | 'audience',
        _timeoutCallback?: (socketId: string, session: ApprovalSession) => void,
      ) => APPROVAL_SESSION,
    ),
    getApprovalTimeoutMs: jest.fn(() => 600_000),
    getApprovalSessionByUserId: jest.fn((_userId: string) => APPROVAL_SESSION),
    getApprovalSession: jest.fn((_socketId: string) => APPROVAL_SESSION),
    removeApprovalSession: jest.fn((_socketId: string) => APPROVAL_SESSION),
  });

  const namespaceManager = createPartialMock<NamespaceManager>({
    getRoomNamespace: jest.fn((_roomId: string) => roomNamespace),
    getApprovalNamespace: jest.fn((_roomId: string) => approvalNamespace),
  });

  const handler = new ApprovalWorkflowHandler(
    roomLifecycleService,
    roomMembershipService,
    createPartialMock<Server>({}),
    namespaceManager,
    roomSessionManager,
    approvalSessionManager,
  );

  return {
    handler,
    roomLifecycleService,
    roomMembershipService,
    roomSessionManager,
    approvalSessionManager,
    namespaceManager,
    roomNamespace,
    approvalNamespace,
  };
}

// Payload userId is deliberately spoofed in request tests: the handler must use
// the verified socket-token identity (TR-33), never the client payload.
const REQUEST_DATA: ApprovalRequestData = {
  roomId: ROOM_ID,
  userId: 'spoofed-user-id',
  username: 'Requester',
  role: 'band_member',
};

describe('ApprovalWorkflowHandler — owner-only gate and ghost-room validation', () => {
  // ------------------------------------------------------------------
  // Request paths (handleApprovalRequest)
  // ------------------------------------------------------------------

  it('requires an authenticated socket identity (TR-33)', async () => {
    const h = buildHarness();
    const anonSocket = createSocket('anon-socket-id');

    await h.handler.handleApprovalRequest(anonSocket, REQUEST_DATA, h.approvalNamespace);

    expect(anonSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Authentication required' }),
    );
    expect(h.roomLifecycleService.getRoom).not.toHaveBeenCalled();
  });

  it('rejects the request when the room is not found', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(undefined);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Room not found' }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('rejects the request when the room is not private', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ isPrivate: false }));

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Room is not private' }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('rejects the request when the user is already in the room', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomMembershipService.findUserInRoom.mockResolvedValue({
      id: REQUESTER_ID,
      username: 'Requester',
      role: 'band_member',
      isReady: true,
    });

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'You are already in this room' }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
    expect(h.roomMembershipService.addPendingMember).not.toHaveBeenCalled();
  });

  it('cleans up a stale approval session before creating a new one', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.approvalSessionManager.hasApprovalSession.mockReturnValue(true);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(h.approvalSessionManager.removeApprovalSessionByUserId).toHaveBeenCalledWith(REQUESTER_ID);
    expect(h.approvalSessionManager.createApprovalSession).toHaveBeenCalledWith(
      REQUESTER_SOCKET_ID,
      ROOM_ID,
      REQUESTER_ID, // verified token identity — the spoofed payload userId is ignored
      'Requester',
      'band_member',
      expect.any(Function), // timeout callback
    );
    expect(requesterSocket.emit).toHaveBeenCalledWith(APPROVAL_EVENTS.APPROVAL_PENDING, {
      message: 'Waiting for room owner approval',
      timeoutMs: 600_000,
    });
  });

  // ------------------------------------------------------------------
  // Ghost-room pre-check — validateRoomIsJoinableForApproval
  // (30s new-room grace + owner-in-grace vs active-owner determination)
  // ------------------------------------------------------------------

  it('allows the request during the 30s new-room grace even with no members', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(
      createMockRoom({ bandMembers: new Map(), audiences: new Map(), createdAt: new Date(Date.now() - 10_000) }),
    );

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    // New-room branch short-circuits before the grace-period lookup.
    expect(h.roomLifecycleService.getRoomGracePeriodUsers).not.toHaveBeenCalled();
    expect(requesterSocket.emit).toHaveBeenCalledWith(APPROVAL_EVENTS.APPROVAL_PENDING, {
      message: 'Waiting for room owner approval',
      timeoutMs: 600_000,
    });
    expect(h.roomMembershipService.addPendingMember).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({ id: REQUESTER_ID, role: 'band_member' }),
    );
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.APPROVAL_REQUEST,
      expect.objectContaining<{ user: unknown }>({ user: expect.objectContaining({ id: REQUESTER_ID }) }),
    );
  });

  it('rejects when the room has no members and nobody is in the grace period', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ bandMembers: new Map(), audiences: new Map() }));
    h.roomLifecycleService.getRoomGracePeriodUsers.mockReturnValue([]);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ message: 'This room is no longer active.', roomId: ROOM_ID }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
    expect(h.roomMembershipService.addPendingMember).not.toHaveBeenCalled();
  });

  it('rejects when only a band_member is in the grace period (band members cannot approve)', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ bandMembers: new Map(), audiences: new Map() }));
    h.roomLifecycleService.getRoomGracePeriodUsers.mockReturnValue([graceEntry('band_member')]);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    // Grace-period owner check uses role === 'room_owner' — band_member does not count.
    expect(requesterSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ message: 'This room is no longer active.', roomId: ROOM_ID }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('rejects with a reconnect message when an owner is in the grace period but the room is empty', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(createMockRoom({ bandMembers: new Map(), audiences: new Map() }));
    h.roomLifecycleService.getRoomGracePeriodUsers.mockReturnValue([graceEntry('room_owner')]);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({
        message: 'This room is temporarily unavailable. The owner may be reconnecting. Please try again shortly.',
        roomId: ROOM_ID,
      }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('rejects when the room has members but no room_owner to approve', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.getRoom.mockResolvedValue(
      createMockRoom({
        bandMembers: new Map([['member-1', { id: 'member-1', username: 'Member', role: 'band_member', isReady: true }]]),
      }),
    );

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ message: 'No room owner is currently available to approve your request.' }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  it('allows the request when the room owner is in the reconnect grace period (owner-in-grace branch)', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomLifecycleService.isUserInGracePeriod.mockReturnValue(true);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(APPROVAL_EVENTS.APPROVAL_PENDING, {
      message: 'Waiting for room owner approval',
      timeoutMs: 600_000,
    });
    // Grace period short-circuits the active-session check.
    expect(h.roomSessionManager.isUserActiveInRoom).not.toHaveBeenCalled();
  });

  it('allows the request when the room owner is active in the room (active-owner branch)', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomSessionManager.isUserActiveInRoom.mockResolvedValue(true);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(h.roomSessionManager.isUserActiveInRoom).toHaveBeenCalledWith(ROOM_ID, OWNER_ID);
    expect(requesterSocket.emit).toHaveBeenCalledWith(APPROVAL_EVENTS.APPROVAL_PENDING, {
      message: 'Waiting for room owner approval',
      timeoutMs: 600_000,
    });
  });

  it('rejects when the owner is neither in the grace period nor active', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.roomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await h.handler.handleApprovalRequest(requesterSocket, REQUEST_DATA, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      ERROR_EVENTS.GHOST_ROOM_ERROR,
      expect.objectContaining({ message: 'The room owner is not currently active. Please try again later.' }),
    );
    expect(h.approvalSessionManager.createApprovalSession).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Owner-only approve (handleApprovalResponse)
  // ------------------------------------------------------------------

  it('rejects an approve from a non-owner — session.userId is the actor, payload userId is only the target (TR-33)', async () => {
    const h = buildHarness();
    const memberSocket = createSocket('member-socket-id', { id: 'member-1', username: 'Member' });
    h.roomSessionManager.getRoomSession.mockReturnValue(
      createPartialMock<NamespaceSession>({ roomId: ROOM_ID, userId: 'member-1' }),
    );
    h.roomMembershipService.isRoomOwner.mockResolvedValue(false);

    await h.handler.handleApprovalResponse(memberSocket, { userId: TARGET_ID, approved: true }, h.roomNamespace);

    // The owner check runs against the verified session, never the payload.
    expect(h.roomMembershipService.isRoomOwner).toHaveBeenCalledWith(ROOM_ID, 'member-1');
    expect(h.roomMembershipService.isRoomOwner).not.toHaveBeenCalledWith(ROOM_ID, TARGET_ID);
    expect(memberSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Only room owner can approve members' }),
    );
    expect(h.roomMembershipService.approveMember).not.toHaveBeenCalled();
    expect(h.roomNamespace.emit).not.toHaveBeenCalled();
  });

  it('rejects when the acting socket has no room session', async () => {
    const h = buildHarness();
    const ownerSocket = createSocket(OWNER_SOCKET_ID, { id: OWNER_ID, username: 'Owner' });

    await h.handler.handleApprovalResponse(ownerSocket, { userId: TARGET_ID, approved: true }, h.roomNamespace);

    expect(ownerSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'You are not in a room' }),
    );
    expect(h.roomLifecycleService.getRoom).not.toHaveBeenCalled();
  });

  it('rejects when the room is not found', async () => {
    const h = buildHarness();
    const ownerSocket = createSocket(OWNER_SOCKET_ID, { id: OWNER_ID, username: 'Owner' });
    h.roomSessionManager.getRoomSession.mockReturnValue(
      createPartialMock<NamespaceSession>({ roomId: ROOM_ID, userId: OWNER_ID }),
    );
    h.roomLifecycleService.getRoom.mockResolvedValue(undefined);

    await h.handler.handleApprovalResponse(ownerSocket, { userId: TARGET_ID, approved: true }, h.roomNamespace);

    expect(ownerSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Room not found' }),
    );
  });

  it('rejects when the target user has no approval session', async () => {
    const h = buildHarness();
    const ownerSocket = createSocket(OWNER_SOCKET_ID, { id: OWNER_ID, username: 'Owner' });
    h.roomSessionManager.getRoomSession.mockReturnValue(
      createPartialMock<NamespaceSession>({ roomId: ROOM_ID, userId: OWNER_ID }),
    );
    h.approvalSessionManager.getApprovalSessionByUserId.mockReturnValue(undefined);

    await h.handler.handleApprovalResponse(ownerSocket, { userId: TARGET_ID, approved: true }, h.roomNamespace);

    expect(ownerSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'No approval session found', userId: TARGET_ID }),
    );
    expect(h.roomMembershipService.approveMember).not.toHaveBeenCalled();
    expect(h.roomNamespace.emit).not.toHaveBeenCalled();
  });

  it('approve broadcasts APPROVAL_GRANTED + USER_JOINED + ROOM_STATE_UPDATED and confirms the owner', async () => {
    const ownerSocket = createSocket(OWNER_SOCKET_ID, { id: OWNER_ID, username: 'Owner' });
    const targetSocket = createSocket(TARGET_SOCKET_ID, { id: TARGET_ID, username: 'Target' });
    const h = buildHarness({
      roomSockets: new Map([[OWNER_SOCKET_ID, ownerSocket]]),
      approvalSockets: new Map([[TARGET_SOCKET_ID, targetSocket]]),
    });
    const targetSession: ApprovalSession = {
      roomId: ROOM_ID,
      userId: TARGET_ID,
      username: 'Target',
      role: 'band_member',
      requestedAt: new Date('2026-08-15T12:00:00.000Z'),
    };
    h.roomSessionManager.getRoomSession.mockReturnValue(
      createPartialMock<NamespaceSession>({ roomId: ROOM_ID, userId: OWNER_ID }),
    );
    h.approvalSessionManager.getApprovalSessionByUserId.mockReturnValue(targetSession);
    h.approvalSessionManager.getApprovalSession.mockImplementation((socketId: string) =>
      socketId === TARGET_SOCKET_ID ? targetSession : undefined,
    );

    await h.handler.handleApprovalResponse(ownerSocket, { userId: TARGET_ID, approved: true }, h.roomNamespace);

    // Exact event names from the shared constants: 'approval_granted',
    // 'user_joined', 'room:state_updated', 'approval_success'.
    expect(targetSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_GRANTED,
      expect.objectContaining({ message: 'Welcome to the room! You are now a band member.' }),
    );
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.USER_JOINED,
      expect.objectContaining<{ user: unknown }>({ user: expect.objectContaining({ id: TARGET_ID }) }),
    );
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_STATE_UPDATED,
      expect.objectContaining<{ room: unknown }>({ room: expect.objectContaining({ id: ROOM_ID }) }),
    );
    expect(ownerSocket.emit).toHaveBeenCalledWith(
      APPROVAL_BE_EVENTS.APPROVAL_SUCCESS,
      expect.objectContaining({ userId: TARGET_ID }),
    );
    expect(h.approvalSessionManager.removeApprovalSessionByUserId).toHaveBeenCalledWith(TARGET_ID);
  });

  it('reject flow emits MEMBER_DENIED to the target and ROOM_STATE_UPDATED to the room', async () => {
    const ownerSocket = createSocket(OWNER_SOCKET_ID, { id: OWNER_ID, username: 'Owner' });
    const targetSocket = createSocket(TARGET_SOCKET_ID, { id: TARGET_ID, username: 'Target' });
    const h = buildHarness({
      roomSockets: new Map([[OWNER_SOCKET_ID, ownerSocket]]),
      approvalSockets: new Map([[TARGET_SOCKET_ID, targetSocket]]),
    });
    const targetSession: ApprovalSession = {
      roomId: ROOM_ID,
      userId: TARGET_ID,
      username: 'Target',
      role: 'band_member',
      requestedAt: new Date('2026-08-15T12:00:00.000Z'),
    };
    h.roomSessionManager.getRoomSession.mockReturnValue(
      createPartialMock<NamespaceSession>({ roomId: ROOM_ID, userId: OWNER_ID }),
    );
    h.approvalSessionManager.getApprovalSessionByUserId.mockReturnValue(targetSession);
    h.approvalSessionManager.getApprovalSession.mockImplementation((socketId: string) =>
      socketId === TARGET_SOCKET_ID ? targetSession : undefined,
    );

    await h.handler.handleApprovalResponse(
      ownerSocket,
      { userId: TARGET_ID, approved: false, message: 'Not this time' },
      h.roomNamespace,
    );

    expect(h.roomMembershipService.rejectMember).toHaveBeenCalledWith(ROOM_ID, TARGET_ID);
    expect(targetSocket.emit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.MEMBER_DENIED, { message: 'Not this time' });
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.ROOM_STATE_UPDATED,
      expect.objectContaining<{ room: unknown }>({ room: expect.objectContaining({ id: ROOM_ID }) }),
    );
    expect(ownerSocket.emit).toHaveBeenCalledWith(
      APPROVAL_BE_EVENTS.APPROVAL_SUCCESS,
      expect.objectContaining({ message: 'User rejected successfully' }),
    );
    expect(h.approvalSessionManager.removeApprovalSessionByUserId).toHaveBeenCalledWith(TARGET_ID);
  });

  // ------------------------------------------------------------------
  // Cancel (handleApprovalCancel) — anti-spoof cross-checks
  // ------------------------------------------------------------------

  it('cancels when the approval session matches the token identity and the roomId', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });

    await h.handler.handleApprovalCancel(requesterSocket, { userId: REQUESTER_ID, roomId: ROOM_ID }, h.approvalNamespace);

    expect(h.roomMembershipService.rejectMember).toHaveBeenCalledWith(ROOM_ID, REQUESTER_ID);
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED,
      expect.objectContaining({ userId: REQUESTER_ID, message: 'User cancelled their join request' }),
    );
    expect(requesterSocket.emit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.APPROVAL_CANCELLED, {
      message: 'Your request has been cancelled',
    });
    expect(h.approvalSessionManager.removeApprovalSession).toHaveBeenCalledWith(REQUESTER_SOCKET_ID);
    expect(requesterSocket.disconnect).toHaveBeenCalled();
  });

  it('rejects cancel when the session userId does not match the token identity (anti-spoof)', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.approvalSessionManager.getApprovalSession.mockReturnValue({ ...APPROVAL_SESSION, userId: 'other-user' });

    await h.handler.handleApprovalCancel(requesterSocket, { userId: REQUESTER_ID, roomId: ROOM_ID }, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Invalid cancellation request' }),
    );
    expect(h.roomMembershipService.rejectMember).not.toHaveBeenCalled();
    expect(requesterSocket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects cancel when the session roomId does not match the payload roomId (anti-spoof)', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.approvalSessionManager.getApprovalSession.mockReturnValue({ ...APPROVAL_SESSION, roomId: 'other-room' });

    await h.handler.handleApprovalCancel(requesterSocket, { userId: REQUESTER_ID, roomId: ROOM_ID }, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'Invalid cancellation request' }),
    );
    expect(h.roomMembershipService.rejectMember).not.toHaveBeenCalled();
    expect(requesterSocket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects cancel when there is no approval session', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.approvalSessionManager.getApprovalSession.mockReturnValue(undefined);

    await h.handler.handleApprovalCancel(requesterSocket, { userId: REQUESTER_ID, roomId: ROOM_ID }, h.approvalNamespace);

    expect(requesterSocket.emit).toHaveBeenCalledWith(
      APPROVAL_EVENTS.APPROVAL_ERROR,
      expect.objectContaining({ message: 'No approval session found' }),
    );
    expect(h.roomMembershipService.rejectMember).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Timeout / disconnect cleanup
  // ------------------------------------------------------------------

  it('timeout removes the pending member and notifies owner and waiting user', async () => {
    const waitingSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    const h = buildHarness({ approvalSockets: new Map([[REQUESTER_SOCKET_ID, waitingSocket]]) });

    await h.handler.handleApprovalTimeout(REQUESTER_SOCKET_ID, APPROVAL_SESSION);

    expect(h.roomMembershipService.rejectMember).toHaveBeenCalledWith(ROOM_ID, REQUESTER_ID);
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED,
      expect.objectContaining({ message: 'Approval request timed out' }),
    );
    expect(waitingSocket.emit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.APPROVAL_TIMEOUT, {
      message: 'Your approval request has timed out',
    });
    expect(waitingSocket.disconnect).toHaveBeenCalled();
    expect(h.approvalSessionManager.removeApprovalSession).toHaveBeenCalledWith(REQUESTER_SOCKET_ID);
  });

  it('disconnect removes the pending member and notifies the room owner', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });

    await h.handler.handleApprovalDisconnect(requesterSocket);

    expect(h.roomMembershipService.rejectMember).toHaveBeenCalledWith(ROOM_ID, REQUESTER_ID);
    expect(h.roomNamespace.emit).toHaveBeenCalledWith(
      ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED,
      expect.objectContaining({ message: 'User disconnected' }),
    );
    expect(h.approvalSessionManager.removeApprovalSession).toHaveBeenCalledWith(REQUESTER_SOCKET_ID);
  });

  it('disconnect without an approval session is a no-op', async () => {
    const h = buildHarness();
    const requesterSocket = createSocket(REQUESTER_SOCKET_ID, { id: REQUESTER_ID, username: null });
    h.approvalSessionManager.getApprovalSession.mockReturnValue(undefined);

    await h.handler.handleApprovalDisconnect(requesterSocket);

    expect(h.roomMembershipService.rejectMember).not.toHaveBeenCalled();
    expect(h.roomNamespace.emit).not.toHaveBeenCalled();
    expect(h.approvalSessionManager.removeApprovalSession).not.toHaveBeenCalled();
  });
});
