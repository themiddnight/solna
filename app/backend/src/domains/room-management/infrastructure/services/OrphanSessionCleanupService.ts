/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition */
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { CORE_NAMESPACES } from '@jam-band/shared';
import { REDIS_KEYS } from '../../../../shared/constants/RedisKeys';
import type { RedisStateService, PipelineOperation } from '../../../../shared/infrastructure/caching/RedisStateService';
import type { NamespaceSession } from './RoomSessionManager';

/**
 * Collaborator extracted from RoomSessionManager (TR-20 split).
 *
 * Owns the orphan-session sweep — sessions that exist in Redis but have no
 * live Socket.IO connection (server restart, Playwright not disconnecting,
 * crash before `removeSession`). Operates on the SAME map instances held by
 * RoomSessionManager (passed by reference in the constructor), so mutations
 * here are visible to the manager immediately — this preserves the exact
 * memory/Redis consistency guarantees the ghost-room-deadlock fix depends on.
 *
 * See docs/FAILURE_PATTERNS.md ("Ghost room deadlock") and
 * RoomSessionManager.orphanCleanup.regression.test.ts.
 */
export class OrphanSessionCleanupService {
  /* eslint-disable @typescript-eslint/member-ordering */
  constructor(
    private readonly redisState: RedisStateService,
    private readonly roomSessions: Map<string, Map<string, NamespaceSession>>,
    private readonly approvalSessions: Map<string, Map<string, NamespaceSession>>,
    private readonly lobbySessions: Map<string, NamespaceSession>,
    private readonly socketToSession: Map<string, NamespaceSession>
  ) {}

  // Redis Key Builders (delegated to REDIS_KEYS) — mirrors RoomSessionManager's
  // private builders; kept local so the moved methods below stay verbatim.
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
   * Remove orphan session Redis keys directly from known session data.
   * Used when the session is found in Redis but NOT in the in-memory map
   * (e.g. after server restart). `removeSession` would early-return in that case,
   * leaving stale Redis keys that make ghost users appear "active" for up to 24h.
   */
  async removeOrphanSessionFromRedis(
    socketId: string,
    session: NamespaceSession,
    sessionHashKey: string
  ): Promise<void> {
    const pipelineOps: PipelineOperation[] = [
      ['del', this.getSessionKey(socketId)],
      ['hdel', sessionHashKey, socketId],
    ];

    if (session.userId !== undefined && session.roomId !== undefined) {
      const currentSocketId = await this.redisState.hget<string>(this.getUserSocketKey(session.userId), session.roomId);
      if (currentSocketId === socketId) {
        pipelineOps.push(['hdel', this.getUserSocketKey(session.userId), session.roomId]);
      }
    }
    try {
      await this.redisState.executePipeline(pipelineOps);
    } catch (error) {
      loggingService.logError(error as Error, { context: 'removeOrphanSessionFromRedis', socketId });
    }

    // Also clean up ALL in-memory maps for this socket.
    // Critical: roomSessions must be cleaned too — not just socketToSession.
    // If socketToSession is cleaned but roomSessions still has the entry,
    // findSocketByUserId() returns the zombie socketId, which causes
    // handleLeaveRoom's duplicate-session guard to skip all cleanup, and
    // isUserActiveInRoom to return true, blocking ghost user removal forever.
    this.socketToSession.delete(socketId);
    if (session.roomId) {
      const roomSessions = this.roomSessions.get(session.roomId);
      if (roomSessions) {
        roomSessions.delete(socketId);
        if (roomSessions.size === 0) {
          this.roomSessions.delete(session.roomId);
        }
      }
      const approvalSessions = this.approvalSessions.get(session.roomId);
      if (approvalSessions) {
        approvalSessions.delete(socketId);
        if (approvalSessions.size === 0) {
          this.approvalSessions.delete(session.roomId);
        }
      }
    }
    this.lobbySessions.delete(socketId);
  }

  /**
   * Clean up orphan sessions from Redis
   * These are sessions that exist in Redis but don't have active Socket.IO connections
   * This happens when:
   * 1. Playwright tests don't disconnect properly
   * 2. Server crashes before removeSession is called
   * 3. Network issues prevent proper cleanup
   */
  async cleanupOrphanRedisSessions(
    io?: { of: (ns: string) => { sockets: { get: (sid: string) => { connected: boolean } | undefined } | undefined } } | undefined,
    onOrphanFound?: (roomId: string, userId: string) => Promise<void>
  ): Promise<{ orphanCount: number; affectedRoomIds: string[] }> {
    try {
      loggingService.logInfo('Starting orphan Redis session cleanup');

      let orphanCount = 0;
      const orphanSockets: string[] = [];
      const affectedRoomIds = new Set<string>();

      // 1. Get all room sessions from Redis
      const allRooms = await this.redisState.smembers(REDIS_KEYS.ROOM_IDS_SET);

      for (const roomId of allRooms) {
        const roomSessionsKey = this.getRoomSessionsKey(roomId);
        const roomSessions = await this.redisState.hgetall<NamespaceSession>(roomSessionsKey);

        for (const [socketId, session] of roomSessions.entries()) {
          // Check if this socket is actually connected to Socket.IO server
          let isConnected = false;

          if (io) {
            // If we have access to io instance, check if socket exists
            const namespace = io.of(session.namespacePath);
            if (namespace) {
              const socket = namespace.sockets?.get(socketId);
              isConnected = socket?.connected ?? false;
            }
          } else {
            // Fallback: check if socket exists in our in-memory map
            isConnected = this.socketToSession.has(socketId);
          }

          if (!isConnected) {
            // This is an orphan session - exists in Redis but not connected
            orphanSockets.push(socketId);
            orphanCount++;
            affectedRoomIds.add(roomId);

            loggingService.logInfo('Found orphan session', {
              socketId,
              userId: session.userId,
              roomId,
              namespacePath: session.namespacePath,
              connectedAt: session.connectedAt
            });

            // Remove Redis keys directly from known session data.
            // Do NOT use removeSession() here — it early-returns when the socket
            // is not in the in-memory map (e.g. after server restart), leaving
            // stale `sessions:socket:{socketId}` keys that make ghost users
            // appear active for up to 24h.
            await this.removeOrphanSessionFromRedis(socketId, session, roomSessionsKey);

            // Notify caller so they can also remove user from room map.
            // DEV-143 (L-1): Retry once on failure — the session is already
            // removed from Redis; if the membership removal fails, the user
            // remains in bandMembers as a ghost until the next cleanup cycle.
            if (onOrphanFound && session.userId) {
              try {
                await onOrphanFound(roomId, session.userId);
              } catch (err) {
                loggingService.logWarn('Orphan callback hasFailed, retrying once', {
                  context: 'cleanupOrphanRedisSessions.onOrphanFound',
                  roomId,
                  userId: session.userId,
                  error: String(err),
                });
                try {
                  await onOrphanFound(roomId, session.userId);
                } catch (retryErr) {
                  loggingService.logError(retryErr instanceof Error ? retryErr : new Error(String(retryErr)), {
                    context: 'cleanupOrphanRedisSessions.onOrphanFound.retryFailed',
                    roomId,
                    userId: session.userId,
                    note: 'Membership may be stale — will retry on next cleanup cycle',
                  });
                }
              }
            }
          }
        }
      }

      // 2. Also check approval sessions
      for (const roomId of allRooms) {
        const approvalSessionsKey = this.getApprovalSessionsKey(roomId);
        const approvalSessions = await this.redisState.hgetall<NamespaceSession>(approvalSessionsKey);

        for (const [socketId, session] of approvalSessions.entries()) {
          let isConnected = false;

          if (io) {
            const namespace = io.of(session.namespacePath);
            if (namespace) {
              const socket = namespace.sockets?.get(socketId);
              isConnected = socket?.connected ?? false;
            }
          } else {
            isConnected = this.socketToSession.has(socketId);
          }

          if (!isConnected) {
            orphanSockets.push(socketId);
            orphanCount++;

            loggingService.logInfo('Found orphan approval session', {
              socketId,
              userId: session.userId,
              roomId,
              namespacePath: session.namespacePath
            });

            await this.removeOrphanSessionFromRedis(socketId, session, approvalSessionsKey);
          }
        }
      }

      // 3. Check lobby sessions
      const lobbySessionsKey = this.getLobbySessionsKey();
      const lobbySessions = await this.redisState.hgetall<NamespaceSession>(lobbySessionsKey);

      for (const [socketId, session] of lobbySessions.entries()) {
        let isConnected = false;

        if (io) {
          const namespace = io.of(CORE_NAMESPACES.LOBBY_MONITOR);
          if (namespace) {
            const socket = namespace.sockets?.get(socketId);
            isConnected = socket?.connected ?? false;
          }
        } else {
          isConnected = this.socketToSession.has(socketId);
        }

        if (!isConnected) {
          orphanSockets.push(socketId);
          orphanCount++;

          loggingService.logInfo('Found orphan lobby session', {
            socketId,
            userId: session.userId,
            namespacePath: session.namespacePath
          });

          await this.removeOrphanSessionFromRedis(socketId, session, lobbySessionsKey);
        }
      }

      if (orphanCount > 0) {
        loggingService.logInfo('Cleaned up orphan Redis sessions', {
          orphanCount,
          orphanSockets: orphanSockets.slice(0, 10) // Log first 10 for debugging
        });
      } else {
        loggingService.logInfo('No orphan Redis sessions found');
      }

      return { orphanCount, affectedRoomIds: Array.from(affectedRoomIds) };
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomSessionManager.cleanupOrphanRedisSessions'
      });
      return { orphanCount: 0, affectedRoomIds: [] };
    }
  }
}
