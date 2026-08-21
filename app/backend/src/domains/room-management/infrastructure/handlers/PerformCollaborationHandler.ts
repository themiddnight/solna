import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import type { Server } from 'socket.io';
import type { RoomLifecycleService } from '../../application/RoomLifecycleService';
import type { RoomMembershipService } from '../../application/RoomMembershipService';

import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '../services/RoomSessionManager';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { buildRoomPayload } from '../../../../shared/utils/roomPayloadUtils';
import { PERFORM_EVENTS, ROOM_STATE_EVENTS, SHARED_EVENTS } from '@jam-band/shared';

/**
 * PerformCollaborationHandler - Handles user-to-user interactions in a perform room
 *
 * This handler manages:
 * - Instrument swap requests between users (request / approve / reject / cancel)
 * - Swap execution and state synchronisation
 * - User kick (room owner only)
 * - Sequencer state exchange between users
 *
 * Requirements: User collaboration features
 */
import type { BandMember } from '../../../../types';

export class PerformCollaborationHandler {
  /* eslint-disable @typescript-eslint/member-ordering */
  // Track pending swap requests: requesterId -> request details
  private readonly pendingSwaps = new Map<string, {
    targetUserId: string;
    sequencerState?: Record<string, unknown>;
    synthParams?: Record<string, unknown>;
  }>();

  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly roomMembershipService: RoomMembershipService,
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Build a room payload with fresh bandMembers, audiences, and pendingMembers from Redis.
   */
  private async buildRoomPayload(room: Record<string, unknown>, roomId: string) {
    return buildRoomPayload(this.roomMembershipService, room, roomId, this.roomLifecycleService);
  }

  /**
   * Handle instrument swap request
   */
  async handleRequestInstrumentSwap(socket: Socket, data: { targetUserId: string; sequencerState?: Record<string, unknown>; synthParams?: Record<string, unknown> }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const roomId = session.roomId;
    const requesterId = session.userId;
    const { targetUserId, sequencerState, synthParams } = data;

    // Validate target user exists in room
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    const targetUser = room.bandMembers.get(targetUserId) || room.audiences.get(targetUserId);
    const requesterUser = room.bandMembers.get(requesterId) || room.audiences.get(requesterId);
    
    if (!targetUser) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('Target user not found in room'));
      return;
    }

    if (!requesterUser) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('Requester not found in room'));
      return;
    }

    // Check if users can swap (not audience)
    if (targetUser.role === 'audience' || requesterUser.role === 'audience') {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('Cannot swap with audience members'));
      return;
    }



    // Check for existing pending swap
    if (this.pendingSwaps.has(requesterId)) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('You already have a pending swap request'));
      return;
    }

    // Store pending swap with state snapshots
    this.pendingSwaps.set(requesterId, {
      targetUserId,
      ...(sequencerState !== undefined && { sequencerState }),
      ...(synthParams !== undefined && { synthParams }),
    });

    // Notify requester that request was sent
    socket.emit(PERFORM_EVENTS.SWAP_REQUEST_SENT, { targetUserId });

    // Send swap request to target user
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit(PERFORM_EVENTS.SWAP_REQUEST_RECEIVED, {
        requesterId,
        requesterUsername: requesterUser.username
      });
    }

    loggingService.logInfo('Instrument swap requested', {
      roomId,
      requesterId,
      targetUserId,
      requesterUsername: requesterUser.username,
      targetUsername: targetUser.username,
      hasSequencerState: !!sequencerState,
      hasSynthParams: !!synthParams
    });
  }

  /**
   * Handle swap approval
   */
  async handleApproveInstrumentSwap(socket: Socket, data: { requesterId: string; sequencerState?: Record<string, unknown>; synthParams?: Record<string, unknown> }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const roomId = session.roomId;
    const targetUserId = session.userId;
    const { requesterId, sequencerState, synthParams } = data;

    // Validate pending swap exists
    const pendingRequest = this.pendingSwaps.get(requesterId);
    if (!pendingRequest || pendingRequest.targetUserId !== targetUserId) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('No pending swap request found'));
      return;
    }

    // Execute the swap with both users' states
    await this.executeSwap(
      requesterId,
      targetUserId,
      roomId,
      namespace,
      pendingRequest.sequencerState,
      pendingRequest.synthParams,
      sequencerState,
      synthParams
    );
  }

  /**
   * Handle swap rejection
   */
  handleRejectInstrumentSwap(socket: Socket, data: { requesterId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const { requesterId } = data;

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Notify requester of rejection
    const requesterSocket = this.findSocketByUserId(requesterId, namespace);
    if (requesterSocket) {
      requesterSocket.emit(PERFORM_EVENTS.SWAP_REJECTED);
    }

    loggingService.logInfo('Instrument swap rejected', {
      roomId: session.roomId,
      requesterId,
      targetUserId: session.userId
    });
  }

  /**
   * Handle swap cancellation
   */
  handleCancelInstrumentSwap(socket: Socket, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const requesterId = session.userId;
    const pendingRequest = this.pendingSwaps.get(requesterId);

    if (!pendingRequest) {
      socket.emit(PERFORM_EVENTS.SWAP_ERROR, createSocketErrorPayload('No pending swap request found'));
      return;
    }

    const targetUserId = pendingRequest.targetUserId;

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Notify target user of cancellation
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit(PERFORM_EVENTS.SWAP_CANCELLED);
    }

    loggingService.logInfo('Instrument swap cancelled', {
      roomId: session.roomId,
      requesterId,
      targetUserId
    });
  }

  /**
   * Handle user kick (room owner only)
   */
  async handleKickUser(socket: Socket, data: { targetUserId: string }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.KICK_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const roomId = session.roomId;
    const ownerId = session.userId;
    const { targetUserId } = data;

    // Verify user is room owner
    if (!await this.roomMembershipService.isRoomOwner(roomId, ownerId)) {
      socket.emit(PERFORM_EVENTS.KICK_ERROR, createSocketErrorPayload('Only room owner can kick users'));
      return;
    }

    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(PERFORM_EVENTS.KICK_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    const targetUser = room.bandMembers.get(targetUserId) || room.audiences.get(targetUserId);
    if (!targetUser) {
      socket.emit(PERFORM_EVENTS.KICK_ERROR, createSocketErrorPayload('Target user not found in room'));
      return;
    }

    // Cannot kick room owner
    if (targetUser.role === 'room_owner') {
      socket.emit(PERFORM_EVENTS.KICK_ERROR, createSocketErrorPayload('Cannot kick room owner'));
      return;
    }

    // Remove user from room as an intentional removal — this prevents grace period
    // from being hasAdded, so the kicked user won't appear as "reconnecting" for others.
    // removeFromGracePeriod is called as a safety net in case a prior disconnect
    // already placed the user in grace period before the kick landed.
    await this.roomMembershipService.removeUserFromRoom(roomId, targetUserId, true);
    await this.roomLifecycleService.removeFromGracePeriod(targetUserId, roomId);

    // Notify kicked user and remove them from the room namespace.
    // Avoid force-disconnecting immediately so the client can process USER_KICKED
    // and navigate back to the lobby reliably.
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit(SHARED_EVENTS.USER_KICKED, { reason: 'Kicked by room owner' });
      void targetSocket.leave(roomId);
    }

    // Notify all users in room about user leaving
    namespace.emit(ROOM_STATE_EVENTS.USER_LEFT, { user: targetUser });

    // Fetch fresh room state after removal to avoid broadcasting stale data (ISSUE-61 pattern):
    // the `room` object captured above still includes the kicked user in bandMembers/audiences.
    const freshRoomForBroadcast = await this.roomLifecycleService.getRoom(roomId);
    if (freshRoomForBroadcast) {
      namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(freshRoomForBroadcast as unknown as Record<string, unknown>, roomId));
    }

    loggingService.logInfo('User kicked from room', {
      roomId,
      ownerId,
      kickedUserId: targetUserId,
      kickedUsername: targetUser.username
    });
  }

  /**
   * Execute the instrument swap between two users
   */
  private async executeSwap(
    requesterId: string, 
    targetUserId: string, 
    roomId: string, 
    namespace: Namespace,
    requesterSequencerState?: Record<string, unknown>,
    requesterSynthParams?: Record<string, unknown>,
    targetSequencerState?: Record<string, unknown>,
    targetSynthParams?: Record<string, unknown>
  ): Promise<void> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      return;
    }

    const requesterUser = room.bandMembers.get(requesterId) || room.audiences.get(requesterId);
    const targetUser = room.bandMembers.get(targetUserId) || room.audiences.get(targetUserId);

    if (!requesterUser || !targetUser) {
      return;
    }

    if (requesterUser.role === 'audience' || targetUser.role === 'audience') {
        return;
    }

    const requesterBandMember = requesterUser as BandMember;
    const targetBandMember = targetUser as BandMember;

    // Capture current state snapshots
    const aInstrument = requesterBandMember.currentInstrument;
    const aCategory = requesterBandMember.currentCategory;
    // Use explicit params if provided, otherwise fallback to stored params
    const aSynthParams = requesterSynthParams || requesterBandMember.synthParams;

    const bInstrument = targetBandMember.currentInstrument;
    const bCategory = targetBandMember.currentCategory;
    const bSynthParams = targetSynthParams || targetBandMember.synthParams;

    // Preconditions: instruments and categories must exist for both users
    if (aInstrument == null || aCategory == null || bInstrument == null || bCategory == null) {
      loggingService.logInfo('Instrument swap aborted due to missing instrument/category', {
        roomId,
        requesterId,
        targetUserId,
        aInstrument,
        aCategory,
        bInstrument,
        bCategory,
      });
      // Notify involved users
      const requesterSocket = this.findSocketByUserId(requesterId, namespace);
      const targetSocket = this.findSocketByUserId(targetUserId, namespace);
      requesterSocket?.emit(PERFORM_EVENTS.SWAP_ERROR, { message: 'Swap failed: missing instrument/category' });
      targetSocket?.emit(PERFORM_EVENTS.SWAP_ERROR, { message: 'Swap failed: missing instrument/category' });
      // Clear pending swap
      this.pendingSwaps.delete(requesterId);
      return;
    }

    const isASynth = aCategory === 'synthesizer';
    const isBSynth = bCategory === 'synthesizer';

    // Perform instrument/category swap (non-null due to preconditions)
    requesterBandMember.currentInstrument = bInstrument!;
    requesterBandMember.currentCategory = bCategory!;

    targetBandMember.currentInstrument = aInstrument!;
    targetBandMember.currentCategory = aCategory!;

    // Apply synth params per rules
    // - If destination is synth, receiver gets source's synth params; otherwise clear
    if (isBSynth && bSynthParams) {
      requesterBandMember.synthParams = bSynthParams;
    } else {
      delete requesterBandMember.synthParams;
    }

    if (isASynth && aSynthParams) {
      targetBandMember.synthParams = aSynthParams;
    } else {
      delete targetBandMember.synthParams;
    }

    // Persist new instruments/categories in room service
    await this.roomMembershipService.updateUserInstrument(roomId, requesterId, requesterBandMember.currentInstrument, requesterBandMember.currentCategory);
    await this.roomMembershipService.updateUserInstrument(roomId, targetUserId, targetBandMember.currentInstrument, targetBandMember.currentCategory);

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Build swap payload with DESTINATION instruments and conditional synth params
    // Also include the SWAPPED sequencer states
    // Requester (A) gets Target's (B) sequencer state
    // Target (B) gets Requester's (A) sequencer state
    const swapData = {
      userA: {
        userId: requesterId,
        instrumentName: requesterBandMember.currentInstrument,
        category: requesterBandMember.currentCategory,
        synthParams: requesterBandMember.currentCategory === 'synthesizer' && requesterBandMember.synthParams ? requesterBandMember.synthParams : undefined,
        sequencerState: targetSequencerState, // A gets B's state
      },
      userB: {
        userId: targetUserId,
        instrumentName: targetBandMember.currentInstrument,
        category: targetBandMember.currentCategory,
        synthParams: targetBandMember.currentCategory === 'synthesizer' && targetBandMember.synthParams ? targetBandMember.synthParams : undefined,
        sequencerState: requesterSequencerState, // B gets A's state
      }
    };

    // Notify all users in room about the swap
    namespace.emit(PERFORM_EVENTS.SWAP_COMPLETED, swapData);

    // ALSO broadcast standard instrument & synth param events so other clients update immediately
    // (Previously only swap_completed was emitted, causing other users to retain stale synth params
    // until an explicit instrument toggle occurred.)
    try {
      namespace.emit('perform:instrument_changed', {
        userId: requesterId,
        username: requesterBandMember.username,
        instrument: requesterBandMember.currentInstrument,
        category: requesterBandMember.currentCategory
      });
      namespace.emit('perform:instrument_changed', {
        userId: targetUserId,
        username: targetBandMember.username,
        instrument: targetBandMember.currentInstrument,
        category: targetBandMember.currentCategory
      });

      if (requesterBandMember.currentCategory === 'synthesizer' && requesterBandMember.synthParams) {
        namespace.emit('perform:synth_params_changed', {
          userId: requesterId,
          username: requesterBandMember.username,
          instrument: requesterBandMember.currentInstrument,
          category: requesterBandMember.currentCategory,
          params: requesterBandMember.synthParams
        });
      }
      if (targetBandMember.currentCategory === 'synthesizer' && targetBandMember.synthParams) {
        namespace.emit('perform:synth_params_changed', {
          userId: targetUserId,
          username: targetBandMember.username,
          instrument: targetBandMember.currentInstrument,
          category: targetBandMember.currentCategory,
          params: targetBandMember.synthParams
        });
      }
    } catch (broadcastErr) {
      loggingService.logError(broadcastErr instanceof Error ? broadcastErr : new Error('Unknown broadcast error'), {
        context: 'PerformCollaborationHandler.executeSwap.broadcasts',
        roomId,
        requesterId,
        targetUserId
      });
    }

    loggingService.logInfo('Instrument swap completed', {
      roomId,
      requesterId,
      targetUserId,
      // Log minimal info about swap data
      userA: swapData.userA.instrumentName,
      userB: swapData.userB.instrumentName,
      hasSequencerA: !!swapData.userA.sequencerState,
      hasSequencerB: !!swapData.userB.sequencerState
    });
  }

  /**
   * Find socket by user ID in namespace
   */
  private findSocketByUserId(userId: string, namespace: Namespace): Socket | null {
    for (const [socketId, socket] of namespace.sockets) {
      const session = this.roomSessionManager.getRoomSession(socketId);
      if (session && session.userId === userId) {
        return socket;
      }
    }
    return null;
  }

  /**
   * Clean up pending swaps when user disconnects
   */
  handleUserDisconnect(userId: string, namespace: Namespace): void {
    // Remove any pending swap requests from this user
    this.pendingSwaps.delete(userId);

    // Cancel any pending swaps targeting this user
    for (const [requesterId, swapRequest] of this.pendingSwaps.entries()) {
      if (swapRequest.targetUserId === userId) {
        this.pendingSwaps.delete(requesterId);
        
        // Notify requester that target user disconnected
        const requesterSocket = this.findSocketByUserId(requesterId, namespace);
        if (requesterSocket) {
          requesterSocket.emit(PERFORM_EVENTS.SWAP_CANCELLED);
        }
      }
    }
  }

  /**
   * Handle request for sequencer state from another user
   */
  handleRequestSequencerState(socket: Socket, data: { targetUserId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SEQUENCER_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const targetSocket = this.findSocketByUserId(data.targetUserId, namespace);
    if (!targetSocket) {
      socket.emit(PERFORM_EVENTS.SEQUENCER_ERROR, createSocketErrorPayload('Target user not found'));
      return;
    }

    // Forward the request to target user (frontend listens to 'sequencer_state_requested')
    targetSocket.emit(PERFORM_EVENTS.SEQUENCER_STATE_REQUESTED, { requesterId: session.userId });
  }

  /**
   * Handle sending sequencer state snapshot to another user
   */
  handleSendSequencerState(
    socket: Socket,
    data: { targetUserId: string; snapshot: { banks: Record<string, unknown>; settings: Record<string, unknown>; currentBank: string } },
    namespace: Namespace
  ): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(PERFORM_EVENTS.SEQUENCER_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const targetSocket = this.findSocketByUserId(data.targetUserId, namespace);
    if (!targetSocket) {
      socket.emit(PERFORM_EVENTS.SEQUENCER_ERROR, createSocketErrorPayload('Target user not found'));
      return;
    }

    // Forward the snapshot to the target user (frontend listens to 'sequencer_state')
    targetSocket.emit(PERFORM_EVENTS.SEQUENCER_STATE, {
      fromUserId: session.userId,
      snapshot: data.snapshot,
    });
  }
}
