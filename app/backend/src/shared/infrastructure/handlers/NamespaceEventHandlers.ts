import type { Namespace, Socket } from 'socket.io';
import { handlePingMeasurement } from '../../utils/socketUtils';
import { decorateSocketErrorEmits } from '../socket/socketErrors';
import type { RoomLifecycleHandler, RoomMembershipHandler, MetronomeEventHandler } from '../../../domains/room-management/infrastructure/handlers';
import type { VoiceConnectionHandler, ChatHandler } from '../../../domains/real-time-communication/infrastructure/handlers';
import type { ApprovalWorkflowHandler } from '../../../domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler';
import type { PerformEventHandler } from '../../../domains/perform-room/infrastructure/handlers/PerformEventHandler';
import type { ArrangeEventHandler } from '../../../domains/arrange-room/infrastructure/handlers/ArrangeEventHandler';
import type { RoomSessionManager } from '../../../domains/room-management/infrastructure/services/RoomSessionManager';
import type { PerformanceMonitoringService } from '../performance/PerformanceMonitoringService';
import type { ConnectionHealthService } from '../resilience/ConnectionHealthService';
import type { ConnectionOptimizationService } from '../performance/ConnectionOptimizationService';
import { BackendErrorRecoveryService, BackendErrorType } from '../resilience/BackendErrorRecoveryService';
import { loggingService } from '../logging/LoggingService';
import { secureSocketEvent } from '../../../middleware/security';
import { CORE_NAMESPACES } from '@jam-band/shared';
import {
  SHARED_EVENTS,
  VOICE_EVENTS,
  ROOM_SWITCH_EVENTS,
  ROOM_LIFECYCLE_EVENTS,
  TOUR_EVENTS,
} from '@jam-band/shared';
import {
  joinRoomSchema,
  chatMessageSchema,
  transferOwnershipSchema,
  memberActionSchema,
  voiceOfferSchema,
  voiceAnswerSchema,
  voiceIceCandidateSchema,
  voiceJoinSchema,
  voiceLeaveSchema,
  voiceMuteChangedSchema,
  voiceSpeakingSchema,
  requestVoiceParticipantsSchema,
  requestMeshConnectionsSchema,
  voiceHeartbeatSchema,
  voiceConnectionFailedSchema,
  approvalRequestSchema,
  approvalCancelSchema,
  prepareIdentitySwapSchema,
  finishTourSchema,
} from '@jam-band/shared';
import { z } from 'zod';
import { sanitizeEventData as sanitizeEventDataShared } from './sanitizeEventData';

const requestRoleChangeSchema = z.object({
  targetRole: z.enum(['band_member', 'audience']),
});

const approveRoleChangeSchema = z.object({
  targetUserId: z.string(),
  targetRole: z.literal('band_member'),
});

const rejectRoleChangeSchema = z.object({
  targetUserId: z.string(),
});

/* eslint-disable @typescript-eslint/member-ordering */
export class NamespaceEventHandlers {
  private performanceMonitoring: PerformanceMonitoringService | null = null;
  private connectionHealth: ConnectionHealthService | null = null;
  private connectionOptimization: ConnectionOptimizationService | null = null;
  private readonly errorRecoveryService: BackendErrorRecoveryService;

  constructor(
    private readonly roomLifecycleHandler: RoomLifecycleHandler,
    private readonly roomMembershipHandler: RoomMembershipHandler,
    private readonly voiceConnectionHandler: VoiceConnectionHandler,
    private readonly approvalWorkflowHandler: ApprovalWorkflowHandler,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly chatHandler: ChatHandler,
    private readonly performEventHandler: PerformEventHandler,
    private readonly arrangeEventHandler: ArrangeEventHandler,
    private readonly metronomeEventHandler: MetronomeEventHandler
  ) {
    this.errorRecoveryService = new BackendErrorRecoveryService();
  }

  /**
   * Set performance monitoring services
   */
  setPerformanceServices(
    performanceMonitoring: PerformanceMonitoringService,
    connectionHealth: ConnectionHealthService,
    connectionOptimization?: ConnectionOptimizationService
  ): void {
    this.performanceMonitoring = performanceMonitoring;
    this.connectionHealth = connectionHealth;
    this.connectionOptimization = connectionOptimization || null;
  }

  /**
   * Get error recovery service for external access
   */
  getErrorRecoveryService(): BackendErrorRecoveryService {
    return this.errorRecoveryService;
  }

  /**
   * Wrapper to track performance and handle errors for room events
   * Requirements: 6.10 - Comprehensive error handling for namespace connection failures
   */
  private trackRoomEvent<T>(
    roomId: string,
    eventName: string,
    handler: (socket: Socket, data: T) => void | Promise<void>
  ): (socket: Socket, data: T) => void {
    return async (socket: Socket, data: T) => {
      const startTime = Date.now();

      try {
        await handler(socket, data);

        const duration = Date.now() - startTime;
        if (this.performanceMonitoring) {
          this.performanceMonitoring.recordRoomEvent(roomId, eventName, duration);
        }
      } catch (error) {
        const duration = Date.now() - startTime;

        // Record performance error
        if (this.performanceMonitoring) {
          this.performanceMonitoring.recordRoomError(roomId, error as Error, {
            eventName,
            socketId: socket.id,
            duration
          });
        }

        // Handle error through recovery service
        await this.errorRecoveryService.handleError({
          errorType: this.classifyError(error as Error, eventName),
          message: `Error in ${eventName}: ${(error as Error).message}`,
          originalError: error as Error,
          socketId: socket.id,
          roomId,
          namespace: `/room/${roomId}`,
          timestamp: Date.now(),
          additionalData: {
            eventName,
            duration,
            data: this.sanitizeEventData(data)
          }
        }, socket);

        // Don't re-throw to prevent client disconnection unless critical
        if (this.isCriticalError(error as Error)) {
          throw error;
        }
      }
    };
  }

  /**
   * Bind one Zod-validated socket event in a single line. Mirrors the
   * secureSocketEvent overloads: pass a schema for validated payloads, or
   * null for events with no payload contract. All room/approval event
   * registrations go through here — grep bindSecure to list the contract.
   */
  private bindSecure<S extends z.ZodTypeAny>(
    socket: Socket,
    eventName: string,
    schema: S,
    handler: (socket: Socket, data: z.infer<S>) => void | Promise<void>,
  ): void;
  private bindSecure<TData = unknown>(
    socket: Socket,
    eventName: string,
    schema: null,
    handler: (socket: Socket, data: TData) => void | Promise<void>,
  ): void;
  private bindSecure(
    socket: Socket,
    eventName: string,
    schema: z.ZodTypeAny | null,
    handler: (socket: Socket, data: never) => void | Promise<void>,
  ): void {
    const secured = schema === null
      ? secureSocketEvent(eventName, null, handler as (socket: Socket, data: unknown) => void | Promise<void>)
      : secureSocketEvent(eventName, schema, handler as (socket: Socket, data: unknown) => void | Promise<void>);
    socket.on(eventName, (data: unknown) => { void secured(socket, data); });
  }

  /**
   * Classify error type based on error and event context
   */
  private classifyError(error: Error, eventName: string): BackendErrorType {
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      return BackendErrorType.ValidationError;
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return BackendErrorType.RateLimitError;
    }

    if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return BackendErrorType.PermissionError;
    }

    if (errorMessage.includes('session') || eventName.includes('join') || eventName.includes('leave')) {
      return BackendErrorType.SessionManagementError;
    }

    if (errorMessage.includes('room') || errorMessage.includes('state')) {
      return BackendErrorType.RoomStateError;
    }

    if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      return BackendErrorType.NetworkError;
    }

    return BackendErrorType.UnknownError;
  }

  /**
   * Check if error is critical and should cause disconnection
   */
  private isCriticalError(error: Error): boolean {
    const criticalPatterns = [
      'out of memory',
      'stack overflow',
      'database connection lost',
      'server shutting down'
    ];

    const errorMessage = error.message.toLowerCase();
    return criticalPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sanitize event data for logging (remove sensitive information).
   * Shared implementation in sanitizeEventData.ts — both handlers delegate
   * to the same module (previously duplicated in BaseSocketHandler.ts).
   */
  private sanitizeEventData(data: unknown): unknown {
    return sanitizeEventDataShared(data);
  }

  /**
   * Set up event handlers for room namespaces
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  setupRoomNamespaceHandlers(namespace: Namespace, roomId: string): void {
    namespace.on('connection', (socket: Socket) => {
      decorateSocketErrorEmits(socket);
      const startTime = Date.now();

      loggingService.logInfo('Socket connected to room namespace', {
        socketId: socket.id,
        roomId,
        namespacePath: `/room/${roomId}`
      });

      // Check connection optimization
      if (this.connectionOptimization) {
        const connectionCheck = this.connectionOptimization.shouldAllowConnection(socket, roomId);
        if (!connectionCheck.allowed) {
          socket.emit('connection_rejected', {
            reason: connectionCheck.reason,
            queuePosition: connectionCheck.queuePosition
          });

          if (connectionCheck.queuePosition === undefined) {
            socket.disconnect();
            return;
          }
        } else {
          // Register successful connection
          this.connectionOptimization.registerConnection(socket, roomId);
        }
      }

      // Register connection for health monitoring
      if (this.connectionHealth) {
        // We'll need to get userId from session after it's established
        socket.on(SHARED_EVENTS.JOIN_ROOM, (_data) => {
          const session = this.roomSessionManager.getRoomSession(socket.id);
          if (session) {
            this.connectionHealth?.registerConnection(socket, session.userId, roomId, `/room/${roomId}`);
          }
        });
      }

      // Bind all room-specific event handlers
      this.bindRoomEventHandlers(socket, roomId, namespace);

      socket.on('disconnect', async (reason) => {
        const disconnectTime = Date.now();
        const connectionDuration = disconnectTime - startTime;

        loggingService.logInfo('Socket disconnected from room namespace', {
          socketId: socket.id,
          roomId,
          reason,
          connectionDuration,
          namespacePath: `/room/${roomId}`
        });

        try {
          // Unregister from performance monitoring services
          if (this.connectionHealth) {
            this.connectionHealth.unregisterConnection(socket.id);
          }

          if (this.connectionOptimization) {
            this.connectionOptimization.unregisterConnection(socket, roomId);
          }

          // COLL-8 FIX: Retrieve session BEFORE any cleanup to prevent order violation
          const session = this.roomSessionManager.getRoomSession(socket.id);

          if (session) {
            // Check if there is a newer active session for this user in this room.
            // If the active socket ID is different from this socket.id,
            // then this socket has been replaced by a new session (kicked).
            // In this case, we skip cleaning up the room state/members,
            // since the user is still active via the new socket!
            const activeSocketId = await this.roomSessionManager.findSocketByUserIdAsync(session.roomId, session.userId);
            if (activeSocketId && activeSocketId !== socket.id) {
              loggingService.logInfo('Disconnect: Replaced session detected, skipping room cleanup', {
                roomId: session.roomId,
                userId: session.userId,
                oldSocketId: socket.id,
                activeSocketId
              });
              await this.roomSessionManager.removeSession(socket.id);
              return;
            }
            // Domain-specific cleanup (perform, arrange, voice) is now handled
            // inside handleLeaveRoom — consolidated into a single cleanup path
            // shared by both explicit LEAVE_ROOM and disconnect.
          }

          // Handle user leaving room through lifecycle handler
          // (domain cleanup, membership removal, grace period, and session removal)
          await this.roomLifecycleHandler.handleLeaveRoom(socket, false);

          // Session is already removed by handleLeaveRoom, but ensure cleanup in edge cases
          if (this.roomSessionManager.getRoomSession(socket.id)) {
            await this.roomSessionManager.removeSession(socket.id);
          }
        } catch (error) {
          // Handle cleanup errors
          await this.errorRecoveryService.handleError({
            errorType: BackendErrorType.SessionManagementError,
            message: `Error during disconnect cleanup: ${(error as Error).message}`,
            originalError: error as Error,
            socketId: socket.id,
            roomId,
            namespace: `/room/${roomId}`,
            timestamp: Date.now(),
            additionalData: { disconnectReason: reason, connectionDuration }
          });
        }
      });

      socket.on('error', async (error) => {
        loggingService.logError(error, {
          context: 'Room namespace socket error',
          socketId: socket.id,
          roomId,
          namespacePath: `/room/${roomId}`
        });

        // Handle socket errors through recovery service
        await this.errorRecoveryService.handleError({
          errorType: BackendErrorType.NamespaceConnectionError,
          message: `Socket error in room namespace: ${error instanceof Error ? error.message : 'Unknown error'}`,
          originalError: error instanceof Error ? error : new Error(String(error)),
          socketId: socket.id,
          roomId,
          namespace: `/room/${roomId}`,
          timestamp: Date.now()
        }, socket);
      });
    });
  }

  /**
   * Bind all room-specific event handlers to the socket
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  private bindRoomEventHandlers(socket: Socket, roomId: string, namespace: Namespace): void {
    // Room management events with error handling
    // Socket.IO socket.on callbacks receive `any` from the library boundary — typed as unknown here;
    // secureSocketEvent infers the handler's data type directly from the Zod schema (validated at runtime).
    this.bindSecure(socket, SHARED_EVENTS.JOIN_ROOM, joinRoomSchema,
      this.trackRoomEvent(roomId, 'join_room', (socket, data) => this.roomLifecycleHandler.handleJoinRoom(socket, data)));

    this.bindSecure<{ isIntendedLeave?: boolean }>(socket, SHARED_EVENTS.LEAVE_ROOM, null,
      async (socket, data) => { await this.roomLifecycleHandler.handleLeaveRoom(socket, data.isIntendedLeave ?? false); });

    // DEV-208: prepare-identity-swap — a guest, having just finished registration, asks the
    // server to record a handoff before its old socket disconnects so the next join (under the
    // new registered userId) is recognized as continuing this session rather than a fresh join.
    this.bindSecure(socket, ROOM_LIFECYCLE_EVENTS.PREPARE_IDENTITY_SWAP, prepareIdentitySwapSchema,
      async (socket, data) => { await this.roomLifecycleHandler.handlePrepareIdentitySwap(socket, data); });

    // DEV-221: finish-tour — a restricted guest/unverified user finished the onboarding tour;
    // un-isolate their solo tour room and publish it to the lobby (owner stays in-room).
    this.bindSecure(socket, TOUR_EVENTS.FINISH_TOUR, finishTourSchema,
      async (socket, data) => { await this.roomLifecycleHandler.handleFinishTour(socket, data); });

    // Chat events - Requirements: 7.4
    this.bindSecure(socket, SHARED_EVENTS.CHAT_MESSAGE, chatMessageSchema,
      (socket, data) => this.chatHandler.handleChatMessageNamespace(socket, data, namespace));

    // Ping measurement events for latency monitoring
    socket.on(SHARED_EVENTS.PING_MEASUREMENT, (data: unknown) => handlePingMeasurement(socket, data));

    // Voice events - Delegated to VoiceConnectionHandler
    this.bindVoiceEvents(socket, namespace);

    // Ownership and Membership events
    this.bindSecure(socket, SHARED_EVENTS.TRANSFER_OWNERSHIP, transferOwnershipSchema,
      (socket, data) => this.roomMembershipHandler.handleTransferOwnershipNamespace(socket, data, namespace));

    // Member Approval events handled by ApprovalWorkflowHandler
    this.bindSecure(socket, SHARED_EVENTS.APPROVE_MEMBER, memberActionSchema,
      (socket, data) => this.approvalWorkflowHandler.handleApprovalResponse(socket, { ...data, approved: true }, namespace));

    this.bindSecure(socket, SHARED_EVENTS.REJECT_MEMBER, memberActionSchema,
      (socket, data) => this.approvalWorkflowHandler.handleApprovalResponse(socket, { ...data, approved: false }, namespace));

    // In-room Role Switching events
    this.bindSecure(socket, SHARED_EVENTS.REQUEST_ROLE_CHANGE, requestRoleChangeSchema,
      (socket, data) => this.roomMembershipHandler.handleRequestRoleChange(socket, data, namespace));

    this.bindSecure(socket, SHARED_EVENTS.APPROVE_ROLE_CHANGE, approveRoleChangeSchema,
      (socket, data) => this.roomMembershipHandler.handleApproveRoleChange(socket, data, namespace));

    this.bindSecure(socket, SHARED_EVENTS.REJECT_ROLE_CHANGE, rejectRoleChangeSchema,
      (socket, data) => this.roomMembershipHandler.handleRejectRoleChange(socket, data, namespace));

    // NOTE: Room scale change and follow-scale events are handled
    // by PerformEventHandler via PERFORM_EVENTS.ROOM_SCALE_CHANGE and
    // PERFORM_EVENTS.TOGGLE_FOLLOW_SCALE (both use 'perform:' prefix).

    // Room Switch events - Seamless room switching
    socket.on(ROOM_SWITCH_EVENTS.INITIATE_SWITCH, (data: { targetRoomId: string; targetRoomType: 'perform' | 'arrange' }) => {
      void this.trackRoomEvent(roomId, ROOM_SWITCH_EVENTS.INITIATE_SWITCH,
        async (socket: Socket, data: { targetRoomId: string; targetRoomType: 'perform' | 'arrange' }) => {
          await this.roomLifecycleHandler.handleInitiateSwitch(socket, data);
        }
      )(socket, data);
    });

    // Note: CANCEL_JOIN_REQUEST is handled in approval namespace via cancel_approval_request

    // --- DOMAIN HANDLERS DELEGATION ---

    // Delegate to Perform Room Handler (Music, Instruments, etc.)
    this.performEventHandler.handleConnection(socket, roomId, namespace);

    // Delegate to Arrange Room Handler (Tracks, Regions, etc.)
    this.arrangeEventHandler.handleConnection(socket, roomId, namespace);

    // Delegate to Metronome Handler
    this.metronomeEventHandler.handleConnection(socket, roomId, namespace);
  }

  /**
   * Bind voice related events
   */
  private bindVoiceEvents(socket: Socket, namespace: Namespace): void {
    // Socket.IO socket.on callbacks receive `any` from the library boundary — typed as unknown here;
    // secureSocketEvent infers the handler's data type directly from the Zod schema (validated at runtime).
    const voice = this.voiceConnectionHandler;
    this.bindSecure(socket, VOICE_EVENTS.VOICE_OFFER, voiceOfferSchema, (s, d) => voice.handleVoiceOfferNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_ANSWER, voiceAnswerSchema, (s, d) => voice.handleVoiceAnswerNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_ICE_CANDIDATE, voiceIceCandidateSchema, (s, d) => voice.handleVoiceIceCandidateNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.JOIN_VOICE, voiceJoinSchema, (s, d) => voice.handleJoinVoiceNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.LEAVE_VOICE, voiceLeaveSchema, (s, d) => voice.handleLeaveVoiceNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_MUTE_CHANGED, voiceMuteChangedSchema, (s, d) => voice.handleVoiceMuteChangedNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_SPEAKING, voiceSpeakingSchema, (s, d) => voice.handleVoiceSpeakingNamespace(s, d));
    this.bindSecure(socket, VOICE_EVENTS.REQUEST_VOICE_PARTICIPANTS, requestVoiceParticipantsSchema, (s, d) => voice.handleRequestVoiceParticipantsNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.REQUEST_MESH_CONNECTIONS, requestMeshConnectionsSchema, (s, d) => voice.handleRequestMeshConnectionsNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_HEARTBEAT, voiceHeartbeatSchema, (s, d) => voice.handleVoiceHeartbeatNamespace(s, d, namespace));
    this.bindSecure(socket, VOICE_EVENTS.VOICE_CONNECTION_FAILED, voiceConnectionFailedSchema, (s, d) => voice.handleVoiceConnectionFailedNamespace(s, d, namespace));
  }

  /**
   * Set up event handlers for approval namespaces
   * Requirements: 3.1, 3.2, 3.6, 3.7, 3.8
   */
  setupApprovalNamespaceHandlers(namespace: Namespace, roomId: string): void {
    namespace.on('connection', (socket: Socket) => {
      decorateSocketErrorEmits(socket);
      loggingService.logInfo('Socket connected to approval namespace', {
        socketId: socket.id,
        roomId,
        namespacePath: `/approval/${roomId}`
      });

      // Handle initial approval connection setup
      this.approvalWorkflowHandler.handleApprovalConnection(socket, roomId, namespace);

      // Bind approval-specific event handlers
      this.bindApprovalEventHandlers(socket, roomId, namespace);

      socket.on('disconnect', async (reason) => {
        loggingService.logInfo('Socket disconnected from approval namespace', {
          socketId: socket.id,
          roomId,
          reason,
          namespacePath: `/approval/${roomId}`
        });

        // Handle approval disconnect (cancellation due to disconnect)
        void this.approvalWorkflowHandler.handleApprovalDisconnect(socket);

        // Clean up session
        await this.roomSessionManager.removeSession(socket.id);
      });

      socket.on('error', (error) => {
        loggingService.logError(error, {
          context: 'Approval namespace socket error',
          socketId: socket.id,
          roomId,
          namespacePath: `/approval/${roomId}`
        });
      });
    });
  }

  /**
   * Bind approval-specific event handlers to the socket
   * Requirements: 3.1, 3.2, 3.6, 3.7
   */
  private bindApprovalEventHandlers(socket: Socket, _roomId: string, namespace: Namespace): void {
    // Socket.IO socket.on callbacks receive `any` from the library boundary — typed as unknown here;
    // secureSocketEvent infers the handler's data type directly from the Zod schema (validated at runtime).
    // Handle approval request from waiting user
    this.bindSecure(socket, SHARED_EVENTS.REQUEST_APPROVAL, approvalRequestSchema,
      (s, d) => this.approvalWorkflowHandler.handleApprovalRequest(s, d, namespace));

    // Handle approval cancellation from waiting user
    this.bindSecure(socket, SHARED_EVENTS.CANCEL_APPROVAL_REQUEST, approvalCancelSchema,
      (s, d) => this.approvalWorkflowHandler.handleApprovalCancel(s, d, namespace));

    // Ping measurement events for latency monitoring during approval
    socket.on(SHARED_EVENTS.PING_MEASUREMENT, (data: unknown) => handlePingMeasurement(socket, data));
  }

  /**
   * Set up event handlers for lobby monitor namespace
   * Requirements: 4.2
   */
  setupLobbyMonitorNamespaceHandlers(namespace: Namespace): void {
    namespace.on('connection', (socket: Socket) => {
      decorateSocketErrorEmits(socket);
      loggingService.logInfo('Socket connected to lobby monitor namespace', {
        socketId: socket.id,
        namespacePath: CORE_NAMESPACES.LOBBY_MONITOR
      });

      // Lobby monitor event handlers
      socket.on(SHARED_EVENTS.PING_MEASUREMENT, (data) => handlePingMeasurement(socket, data));

      socket.on('disconnect', async (reason) => {
        loggingService.logInfo('Socket disconnected from lobby monitor namespace', {
          socketId: socket.id,
          reason,
          namespacePath: CORE_NAMESPACES.LOBBY_MONITOR
        });

        // Clean up session
        await this.roomSessionManager.removeSession(socket.id);
      });

      socket.on('error', (error) => {
        loggingService.logError(error, {
          context: 'Lobby monitor namespace socket error',
          socketId: socket.id,
          namespacePath: CORE_NAMESPACES.LOBBY_MONITOR
        });
      });
    });
  }

  /**
   * Get system health status
   * Requirements: 6.10 - Connection health monitoring and automatic recovery
   */
  getSystemHealth(): {
    isHealthy: boolean;
    errorRecoveryStats: ReturnType<BackendErrorRecoveryService['getErrorStats']>;
    healthReport: ReturnType<BackendErrorRecoveryService['getHealthReport']>;
  } {
    const errorStats = this.errorRecoveryService.getErrorStats();
    const healthReport = this.errorRecoveryService.getHealthReport();

    return {
      isHealthy: this.errorRecoveryService.isSystemHealthy(),
      errorRecoveryStats: errorStats,
      healthReport
    };
  }

  /**
   * Clear error recovery state (for manual intervention)
   */
  clearErrorRecoveryState(): void {
    this.errorRecoveryService.clearErrorHistory();
  }
}
