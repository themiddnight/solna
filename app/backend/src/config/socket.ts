/**
 * Socket.IO Server Configuration with Redis Adapter Support
 * 
 * When clustering is isEnabled, uses Redis adapter for cross-process messaging.
 * Falls back to in-memory adapter when Redis is not available.
 */
import type { Socket } from 'socket.io';
import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient, getRedisSubscriber, isRedisAvailable } from './redis';
import { getClusterConfig, getWorkerId } from './cluster';
import { config } from './environment';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { createSocketConnectionError, decorateSocketErrorEmits } from '../shared/infrastructure/socket/socketErrors';
import { arrangeRoomStateService } from '../domains/arrange-room/application/ArrangeRoomStateService';
import { performRoomStateService } from '../domains/perform-room/application/PerformRoomStateService';
import { tokenService } from '../domains/auth/domain/services/TokenService';
import { UserRepository } from '../domains/auth/infrastructure/repositories/UserRepository';
import { roomUserRepository } from '../domains/room-management/infrastructure/repositories/RoomUserRepository';
import { isRoomNamespace, isApprovalNamespace, extractRoomIdFromNamespace, extractRoomIdFromApprovalNamespace } from '@jam-band/shared';
import type { GracePeriodEntry } from '../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { AuthUserModel } from '../domains/auth/domain/models/User';
import { CacheService } from '../shared/infrastructure/caching/CacheService';
import { CACHE_KEYS } from '../shared/constants/CacheKeys';
import { PhaseTimer } from '../shared/infrastructure/profiling/PhaseTimer';

/**
 * Projection of an authenticated (or guest) user stored on socket.data; cached briefly per userId.
 * `userType` is the UserType enum value for registered users, or 'GUEST' for guest tokens.
 */
export interface SocketAuthUser {
  id: string;
  email: string | null;
  username: string | null;
  userType: AuthUserModel['userType'] | 'GUEST';
  emailVerified: boolean;
  // Identity-derived display data sourced from the DB (null for guests). Room handlers use this
  // as the authoritative profile picture so it survives an in-room identity swap and can never
  // be spoofed via the client join payload (TR-33).
  profilePictureUrl: string | null;
}

/** TTL (seconds) for the per-connection user cache — short so username/userType changes self-heal. */
const SOCKET_AUTH_USER_CACHE_TTL_S = 60;

// Reuse one repository instance instead of `new UserRepository()` on every connection.
const socketAuthUserRepository = new UserRepository();

/**
 * Resolve the verified user (registered or guest) from the socket handshake token (DEV-179).
 * Returns null when no/invalid token is presented. Guest tokens carry identity in their JWT
 * claims (no DB row), so they skip the DB lookup; registered users use a short-lived cache.
 */
const resolveSocketUser = async (socket: Socket): Promise<SocketAuthUser | null> => {
  const authToken = (socket.handshake.auth as Record<string, unknown>).token;
  const headerToken = socket.handshake.headers.authorization?.split(' ')[1];
  const tokenRaw = typeof authToken === 'string' && authToken !== '' ? authToken : (headerToken ?? '');
  if (tokenRaw === '') {
    return null;
  }

  let payload;
  try {
    payload = tokenService.verifyToken(String(tokenRaw));
  } catch {
    return null;
  }

  // Guest token — identity is in the JWT claims; no DB row exists.
  if (payload.type === 'guest' || payload.userType === 'GUEST') {
    return {
      id: payload.userId,
      email: null,
      username: payload.username ?? null,
      userType: 'GUEST',
      emailVerified: false,
      profilePictureUrl: null,
    };
  }

  // Registered user — cached projection (short TTL so changes self-heal).
  const cache = CacheService.getInstance();
  const cacheKey = CACHE_KEYS.socketAuthUser(payload.userId);
  let authUser = cache.get<SocketAuthUser>(cacheKey);
  if (!authUser) {
    const user = await socketAuthUserRepository.findById(payload.userId);
    if (user) {
      authUser = {
        id: user.id,
        email: user.email,
        username: user.username,
        userType: user.userType,
        emailVerified: user.emailVerified,
        profilePictureUrl: user.profilePictureUrl,
      };
      cache.set(cacheKey, authUser, SOCKET_AUTH_USER_CACHE_TTL_S);
    }
  }
  // OTP hard gate (mirrors authenticateToken): an unverified registered identity is never
  // admitted, so no namespace ever sees one in socket.data.user.
  if (authUser && authUser.userType === 'REGISTERED' && !authUser.emailVerified) {
    return null;
  }

  // Assign a fresh copy so per-socket data isn't a shared cache reference.
  return authUser ? { ...authUser } : null;
};

/**
 * Strict socket auth middleware (DEV-179): rejects connections without a valid token and sets
 * socket.data.user from the verified identity. Attached to every namespace the client connects
 * to (lobby, room, approval) so identity can never be asserted by the client payload.
 */
export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  decorateSocketErrorEmits(socket);
  const user = await resolveSocketUser(socket);
  if (!user) {
    next(createSocketConnectionError('Authentication required'));
    return;
  }
  (socket.data as Record<string, unknown>).user = user;
  next();
};

/**
 * Dependencies injected into createDynamicNamespaceMiddleware.
 * Using injection instead of dynamic require() to avoid module initialization
 * race conditions (root cause analysis: MIDD-54).
 */
export interface DynamicNamespaceDeps {
  /** Returns all users currently in grace period for the given room */
  getGracePeriodUsers: (roomId: string) => GracePeriodEntry[];
  /** Clears the in-memory grace period map for the given room */
  cleanupRoomGracePeriod: (roomId: string) => void;
  /** Clears the Redis project↔room mapping when a room is deleted */
  clearActiveRoomByRoomId: (roomId: string) => Promise<void>;
}

/**
 * Create dynamic namespace middleware to handle on-demand namespace creation
 * This allows clients to connect to rooms whose namespaces were cleaned up but still exist in Redis
 * Also cleans up orphaned rooms (rooms with no users)
 */

export const createDynamicNamespaceMiddleware = (_io: Server, roomRepository: { getRoom: (id: string) => Promise<unknown>; deleteRoom: (id: string) => Promise<boolean>; isInReconnectionWindow?: () => boolean }, deps: DynamicNamespaceDeps) => {
  return async (socket: Socket, next: (err?: Error) => void) => {
    decorateSocketErrorEmits(socket);

    // DEV-178: profile the connection-accept hot path when PROFILE_JOIN_PATH is enabled.
    const timer = new PhaseTimer(config.profiling.joinPath);

    // Authenticate first (DEV-179): every room/approval connection must carry a valid token
    // (registered or guest). Identity is set here and is never taken from the client payload.
    const authedUser = await resolveSocketUser(socket);
    timer.mark('auth');
    if (!authedUser) {
      return next(createSocketConnectionError('Authentication required'));
    }
    (socket.data as Record<string, unknown>).user = authedUser;

    const namespace = socket.nsp.name;

    // Only handle dynamic room and approval namespaces
    if (!isRoomNamespace(namespace) && !isApprovalNamespace(namespace)) {
      return next();
    }

    const roomId = extractRoomIdFromNamespace(namespace) || extractRoomIdFromApprovalNamespace(namespace);
    if (!roomId) {
      return next();
    }

    const isApproval = isApprovalNamespace(namespace);

    try {
      // Check if room exists. getRoom and getUserCount are independent Redis reads, so
      // issue them as a single parallel round-trip instead of two sequential awaits — one
      // fewer network RTT per room connection on the connect-accept hot path (DEV-178
      // profiling: getRoom was the dominant connect-phase cost). getUserCount fail-opens to
      // 0 for a missing room, which is harmless since we return early when room == null.
      const [room, totalUsers] = await Promise.all([
        roomRepository.getRoom(roomId),
        roomUserRepository.getUserCount(roomId),
      ]);
      timer.mark('getRoom');

      if (room == null) {
        loggingService.logInfo('Dynamic namespace: Room not isFound, rejecting connection', {
          namespace,
          roomId,
          socketId: socket.id
        });

        // Clear stale project-room mapping to prevent repeated navigation to deleted rooms
        await deps.clearActiveRoomByRoomId(roomId).catch(() => {});

        return next(createSocketConnectionError('Room not found', { roomId }));
      }

      // Detect orphaned rooms. totalUsers (from getUserCount above) reads Redis — on Redis
      // error it returns 0 (fail-open), so we add a second independent guard:
      // socket.nsp.sockets.size counts currently-connected sockets in this namespace from
      // in-process memory, bypassing Redis entirely.
      const connectedSocketsInNamespace = socket.nsp.sockets.size;
      const gracePeriodUsers = deps.getGracePeriodUsers(roomId);
      timer.mark('ghostCheck');

      // Don't delete newly created rooms — give the owner time to connect
      const roomAgeMs = Date.now() - new Date((room as Record<string, unknown> & { createdAt?: string }).createdAt ?? 0).getTime();
      const ROOM_GRACE_PERIOD_MS = 30_000; // 30 seconds

      // Don't delete rooms during reconnection window after server restart
      // Users may still be reconnecting and their membership data is preserved in Redis
      const isInReconnectionWindow = roomRepository.isInReconnectionWindow?.() ?? false;

      if (totalUsers === 0 && connectedSocketsInNamespace === 0 && gracePeriodUsers.length === 0 && roomAgeMs > ROOM_GRACE_PERIOD_MS && !isInReconnectionWindow) {
        loggingService.logInfo('Dynamic namespace: Detected orphaned room, cleaning up', {
          namespace,
          roomId,
          socketId: socket.id,
        });

        try {
          await roomRepository.deleteRoom(roomId);
          deps.cleanupRoomGracePeriod(roomId);

          // Clear Redis project↔room mapping to maintain 1 project : 1 room rule
          await deps.clearActiveRoomByRoomId(roomId).catch((dbError: unknown) => {
            loggingService.logError(dbError instanceof Error ? dbError : new Error(String(dbError)), {
              context: 'DynamicNamespaceMiddleware.clearActiveRoom',
              roomId,
            });
          });

          await performRoomStateService.deleteState(roomId).catch((stateError: unknown) => {
            loggingService.logError(stateError instanceof Error ? stateError : new Error(String(stateError)), {
              context: 'DynamicNamespaceMiddleware.performStateCleanup',
              roomId,
            });
          });

          await arrangeRoomStateService.deleteState(roomId).catch((stateError: unknown) => {
            loggingService.logError(stateError instanceof Error ? stateError : new Error(String(stateError)), {
              context: 'DynamicNamespaceMiddleware.arrangeStateCleanup',
              roomId,
            });
          });

          loggingService.logInfo('Dynamic namespace: Deleted orphaned room', {
            namespace,
            roomId,
            socketId: socket.id,
          });
          timer.mark('orphanCleanup');
        } catch (cleanupError) {
          loggingService.logError(
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
            {
              context: 'DynamicNamespaceMiddleware.cleanup',
              namespace,
              roomId,
            }
          );
        }

        timer.flush('socket.connect.namespace', { namespace, roomId, outcome: 'orphan-cleanup' });
        return next(createSocketConnectionError('Room not found', { roomId }));
      }

      // Room exists, allow connection
      // The namespace will be created automatically by Socket.IO if it doesn't exist
      loggingService.logInfo('Dynamic namespace: Room exists, allowing connection', {
        namespace,
        roomId,
        socketId: socket.id,
        isApproval,
        userCount: totalUsers
      });

      timer.flush('socket.connect.namespace', { namespace, roomId, outcome: 'allowed', userCount: totalUsers });
      next();
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          context: 'DynamicNamespaceMiddleware',
          namespace,
          roomId
        }
      );
      next(createSocketConnectionError('Failed to verify room existence', { roomId }));
    }
  };
};

export const createSocketServer = async (httpServer: HttpServer, roomRepository: { getRoom: (id: string) => Promise<unknown>; deleteRoom: (id: string) => Promise<boolean>; isInReconnectionWindow?: () => boolean },
 deps: DynamicNamespaceDeps): Promise<Server> => {
  const allowedOrigins = config.cors.allowedOrigins;
  const isWildcard = allowedOrigins.includes('*');

  // Clean up origins for Socket.IO (remove trailing slashes if present)
  const socketCorsOrigin = isWildcard
    ? "*"
    : allowedOrigins.map((url: string) => url.replace(/\/$/, ''));

  loggingService.logInfo('Socket.IO CORS configuration', {
    origin: socketCorsOrigin,
    nodeEnv: config.nodeEnv,
    workerId: getWorkerId(),
  });

  const io = new Server(httpServer, {
    cors: {
      origin: config.nodeEnv === 'production'
        ? socketCorsOrigin
        : "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    pingInterval: 10000,
    pingTimeout: 10000,
    perMessageDeflate: false
  });

  // Setup Redis adapter whenever Redis is available (not just when clustering).
  // Using Redis adapter even in single-process mode ensures consistent behavior
  // and makes scaling to multiple workers seamless.
  try {
    const isRedisAvailableFlag = await isRedisAvailable();

    if (isRedisAvailableFlag) {
      const pubClient = await getRedisClient();
      const subClient = await getRedisSubscriber();

      io.adapter(createAdapter(pubClient, subClient));

      loggingService.logInfo('Socket.IO using Redis adapter', {
        workerId: getWorkerId(),
        clusteringEnabled: getClusterConfig().enabled,
      });
    } else {
      loggingService.logInfo('Redis not isAvailable, using in-memory adapter');

      if (getClusterConfig().enabled) {
        loggingService.logError(
          new Error('Clustering enabled but Redis not available — Socket.IO events will not sync across workers!'),
          { context: 'SocketConfig' }
        );
      }
    }
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
      context: 'SocketConfig',
      message: 'Failed to setup Redis adapter',
    });
  }

  // Main-namespace JWT middleware — lenient (sets user or null). The strict per-namespace gate
  // that rejects unauthenticated connections is `authenticateSocket`, attached to the lobby and
  // room/approval namespaces the client actually connects to (DEV-179).
  io.use(async (socket, next) => {
    decorateSocketErrorEmits(socket);
    (socket.data as Record<string, unknown>).user = await resolveSocketUser(socket);
    next();
  });

  // Add dynamic namespace middleware to handle on-demand namespace creation
  // This prevents "Invalid namespace" errors when namespaces are cleaned up but rooms still exist
  io.of(/^\/(room|approval)\/[a-f0-9-]+$/).use(createDynamicNamespaceMiddleware(io, roomRepository, deps));

  loggingService.logInfo('Socket.IO dynamic namespace middleware enabled', {
    pattern: '/^\\/(room|approval)\\/[a-f0-9-]+$/',
    workerId: getWorkerId()
  });

  return io;
};
