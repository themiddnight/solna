/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { UserSession } from '../../../../types';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { CORE_NAMESPACES, isRoomNamespace, isApprovalNamespace } from '@jam-band/shared';
import { RedisStateService } from '../../../../shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '../../../../shared/constants/RedisKeys';
import type { PipelineOperation } from '../../../../shared/infrastructure/caching/RedisStateService';
import { OrphanSessionCleanupService } from './OrphanSessionCleanupService';

export interface NamespaceSession extends UserSession {
  socketId: string;
  namespacePath: string;
  connectedAt: Date;
  lastActivity: Date;
  /** Socket-level instrument cache (DEV-123) — in-memory only, never persisted to Redis */
  currentInstrument?: string;
  currentCategory?: string;
}

type SocketPresenceChecker = (session: NamespaceSession) => Promise<boolean>;

export class RoomSessionManager {
  /* eslint-disable @typescript-eslint/member-ordering */
  // Sessions organized by namespace type and room ID
  private readonly roomSessions = new Map<string, Map<string, NamespaceSession>>(); // roomId -> socketId -> session
  private readonly approvalSessions = new Map<string, Map<string, NamespaceSession>>(); // roomId -> socketId -> session
  private readonly lobbySessions = new Map<string, NamespaceSession>(); // socketId -> session

  // Reverse lookup: socketId -> session for quick access
  private readonly socketToSession = new Map<string, NamespaceSession>();

  // Redis service
  private readonly redisState = RedisStateService.getInstance();
  private readonly SESSION_TTL = 24 * 60 * 60; // 24 hours
  private socketPresenceChecker?: SocketPresenceChecker;

  // Collaborator extracted for TR-20 (see OrphanSessionCleanupService) — operates
  // on the SAME map instances (passed by reference) so its mutations are visible
  // here immediately, preserving the ghost-room-deadlock cleanup guarantees.
  private readonly orphanCleaner = new OrphanSessionCleanupService(
    this.redisState,
    this.roomSessions,
    this.approvalSessions,
    this.lobbySessions,
    this.socketToSession
  );

  constructor() {
    loggingService.logInfo('RoomSessionManager initialized');
  }

  setSocketPresenceChecker(checker: SocketPresenceChecker): void {
    this.socketPresenceChecker = checker;
  }

  // Redis Key Builders (delegated to REDIS_KEYS)
  private getSessionKey(socketId: string): string {
    return REDIS_KEYS.sessionSocket(socketId);
  }

  private getRoomSessionsKey(roomId: string): string {
    return REDIS_KEYS.sessionRoom(roomId);
  }

  private getApprovalSessionsKey(roomId: string): string {
    return REDIS_KEYS.sessionApproval(roomId);
  }

  private getUserSocketKey(userId: string): string {
    return REDIS_KEYS.sessionUser(userId);
  }

  private getLobbySessionsKey(): string {
    return REDIS_KEYS.SESSION_LOBBY;
  }

  /**
   * Set a room session for a user in a specific room namespace
   */
  async setRoomSession(roomId: string, socketId: string, session: UserSession): Promise<void> {
    if (!this.roomSessions.has(roomId)) {
      this.roomSessions.set(roomId, new Map());
    }

    const namespaceSession: NamespaceSession = {
      ...session,
      socketId,
      namespacePath: `/room/${roomId}`,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.roomSessions.get(roomId)!.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    // Sync to Redis using pipeline for efficiency (3 ops -> 1 network round-trip)
    try {
      await this.redisState.executePipeline([
        ['setEx', this.getSessionKey(socketId), this.SESSION_TTL, namespaceSession],
        ['hset', this.getRoomSessionsKey(roomId), socketId, namespaceSession],
        ['hset', this.getUserSocketKey(session.userId), roomId, socketId],
      ]);

      loggingService.logInfo('Set room session', {
        roomId,
        socketId,
        userId: session.userId,
        namespacePath: namespaceSession.namespacePath
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'setRoomSession',
        roomId,
        socketId,
        userId: session.userId
      });
      // Rollback memory state
      const roomSessions = this.roomSessions.get(roomId);
      if (roomSessions) {
        roomSessions.delete(socketId);
        if (roomSessions.size === 0) {
          this.roomSessions.delete(roomId);
        }
      }
      this.socketToSession.delete(socketId);
      throw error;
    }
  }

  /**
   * Set an approval session for a user requesting to join a private room
   */
  async setApprovalSession(roomId: string, socketId: string, session: UserSession): Promise<void> {
    if (!this.approvalSessions.has(roomId)) {
      this.approvalSessions.set(roomId, new Map());
    }

    const namespaceSession: NamespaceSession = {
      ...session,
      socketId,
      namespacePath: `/approval/${roomId}`,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.approvalSessions.get(roomId)!.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    // Sync to Redis using pipeline (2 ops -> 1 network round-trip)
    try {
      await this.redisState.executePipeline([
        ['setEx', this.getSessionKey(socketId), this.SESSION_TTL, namespaceSession],
        ['hset', this.getApprovalSessionsKey(roomId), socketId, namespaceSession],
      ]);

      loggingService.logInfo('Set approval session', {
        roomId,
        socketId,
        userId: session.userId,
        namespacePath: namespaceSession.namespacePath
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'setApprovalSession',
        roomId,
        socketId,
        userId: session.userId
      });
      // Rollback memory state
      const approvalSessions = this.approvalSessions.get(roomId);
      if (approvalSessions) {
        approvalSessions.delete(socketId);
        if (approvalSessions.size === 0) {
          this.approvalSessions.delete(roomId);
        }
      }
      this.socketToSession.delete(socketId);
      throw error;
    }
  }

  /**
   * Set a lobby session for latency monitoring
   */
  async setLobbySession(socketId: string, userId: string): Promise<void> {
    const namespaceSession: NamespaceSession = {
      roomId: 'lobby',
      userId,
      socketId,
      namespacePath: CORE_NAMESPACES.LOBBY_MONITOR,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.lobbySessions.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    // Sync to Redis using pipeline (2 ops -> 1 network round-trip)
    try {
      await this.redisState.executePipeline([
        ['setEx', this.getSessionKey(socketId), this.SESSION_TTL, namespaceSession],
        ['hset', this.getLobbySessionsKey(), socketId, namespaceSession],
      ]);

      loggingService.logInfo('Set lobby session', {
        socketId,
        userId,
        namespacePath: namespaceSession.namespacePath
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'setLobbySession',
        socketId,
        userId
      });
      // Rollback memory state
      this.lobbySessions.delete(socketId);
      this.socketToSession.delete(socketId);
      throw error;
    }
  }

  /**
   * Get room sessions for a specific room
   */
  getRoomSessions(roomId: string): Map<string, NamespaceSession> {
    return this.roomSessions.get(roomId) ?? new Map<string, NamespaceSession>();
  }

  /**
   * Get approval sessions for a specific room
   */
  getApprovalSessions(roomId: string): Map<string, NamespaceSession> {
    return this.approvalSessions.get(roomId) ?? new Map<string, NamespaceSession>();
  }

  /**
   * Get a session by socket ID (works across all namespace types)
   */
  getSession(socketId: string): NamespaceSession | undefined {
    const session = this.socketToSession.get(socketId);
    if (session) {
      // Update last activity
      session.lastActivity = new Date();

      // Update Redis TTL periodically if needed (omitted here to avoid excessive writes)
      // but if we were strict, we would refresh the key's TTL
    }
    return session;
  }

  /**
   * Get room session by socket ID
   */
  getRoomSession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return (session != null && isRoomNamespace(session.namespacePath)) ? session : undefined;
  }

  /**
   * Get a room session from Redis by socket ID — cross-process fallback.
   * Used when the in-memory session map is stale (e.g. after socket reconnection
   * assigns a new socket.id that was previously registered in Redis).
   */
  async getRoomSessionFromRedis(socketId: string): Promise<NamespaceSession | undefined> {
    try {
      const session = await this.redisState.get<NamespaceSession>(this.getSessionKey(socketId));
      if (!session) return undefined;
      if (!isRoomNamespace(session.namespacePath)) return undefined;

      loggingService.logInfo('Restored room session from Redis', {
        socketId,
        roomId: session.roomId,
        userId: session.userId,
        namespacePath: session.namespacePath,
      });

      // Restore the in-memory session so subsequent in-memory lookups succeed
      if (!this.roomSessions.has(session.roomId)) {
        this.roomSessions.set(session.roomId, new Map());
      }
      this.roomSessions.get(session.roomId)!.set(socketId, session);
      this.socketToSession.set(socketId, session);

      return session;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'getRoomSessionFromRedis',
        socketId,
      });
      return undefined;
    }
  }

  /**
   * Get approval session by socket ID
   */
  getApprovalSession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return (session != null && isApprovalNamespace(session.namespacePath)) ? session : undefined;
  }

  /**
   * Get lobby session by socket ID
   */
  getLobbySession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return session?.namespacePath === CORE_NAMESPACES.LOBBY_MONITOR ? session : undefined;
  }

  /**
   * Remove a session by socket ID
   */
  async removeSession(socketId: string): Promise<boolean> {
    const session = this.socketToSession.get(socketId);
    if (!session) {
      return false;
    }

    // Remove from appropriate namespace map
    if (isRoomNamespace(session.namespacePath)) {
      const roomId = session.roomId;
      const roomSessions = this.roomSessions.get(roomId);
      if (roomSessions) {
        roomSessions.delete(socketId);
        if (roomSessions.size === 0) {
          this.roomSessions.delete(roomId);
        }
      }
    } else if (isApprovalNamespace(session.namespacePath)) {
      const roomId = session.roomId;
      const approvalSessions = this.approvalSessions.get(roomId);
      if (approvalSessions) {
        approvalSessions.delete(socketId);
        if (approvalSessions.size === 0) {
          this.approvalSessions.delete(roomId);
        }
      }
    } else if (session.namespacePath === CORE_NAMESPACES.LOBBY_MONITOR) {
      this.lobbySessions.delete(socketId);
    }

    // Remove from reverse lookup first so the session is gone from memory regardless of Redis
    this.socketToSession.delete(socketId);

    // Sync remove to Redis using pipeline (variable ops -> 1 network round-trip)
    const pipelineOps: PipelineOperation[] = [
      ['del', this.getSessionKey(socketId)],
    ];

    if (session.roomId !== '') {
      pipelineOps.push(['hdel', this.getRoomSessionsKey(session.roomId), socketId]);

      const currentSocketId = await this.redisState.hget<string>(this.getUserSocketKey(session.userId), session.roomId);
      if (currentSocketId === socketId) {
        pipelineOps.push(['hdel', this.getUserSocketKey(session.userId), session.roomId || '']);
      } else {
        loggingService.logInfo('Skipping user-socket mapping deletion for replaced session in Redis', {
          userId: session.userId,
          roomId: session.roomId,
          socketId,
          currentSocketId
        });
      }
    }

    try {
      await this.redisState.executePipeline(pipelineOps);
    } catch (err) {
      loggingService.logError(err as Error, { context: 'removeSession', socketId });
      // Memory is already cleaned up — log the failure but don't re-insert
    }

    loggingService.logInfo('Removed session', {
      socketId,
      userId: session.userId,
      roomId: session.roomId,
      namespacePath: session.namespacePath
    });

    return true;
  }

  /**
   * Remove all sessions for a specific room (both room and approval sessions)
   */
  cleanupRoomSessions(roomId: string): void {
    // Clean up room sessions
    const roomSessions = this.roomSessions.get(roomId);
    if (roomSessions) {
      for (const socketId of roomSessions.keys()) {
        this.socketToSession.delete(socketId);
      }
      this.roomSessions.delete(roomId);
    }

    // Clean up approval sessions
    const approvalSessions = this.approvalSessions.get(roomId);
    if (approvalSessions) {
      for (const socketId of approvalSessions.keys()) {
        this.socketToSession.delete(socketId);
      }
      this.approvalSessions.delete(roomId);
    }

    // Sync cleanup to Redis
    // Note: We should ideally lookup all sockets in these rooms and delete their individual session keys too
    // but for now we just clear the room hashes. The individual socket keys will expire by TTL.
    void this.redisState.delete(this.getRoomSessionsKey(roomId));
    void this.redisState.delete(this.getApprovalSessionsKey(roomId));

    // Also need to clean up user->socket mappings? 
    // This is trickier without iterating. TTL will handle it eventually.
    loggingService.logInfo('Cleaned up room sessions', {
      roomId,
      roomSessionsCount: roomSessions?.size || 0,
      approvalSessionsCount: approvalSessions?.size || 0
    });
  }

  /**
   * Find socket ID by user ID in a specific room
   */
  findSocketByUserId(roomId: string, userId: string): string | undefined {
    const roomSessions = this.roomSessions.get(roomId);
    if (roomSessions) {
      for (const [socketId, session] of roomSessions.entries()) {
        if (session.userId === userId) {
          return socketId;
        }
      }
    }

    // Check Redis if not found locally (Hybrid Approach)
    // IMPORTANT: This creates an async requirement for what was a synchronous method.
    // However, since we can't change the signature easily in a patch, 
    // we'll have to rely on local lookup for synchronous calls. 
    // For proper Redis support, the caller should await this or we assume
    // that cross-node lookups are handled differently (e.g. broadcasting).

    return undefined;
  }

  /**
   * Async version of findSocketByUserId that checks Redis
   */
  async findSocketByUserIdAsync(roomId: string, userId: string): Promise<string | undefined> {
    // 1. Try local first (fastest)
    const localSocket = this.findSocketByUserId(roomId, userId);
    if (localSocket) return localSocket;

    // 2. Try Redis
    return await this.redisState.hget<string>(this.getUserSocketKey(userId), roomId) ?? undefined;
  }

  /**
   * Check if a socket session is actually active (exists in memory or Redis)
   */
  async isSocketActive(socketId: string): Promise<boolean> {
    // 1. Check local first
    if (this.socketToSession.has(socketId)) {
      return true;
    }

    // 2. Check Redis
    return await this.redisState.exists(this.getSessionKey(socketId));
  }

  /**
   * Check if a user is actively connected to a room — cross-process safe.
   *
   * Unlike `isSocketActive`, this method does NOT rely on in-memory socket maps,
   * making it reliable in multi-process / clustered deployments.
   *
   * Algorithm:
   *   1. Local in-memory check (fastest — works within the same process)
   *   2. Redis: look up the user's socket ID for this room from the user→socket hash
   *   3. Confirm the session key for that socket still exists in Redis
   *      (session keys are deleted immediately on disconnect by `removeSession`)
   */
  async isUserActiveInRoom(roomId: string, userId: string): Promise<boolean> {
    // 1. Local in-memory check (fastest)
    const localSocket = this.findSocketByUserId(roomId, userId);
    if (localSocket) return true;

    // 2. Redis: look up the socket ID registered for this user+room
    const socketId = await this.redisState.hget<string>(this.getUserSocketKey(userId), roomId);
    if (!socketId) return false;

    const session = await this.redisState.get<NamespaceSession>(this.getSessionKey(socketId));
    if (!session) {
      // User->room mapping exists but session key is gone; clean stale mapping.
      await this.redisState.hdel(this.getUserSocketKey(userId), roomId);
      return false;
    }

    // Guard against stale/mismatched mappings that can make ghost users look active.
    if (session.userId !== userId || session.roomId !== roomId || !isRoomNamespace(session.namespacePath)) {
      await this.orphanCleaner.removeOrphanSessionFromRedis(socketId, session, this.getRoomSessionsKey(roomId));
      return false;
    }

    if (this.socketPresenceChecker) {
      const isSocketReallyConnected = await this.socketPresenceChecker(session);
      if (!isSocketReallyConnected) {
        // Session exists in Redis but socket is not connected in any worker.
        await this.orphanCleaner.removeOrphanSessionFromRedis(socketId, session, this.getRoomSessionsKey(roomId));
        return false;
      }
    }

    // 3. Confirm the session key still exists (deleted on disconnect — cross-process safe)
    return true;
  }

  /**
   * Find socket ID by user ID in approval sessions for a specific room
   */
  findApprovalSocketByUserId(roomId: string, userId: string): string | undefined {
    const approvalSessions = this.approvalSessions.get(roomId);
    if (approvalSessions) {
      for (const [socketId, session] of approvalSessions.entries()) {
        if (session.userId === userId) {
          return socketId;
        }
      }
    }
    return undefined;
  }

  /**
   * Remove old sessions for a user (keeping only the current socket).
   * If roomId is provided, only removes sessions in that room.
   *
   * DEV-143 (L-3): This method only iterates the in-memory `socketToSession` map.
   * Stale sessions from a previous server process that still exist in Redis
   * are NOT cleaned up here. They rely on the 24h session TTL for eventual
   * cleanup. When the app scales to multiple processes, this should also query
   * Redis for sessions belonging to this userId in this room.
   */
  async removeOldSessionsForUser(userId: string, currentSocketId: string, roomId?: string): Promise<string[]> {
    const sessionsToRemove: string[] = [];

    // Check all sessions for this user
    for (const [socketId, session] of this.socketToSession.entries()) {
      if (session.userId === userId && socketId !== currentSocketId) {
        // If roomId is provided, only remove if the session is in that room
        if (roomId !== undefined && session.roomId !== roomId) {
          continue;
        }
        sessionsToRemove.push(socketId);
      }
    }

    // Remove old sessions
    await Promise.all(sessionsToRemove.map(socketId => this.removeSession(socketId)));

    if (sessionsToRemove.length > 0) {
      loggingService.logInfo('Removed old sessions for user', {
        userId,
        currentSocketId,
        roomId,
        removedSessions: sessionsToRemove.length
      });
    }

    return sessionsToRemove;
  }

  /**
   * Get all users in a room (from room sessions)
   */
  getRoomUsers(roomId: string): Array<{ userId: string; socketId: string }> {
    const roomSessions = this.roomSessions.get(roomId);
    if (!roomSessions) {
      return [];
    }

    return Array.from(roomSessions.values()).map(session => ({
      userId: session.userId,
      socketId: session.socketId
    }));
  }

  /**
   * Get all users waiting for approval in a room
   */
  getApprovalUsers(roomId: string): Array<{ userId: string; socketId: string }> {
    const approvalSessions = this.approvalSessions.get(roomId);
    if (!approvalSessions) {
      return [];
    }

    return Array.from(approvalSessions.values()).map(session => ({
      userId: session.userId,
      socketId: session.socketId
    }));
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    roomSessions: number;
    approvalSessions: number;
    lobbySessions: number;
    roomBreakdown: Array<{ roomId: string; roomSessions: number; approvalSessions: number }>;
  } {
    const roomBreakdown = new Map<string, { roomSessions: number; approvalSessions: number }>();

    // Count room sessions
    for (const [roomId, sessions] of this.roomSessions.entries()) {
      if (!roomBreakdown.has(roomId)) {
        roomBreakdown.set(roomId, { roomSessions: 0, approvalSessions: 0 });
      }
      roomBreakdown.get(roomId)!.roomSessions = sessions.size;
    }

    // Count approval sessions
    for (const [roomId, sessions] of this.approvalSessions.entries()) {
      if (!roomBreakdown.has(roomId)) {
        roomBreakdown.set(roomId, { roomSessions: 0, approvalSessions: 0 });
      }
      roomBreakdown.get(roomId)!.approvalSessions = sessions.size;
    }

    const totalRoomSessions = Array.from(this.roomSessions.values())
      .reduce((sum, sessions) => sum + sessions.size, 0);
    const totalApprovalSessions = Array.from(this.approvalSessions.values())
      .reduce((sum, sessions) => sum + sessions.size, 0);

    return {
      totalSessions: this.socketToSession.size,
      roomSessions: totalRoomSessions,
      approvalSessions: totalApprovalSessions,
      lobbySessions: this.lobbySessions.size,
      roomBreakdown: Array.from(roomBreakdown.entries()).map(([roomId, counts]) => ({
        roomId,
        ...counts
      }))
    };
  }

  /**
   * Clean up expired sessions (sessions that haven't been active for a long time)
   */
  async cleanupExpiredSessions(maxInactiveMs: number = 30 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const expiredSockets: string[] = [];

    for (const [socketId, session] of this.socketToSession.entries()) {
      const inactiveTime = now - session.lastActivity.getTime();
      if (inactiveTime > maxInactiveMs) {
        expiredSockets.push(socketId);
      }
    }

    await Promise.all(expiredSockets.map(socketId => this.removeSession(socketId)));

    if (expiredSockets.length > 0) {
      loggingService.logInfo('Cleaned up expired sessions', {
        expiredCount: expiredSockets.length,
        maxInactiveMs
      });
    }
  }

  /**
   * Clean up orphan sessions from Redis
   * These are sessions that exist in Redis but don't have active Socket.IO connections
   * This happens when:
   * 1. Playwright tests don't disconnect properly
   * 2. Server crashes before removeSession is called
   * 3. Network issues prevent proper cleanup
   *
   * Delegates to OrphanSessionCleanupService (TR-20 split) — see that module
   * for the implementation; behavior/signature unchanged.
   */
  async cleanupOrphanRedisSessions(
    io?: { of: (ns: string) => { sockets: { get: (sid: string) => { connected: boolean } | undefined } | undefined } } | undefined,
    onOrphanFound?: (roomId: string, userId: string) => Promise<void>
  ): Promise<{ orphanCount: number; affectedRoomIds: string[] }> {
    return this.orphanCleaner.cleanupOrphanRedisSessions(io, onOrphanFound);
  }
}

// Shared runtime instance used by HTTP routes and Socket handlers.
// Index bootstrap wires socket presence checker on this instance.
export const roomSessionManager = new RoomSessionManager();