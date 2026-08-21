import type { Socket, Namespace } from 'socket.io';
import type { RoomSessionManager, NamespaceSession } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { VoiceParticipantInfo } from '../../../../types';
import { VOICE_EVENTS, ROOM_CONSTANTS } from '@jam-band/shared';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';

const MAX_HEARTBEAT_PEERS = ROOM_CONSTANTS.MAX_PARTICIPANTS;

type VoiceHeartbeatData = {
  roomId: string;
  userId: string;
  connectionStates: Record<string, { connectionState: string; iceConnectionState: string }>;
};

/**
 * VoiceConnectionHealthHandler - connection health monitoring for the voice
 * mesh network, split out of VoiceConnectionHandler (TR-20): heartbeat
 * processing, failed-connection notification, and periodic stale-participant
 * cleanup.
 *
 * Shares the `voiceParticipants` map instance with VoiceConnectionHandler
 * (passed in by reference) so join/leave state stays a single source of
 * truth. Extracted verbatim; no behavior change.
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class VoiceConnectionHealthHandler {
  constructor(
    private readonly roomSessionManager: RoomSessionManager,
    private readonly voiceParticipants: Map<string, Map<string, VoiceParticipantInfo>>,
    private readonly getVoiceRoomMap: (roomId: string) => Map<string, VoiceParticipantInfo>
  ) { }

  /**
   * Validate the peer-count limit, update the participant's heartbeat/connection
   * state, and compute the failed-connections list. Returns `null` when the
   * update should be dropped (peer limit exceeded).
   *
   * This is the deduplicated block that was previously copy-pasted between
   * handleVoiceHeartbeat and handleVoiceHeartbeatNamespace.
   */
  private computeHeartbeatUpdate(
    session: NamespaceSession,
    data: VoiceHeartbeatData
  ): { userId: string; roomId: string; failedConnections: string[] } | null {
    // DEV-179: heartbeat is attributed to the token-verified session id, never data.userId.
    const userId = session.userId;

    if (Object.keys(data.connectionStates).length > MAX_HEARTBEAT_PEERS) {
      loggingService.logWarn('Voice heartbeat connectionStates exceeds peer limit', {
        userId,
        roomId: data.roomId,
        peerCount: Object.keys(data.connectionStates).length,
        limit: MAX_HEARTBEAT_PEERS,
      });
      return null;
    }

    const roomId = data.roomId;

    // Update last seen timestamp for this user
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participant = voiceRoomMap.get(userId);
    if (participant) {
      participant.lastHeartbeat = Date.now();
      participant.connectionStates = data.connectionStates;
    }

    // Check for failed connections and notify other participants
    const failedConnections = Object.entries(data.connectionStates)
      .filter(([_peerId, state]) =>
        state.connectionState === 'failed' ||
        state.iceConnectionState === 'failed' ||
        state.iceConnectionState === 'disconnected'
      )
      .map(([peerId]) => peerId);

    return { userId, roomId, failedConnections };
  }

  /**
   * Periodic cleanup of stale voice connections
   */
  cleanupStaleVoiceConnections(): void {
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 60 seconds

    this.voiceParticipants.forEach((roomMap, roomId) => {
      const staleParticipants: string[] = [];

      roomMap.forEach((participant, userId) => {
        if (participant.lastHeartbeat != null && now - participant.lastHeartbeat > STALE_THRESHOLD) {
          staleParticipants.push(userId);
        }
      });

      // Remove stale participants
      if (staleParticipants.length > 0) {
        loggingService.logInfo('Pruning stale voice participants (no heartbeat/reconcile in 60s)', {
          roomId,
          userIds: staleParticipants,
        });
      }
      staleParticipants.forEach(userId => {
        roomMap.delete(userId);
      });

      // Clean up empty room maps
      if (roomMap.size === 0) {
        this.voiceParticipants.delete(roomId);
      }
    });
  }

  /**
   * Handle voice heartbeat through namespace
   */
  handleVoiceHeartbeatNamespace(socket: Socket, data: VoiceHeartbeatData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const update = this.computeHeartbeatUpdate(session, data);
    if (!update) {
      return;
    }
    const { userId, failedConnections } = update;

    if (failedConnections.length > 0) {

      // Notify affected peers about connection issues through namespace
      failedConnections.forEach(failedPeerId => {
        // Find the socket in the namespace for this peer
        for (const [socketId, peerSocket] of Array.from(namespace.sockets)) {
          const peerSession = this.roomSessionManager.getRoomSession(socketId);
          if (peerSession && peerSession.userId === failedPeerId) {
            peerSocket.emit(VOICE_EVENTS.VOICE_CONNECTION_FAILED, {
              fromUserId: userId,
              reason: 'peer_reported_failure'
            });
            break;
          }
        }
      });
    }
  }

  /**
   * Handle voice connection failed through namespace
   */
  handleVoiceConnectionFailedNamespace(socket: Socket, data: { roomId: string; targetUserId: string }, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Ask the peers to re-establish. Addressed with targetUserId; room key is the
    // plain roomId that sockets join.
    socket.to(session.roomId).emit(VOICE_EVENTS.VOICE_RECONNECTION_REQUESTED, {
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId,
    });
  }
}
/* eslint-enable @typescript-eslint/member-ordering */
