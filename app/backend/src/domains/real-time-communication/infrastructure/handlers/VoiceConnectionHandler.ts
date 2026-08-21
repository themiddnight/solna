import type { Socket, Namespace } from 'socket.io';
import type { Server } from 'socket.io';
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import type {
  VoiceOfferData,
  VoiceAnswerData,
  VoiceIceCandidateData,
  JoinVoiceData,
  LeaveVoiceData,
  VoiceParticipantInfo,
  VoiceMuteChangedData,
  VoiceSpeakingData,
  RequestVoiceParticipantsData
} from '../../../../types';
import { VOICE_EVENTS } from '@jam-band/shared';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { VoiceSignalingHandler } from './VoiceSignalingHandler';
import { VoiceConnectionHealthHandler } from './VoiceConnectionHealthHandler';

/**
 * VoiceConnectionHandler - Handles WebRTC mesh functionality for voice communication
 *
 * This handler manages:
 * - WebRTC offer/answer/ICE candidate exchange
 * - Voice participant management
 * - Mesh network coordination
 * - Namespace-based communication (the only reachable path — see FU-1)
 *
 * Requirements: 4.1, 4.6
 *
 * TR-20 split: offer/answer/ICE signaling lives in `VoiceSignalingHandler`
 * and heartbeat/connection-health monitoring lives in
 * `VoiceConnectionHealthHandler` (both in this same directory). This class
 * still owns the `voiceParticipants` state and delegates to those
 * collaborators for their respective public methods; all public method
 * names/signatures are unchanged so existing callers are unaffected.
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class VoiceConnectionHandler {
  private readonly voiceParticipants = new Map<string, Map<string, VoiceParticipantInfo>>(); // roomId -> userId -> info
  private readonly signalingHandler: VoiceSignalingHandler;
  private readonly healthHandler: VoiceConnectionHealthHandler;

  constructor(
    private readonly roomMembershipService: RoomMembershipService,
    private readonly io: Server,
    private readonly roomSessionManager: RoomSessionManager
  ) {
    this.signalingHandler = new VoiceSignalingHandler(roomMembershipService, roomSessionManager);
    this.healthHandler = new VoiceConnectionHealthHandler(
      roomSessionManager,
      this.voiceParticipants,
      (roomId: string) => this.getVoiceRoomMap(roomId)
    );
  }

  private getVoiceRoomMap(roomId: string): Map<string, VoiceParticipantInfo> {
    if (!this.voiceParticipants.has(roomId)) {
      this.voiceParticipants.set(roomId, new Map());
    }
    return this.voiceParticipants.get(roomId)!;
  }

  /**
   * DEV-267: a deterministic version of the room's voice membership (a djb2 hash of the
   * sorted participant userIds). Computed fresh from the map on every request, so it needs
   * no bump-site plumbing and can never drift from the actual roster — it changes iff a
   * participant joins or leaves. Lets `handleRequestMeshConnections*` skip the redundant
   * NEW_MESH_PEER fanout on a steady-state heartbeat where the requester's view is current.
   */
  private meshMembershipVersion(voiceRoomMap: Map<string, VoiceParticipantInfo>): number {
    const signature = Array.from(voiceRoomMap.keys()).sort().join(',');
    let hash = 5381;
    for (let i = 0; i < signature.length; i++) {
      hash = ((hash << 5) + hash + signature.charCodeAt(i)) | 0;
    }
    return hash;
  }

  // Namespace versions of voice handlers
  // (offer/answer/ICE delegated to VoiceSignalingHandler — see class doc)
  async handleVoiceOfferNamespace(socket: Socket, data: VoiceOfferData, namespace: Namespace): Promise<void> {
    return this.signalingHandler.handleVoiceOfferNamespace(socket, data, namespace);
  }

  handleVoiceAnswerNamespace(socket: Socket, data: VoiceAnswerData, namespace: Namespace): void {
    return this.signalingHandler.handleVoiceAnswerNamespace(socket, data, namespace);
  }

  handleVoiceIceCandidateNamespace(socket: Socket, data: VoiceIceCandidateData, namespace: Namespace): void {
    return this.signalingHandler.handleVoiceIceCandidateNamespace(socket, data, namespace);
  }

  /**
   * Handle join voice through namespace with auto-connection support
   * Requirements: 7.3, 5.1, 5.2, 5.3
   */
  handleJoinVoiceNamespace(socket: Socket, data: JoinVoiceData, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      loggingService.logWarn('Invalid join voice', { socketId: socket.id, roomId: data.roomId });
      return;
    }

    // DEV-179: acting identity comes from the join-time session (token-verified), never the
    // client payload — otherwise a client could key voice presence under another user's id.
    const userId = session.userId;
    const username = session.username ?? data.username;

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const existingParticipants = Array.from(voiceRoomMap.values());

    // Add new user to voice participants with default soft-mute - Requirement 5.3
    voiceRoomMap.set(userId, {
      userId,
      username,
      isMuted: true, // Default soft-mute state for auto-connection
      lastHeartbeat: Date.now()
    });

    // Notify other users in the room about the new voice participant.
    // Room key is the PLAIN roomId — that is what sockets join (RoomJoinEmitter);
    // `namespace.name` would target an empty room and reach nobody.
    socket.to(session.roomId).emit(VOICE_EVENTS.USER_JOINED_VOICE, {
      userId,
      username
    });

    // Send existing participants to new user for auto-connection - Requirement 5.1
    socket.emit(VOICE_EVENTS.MESH_PARTICIPANTS, {
      participants: existingParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        shouldInitiate: userId.localeCompare(p.userId) < 0
      })),
      // DEV-267: membership version so the client can gate steady-state reconcile churn.
      version: this.meshMembershipVersion(voiceRoomMap),
      // The join handler just registered the user, so selfRegistered is always true.
      selfRegistered: true,
    });
  }

  /**
   * Handle leave voice through namespace - Requirements: 7.3
   */
  handleLeaveVoiceNamespace(socket: Socket, _data: LeaveVoiceData, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      loggingService.logWarn('Invalid leave voice - no session', { socketId: socket.id });
      return;
    }
    // DEV-179: leave acts on the token-verified session id, never the client payload userId.
    const userId = session.userId;
    const voiceRoomMap = this.getVoiceRoomMap(session.roomId);
    voiceRoomMap.delete(userId);

    // Notify other users in the room that this user left voice chat
    socket.to(session.roomId).emit(VOICE_EVENTS.USER_LEFT_VOICE, {
      userId
    });
  }

  /**
   * Handle voice mute changed through namespace - Requirements: 7.3
   */
  handleVoiceMuteChangedNamespace(socket: Socket, data: VoiceMuteChangedData, _namespace: Namespace): void {
    if (data.roomId.length === 0) return;

    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    // DEV-179: mute state is keyed/broadcast by the token-verified session id, never data.userId.
    const userId = session.userId;
    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const participant = voiceRoomMap.get(userId);
    if (participant) {
      participant.isMuted = data.isMuted;
      participant.lastHeartbeat = Date.now();

      // Notify other users in the room about mute state change
      socket.to(session.roomId).emit(VOICE_EVENTS.VOICE_MUTE_CHANGED, {
        userId,
        isMuted: data.isMuted
      });
    }
  }

  /**
   * DEV-270 — relay the speaking (talking) indicator to the rest of the room.
   * Pure ephemeral relay: no participant/Redis state is touched (talking self-
   * expires, so a late joiner needs no history). The acting id is the token-
   * verified session userId, never the client payload (TR-33); broadcast with
   * socket.to() so the sender is excluded (TR-3).
   *
   * Room key: sockets join the PLAIN roomId (RoomJoinEmitter), not the namespace
   * path — see Invariants & gotchas #6 in the domain README.
   */
  handleVoiceSpeakingNamespace(socket: Socket, data: VoiceSpeakingData): void {
    if (data.roomId.length === 0) return;

    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    socket.to(data.roomId).emit(VOICE_EVENTS.VOICE_SPEAKING, {
      userId: session.userId,
      isSpeaking: data.isSpeaking,
    });
  }

  /**
   * Clean up voice participants when a room is closed
   */
  cleanupRoom(roomId: string): void {
    this.voiceParticipants.delete(roomId);
  }

  /**
   * Periodic cleanup of stale voice connections
   * (delegated to VoiceConnectionHealthHandler — see class doc)
   */
  cleanupStaleVoiceConnections(): void {
    return this.healthHandler.cleanupStaleVoiceConnections();
  }

  /**
   * Handle request voice participants through namespace
   */
  handleRequestVoiceParticipantsNamespace(socket: Socket, _data: RequestVoiceParticipantsData, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const roomId = session.roomId;
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participants = Array.from(voiceRoomMap.values());

    socket.emit(VOICE_EVENTS.VOICE_PARTICIPANTS, { participants });
  }

  /**
   * Handle request mesh connections through namespace
   */
  handleRequestMeshConnectionsNamespace(socket: Socket, data: { roomId: string; userId: string; lastVersion?: number | undefined }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      loggingService.logWarn('Invalid mesh connection request', { socketId: socket.id, roomId: data.roomId });
      return;
    }

    // DEV-179: the requesting identity is the token-verified session id, never data.userId.
    const userId = session.userId;

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);

    // Keep-alive: the mesh reconcile fires from every live voice client at least
    // every 15s — a registered requester must never be stale-pruned while it runs.
    // (VOICE_HEARTBEAT alone cannot cover this: it is not sent while a client has
    // zero peers, which is exactly the solo-user case the 60s prune was hitting.)
    const requester = voiceRoomMap.get(userId);
    if (requester) {
      requester.lastHeartbeat = Date.now();
    }

    const version = this.meshMembershipVersion(voiceRoomMap);
    const allParticipants = Array.from(voiceRoomMap.values());
    const otherParticipants = allParticipants.filter(p => p.userId !== userId);

    // For full mesh: respond with all other participants this user should connect to.
    // The authoritative full list is ALWAYS sent (drives the client's ghost-prune, DEV-265).
    socket.emit(VOICE_EVENTS.MESH_PARTICIPANTS, {
      participants: otherParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        // Deterministic connection initiation based on lexicographical comparison
        shouldInitiate: userId.localeCompare(p.userId) < 0
      })),
      version,
      // Self-heal signal: the roster list always excludes self, so this is the only
      // way a client can learn it has been dropped (stale prune, lost JOIN_VOICE race)
      // and must re-announce. Optional field — older emit sites simply omit it.
      selfRegistered: requester !== undefined,
    });

    // DEV-267: skip the O(N) NEW_MESH_PEER fanout when the requester's roster view is
    // already current — a steady-state heartbeat with a matching version changed nothing.
    if (data.lastVersion === version) return;

    // Notify each existing participant about the new user they should connect to
    otherParticipants.forEach(participant => {
      // Find the socket in the namespace for this participant
      for (const [socketId, socket] of Array.from(namespace.sockets)) {
        const participantSession = this.roomSessionManager.getRoomSession(socketId);
        if (participantSession && participantSession.userId === participant.userId) {
          socket.emit(VOICE_EVENTS.NEW_MESH_PEER, {
            userId,
            username: voiceRoomMap.get(userId)?.username || 'Unknown',
            shouldInitiate: participant.userId.localeCompare(userId) < 0
          });
          break;
        }
      }
    });
  }

  /**
   * Handle voice heartbeat through namespace
   * (delegated to VoiceConnectionHealthHandler — see class doc)
   */
  handleVoiceHeartbeatNamespace(socket: Socket, data: { roomId: string; userId: string; connectionStates: Record<string, { connectionState: string; iceConnectionState: string }> }, namespace: Namespace): void {
    return this.healthHandler.handleVoiceHeartbeatNamespace(socket, data, namespace);
  }

  /**
   * Handle voice connection failed through namespace
   * (delegated to VoiceConnectionHealthHandler — see class doc)
   */
  handleVoiceConnectionFailedNamespace(socket: Socket, data: { roomId: string; targetUserId: string }, namespace: Namespace): void {
    return this.healthHandler.handleVoiceConnectionFailedNamespace(socket, data, namespace);
  }

  /**
   * Get voice participants for a room (for debugging/monitoring)
   */
  getVoiceParticipants(roomId: string): VoiceParticipantInfo[] {
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    return Array.from(voiceRoomMap.values());
  }
}
/* eslint-enable @typescript-eslint/member-ordering */
