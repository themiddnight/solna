import type { Socket, Namespace } from 'socket.io';
import { BaseSocketHandler } from '../../../../shared/infrastructure/handlers/BaseSocketHandler';
import type { PerformRoomHandler } from './PerformRoomHandler';
import type { PerformBroadcastHandler } from '../../../room-management/infrastructure/handlers/PerformBroadcastHandler';
import type { NotePlayingHandler } from '../../../audio-processing/infrastructure/handlers/NotePlayingHandler';
import type { AudioRoutingHandler } from '../../../audio-processing/infrastructure/handlers/AudioRoutingHandler';
import type { PerformCollaborationHandler } from '../../../room-management/infrastructure/handlers/PerformCollaborationHandler';
import type { RoomMembershipHandler } from '../../../room-management/infrastructure/handlers/RoomMembershipHandler';
import { secureSocketEvent } from '../../../../middleware/security';
import {
  PERFORM_EVENTS,
  SHARED_EVENTS,
  OCCUPANCY_EVENTS,
  occupancyJoinSchema,
  occupancyLeaveSchema,
  performInstrumentPracticeStateChangeSchema,
  performShadowCaptureStateChangeSchema,
} from '@jam-band/shared';

export class PerformEventHandler extends BaseSocketHandler {
  /* eslint-disable @typescript-eslint/member-ordering */
  constructor(
    private readonly performRoomHandler: PerformRoomHandler,
    private readonly performBroadcastHandler: PerformBroadcastHandler,
    private readonly notePlayingHandler: NotePlayingHandler,
    private readonly audioRoutingHandler: AudioRoutingHandler,
    private readonly performCollaborationHandler: PerformCollaborationHandler,
    private readonly roomMembershipHandler: RoomMembershipHandler
  ) {
    super();
  }

  public handleConnection(socket: Socket, roomId: string, namespace: Namespace): void {
    this.bindPerformEvents(socket, roomId, namespace);
  }

  private bindPerformEvents(socket: Socket, roomId: string, namespace: Namespace): void {
    /* eslint-disable @typescript-eslint/no-floating-promises */
    socket.on(PERFORM_EVENTS.SEND_SEQUENCER_STATE, (data) => {
      void secureSocketEvent(
        PERFORM_EVENTS.SEND_SEQUENCER_STATE,
        null,
        (socket, data) => this.performCollaborationHandler.handleSendSequencerState(
          socket,
          (data as unknown) as { targetUserId: string; snapshot: { banks: Record<string, unknown>; settings: Record<string, unknown>; currentBank: string; } },
          namespace
        )
      )(socket, data);
    });

    socket.on(SHARED_EVENTS.KICK_USER, (data) => {
      secureSocketEvent(
        SHARED_EVENTS.KICK_USER,
        null,
        (socket, data) => this.performCollaborationHandler.handleKickUser(socket, data as { targetUserId: string }, namespace)
      )(socket, data);
    });

    // Scale follow events
    socket.on(PERFORM_EVENTS.ROOM_SCALE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.ROOM_SCALE_CHANGE,
        null,
        async (socket, data) => {
          const hasUpdated = await this.roomMembershipHandler.handleRoomScaleChange(
            socket,
            data as { rootNote: string; scale: 'major' | 'minor' },
            namespace
          );
          if (hasUpdated) {
            await this.performRoomHandler.handleScaleChange(socket, namespace, {
              ...(data as { rootNote: string; scale: 'major' | 'minor' }),
              roomId,
            } as { roomId: string; rootNote: string; scale: 'major' | 'minor' });
          }
        }
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.TOGGLE_FOLLOW_SCALE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.TOGGLE_FOLLOW_SCALE,
        null,
        (socket, data) => this.roomMembershipHandler.handleToggleFollowScale(socket, data as { followScale: boolean }, namespace)
      )(socket, data);
    });

    // Perform room events (stateful collaboration)
    socket.on(PERFORM_EVENTS.REQUEST_STATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.REQUEST_STATE,
        null,
        (socket, data) => this.performRoomHandler.handleRequestState(socket, { ...(data as Record<string, unknown>), roomId })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.USER_STATE_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.USER_STATE_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleUserStateUpdate(socket, namespace, {
          ...(data as { updates: Record<string, unknown> }),
          roomId,
        } as { roomId: string; updates: Record<string, unknown> })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.BPM_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.BPM_CHANGE,
        null,
        (socket, data) => this.performRoomHandler.handleBpmChange(socket, namespace, {
          ...(data as { bpm: number }),
          roomId,
        } as { roomId: string; bpm: number })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.ROOM_TIME_SIGNATURE_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.ROOM_TIME_SIGNATURE_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleTimeSignatureUpdate(socket, namespace, {
          ...(data as { numerator: number; denominator?: number }),
          roomId,
        } as { roomId: string; numerator: number; denominator?: number })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.CHANGE_INSTRUMENT, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.CHANGE_INSTRUMENT,
        null,
        (socket, data) => this.performRoomHandler.handleInstrumentChange(socket, namespace, {
          ...(data as { instrument: string; category: 'synth' | 'drums' | 'sampler' | 'effects' }),
          roomId,
        } as { roomId: string; instrument: string; category: 'synth' | 'drums' | 'sampler' | 'effects' })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.UPDATE_SYNTH_PARAMS, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.UPDATE_SYNTH_PARAMS,
        null,
        (socket, data) => this.performRoomHandler.handleSynthParamsUpdate(socket, namespace, {
          ...(data as { params: unknown; instrument?: string; category?: string }),
          roomId,
        } as { roomId: string; params: unknown; instrument?: string; category?: string })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.SYNTH_PARAMS_COMMIT, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.SYNTH_PARAMS_COMMIT,
        null,
        (socket, data) => this.performRoomHandler.handleSynthParamsCommit(socket, namespace, {
          ...(data as { params: unknown }),
          roomId,
        } as { roomId: string; params: unknown })
      )(socket, data);
    });

    // Non-synth instrument pre-gain (DEV-301) — sibling to UPDATE_SYNTH_PARAMS/
    // SYNTH_PARAMS_COMMIT above, same ephemeral/commit shape.
    socket.on(PERFORM_EVENTS.UPDATE_INSTRUMENT_PARAMS, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.UPDATE_INSTRUMENT_PARAMS,
        null,
        (socket, data) => this.performRoomHandler.handleInstrumentParamsUpdate(socket, namespace, {
          ...(data as { params: unknown; instrument?: string; category?: string }),
          roomId,
        } as { roomId: string; params: unknown; instrument?: string; category?: string })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMIT, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMIT,
        null,
        (socket, data) => this.performRoomHandler.handleInstrumentParamsCommit(socket, namespace, {
          ...(data as { params: unknown }),
          roomId,
        } as { roomId: string; params: unknown })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.SEQUENCER_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.SEQUENCER_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleSequencerUpdate(socket, namespace, {
          ...(data as { sequencerState: { beats: unknown[]; selectedBeat?: number; editMode?: boolean } }),
          roomId,
        } as { roomId: string; sequencerState: { beats: unknown[]; selectedBeat?: number; editMode?: boolean } })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.RECORDING_STATE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.RECORDING_STATE_CHANGE,
        null,
        (socket, data) => this.performRoomHandler.handleRecordingStateChange(socket, namespace, {
          ...(data as { updates: { isAudioRecording?: boolean; isSessionRecording?: boolean; shadowCaptureStates?: Record<string, boolean> } }),
          roomId,
        } as { roomId: string; updates: { isAudioRecording?: boolean; isSessionRecording?: boolean; shadowCaptureStates?: Record<string, boolean> } })
      )(socket, data);
    });

    // Companion events
    socket.on(PERFORM_EVENTS.COMPANION_ADD, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_ADD,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionAdd(socket, namespace, {
          ...(data as { instrumentId?: string }),
          roomId,
        } as { roomId: string; instrumentId?: string })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_REMOVE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_REMOVE,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionRemove(socket, namespace, {
          ...(data as { companionId: string }),
          roomId,
        } as { roomId: string; companionId: string })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionUpdate(socket, namespace, {
          ...(data as { companionId: string; updates: unknown }),
          roomId,
        } as { roomId: string; companionId: string; updates: unknown })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_BULK_PRESET_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_BULK_PRESET_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionBulkPresetUpdate(socket, namespace, {
          ...(data as { genrePreset?: unknown; embellishmentIntensity?: unknown; overrideInstruments?: unknown }),
          roomId,
        })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_PRESET_CONTROLS_UPDATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_PRESET_CONTROLS_UPDATE,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionPresetControlsUpdate(socket, namespace, {
          ...(data as { genrePreset?: unknown; embellishmentIntensity?: unknown; overrideInstruments?: unknown }),
          roomId,
        })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_PLAY_ALL, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_PLAY_ALL,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionPlayAll(socket, namespace, {
          ...(data as Record<string, unknown>),
          roomId,
        })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_STOP_ALL, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_STOP_ALL,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionStopAll(socket, namespace, {
          ...(data as Record<string, unknown>),
          roomId,
        })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_SET_CHORD_LENGTH, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_SET_CHORD_LENGTH,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionSetChordLength(socket, namespace, {
          ...(data as { barsPerChord: number }),
          roomId,
        } as { roomId: string; barsPerChord: number })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_SET_CHORD_PROGRESSION, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_SET_CHORD_PROGRESSION,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionSetChordProgression(socket, namespace, {
          ...(data as { progression: unknown }),
          roomId,
        } as { roomId: string; progression: unknown })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_SET_PROGRESSION_FLAVOR, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_SET_PROGRESSION_FLAVOR,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionSetProgressionFlavor(socket, namespace, {
          ...(data as { flavor: string }),
          roomId,
        } as { roomId: string; flavor: string })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL,
        null,
        (socket, data) => this.performRoomHandler.handleCompanionVolumeEphemeral(socket, {
          ...(data as { companionId: string; volume: number }),
          roomId,
        } as { roomId: string; companionId: string; volume: number })
      )(socket, data);
    });

    // Element occupancy (DEV-350 M4 Task 24) — replaces the old
    // COMPANION_VOLUME_LOCK/_UNLOCK, COMPANION_SETTINGS_LOCK/_UNLOCK and
    // COMPANION_PROGRESSION_LOCK/_UNLOCK registrations (Task 7's Arrange wiring, same schemas).
    // HEARTBEAT reuses occupancyJoinSchema: same `{ roomId, elementId }` shape.
    socket.on(OCCUPANCY_EVENTS.JOIN, (data) => {
      secureSocketEvent(
        OCCUPANCY_EVENTS.JOIN,
        occupancyJoinSchema,
        (socket, validatedData) => this.performRoomHandler.handleOccupancyJoin(socket, namespace, validatedData)
      )(socket, { ...data, roomId });
    });

    socket.on(OCCUPANCY_EVENTS.LEAVE, (data) => {
      secureSocketEvent(
        OCCUPANCY_EVENTS.LEAVE,
        occupancyLeaveSchema,
        (socket, validatedData) => this.performRoomHandler.handleOccupancyLeave(socket, namespace, validatedData)
      )(socket, { ...data, roomId });
    });

    socket.on(OCCUPANCY_EVENTS.HEARTBEAT, (data) => {
      secureSocketEvent(
        OCCUPANCY_EVENTS.HEARTBEAT,
        occupancyJoinSchema,
        (socket, validatedData) => this.performRoomHandler.handleOccupancyHeartbeat(socket, validatedData)
      )(socket, { ...data, roomId });
    });

    socket.on(PERFORM_EVENTS.SHADOW_CAPTURE_STATE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.SHADOW_CAPTURE_STATE_CHANGE,
        performShadowCaptureStateChangeSchema,
        (socket, validatedData) => this.performRoomHandler.handleShadowCaptureStateChange(
          socket,
          namespace,
          validatedData
        )
      )(socket, { ...data, roomId });
    });

    socket.on(PERFORM_EVENTS.MEMBER_BROADCAST_STATE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.MEMBER_BROADCAST_STATE_CHANGE,
        null,
        (socket, data) => this.performRoomHandler.handleMemberBroadcastStateChange(socket, namespace, {
          ...(data as { isActive: boolean }),
          roomId,
        } as { roomId: string; isActive: boolean })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.VOICE_STATE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.VOICE_STATE_CHANGE,
        null,
        (socket, data) => this.performRoomHandler.handleVoiceStateChange(socket, namespace, {
          ...(data as { isMuted: boolean }),
          roomId,
        } as { roomId: string; isMuted: boolean })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.INSTRUMENT_PRACTICE_STATE_CHANGE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.INSTRUMENT_PRACTICE_STATE_CHANGE,
        performInstrumentPracticeStateChangeSchema,
        (socket, validatedData) => this.performRoomHandler.handleInstrumentPracticeStateChange(
          socket,
          namespace,
          validatedData
        )
      )(socket, { ...data, roomId });
    });

    // Effects Chain
    socket.on(PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN,
        null,
        (socket, data) => this.performRoomHandler.handleEffectsChainUpdate(socket, namespace, {
          ...(data as { chains: unknown }),
          roomId,
        } as { roomId: string; chains: unknown })
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.EFFECTS_CHAIN_COMMIT, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.EFFECTS_CHAIN_COMMIT,
        null,
        (socket, data) => this.performRoomHandler.handleEffectsChainCommit(socket, namespace, {
          ...(data as { chains: unknown }),
          roomId,
        } as { roomId: string; chains: unknown })
      )(socket, data);
    });

    // Instrument Swap
    socket.on(PERFORM_EVENTS.REQUEST_INSTRUMENT_SWAP, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.REQUEST_INSTRUMENT_SWAP,
        null,
        (socket, data) => this.performCollaborationHandler.handleRequestInstrumentSwap(
          socket,
          data as { targetUserId: string; sequencerState?: Record<string, unknown>; synthParams?: Record<string, unknown> },
          namespace
        )
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.APPROVE_INSTRUMENT_SWAP, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.APPROVE_INSTRUMENT_SWAP,
        null,
        (socket, data) => this.performCollaborationHandler.handleApproveInstrumentSwap(
          socket,
          data as { requesterId: string; sequencerState?: Record<string, unknown>; synthParams?: Record<string, unknown> },
          namespace
        )
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.REJECT_INSTRUMENT_SWAP, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.REJECT_INSTRUMENT_SWAP,
        null,
        (socket, data) => this.performCollaborationHandler.handleRejectInstrumentSwap(socket, data as { requesterId: string }, namespace)
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.CANCEL_INSTRUMENT_SWAP, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.CANCEL_INSTRUMENT_SWAP,
        null,
        (socket, _data) => this.performCollaborationHandler.handleCancelInstrumentSwap(socket, namespace)
      )(socket, data);
    });

    // Sequencer State Request
    socket.on(PERFORM_EVENTS.REQUEST_SEQUENCER_STATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.REQUEST_SEQUENCER_STATE,
        null,
        (socket, data) => this.performCollaborationHandler.handleRequestSequencerState(socket, data as { targetUserId: string }, namespace)
      )(socket, data);
    });

    // Perform room broadcast events (for audience HLS streaming)
    socket.on(PERFORM_EVENTS.TOGGLE_BROADCAST, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.TOGGLE_BROADCAST,
        null,
        (socket, data) => this.performBroadcastHandler.handleToggleBroadcast(
          socket,
          data as { isBroadcasting: boolean },
          namespace
        )
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK,
        null,
        (socket, data) => this.performBroadcastHandler.handleBroadcastAudioChunk(
          socket,
          data as { chunk: string; timestamp: number; sequenceNumber: number; isInitSegment?: boolean },
          namespace
        )
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.REQUEST_BROADCAST_STATE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.REQUEST_BROADCAST_STATE,
        null,
        (socket, _data) => this.performBroadcastHandler.handleRequestBroadcastState(socket)
      )(socket, data);
    });

    // Note playing events (Delegated to NotePlayingHandler)
    socket.on(PERFORM_EVENTS.PLAY_NOTE, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.PLAY_NOTE,
        null,
        (socket, data) => this.notePlayingHandler.handlePlayNoteNamespace(
          socket,
          data as { notes: string[]; velocity: number; instrument: string; category: string; eventType: 'note_on' | 'note_off' | 'sustain_on' | 'sustain_off'; isKeyHeld?: boolean; sampleNotes?: string[] },
          namespace
        )
      )(socket, data);
    });

    socket.on(PERFORM_EVENTS.STOP_ALL_NOTES, (data) => {
      secureSocketEvent(
        PERFORM_EVENTS.STOP_ALL_NOTES,
        null,
        (socket, data) => this.notePlayingHandler.handleStopAllNotesNamespace(
          socket,
          data as { instrument: string; category: string },
          namespace
        )
      )(socket, data);
    });
  }

  // Helper methods to clean up resources on disconnect
  public handleUserLeave(roomId: string, userId: string, namespace: Namespace): void {
    this.performCollaborationHandler.handleUserDisconnect(userId, namespace);
    this.performRoomHandler.handleUserLeave(roomId, userId, namespace);
    // TR-10: Clear any pending ephemeral commits for disconnected user
    this.performRoomHandler.clearAllEphemeralCommitsForUser(userId);
  }
}
