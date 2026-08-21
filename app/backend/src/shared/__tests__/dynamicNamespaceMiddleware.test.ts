/**
 * Unit Tests for Dynamic Namespace Middleware
 *
 * Tests the Socket.IO dynamic namespace middleware that verifies room existence
 * before allowing socket connections to room namespaces.
 *
 * This middleware was the source of the "Failed to verify room existence" bug.
 */

import { createDynamicNamespaceMiddleware } from '../../config/socket';
import { CORE_NAMESPACES, isRoomNamespace, isApprovalNamespace } from '@jam-band/shared';
import type { RoomRepository } from '../../domains/room-management/infrastructure/repositories/RoomRepository';
import type { Room } from '../../types';
import { RoomType } from '../../types';
import type { Socket, Server } from 'socket.io';

function createMockRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'abc123-def456',
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

// DEV-179: the dynamic namespace middleware now authenticates the socket first. Mock the
// token verifier so these tests can drive both the happy path (valid guest token) and the
// negative-auth paths (invalid/expired token → verifyToken throws, mirroring the real
// TokenService which throws on any bad token).
//
// `verifyTokenBehavior` is a plain mutable module variable (not a jest.fn) so jest.config's
// `resetMocks: true` can't wipe the implementation between tests. Each test reassigns it.
type VerifyTokenResult = { type: string; userId: string; username: string; userType: string };
let verifyTokenBehavior: () => VerifyTokenResult = () => ({
  type: 'guest',
  userId: 'guest:test',
  username: 'Guest',
  userType: 'GUEST',
});

jest.mock('../../domains/auth/domain/services/TokenService', () => ({
  tokenService: {
    verifyToken: () => verifyTokenBehavior(),
  },
}));

// Keep the room-existence happy path off Redis: getUserCount is fail-open (returns 0) so a
// real call wouldn't crash, but mocking it makes the "valid token" control test deterministic.
jest.mock('../../domains/room-management/infrastructure/repositories/RoomUserRepository', () => ({
  roomUserRepository: {
    getUserCount: () => Promise.resolve(0),
  },
}));

// Token behavior matching the real TokenService: throws on any invalid/expired/garbage token.
const VALID_GUEST_TOKEN: () => VerifyTokenResult = () => ({
  type: 'guest',
  userId: 'guest:test',
  username: 'Guest',
  userType: 'GUEST',
});
const THROWING_TOKEN: () => VerifyTokenResult = () => {
  throw new Error('Invalid or expired token');
};

// Mock Server and Socket for testing
class MockServer {
  private readonly namespaces: Map<string, { use: jest.Mock }> = new Map();

  of(nameOrRegex: string | RegExp) {
    const key = typeof nameOrRegex === 'string' ? nameOrRegex : nameOrRegex.toString();
    if (!this.namespaces.has(key)) {
      this.namespaces.set(key, {
        use: jest.fn(),
      });
    }
    return this.namespaces.get(key);
  }
}

class MockSocket {
  public nsp: { name: string; sockets: Map<string, unknown> };
  public id: string;
  public data: Record<string, unknown> = {};
  // DEV-179: socket auth reads the token from the handshake. `token` is configurable so
  // negative-auth tests can simulate a missing token. Pass `null` to omit the token entirely
  // (an empty handshake.auth); a string sets that token; the default mints a valid guest token.
  public handshake: { auth: Record<string, unknown>; headers: Record<string, string> };

  constructor(namespaceName: string, token: string | null = 'guest-token') {
    this.nsp = { name: namespaceName, sockets: new Map() };
    this.id = `socket-${Math.random().toString(36).substring(7)}`;
    this.handshake = {
      auth: token !== null ? { token } : {},
      headers: {},
    };
  }
}

describe('Dynamic Namespace Middleware - Unit Tests', () => {
  let mockServer: MockServer;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockDeps: { getGracePeriodUsers: jest.Mock; cleanupRoomGracePeriod: jest.Mock; clearActiveRoomByRoomId: jest.Mock };
  let middleware: ReturnType<typeof createDynamicNamespaceMiddleware>;

  beforeEach(() => {
    // Default every test to a valid token; negative-auth tests opt into THROWING_TOKEN.
    verifyTokenBehavior = VALID_GUEST_TOKEN;

    mockServer = new MockServer();

    // Mock RoomRepository
    mockRoomRepository = {
      getRoom: jest.fn(),
      deleteRoom: jest.fn(),
    } as unknown as jest.Mocked<RoomRepository>;

    // Mock deps (injected dependencies — replaces dynamic require())
    mockDeps = {
      getGracePeriodUsers: jest.fn().mockReturnValue([]),
      cleanupRoomGracePeriod: jest.fn(),
      clearActiveRoomByRoomId: jest.fn().mockResolvedValue(undefined),
    };

    // Create middleware
    middleware = createDynamicNamespaceMiddleware(mockServer as unknown as Server, mockRoomRepository, mockDeps);

    // Mock console logs to reduce noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Non-Dynamic Namespaces', () => {
    it('should allow connection to non-dynamic namespaces without checking', async () => {
      const mockSocket = new MockSocket(CORE_NAMESPACES.LOBBY);
      const next = jest.fn();

      await middleware(mockSocket as unknown as Socket, next);

      expect(next).toHaveBeenCalledWith(); // Called with no error
    });

    it('should allow connection to root namespace', async () => {
      const mockSocket = new MockSocket('/');
      const next = jest.fn();

      await middleware(mockSocket as unknown as Socket, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow connection to other namespaces like /lobby-monitor', async () => {
      const mockSocket = new MockSocket(CORE_NAMESPACES.LOBBY_MONITOR);
      const next = jest.fn();

      await middleware(mockSocket as unknown as Socket, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('Namespace Pattern Matching', () => {
    it('should match valid room namespace patterns', () => {
      const validPatterns = [
        '/room/abc123-def456', // Valid hex with numbers and dash
        '/room/0123456789abcdef', // All hex chars
        '/room/aaaa-bbbb-cccc-dddd-eeee', // Lowercase with dashes
      ];

      validPatterns.forEach(pattern => {
        expect(isRoomNamespace(pattern)).toBe(true);
      });
    });

    it('should match valid approval namespace patterns', () => {
      const validPatterns = [
        '/approval/550e8400-e29b-41d4-a716-446655440000',
        '/approval/abc123-def456',
      ];

      validPatterns.forEach(pattern => {
        expect(isApprovalNamespace(pattern)).toBe(true);
      });
    });

    it('should NOT match invalid namespace patterns', () => {
      const invalidPatterns = [
        '/room/', // Missing ID
        '/room/INVALID-CAPS', // Contains uppercase
        '/room/has spaces', // Contains spaces
        '/invalid/room-id', // Wrong namespace
      ];

      invalidPatterns.forEach(pattern => {
        expect(isRoomNamespace(pattern)).toBe(false);
        expect(isApprovalNamespace(pattern)).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty room ID gracefully', async () => {
      const mockSocket = new MockSocket('/room/');
      const next = jest.fn();

      await middleware(mockSocket as unknown as Socket, next);

      // Should allow (not a dynamic namespace match)
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle malformed namespace paths', async () => {
      const malformedPaths = [
        '/room//double-slash',
        '/room/../../escape',
        '/room/<script>xss</script>',
      ];

      for (const path of malformedPaths) {
        const mockSocket = new MockSocket(path);
        const next = jest.fn();

        await middleware(mockSocket as unknown as Socket, next);

        // Should either allow (no match) or reject safely
        expect(next).toHaveBeenCalled();
      }
    });
  });

  describe('Negative Auth - DEV-179', () => {
    // A valid room exists for all of these so the ONLY reason a connection is rejected is
    // authentication — proving "no socket can join a room without a valid JWT".
    const VALID_ROOM_NS = '/room/abc123-def456';

    // Typed `next` mock so `next.mock.calls[0][0]` is `Error | undefined` (no `any` access).
    const createNext = () => jest.fn<void, [Error?]>();

    beforeEach(() => {
      mockRoomRepository.getRoom.mockResolvedValue(createMockRoom());
    });

    it('rejects a room-namespace connection with NO token ("Authentication required")', async () => {
      verifyTokenBehavior = VALID_GUEST_TOKEN; // irrelevant: no token means verify is never reached
      const mockSocket = new MockSocket(VALID_ROOM_NS, null); // empty handshake.auth (no token)
      const next = createNext();

      await middleware(mockSocket as unknown as Socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]?.[0];
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toBe('Authentication required');
      // Auth runs before the room-existence check — no DB read happens.
      expect(mockRoomRepository.getRoom).not.toHaveBeenCalled();
    });

    it('rejects a room-namespace connection with an INVALID/garbage token', async () => {
      verifyTokenBehavior = THROWING_TOKEN; // verifyToken throws on garbage tokens
      const mockSocket = new MockSocket(VALID_ROOM_NS, 'garbage.not.a.jwt');
      const next = createNext();

      await middleware(mockSocket as unknown as Socket, next);

      const err = next.mock.calls[0]?.[0];
      expect(err?.message).toBe('Authentication required');
      expect(mockRoomRepository.getRoom).not.toHaveBeenCalled();
    });

    it('rejects a room-namespace connection with an EXPIRED token', async () => {
      // The real TokenService throws "Invalid or expired token" for expired JWTs, so the
      // expired case is indistinguishable from invalid at this boundary — both rejected.
      verifyTokenBehavior = THROWING_TOKEN;
      const mockSocket = new MockSocket(VALID_ROOM_NS, 'expired.jwt.token');
      const next = createNext();

      await middleware(mockSocket as unknown as Socket, next);

      const err = next.mock.calls[0]?.[0];
      expect(err?.message).toBe('Authentication required');
    });

    it('rejects an approval-namespace connection with an invalid token', async () => {
      verifyTokenBehavior = THROWING_TOKEN;
      const mockSocket = new MockSocket('/approval/abc123-def456', 'garbage');
      const next = createNext();

      await middleware(mockSocket as unknown as Socket, next);

      const err = next.mock.calls[0]?.[0];
      expect(err?.message).toBe('Authentication required');
    });

    it('allows a room-namespace connection with a valid token (control)', async () => {
      verifyTokenBehavior = VALID_GUEST_TOKEN;
      const mockSocket = new MockSocket(VALID_ROOM_NS, 'guest-token');
      const next = createNext();

      await middleware(mockSocket as unknown as Socket, next);

      // Valid token → no auth error; the room exists so the connection proceeds.
      expect(next).toHaveBeenCalledWith();
      // socket.data.user was populated from the verified token (identity from token, DEV-179).
      expect((mockSocket.data as { user?: { userType?: string } }).user?.userType).toBe('GUEST');
    });
  });

  describe('Regression - Bug Fix Verification', () => {
    it('should query room user counts from Redis sets (using roomUserRepository)', () => {
      const middlewareSource = createDynamicNamespaceMiddleware.toString();

      // Should contain roomUserRepository.getUserCount call
      expect(middlewareSource).toContain('roomUserRepository.getUserCount');
    });
  });
});
