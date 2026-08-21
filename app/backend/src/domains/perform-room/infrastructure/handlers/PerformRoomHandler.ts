import type { Socket, Namespace } from 'socket.io';
import type { PerformRoomStateService } from '../../application/PerformRoomStateService';
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { BaseRoomHandler } from '../../../../shared/infrastructure/handlers/BaseRoomHandler';
import type { PerformRoomState, UserPerformState, InstrumentCategory } from '../../domain/models/PerformRoomState';
import {
  createSocketErrorPayload,
  isValidPerformTimeSignature,
  INSTRUMENT_CONSTANTS,
  PERFORM_EVENTS,
} from '@jam-band/shared';
import { companionRuntimeRegistry } from '../../application/CompanionRuntimeRegistry';
import { PerformCompanionHandler } from './PerformCompanionHandler';
import { PerformEphemeralParamsHandler } from './PerformEphemeralParamsHandler';
import type { EventBus } from '../../../../shared/domain/events/EventBus';
import { RoomOccupancyChanged } from '../../../../shared/domain/events/RoomEvents';
import { RoomOccupancyService } from '../../../room-shared/application/RoomOccupancyService';
import type { RoomOccupancyOperations } from '../../../room-shared/application/RoomOccupancyService';
import * as occupancySocketHandlers from '../../../room-shared/application/occupancySocketHandlers';

export class PerformRoomHandler extends BaseRoomHandler<PerformRoomStateService, PerformRoomState> {
  /* eslint-disable @typescript-eslint/member-ordering */
  protected readonly roomType = 'perform' as const;
  protected readonly eventPrefix = 'perform';
  private readonly roomMembershipService: RoomMembershipService | undefined;
  private readonly companionHandler: PerformCompanionHandler;
  private readonly ephemeralParamsHandler: PerformEphemeralParamsHandler;

  // DEV-350 M4 Task 24: element occupancy (presence badges) — bound to the same Redis-backed
  // getState/saveState pair as the state service, adapted since RoomOccupancyService's
  // saveState takes the occupancy Map plus the state snapshot it already read, not a full
  // PerformRoomState (mirrors ArrangeRoomHandler's wiring exactly, Task 7). Reusing that
  // snapshot is safe under the room-wide mutex (TR-2) and avoids a second full state read.
  private readonly occupancyService = new RoomOccupancyService(
    (roomId) => this.stateService.getState(roomId),
    async (roomId, occupancy, state) => {
      await this.stateService.saveState(roomId, { ...state, occupancy, lastUpdated: new Date() });
    }
  );

  // Expose ephemeral commit helpers as public for event handlers (TR-10)
  public override clearAllEphemeralCommitsForUser(userId: string): void {
    super.clearAllEphemeralCommitsForUser(userId);
  }

  constructor(
    performRoomStateService: PerformRoomStateService,
    roomSessionManager: RoomSessionManager,
    roomLifecycleService: RoomLifecycleService,
    roomMembershipService?: RoomMembershipService,
    eventBus?: EventBus,
  ) {
    super(performRoomStateService, roomSessionManager, roomLifecycleService);
    this.roomMembershipService = roomMembershipService;
    this.companionHandler = new PerformCompanionHandler({
      stateService: this.stateService,
      getRoomMembershipService: () => this.roomMembershipService,
      validateSession: (socket, roomId) => this.validateSession(socket, roomId),
      handleError: (socket, error, context, roomId) => this.handleError(socket, error, context, roomId),
      // Surface companion add/remove to the lobby so room cards refresh their
      // companion count without anyone joining/leaving. Fire-and-forget.
      onCompanionCountChanged: eventBus
        ? (roomId) => void eventBus.publish(new RoomOccupancyChanged(roomId, 'companion_change'))
        : undefined,
      getSession: (socket) => this.getSession(socket),
      getOccupancyService: () => this.occupancyService,
    });
    this.ephemeralParamsHandler = new PerformEphemeralParamsHandler({
      stateService: this.stateService,
      getRoomMembershipService: () => this.roomMembershipService,
      validateSession: (socket, roomId) => this.validateSession(socket, roomId),
      handleError: (socket, error, context, roomId) => this.handleError(socket, error, context, roomId),
      scheduleEphemeralCommit: (roomId, userId, fieldName, value, commitHandler) =>
        this.scheduleEphemeralCommit(roomId, userId, fieldName, value, commitHandler),
      clearEphemeralCommit: (roomId, userId, fieldName) => this.clearEphemeralCommit(roomId, userId, fieldName),
    });
  }

  public getOccupancyService(): RoomOccupancyOperations {
    return this.occupancyService;
  }

  /**
   * Require existing state — throws if not found.
   * Use for mutation handlers where missing state indicates a bug or data corruption.
   */
  private async requireState(roomId: string): Promise<PerformRoomState> {
    const state = await this.stateService.getState(roomId);
    if (!state) {
      throw new Error(`Perform room state not found for room: ${roomId}`);
    }
    return state;
  }

  private syncCompanionRuntime(roomId: string, state: PerformRoomState): void {
    companionRuntimeRegistry.upsertFromPerformState(roomId, state);
  }

  async handleRequestState(socket: Socket, data: { roomId: string }): Promise<void> {
    const session = await this.validateSessionWithRetry(socket, data.roomId);
    if (!session) {
      socket.emit('error', createSocketErrorPayload('Invalid session or room'));
      return;
    }

    // For requestState, lazy-init is acceptable — late joiners need to see room state
    let state = await this.stateService.getState(data.roomId);
    if (!state) {
      state = await this.stateService.initializeState(data.roomId);
    }
    this.syncCompanionRuntime(data.roomId, state);

    const userStatesArray = Array.from(state.userStates.entries()).map(([_userId, userState]) => ({
      ...userState,
    }));

    // DEV-350: element occupancy (presence badges) for late joiners — same
    // serialization shape as Arrange's state_sync (ArrangeRoomHandler.ts), whose
    // FE consumes it via `setOccupancyBulk`. Without it a mid-session joiner
    // starts with an empty occupancy store and locally believes every container
    // is unclaimed.
    const occupancyArray = Array.from(state.occupancy.entries()).map(([elementId, occ]) => ({
      elementId,
      ...occ,
    }));

    socket.emit(PERFORM_EVENTS.STATE_SYNC, {
      userStates: userStatesArray,
      recordingStates: state.recordingStates,
      broadcastStates: state.broadcastStates,
      voiceStates: state.voiceStates,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      roomScale: state.roomScale,
      companions: state.companions,
      companionChordLength: state.companionChordLength,
      companionChordProgression: state.companionChordProgression,
      companionProgressionFlavor: state.companionProgressionFlavor,
      companionSelectedGenrePreset: state.companionSelectedGenrePreset,
      companionSelectedIntensity: state.companionSelectedIntensity,
      companionOverrideInstruments: state.companionOverrideInstruments,
      occupancy: occupancyArray,
    });

    loggingService.logInfo('Perform room state requested', {
      roomId: data.roomId,
      userId: session.userId,
      userCount: state.userStates.size,
    });
  }

  async handleUserStateUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      updates: Partial<UserPerformState>;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      const state = await this.requireState(data.roomId);

      let userState = state.userStates.get(session.userId);
      if (!userState) {
        // User not yet joined this perform room state — add them
        userState = {
          userId: session.userId,
          username: session.username,
          currentInstrument: data.updates.currentInstrument ?? INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT,
          currentCategory: data.updates.currentCategory ?? (INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY as InstrumentCategory),
          effectChains: {},
          isInstrumentPracticing: false,
          isPlaying: false,
        };
        await this.stateService.addUserState(data.roomId, session.userId, userState);
      } else {
        await this.stateService.updateUserState(data.roomId, session.userId, data.updates);
      }


      this.broadcast(namespace, data.roomId, 'user_state_updated', {
        userId: session.userId,
        updates: data.updates,
      });

      loggingService.logInfo('User state updated', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleUserStateUpdate', data.roomId);
    }
  }

  async handleBpmChange(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; bpm: number }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      const updatedState = await this.stateService.setBpm(data.roomId, data.bpm);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.broadcast(namespace, data.roomId, 'bpm_changed', {
        bpm: data.bpm,
        userId: session.userId,
      });

      loggingService.logInfo('BPM changed in perform room', {
        roomId: data.roomId,
        bpm: data.bpm,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleBpmChange', data.roomId);
    }
  }

  async handleScaleChange(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; rootNote: string; scale: 'major' | 'minor' }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      // side-effects only; live follow is driven by ROOM_SCALE_CHANGED
      const updatedState = await this.stateService.updateRoomScale(data.roomId, data.rootNote, data.scale);
      this.syncCompanionRuntime(data.roomId, updatedState);

      loggingService.logInfo('Scale changed in perform room', {
        roomId: data.roomId,
        rootNote: data.rootNote,
        scale: data.scale,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleScaleChange', data.roomId);
    }
  }

  async handleTimeSignatureUpdate(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; numerator: number; denominator?: number }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    if (!this.roomMembershipService) {
      socket.emit('error', createSocketErrorPayload('Membership service not available'));
      return;
    }

    try {
      const isOwner = await this.roomMembershipService.isRoomOwner(data.roomId, session.userId);
      if (!isOwner) {
        socket.emit('error', createSocketErrorPayload('Only room owners can change the time signature'));
        return;
      }

      const denominator = data.denominator ?? 4;
      const timeSignature = { numerator: data.numerator, denominator };

      if (data.numerator < 2 || data.numerator > 12) {
        socket.emit('error', createSocketErrorPayload('Invalid numerator. Must be between 2 and 12'));
        return;
      }

      if (!isValidPerformTimeSignature(timeSignature)) {
        socket.emit('error', createSocketErrorPayload('Invalid denominator. Must be 4 or 8'));
        return;
      }

      const updatedState = await this.stateService.updateTimeSignature(data.roomId, data.numerator, denominator);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.broadcast(namespace, data.roomId, 'room_time_signature_updated', {
        timeSignature,
        userId: session.userId,
      });

      loggingService.logInfo('Time signature updated in perform room', {
        roomId: data.roomId,
        numerator: data.numerator,
        denominator,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleTimeSignatureUpdate', data.roomId);
    }
  }

  async handleInstrumentChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      instrument: string;
      category: InstrumentCategory;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateUserState(data.roomId, session.userId, {
        currentInstrument: data.instrument,
        currentCategory: data.category,
      });

      // Also update main room state (Redis) so new users get instrument info on join
      if (this.roomMembershipService) {
        await this.roomMembershipService.updateUserInstrument(
          data.roomId, session.userId, data.instrument, data.category
        ).catch(err => loggingService.logError(err as Error, {
          context: 'PerformRoomHandler.handleInstrumentChange.syncMainRoomState',
          roomId: data.roomId, userId: session.userId,
        }));
      }

      this.broadcast(namespace, data.roomId, 'instrument_changed', {
        userId: session.userId,
        instrument: data.instrument,
        category: data.category,
      });

      loggingService.logInfo('Instrument changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
        instrument: data.instrument,
        category: data.category,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleInstrumentChange', data.roomId);
    }
  }

  /**
   * Handle synth params update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleSynthParamsUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
      instrument?: string;
      category?: string;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleSynthParamsUpdate(socket, namespace, data);
  }

  /**
   * Handle synth params commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleSynthParamsCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleSynthParamsCommit(socket, namespace, data);
  }

  /**
   * Handle instrument params update (EPHEMERAL — broadcast only, no Redis write)
   * DEV-301: non-synth instrument pre-gain, sibling to handleSynthParamsUpdate above.
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleInstrumentParamsUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
      instrument?: string;
      category?: string;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleInstrumentParamsUpdate(socket, namespace, data);
  }

  /**
   * Handle instrument params commit (COMMIT — save to Redis + broadcast committed)
   * DEV-301: non-synth instrument pre-gain, sibling to handleSynthParamsCommit above.
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleInstrumentParamsCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleInstrumentParamsCommit(socket, namespace, data);
  }

  async handleSequencerUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      sequencerState: {
        beats: unknown[];
        selectedBeat?: number;
        editMode?: boolean;
      };
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateUserState(data.roomId, session.userId, {
        sequencerState: data.sequencerState,
      });

      this.broadcast(namespace, data.roomId, 'sequencer_updated', {
        userId: session.userId,
        sequencerState: data.sequencerState,
      });

      loggingService.logInfo('Sequencer updated in perform room', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleSequencerUpdate', data.roomId);
    }
  }

  async handleRecordingStateChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      updates: {
        isAudioRecording?: boolean;
        isSessionRecording?: boolean;
        shadowCaptureStates?: Record<string, boolean>;
      };
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateRecordingState(data.roomId, data.updates);

      this.broadcast(namespace, data.roomId, 'recording_state_changed', {
        userId: session.userId,
        updates: data.updates,
      });

      loggingService.logInfo('Recording state changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleRecordingStateChange', data.roomId);
    }
  }

  async handleShadowCaptureStateChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      enabled: boolean;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateShadowCaptureState(data.roomId, session.userId, data.enabled);

      this.broadcast(namespace, data.roomId, 'shadow_capture_state_changed', {
        userId: session.userId,
        enabled: data.enabled,
      });

      loggingService.logInfo('Shadow capture state changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
        enabled: data.enabled,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleShadowCaptureStateChange', data.roomId);
    }
  }

  async handleMemberBroadcastStateChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      isActive: boolean;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateMemberBroadcastState(
        data.roomId,
        session.userId,
        session.username,
        data.isActive
      );

      this.broadcast(namespace, data.roomId, PERFORM_EVENTS.MEMBER_BROADCAST_STATE_CHANGED, {
        userId: session.userId,
        username: session.username,
        isActive: data.isActive,
      });

      loggingService.logInfo('Broadcast state changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
        isActive: data.isActive,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleMemberBroadcastStateChange', data.roomId);
    }
  }

  async handleVoiceStateChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      isMuted: boolean;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateVoiceState(data.roomId, session.userId, data.isMuted);

      this.broadcast(namespace, data.roomId, 'voice_state_changed', {
        userId: session.userId,
        isMuted: data.isMuted,
      });

      loggingService.logInfo('Voice state changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
        isMuted: data.isMuted,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleVoiceStateChange', data.roomId);
    }
  }

  async handleInstrumentPracticeStateChange(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      isPracticing: boolean;
    }
  ): Promise<void> {
    const session = await this.validateSession(socket, data.roomId);
    if (!session) return;

    try {
      await this.stateService.updateUserState(data.roomId, session.userId, {
        isInstrumentPracticing: data.isPracticing,
      });

      this.broadcast(namespace, data.roomId, 'instrument_practice_state_changed', {
        userId: session.userId,
        isPracticing: data.isPracticing,
      });

      loggingService.logInfo('Instrument practice state changed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
        isPracticing: data.isPracticing,
      });
    } catch (error) {
      this.handleError(socket, error as Error, 'PerformRoomHandler.handleInstrumentPracticeStateChange', data.roomId);
    }
  }

  /**
   * Handle effects chain update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleEffectsChainUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      chains: unknown;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleEffectsChainUpdate(socket, namespace, data);
  }

  /**
   * Handle effects chain commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   * Delegates to PerformEphemeralParamsHandler (extracted cluster, TR-20 split).
   */
  async handleEffectsChainCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      chains: unknown;
    }
  ): Promise<void> {
    return await this.ephemeralParamsHandler.handleEffectsChainCommit(socket, namespace, data);
  }

  async handleCompanionAdd(socket: Socket, namespace: Namespace, data: { roomId: string; instrumentId?: string }): Promise<void> {
    return await this.companionHandler.handleCompanionAdd(socket, namespace, data);
  }

  async handleCompanionRemove(socket: Socket, namespace: Namespace, data: { roomId: string; companionId: string }): Promise<void> {
    return await this.companionHandler.handleCompanionRemove(socket, namespace, data);
  }

  async handleCompanionUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; companionId: string; updates: unknown }): Promise<void> {
    return await this.companionHandler.handleCompanionUpdate(socket, namespace, data);
  }

  async handleCompanionBulkPresetUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      genrePreset?: unknown;
      embellishmentIntensity?: unknown;
      overrideInstruments?: unknown;
    },
  ): Promise<void> {
    return await this.companionHandler.handleCompanionBulkPresetUpdate(socket, namespace, data);
  }

  async handleCompanionPresetControlsUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      genrePreset?: unknown;
      embellishmentIntensity?: unknown;
      overrideInstruments?: unknown;
    },
  ): Promise<void> {
    return await this.companionHandler.handleCompanionPresetControlsUpdate(socket, namespace, data);
  }

  async handleCompanionPlayAll(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    return await this.companionHandler.handleCompanionPlayAll(socket, namespace, data);
  }

  async handleCompanionStopAll(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    return await this.companionHandler.handleCompanionStopAll(socket, namespace, data);
  }

  async handleCompanionSetProgressionFlavor(socket: Socket, namespace: Namespace, data: { roomId: string; flavor: string }): Promise<void> {
    return await this.companionHandler.handleCompanionSetProgressionFlavor(socket, namespace, data);
  }

  async handleCompanionSetChordLength(socket: Socket, namespace: Namespace, data: { roomId: string; barsPerChord: number }): Promise<void> {
    return await this.companionHandler.handleCompanionSetChordLength(socket, namespace, data);
  }

  async handleCompanionSetChordProgression(socket: Socket, namespace: Namespace, data: { roomId: string; progression: unknown }): Promise<void> {
    return await this.companionHandler.handleCompanionSetChordProgression(socket, namespace, data);
  }

  async handleCompanionVolumeEphemeral(socket: Socket, data: { roomId: string; companionId: string; volume: number }): Promise<void> {
    return await this.companionHandler.handleCompanionVolumeEphemeral(socket, data);
  }

  /**
   * Element occupancy (DEV-350 M4 Task 24) — thin facade delegations to `companionHandler`,
   * mirroring `ArrangeRoomHandler`'s `lockHandler` delegation exactly (Task 7). Replaces the
   * old per-resource companion volume/settings/progression lock facades.
   */
  async handleOccupancyJoin(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return await this.companionHandler.handleOccupancyJoin(socket, namespace, data);
  }

  async handleOccupancyLeave(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return await this.companionHandler.handleOccupancyLeave(socket, namespace, data);
  }

  async handleOccupancyHeartbeat(socket: Socket, data: { roomId: string; elementId: string }): Promise<void> {
    return await this.companionHandler.handleOccupancyHeartbeat(socket, data);
  }

  async handleUserLeave(roomId: string, userId: string, namespace: Namespace): Promise<void> {
    try {
      await this.stateService.removeUserState(roomId, userId);

      if (await this.stateService.removeVoiceState(roomId, userId)) {
        this.broadcast(namespace, roomId, 'voice_state_changed', {
          userId,
          isMuted: true,
        });
      }

      const removedBroadcast = await this.stateService.removeMemberBroadcastState(roomId, userId);
      if (removedBroadcast) {
        this.broadcast(namespace, roomId, PERFORM_EVENTS.MEMBER_BROADCAST_STATE_CHANGED, {
          userId,
          username: removedBroadcast.username,
          isActive: false,
        });
      }

      loggingService.logInfo('User left perform room, state cleaned up', {
        roomId,
        userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'PerformRoomHandler.handleUserLeave',
        roomId,
        userId,
      });
    }

    // DEV-350 M4 Task 24: release element occupancy (shared orchestration), replacing the old
    // blanket COMPANION_RELEASE_USER_LOCKS broadcast — OCCUPANCY_EVENTS.LEFT per element already
    // covers it generically (mirrors ArrangeLockHandler.handleUserLeaveLocks).
    //
    // Isolated in its own try/catch and run AFTER the state cleanup above (not the first
    // statement in the shared try block): RoomOccupancyService.releaseAllForUser goes through
    // a Redis mutex (executeWithLock) that THROWS after a 5s lock-acquisition timeout, and
    // BaseRoomStateService.saveState re-throws on Redis errors. If this ran first inside the
    // same try block, lock contention or a degraded Redis would silently skip
    // removeUserState/removeVoiceState/removeMemberBroadcastState for the leaving user and add
    // a ~5s stall to every leave — a FAILURE_PATTERNS "code gating a state reset" bug. A failure
    // releasing occupancy must never strand the rest of leave cleanup.
    try {
      await occupancySocketHandlers.releaseAllOccupancyForUser(this.occupancyService, roomId, userId, namespace);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'PerformRoomHandler.handleUserLeave.releaseAllOccupancyForUser',
        roomId,
        userId,
      });
    }
  }
}
