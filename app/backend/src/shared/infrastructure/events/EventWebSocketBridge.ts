/**
 * EventWebSocketBridge - Connects domain events to WebSocket broadcasting
 * 
 * This service subscribes to domain events and translates them into
 * appropriate WebSocket messages for real-time client updates.
 * 
 * Requirements: 5.1, 5.4
 */

import type { Server } from 'socket.io';
import type { EventBus, EventHandler } from '../../domain/events/EventBus';
import type { NamespaceManager } from '../namespace/NamespaceManager';
import type {
  RoomCreated,
  MemberJoined,
  MemberLeft,
  OwnershipTransferred,
  RoomSettingsUpdated,
  RoomClosed
} from '../../domain/events/RoomEvents';
import type {
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../domain/events/UserOnboardingEvents';
import type { UserCreated, UserProfileUpdated } from '../../domain/events/UserEvents';
import { CORE_NAMESPACES, ROOM_STATE_EVENTS } from '@jam-band/shared';

export class EventWebSocketBridge {
  constructor(
    private readonly eventBus: EventBus,
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager
  ) {
    this.setupEventHandlers();
  }

  /**
   * Cleanup method to unsubscribe from all events
   */
  cleanup(): void {
    // Note: EventBus interface doesn't currently support unsubscribing all handlers
    // This would need to be implemented if cleanup is required
  }

  /**
   * Setup all event handlers that bridge domain events to WebSocket messages
   */
  private setupEventHandlers(): void {
    // Room Management Events
    this.eventBus.subscribe('RoomCreated', this.handleRoomCreated.bind(this));
    this.eventBus.subscribe('MemberJoined', this.handleMemberJoined.bind(this));
    this.eventBus.subscribe('MemberLeft', this.handleMemberLeft.bind(this));
    this.eventBus.subscribe('OwnershipTransferred', this.handleOwnershipTransferred.bind(this));
    this.eventBus.subscribe('RoomSettingsUpdated', this.handleRoomSettingsUpdated.bind(this));
    this.eventBus.subscribe('RoomClosed', this.handleRoomClosed.bind(this));

    // User Onboarding Events
    this.eventBus.subscribe('UserJoinedRoom', this.handleUserJoinedRoom.bind(this));
    this.eventBus.subscribe('UserInstrumentsReady', this.handleUserInstrumentsReady.bind(this));
    this.eventBus.subscribe('UserAudioRoutingReady', this.handleUserAudioRoutingReady.bind(this));
    this.eventBus.subscribe('UserVoiceConnectionReady', this.handleUserVoiceConnectionReady.bind(this));
    this.eventBus.subscribe('UserReadyForPlayback', this.handleUserReadyForPlayback.bind(this));
    this.eventBus.subscribe('UserOnboardingFailed', this.handleUserOnboardingFailed.bind(this));
    this.eventBus.subscribe('UserOnboardingTimeout', this.handleUserOnboardingTimeout.bind(this));

    // User Management Events
    this.eventBus.subscribe('UserCreated', this.handleUserCreated.bind(this));
    this.eventBus.subscribe('UserProfileUpdated', this.handleUserProfileUpdated.bind(this));
  }

  /**
   * Handle RoomCreated event
   * Note: Lobby broadcast is handled directly in RoomLifecycleHandler with richer data.
   * This handler is kept for potential future cross-context event processing.
   */
  private readonly handleRoomCreated: EventHandler<RoomCreated> = async (_event) => {
    // Lobby broadcast intentionally handled in RoomLifecycleHandler (direct broadcast)
    // to avoid duplicate events and ensure complete data (isHidden, activeBandMemberCount, etc.)
  };

  /**
   * Handle MemberJoined event - notify room members
   */
  private readonly handleMemberJoined: EventHandler<MemberJoined> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit(ROOM_STATE_EVENTS.USER_JOINED, {
        user: {
          id: event.userId,
          username: event.username,
          role: event.role
        }
      });
    }
  };

  /**
   * Handle MemberLeft event - notify room members
   */
  private readonly handleMemberLeft: EventHandler<MemberLeft> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit(ROOM_STATE_EVENTS.USER_LEFT, {
        user: {
          id: event.userId,
          username: event.username
        }
      });
    }
  };

  /**
   * Handle OwnershipTransferred event - notify room members
   */
  private readonly handleOwnershipTransferred: EventHandler<OwnershipTransferred> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit(ROOM_STATE_EVENTS.OWNERSHIP_TRANSFERRED, {
        newOwner: {
          id: event.newOwnerId
        },
        oldOwner: {
          id: event.previousOwnerId
        }
      });
    }
  };

  /**
   * Handle RoomSettingsUpdated event - notify room members
   */
  private readonly handleRoomSettingsUpdated: EventHandler<RoomSettingsUpdated> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit('room_settings_updated', {
        roomId: event.aggregateId,
        changes: event.changes,
        updatedBy: event.updatedBy
      });
    }
  };

  /**
   * Handle RoomClosed event - notify all clients
   */
  private readonly handleRoomClosed: EventHandler<RoomClosed> = async (event) => {

    // Notify room members first
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, {
        message: event.reason || 'Room has been closed',
        closedBy: event.closedBy
      });
    }

    // Lobby room-list update — `/lobby` is where the lobby client listens; the default
    // namespace has no clients.
    const lobbyNamespace = this.io.of(CORE_NAMESPACES.LOBBY);
    lobbyNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, {
      roomId: event.aggregateId,
      reason: event.reason
    });
  };

  /**
   * Handle UserJoinedRoom event - start onboarding coordination
   */
  private readonly handleUserJoinedRoom: EventHandler<UserJoinedRoom> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_started', {
        userId: event.userId,
        username: event.username,
        role: event.role,
        onboardingId: event.eventId
      });
    }
  };

  /**
   * Handle UserInstrumentsReady event - update onboarding progress
   */
  private readonly handleUserInstrumentsReady: EventHandler<UserInstrumentsReady> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'instruments_ready',
        instruments: event.instruments,
        progress: 33 // 1 of 3 steps complete
      });
    }
  };

  /**
   * Handle UserAudioRoutingReady event - update onboarding progress
   */
  private readonly handleUserAudioRoutingReady: EventHandler<UserAudioRoutingReady> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'audio_routing_ready',
        audioBusId: event.audioBusId,
        progress: 66 // 2 of 3 steps complete
      });
    }
  };

  /**
   * Handle UserVoiceConnectionReady event - update onboarding progress
   */
  private readonly handleUserVoiceConnectionReady: EventHandler<UserVoiceConnectionReady> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'voice_connection_ready',
        connectionId: event.connectionId,
        progress: 90 // Almost complete
      });
    }
  };

  /**
   * Handle UserReadyForPlayback event - complete onboarding
   */
  private readonly handleUserReadyForPlayback: EventHandler<UserReadyForPlayback> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_complete', {
        userId: event.userId,
        step: 'ready_for_playback',
        progress: 100
      });

      // Also emit general user ready event for other room logic
      roomNamespace.emit('user_ready', {
        userId: event.userId,
        isReady: true
      });
    }
  };

  /**
   * Handle UserOnboardingFailed event - notify of failure
   */
  private readonly handleUserOnboardingFailed: EventHandler<UserOnboardingFailed> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_failed', {
        userId: event.userId,
        reason: event.reason,
        step: event.failedComponent
      });
    }
  };

  /**
   * Handle UserOnboardingTimeout event - notify of timeout
   */
  private readonly handleUserOnboardingTimeout: EventHandler<UserOnboardingTimeout> = async (event) => {

    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace != null) {
      roomNamespace.emit('user_onboarding_timeout', {
        userId: event.userId,
        timeoutAfter: event.timeoutAfterMs
      });
    }
  };

  /**
   * Handle UserCreated event - broadcast to relevant contexts
   */
  private readonly handleUserCreated: EventHandler<UserCreated> = async (_event) => {

    // This could be used for user management dashboards or monitoring
    // For now, we'll just log it as user creation is typically not broadcast
  };

  /**
   * Handle UserProfileUpdated event - notify relevant rooms
   */
  private readonly handleUserProfileUpdated: EventHandler<UserProfileUpdated> = async (_event) => {

    // This could notify rooms where the user is present about profile changes
    // Implementation would depend on specific requirements
  };
}
