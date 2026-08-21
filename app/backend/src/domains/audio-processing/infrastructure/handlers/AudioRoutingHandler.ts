import type { Socket, Namespace } from 'socket.io';
import type { Server } from 'socket.io';
import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { PERFORM_EVENTS } from '@jam-band/shared';

/**
 * AudioRoutingHandler - Handles audio parameter routing and synth coordination
 * 
 * This handler manages:
 * - Parameter requests between users
 * - Auto-requesting parameters for new users
 * 
 * Requirements: 4.1, 10.2
 */
export class AudioRoutingHandler {
  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly io: Server,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly namespaceManager: NamespaceManager
  ) {}

  /**
   * Auto-request synth parameters for new users joining the room
   * Ensures new users receive current synth states from existing users
   */
  async autoRequestSynthParamsForNewUser(socket: Socket, roomId: string, newUserId: string): Promise<void> {
    loggingService.logInfo('Audio routing - auto-request synth params for new user', {
      newUserId,
      roomId
    });
    
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - room not found for auto-request', { roomId });
      return;
    }

    const newUser = room.bandMembers.get(newUserId) || room.audiences.get(newUserId);
    if (!newUser) {
      loggingService.logInfo('Audio routing - new user not found for auto-request', { newUserId });
      return;
    }

    // Debug: Log all band members in the room and their categories
    loggingService.logInfo('Audio routing - all band members in room', {
      roomId,
      bandMembers: Array.from(room.bandMembers.values()).map(member => ({
        username: member.username,
        id: member.id,
        category: member.currentCategory,
        instrument: member.currentInstrument
      }))
    });

    // Find all band members with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.bandMembers.values()).filter(member =>
      member.currentCategory === 'synthesizer' && member.id !== newUserId
    );

    loggingService.logInfo('Audio routing - auto-requesting synth params', {
      newUsername: newUser.username,
      synthUsersCount: synthUsers.length
    });

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      const synthUserSocketId = this.roomSessionManager.findSocketByUserId(roomId, synthUser.id);
      if (synthUserSocketId) {
        const synthUserSocket = this.io.sockets.sockets.get(synthUserSocketId);
        if (synthUserSocket) {
          loggingService.logInfo('Audio routing - requesting synth params from user', {
            synthUsername: synthUser.username,
            newUsername: newUser.username
          });
          
          synthUserSocket.emit(PERFORM_EVENTS.AUTO_SEND_SYNTH_PARAMS_TO_NEW_USER, {
            newUserId: newUserId,
            newUsername: newUser.username
          });
        } else {
          loggingService.logInfo('Audio routing - no socket found for synth user', {
            synthUsername: synthUser.username
          });
        }
      } else {
        loggingService.logInfo('Audio routing - no socket ID found for synth user', {
          synthUsername: synthUser.username
        });
      }
    });
  }

  /**
   * Auto-request synth parameters for new users joining the room (namespace version)
   * Namespace-aware version for better isolation and performance
   */
  async autoRequestSynthParamsForNewUserNamespace(namespace: Namespace, roomId: string, newUserId: string): Promise<void> {
    loggingService.logInfo('Audio routing - auto-request synth params for new user (namespace)', {
      newUserId,
      roomId,
      namespaceName: namespace.name
    });
    
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - room not found for namespace auto-request', { roomId });
      return;
    }

    const newUser = room.bandMembers.get(newUserId) || room.audiences.get(newUserId);
    if (!newUser) {
      loggingService.logInfo('Audio routing - new user not found for namespace auto-request', { newUserId });
      return;
    }

    // Debug: Log all band members in the room and their categories
    loggingService.logInfo('Audio routing - all band members in room (namespace)', {
      roomId,
      bandMembers: Array.from(room.bandMembers.values()).map(member => ({
        username: member.username,
        id: member.id,
        category: member.currentCategory,
        instrument: member.currentInstrument
      }))
    });

    // Find all band members with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.bandMembers.values()).filter(member =>
      member.currentCategory === 'synthesizer' && member.id !== newUserId
    );

    loggingService.logInfo('Audio routing - auto-requesting synth params (namespace)', {
      newUsername: newUser.username,
      synthUsersCount: synthUsers.length
    });

    if (synthUsers.length === 0) {
      loggingService.logInfo('Audio routing - no synthesizer users found to request params from');
      return;
    }

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      // Find the socket in the namespace for this synth user
      for (const [socketId, socket] of namespace.sockets) {
        const session = this.roomSessionManager.getRoomSession(socketId);
        if (session && session.userId === synthUser.id) {
          loggingService.logInfo('Audio routing - requesting synth params from user (namespace)', {
            synthUsername: synthUser.username,
            newUsername: newUser.username
          });
          
          // Send both events to ensure reliability
          socket.emit(PERFORM_EVENTS.AUTO_SEND_SYNTH_PARAMS_TO_NEW_USER, {
            newUserId: newUserId,
            newUsername: newUser.username
          });
          
          // Also send a direct request for current synth params
          socket.emit(PERFORM_EVENTS.REQUEST_CURRENT_SYNTH_PARAMS_FOR_NEW_USER, {
            newUserId: newUserId,
            newUsername: newUser.username,
            synthUserId: synthUser.id,
            synthUsername: synthUser.username
          });
          break;
        }
      }
    });
  }

  /**
   * Send persisted instrument params to a late-joining user (DEV-317).
   *
   * Unlike the synth auto-request pattern, this reads the already-persisted
   * `instrumentParams` field off each non-synth BandMember and emits them
   * **directly to the joiner** — one hop, no liveness dependency on the
   * source peer. Each payload carries { userId, username, instrument, category,
   * params } so the frontend can route it through the same remote-apply path
   * used by INSTRUMENT_PARAMS_CHANGED/COMMITTED (useInstrumentManager.ts).
   */
  async sendInstrumentParamsToNewUser(namespace: Namespace, roomId: string, newUserId: string): Promise<void> {
    loggingService.logInfo('Audio routing - sending instrument params to new user', {
      newUserId,
      roomId,
      namespaceName: namespace.name,
    });

    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - room not found for instrument-params send', { roomId });
      return;
    }

    const newUser = room.bandMembers.get(newUserId) || room.audiences.get(newUserId);
    if (!newUser) {
      loggingService.logInfo('Audio routing - new user not found for instrument-params send', { newUserId });
      return;
    }

    // Collect non-synth band members (excluding the joiner) that have instrumentParams.
    // Synth users are deliberately excluded — their params are handled by the existing
    // autoRequestSynthParamsForNewUserNamespace path.
    const membersWithParams = Array.from(room.bandMembers.values()).filter((member) => {
      if (member.id === newUserId) return false;
      if (member.currentCategory === 'synthesizer') return false;
      const params = member.instrumentParams;
      return params !== undefined && Object.keys(params).length > 0;
    });

    if (membersWithParams.length === 0) {
      loggingService.logInfo('Audio routing - no non-synth members with instrumentParams found');
      return;
    }

    loggingService.logInfo('Audio routing - sending instrument params to new user', {
      newUsername: newUser.username,
      membersWithParamsCount: membersWithParams.length,
    });

    // Find the joiner's socket and emit one payload per peer directly
    for (const [, socket] of namespace.sockets) {
      const session = this.roomSessionManager.getRoomSession(socket.id);
      if (session && session.userId === newUserId) {
        for (const member of membersWithParams) {
          socket.emit(PERFORM_EVENTS.SEND_INSTRUMENT_PARAMS_TO_NEW_USER, {
            userId: member.id,
            username: member.username,
            instrument: member.currentInstrument,
            category: member.currentCategory,
            params: member.instrumentParams,
          });
        }
        break;
      }
    }
  }
}