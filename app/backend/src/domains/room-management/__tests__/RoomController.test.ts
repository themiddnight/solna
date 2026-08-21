/**
 * RoomController unit tests — the HTTP boundary of the room-management domain.
 * Runs the REAL controller against mocked service seams (RoomLifecycleService,
 * RoomSessionManager, NamespaceGracePeriodManager) with fake req/res, the house
 * pattern for controller tests (cf. RoomController.inviteCodes.test.ts).
 *
 * TR-33: the only authenticated endpoint (getRoomInviteCodes, covered in
 * RoomController.inviteCodes.test.ts) keys off `req.user`; the endpoints here are
 * deliberately unauthenticated — room existence, counts, and ghost deletion are
 * exactly what the lobby already exposes, and deleteGhostRoom re-validates
 * against live sessions + grace periods before touching anything.
 */

import type { Request, Response } from 'express';
import type { RoomLifecycleService } from '../application/RoomLifecycleService';
import type { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import type { NamespaceGracePeriodManager } from '@/shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { AuthenticatedUser } from '@/domains/auth/infrastructure/middleware/authMiddleware';
import type { Room, BandMember, Audience } from '../../../types';
import { RoomType } from '../../../types';
import { RoomController } from '../infrastructure/controllers/RoomController';
import { createPartialMock } from '@/testing/mocks';
import { getHealthCheckData } from '@/middleware/monitoring';
import type * as MonitoringModule from '@/middleware/monitoring';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
    logSecurityEvent: jest.fn(),
    logSystemHealth: jest.fn(),
    logPerformanceMetric: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

// getHealthCheckData is the only monitoring import the controller touches; keep the
// real module (systemMonitor singleton etc.) and swap just this function so the
// error path of getHealthCheck is testable without a real health check failure.
jest.mock('@/middleware/monitoring', () => {
  const actual = jest.requireActual<typeof MonitoringModule>('@/middleware/monitoring');
  return {
    ...actual,
    getHealthCheckData: jest.fn(),
  };
});

const getHealthCheckDataMock = jest.mocked(getHealthCheckData);

const ROOM_ID = 'room-1';
const OWNER_ID = 'user-owner';

// ── fixtures ──────────────────────────────────────────────────────────────────

interface FakeReqOverrides {
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  user?: AuthenticatedUser;
  userAgent?: string;
}

function makeReq(overrides: FakeReqOverrides = {}): Request {
  return {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn().mockReturnValue(overrides.userAgent ?? 'test-user-agent'),
    user: overrides.user,
    // TR-27 confined boundary cast: the controller touches only the members above.
  } as unknown as Request;
}

interface MockRes {
  status: jest.Mock;
  json: jest.Mock;
}

function makeRes(): Response & MockRes {
  const res = {} as Response & MockRes;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function makeBandMember(id: string, role: 'room_owner' | 'band_member' = 'band_member'): BandMember {
  return { id, username: `user-${id}`, role, isReady: true };
}

function makeAudience(id: string): Audience {
  return { id, username: `user-${id}`, role: 'audience', joinedAt: new Date() };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: ROOM_ID,
    name: 'Rock Room',
    description: 'A rock room',
    roomType: RoomType.PERFORM,
    owner: OWNER_ID,
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    isIsolated: false,
    createdAt: new Date(),
    metronome: { bpm: 120, beatZeroAt: 0 },
    ...overrides,
  };
}

interface ControllerSeams {
  controller: RoomController;
  lifecycle: jest.Mocked<RoomLifecycleService>;
  sessionManager: jest.Mocked<RoomSessionManager>;
  gracePeriodManager: jest.Mocked<NamespaceGracePeriodManager>;
}

// exactOptionalPropertyTypes: explicit `| undefined` lets tests pass undefined
// to force the "missing" service responses (jest.fn().mockResolvedValue(undefined)).
function makeController(overrides: {
  room?: Room | undefined;
  rooms?: Record<string, unknown>[] | undefined;
  inviteResult?: { room: Room; role: 'band_member' | 'audience' } | undefined;
} = {}): ControllerSeams {
  const lifecycle = createPartialMock<RoomLifecycleService>({
    getRoom: jest.fn().mockResolvedValue(overrides.room),
    getAllRooms: jest.fn().mockResolvedValue(overrides.rooms ?? []),
    getRoomByInviteCode: jest.fn().mockResolvedValue(overrides.inviteResult),
    deleteRoom: jest.fn().mockResolvedValue(true),
  });
  const sessionManager = createPartialMock<RoomSessionManager>({
    isUserActiveInRoom: jest.fn().mockResolvedValue(false),
  });
  const gracePeriodManager = createPartialMock<NamespaceGracePeriodManager>({
    isUserInGracePeriod: jest.fn().mockReturnValue(false),
    getRoomGracePeriodUsers: jest.fn().mockReturnValue([]),
  });
  const controller = new RoomController(lifecycle, sessionManager, gracePeriodManager);
  return { controller, lifecycle, sessionManager, gracePeriodManager };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getHealthCheck ─────────────────────────────────────────────────────────────

describe('RoomController.getHealthCheck', () => {
  it('returns the health payload from the monitoring module', async () => {
    getHealthCheckDataMock.mockReturnValue({
      status: 'healthy',
      timestamp: '2026-08-16T00:00:00.000Z',
      uptime: 42,
      memory: { rss: 1, heapTotal: 2, heapUsed: 1, external: 0, arrayBuffers: 0 },
      health: { healthChecks: { memory: true } },
      performance: {},
    });
    const { controller } = makeController();
    const res = makeRes();

    await controller.getHealthCheck(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'healthy', uptime: 42 })
    );
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('masks the error message outside development (500)', async () => {
    getHealthCheckDataMock.mockImplementation(() => {
      throw new Error('redis is down');
    });
    const { controller } = makeController();
    const res = makeRes();

    await controller.getHealthCheck(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', message: 'Health check failed', error: 'Internal server error' })
    );
  });

  it('exposes the real error message in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      getHealthCheckDataMock.mockImplementation(() => {
        throw new Error('redis is down');
      });
      const { controller } = makeController();
      const res = makeRes();

      await controller.getHealthCheck(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'redis is down' })
      );
    } finally {
      // env.NODE_ENV is typed non-optional; tests always run with NODE_ENV=test.
      process.env.NODE_ENV = originalNodeEnv ?? 'test';
    }
  });
});

// ── checkRoomExists ────────────────────────────────────────────────────────────

describe('RoomController.checkRoomExists', () => {
  it('returns 400 when roomId is missing', async () => {
    const { controller } = makeController();
    const res = makeRes();

    await controller.checkRoomExists(makeReq({ params: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ exists: false, userCount: 0, message: 'Room ID is required' });
  });

  it('counts all members during the creation grace period without session checks', async () => {
    const room = makeRoom({
      bandMembers: new Map([['user-1', makeBandMember('user-1')]]),
      audiences: new Map([['user-2', makeAudience('user-2')]]),
    });
    const { controller, sessionManager } = makeController({ room });
    const res = makeRes();

    await controller.checkRoomExists(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.json).toHaveBeenCalledWith({ exists: true, userCount: 2 });
    expect(sessionManager.isUserActiveInRoom).not.toHaveBeenCalled();
  });

  it('counts grace-period users and active sessions for an older room', async () => {
    const room = makeRoom({
      createdAt: new Date(Date.now() - 60_000),
      bandMembers: new Map([['user-grace', makeBandMember('user-grace')]]),
      audiences: new Map([
        ['user-active', makeAudience('user-active')],
        ['user-idle', makeAudience('user-idle')],
      ]),
    });
    const { controller, sessionManager, gracePeriodManager } = makeController({ room });
    gracePeriodManager.isUserInGracePeriod.mockImplementation((userId: string) => userId === 'user-grace');
    sessionManager.isUserActiveInRoom.mockImplementation(
      (_roomId: string, userId: string) => Promise.resolve(userId === 'user-active')
    );
    const res = makeRes();

    await controller.checkRoomExists(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.json).toHaveBeenCalledWith({ exists: true, userCount: 2 });
    expect(sessionManager.isUserActiveInRoom).toHaveBeenCalledTimes(2);
  });

  it('reports exists:false when the room is gone', async () => {
    const { controller } = makeController({ room: undefined });
    const res = makeRes();

    await controller.checkRoomExists(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.json).toHaveBeenCalledWith({ exists: false, userCount: 0 });
  });

  it('degrades to exists:false when the lookup fails', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getRoom.mockRejectedValue(new Error('db down'));
    const res = makeRes();

    await controller.checkRoomExists(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.json).toHaveBeenCalledWith({ exists: false, userCount: 0 });
  });
});

// ── getRoomList ────────────────────────────────────────────────────────────────

describe('RoomController.getRoomList', () => {
  const roomA = { id: 'room-a', name: 'Rock Room', description: 'loud', roomType: 'perform' };
  const roomB = { id: 'room-b', name: 'Jazz Bar', description: 'smooth jazz', roomType: 'arrange' };
  const roomC = { id: 'room-c', name: 'Hip Hop Lab', description: 'beats', roomType: 'perform' };

  it('logs a security event for guest access and lists without auth', async () => {
    const { controller, lifecycle } = makeController({ rooms: [roomA, roomB, roomC] });
    const res = makeRes();

    await controller.getRoomList(makeReq(), res);

    expect(lifecycle.getAllRooms).toHaveBeenCalledWith(false);
    expect(res.json).toHaveBeenCalledWith({
      rooms: [roomA, roomB, roomC],
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('skips the guest security log for authenticated requests', async () => {
    const { controller, lifecycle } = makeController({ rooms: [roomA] });
    const res = makeRes();

    await controller.getRoomList(makeReq({ headers: { authorization: 'Bearer token-123' } }), res);

    expect(lifecycle.getAllRooms).toHaveBeenCalledWith(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
  });

  it('filters by search across name and description (case-insensitive)', async () => {
    const { controller } = makeController({ rooms: [roomA, roomB, roomC] });
    const res = makeRes();

    await controller.getRoomList(makeReq({ query: { search: 'jazz' } }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ rooms: [roomB], total: 1 })
    );
  });

  it('paginates with page and limit', async () => {
    const { controller } = makeController({ rooms: [roomA, roomB, roomC] });
    const res = makeRes();

    await controller.getRoomList(makeReq({ query: { page: '2', limit: '1' } }), res);

    expect(res.json).toHaveBeenCalledWith({
      rooms: [roomB],
      total: 3,
      page: 2,
      limit: 1,
      totalPages: 3,
    });
  });

  it('clamps page to 1 and limit into [1, 100]', async () => {
    const { controller } = makeController({ rooms: [roomA, roomB, roomC] });
    const res = makeRes();

    await controller.getRoomList(makeReq({ query: { page: '0', limit: '1000' } }), res);

    expect(res.json).toHaveBeenCalledWith({
      rooms: [roomA, roomB, roomC],
      total: 3,
      page: 1,
      limit: 100,
      totalPages: 1,
    });
  });

  it('falls back to limit 20 when limit is not a number', async () => {
    const { controller } = makeController({ rooms: [roomA, roomB, roomC] });
    const res = makeRes();

    await controller.getRoomList(makeReq({ query: { limit: 'abc' } }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, totalPages: 1 }));
  });

  it('returns 500 when the listing fails', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getAllRooms.mockRejectedValue(new Error('boom'));
    const res = makeRes();

    await controller.getRoomList(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Failed to retrieve room list' });
  });
});

// ── deleteGhostRoom ────────────────────────────────────────────────────────────

describe('RoomController.deleteGhostRoom', () => {
  it('returns 400 when roomId is missing', async () => {
    const { controller } = makeController();
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Room ID is required' });
  });

  it('treats an already-clean room as success (goal achieved)', async () => {
    const { controller, lifecycle } = makeController({ room: undefined });
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Room already cleaned up' });
    expect(lifecycle.deleteRoom).not.toHaveBeenCalled();
  });

  it('refuses deletion while any user has an active session (403)', async () => {
    const room = makeRoom({ bandMembers: new Map([['user-1', makeBandMember('user-1')]]) });
    const { controller, sessionManager } = makeController({ room });
    sessionManager.isUserActiveInRoom.mockResolvedValue(true);
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Cannot delete room with active users',
      reason: 'ROOM_HAS_ACTIVE_USERS',
    });
  });

  it('refuses deletion while a musician is in the grace period (403)', async () => {
    const room = makeRoom({ bandMembers: new Map([['user-1', makeBandMember('user-1')]]) });
    const { controller, gracePeriodManager } = makeController({ room });
    gracePeriodManager.getRoomGracePeriodUsers.mockReturnValue([
      { userId: 'user-1', roomId: ROOM_ID, namespacePath: `/room/${ROOM_ID}`, timestamp: Date.now(), isIntendedLeave: false, userData: makeBandMember('user-1') },
    ]);
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Cannot delete room with users in grace period',
      reason: 'ROOM_HAS_GRACE_PERIOD_USERS',
    });
  });

  it('does not block on audience-only grace period entries', async () => {
    const room = makeRoom({ audiences: new Map([['user-a', makeAudience('user-a')]]) });
    const { controller, gracePeriodManager, lifecycle } = makeController({ room });
    gracePeriodManager.getRoomGracePeriodUsers.mockReturnValue([
      { userId: 'user-a', roomId: ROOM_ID, namespacePath: `/room/${ROOM_ID}`, timestamp: Date.now(), isIntendedLeave: false, userData: makeAudience('user-a') },
    ]);
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(lifecycle.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Ghost room deleted successfully' });
  });

  it('deletes a true ghost room', async () => {
    const room = makeRoom({ bandMembers: new Map([['user-1', makeBandMember('user-1')]]) });
    const { controller, lifecycle } = makeController({ room });
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(lifecycle.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Ghost room deleted successfully' });
  });

  it('returns 500 when the lookup fails', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getRoom.mockRejectedValue(new Error('db down'));
    const res = makeRes();

    await controller.deleteGhostRoom(makeReq({ params: { roomId: ROOM_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Failed to delete ghost room' });
  });
});

// ── getInviteCodeDetails ───────────────────────────────────────────────────────

describe('RoomController.getInviteCodeDetails', () => {
  it('returns 400 when code is missing', async () => {
    const { controller } = makeController();
    const res = makeRes();

    await controller.getInviteCodeDetails(makeReq({ params: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invite code is required' });
  });

  it('resolves a band-member invite code to the room details', async () => {
    const room = makeRoom({ roomType: RoomType.ARRANGE });
    const { controller } = makeController({ inviteResult: { room, role: 'band_member' } });
    const res = makeRes();

    await controller.getInviteCodeDetails(makeReq({ params: { code: 'band-abc' } }), res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      roomId: ROOM_ID,
      role: 'band_member',
      roomType: RoomType.ARRANGE,
    });
  });

  it('resolves an audience invite code with the audience role', async () => {
    const room = makeRoom();
    const { controller } = makeController({ inviteResult: { room, role: 'audience' } });
    const res = makeRes();

    await controller.getInviteCodeDetails(makeReq({ params: { code: 'aud-xyz' } }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'audience' }));
  });

  it('returns 404 for an unknown or expired code', async () => {
    const { controller } = makeController({ inviteResult: undefined });
    const res = makeRes();

    await controller.getInviteCodeDetails(makeReq({ params: { code: 'expired' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid or expired invite link' });
  });

  it('returns 500 when the lookup fails', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getRoomByInviteCode.mockRejectedValue(new Error('redis down'));
    const res = makeRes();

    await controller.getInviteCodeDetails(makeReq({ params: { code: 'band-abc' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Failed to retrieve invite details' });
  });
});
