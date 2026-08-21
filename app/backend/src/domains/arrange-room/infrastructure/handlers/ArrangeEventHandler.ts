/* eslint-disable @typescript-eslint/no-floating-promises */
import type { z } from 'zod';
import type { Socket, Namespace } from 'socket.io';
import { BaseSocketHandler } from '../../../../shared/infrastructure/handlers/BaseSocketHandler';
import type { ArrangeRoomHandler } from './ArrangeRoomHandler';
import { secureSocketEvent } from '../../../../middleware/security';
import { checkSocketRateLimitAsync } from '../../../../middleware/rateLimit';
import { ARRANGE_EVENTS, OCCUPANCY_EVENTS, SOCKET_ERROR_CODES, createSocketErrorPayload } from '@jam-band/shared';
import { toDecibels } from '../../domain/models/ArrangeRoomState';
import {
  arrangeRequestStateSchema,
  arrangeTrackAddSchema,
  arrangeTrackUpdateSchema,
  arrangeTrackDeleteSchema,
  arrangeTrackReorderSchema,
  arrangeTrackInstrumentChangeSchema,
  arrangeRegionAddSchema,
  arrangeRegionUpdateSchema,
  arrangeRegionMoveSchema,
  arrangeRegionDragSchema,
  arrangeRegionDeleteSchema,
  arrangeRecordingPreviewSchema,
  arrangeRecordingPreviewEndSchema,
  arrangeNoteAddSchema,
  arrangeNoteUpdateSchema,
  arrangeNoteDeleteSchema,
  arrangeEffectChainUpdateSchema,
  arrangeMasterVolumeUpdateSchema,
  arrangeSynthParamsUpdateSchema,
  arrangeInstrumentParamsUpdateSchema,
  arrangeBpmUpdateSchema,
  arrangeTimeSignatureUpdateSchema,
  arrangeSelectionChangeSchema,
  occupancyJoinSchema,
  occupancyLeaveSchema,
  arrangeVoiceStateSchema,
  arrangeMarkerAddSchema,
  arrangeMarkerUpdateSchema,
  arrangeMarkerDeleteSchema,
  arrangeFullStateUpdateSchema,
  arrangeMonitorShareStateSchema,
  arrangeMonitorShareNoteSchema,
  arrangeSaveLockRequestSchema,
  arrangeSaveLockReleaseSchema,
  arrangeChordBlockAddSchema,
  arrangeChordBlockRemoveSchema,
  arrangeChordBlockDragSchema,
  arrangeChordBlockDragCommitSchema,
  arrangeChordBlockUpdateSchema,
  arrangeCompanionConfigUpdateSchema,
  arrangeCompanionConfigCommitSchema,
  arrangeCompanionRegionConvertSchema,
  arrangeCompanionRegionRevertSchema,
} from '@jam-band/shared';
import type { ArrangeRegionAddData } from '@jam-band/shared';
import type { Decibels, Region } from '../../domain/models/ArrangeRoomState';

/** DEV-304: the Zod-inferred shape of a `region_add`/`full_state_update` region DTO — its
 * companion-derived `volume` field(s) are still plain `number` (shared package can't import
 * the backend-local `Decibels` brand), unlike the domain `Region` these get brand-cast into.
 * Derived from `ArrangeRegionAddData['region']` (rather than importing `regionSchema` as a
 * value just to `z.infer` it) to keep this a type-only import. */
type IncomingRegion = ArrangeRegionAddData['region'];

/**
 * DEV-303 (final review fix, Critical 1): brand-cast an update payload's optional `volume`
 * field to `Decibels`, WITHOUT ever introducing a `volume` key that wasn't in the input.
 * Zod omits absent optional keys entirely from its parsed output — the naive
 * `volume: v === undefined ? undefined : toDecibels(v)` pattern always re-adds a `volume` key
 * set to explicit `undefined`, and the downstream `{ ...track, ...updates }` spread in
 * ArrangeRoomStateMutations copies own keys INCLUDING `undefined`-valued ones, silently wiping
 * the track's real stored volume on any non-volume update (rename/pan/color/etc).
 *
 * Destructuring out `volume` (rather than casting the whole object) keeps this branding-only —
 * `rest` never had a `volume` key at runtime NOR in its type once destructured, so re-adding
 * `Decibels`-typed `volume` only when it was actually present needs no unsafe cast at all.
 */
function withVolumeInDecibels<T extends { volume?: number | undefined }>(
  updates: T,
): Omit<T, 'volume'> & { volume?: Decibels } {
  const { volume, ...rest } = updates;
  if (volume === undefined) {
    return rest;
  }
  return { ...rest, volume: toDecibels(volume) };
}

/**
 * DEV-304: brand-cast a companion region config's `volume` (dB, ALWAYS present on a full
 * `CompanionRegionConfig` — unlike the optional-patch case `withVolumeInDecibels` handles
 * above) to `Decibels`. Zod already range-checked it to -60..+12 dB (companionRegionConfigSchema).
 */
function withCompanionConfigVolumeInDecibels<T extends { volume: number }>(
  config: T,
): Omit<T, 'volume'> & { volume: Decibels } {
  return { ...config, volume: toDecibels(config.volume) };
}

/**
 * DEV-304: brand-cast the companion-derived `volume` field(s) on an incoming region DTO —
 * a `companion` region's own `config.volume`, or a `midi` region's optional
 * `companionMetadata.config.volume` (carried when the region was converted from a companion
 * region, DEV-279 Phase 3 Task 3.3a). `audio` regions carry no companion config and pass
 * through unchanged.
 *
 * DEV-304 (fix round 1): the midi branch used to do
 * `companionMetadata: region.companionMetadata ? { ... } : undefined`, which — same anti-pattern
 * class as `withVolumeInDecibels` above (DEV-303) — ALWAYS re-adds a `companionMetadata` own key,
 * set to explicit `undefined` on a plain MIDI region that never had one. Harmless through today's
 * two consumers (`addRegionToState` appends the whole object; `setFullState` replaces wholesale),
 * but `updateRegionInState` does a `{ ...existingRegion, ...updates }` spread-merge one function
 * away — if this helper's output ever flows through that path, the `undefined`-valued key would
 * silently wipe a region's real `companionMetadata`. Destructure instead, so `rest` never has a
 * `companionMetadata` key when the input didn't, and only re-add it when genuinely present.
 */
function withRegionVolumeInDecibels(region: IncomingRegion): Region {
  if (region.type === 'companion') {
    return { ...region, config: withCompanionConfigVolumeInDecibels(region.config) };
  }
  if (region.type === 'midi') {
    const { companionMetadata, ...rest } = region;
    if (!companionMetadata) {
      return rest;
    }
    return {
      ...rest,
      companionMetadata: {
        ...companionMetadata,
        config: withCompanionConfigVolumeInDecibels(companionMetadata.config),
      },
    };
  }
  return region;
}

export class ArrangeEventHandler extends BaseSocketHandler {
  constructor(private readonly arrangeRoomHandler: ArrangeRoomHandler) {
    super();
  }

  public handleConnection(socket: Socket, roomId: string, namespace: Namespace): void {
    this.bindArrangeEvents(socket, roomId, namespace);
  }

  // Method to handle user leave, delegated to ArrangeRoomHandler
  public handleUserLeave(roomId: string, userId: string, namespace: Namespace): void {
    this.arrangeRoomHandler.handleUserLeave(roomId, userId, namespace);
    // TR-10: Clear any pending ephemeral commits for disconnected user
    this.arrangeRoomHandler.clearAllEphemeralCommitsForUser(userId);
  }

  private async executeRateLimitedEvent<S extends z.ZodTypeAny>(
    socket: Socket,
    eventName: string,
    schema: S,
    handler: (socket: Socket, data: z.infer<S>) => void,
    rawData: unknown,
  ): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, eventName);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${eventName}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        {
          code: SOCKET_ERROR_CODES.RATE_LIMITED,
          retryAfter: rateLimitCheck.retryAfter,
        },
      ));
      return;
    }
    secureSocketEvent(eventName, schema, handler)(socket, rawData);
  }

  private bindArrangeEvents(socket: Socket, roomId: string, namespace: Namespace): void {
    // Every registration hands the validated, Zod-inferred shared DTO (`d`) straight
    // to the ArrangeRoomHandler with no cast: the arrange event schemas mirror the
    // backend domain shapes exactly (see shared/src/validation/schemas.ts), and the
    // domain optional fields carry `| undefined` to match exactOptionalPropertyTypes.
    socket.on(ARRANGE_EVENTS.REQUEST_STATE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.REQUEST_STATE, arrangeRequestStateSchema,
        (socket, d) => this.arrangeRoomHandler.handleRequestState(socket, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_ADD, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_ADD, arrangeTrackAddSchema,
        // DEV-303: Zod already range-checked track.volume to -60..+12 dB (trackSchema) —
        // brand-cast at this trust boundary so it satisfies the domain's `Decibels` type.
        (socket, d) => this.arrangeRoomHandler.handleTrackAdd(socket, namespace, {
          ...d,
          track: { ...d.track, volume: toDecibels(d.track.volume) },
        }), data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_UPDATE, arrangeTrackUpdateSchema,
        // DEV-303: same brand-cast at the boundary; volume is optional on an update payload.
        // See `withVolumeInDecibels` above — must never add a `volume` key when absent.
        (socket, d) => this.arrangeRoomHandler.handleTrackUpdate(socket, namespace, {
          ...d,
          updates: withVolumeInDecibels(d.updates),
        }), data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_DELETE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_DELETE, arrangeTrackDeleteSchema,
        (socket, d) => this.arrangeRoomHandler.handleTrackDelete(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_INSTRUMENT_CHANGE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_INSTRUMENT_CHANGE, arrangeTrackInstrumentChangeSchema,
        (socket, d) => this.arrangeRoomHandler.handleTrackInstrumentChange(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_REORDER, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_REORDER, arrangeTrackReorderSchema,
        (socket, d) => this.arrangeRoomHandler.handleTrackReorder(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_ADD, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_ADD, arrangeRegionAddSchema,
        // DEV-304: brand-cast a companion/converted-midi region's config volume at this
        // trust boundary — see `withRegionVolumeInDecibels`.
        (socket, d) => this.arrangeRoomHandler.handleRegionAdd(socket, namespace, {
          ...d,
          region: withRegionVolumeInDecibels(d.region),
        }), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_UPDATE, arrangeRegionUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleRegionUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_MOVE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_MOVE, arrangeRegionMoveSchema,
        (socket, d) => this.arrangeRoomHandler.handleRegionMove(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_DRAG, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_DRAG, arrangeRegionDragSchema,
        (socket, d) => this.arrangeRoomHandler.handleRegionDrag(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_DRAG_END, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_DRAG_END, arrangeRegionDragSchema,
        (socket, d) => this.arrangeRoomHandler.handleRegionDragEnd(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.REGION_DELETE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.REGION_DELETE, arrangeRegionDeleteSchema,
        (socket, d) => this.arrangeRoomHandler.handleRegionDelete(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.RECORDING_PREVIEW, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.RECORDING_PREVIEW, arrangeRecordingPreviewSchema,
        (socket, d) => this.arrangeRoomHandler.handleRecordingPreview(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.RECORDING_PREVIEW_END, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.RECORDING_PREVIEW_END, arrangeRecordingPreviewEndSchema,
        (socket, d) => this.arrangeRoomHandler.handleRecordingPreviewEnd(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.NOTE_ADD, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.NOTE_ADD, arrangeNoteAddSchema,
        (socket, d) => this.arrangeRoomHandler.handleNoteAdd(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.NOTE_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.NOTE_UPDATE, arrangeNoteUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleNoteUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.NOTE_DELETE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.NOTE_DELETE, arrangeNoteDeleteSchema,
        (socket, d) => this.arrangeRoomHandler.handleNoteDelete(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.NOTE_REALTIME_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.NOTE_REALTIME_UPDATE, arrangeNoteUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleNoteRealtimeUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.EFFECT_CHAIN_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.EFFECT_CHAIN_UPDATE, arrangeEffectChainUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleEffectChainUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.EFFECT_CHAIN_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.EFFECT_CHAIN_COMMIT, arrangeEffectChainUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleEffectChainCommit(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.SYNTH_PARAMS_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.SYNTH_PARAMS_UPDATE, arrangeSynthParamsUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleSynthParamsUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.SYNTH_PARAMS_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.SYNTH_PARAMS_COMMIT, arrangeSynthParamsUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleSynthParamsCommit(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.INSTRUMENT_PARAMS_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.INSTRUMENT_PARAMS_UPDATE, arrangeInstrumentParamsUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleInstrumentParamsUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.INSTRUMENT_PARAMS_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.INSTRUMENT_PARAMS_COMMIT, arrangeInstrumentParamsUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleInstrumentParamsCommit(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.TRACK_PROPERTY_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.TRACK_PROPERTY_COMMIT, arrangeTrackUpdateSchema,
        // DEV-303: same brand-cast at the boundary as TRACK_UPDATE above — see
        // `withVolumeInDecibels` for why this must never add an `undefined` `volume` key.
        (socket, d) => this.arrangeRoomHandler.handleTrackPropertyCommit(socket, namespace, {
          ...d,
          updates: withVolumeInDecibels(d.updates),
        }), data);
    });

    socket.on(ARRANGE_EVENTS.MASTER_VOLUME_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.MASTER_VOLUME_UPDATE, arrangeMasterVolumeUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleMasterVolumeUpdate(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.MASTER_VOLUME_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.MASTER_VOLUME_COMMIT, arrangeMasterVolumeUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleMasterVolumeCommit(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.BPM_CHANGE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.BPM_CHANGE, arrangeBpmUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleBpmChange(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.TIME_SIGNATURE_CHANGE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.TIME_SIGNATURE_CHANGE, arrangeTimeSignatureUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleTimeSignatureChange(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.SELECTION_CHANGE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.SELECTION_CHANGE, arrangeSelectionChangeSchema,
        (socket, d) => this.arrangeRoomHandler.handleSelectionChange(socket, namespace, d))(socket, data);
    });

    // Element occupancy (DEV-350 M2) — replaces the old LOCK_ACQUIRE/LOCK_RELEASE primitive-lock
    // events (Task 7). HEARTBEAT reuses occupancyJoinSchema: same `{ roomId, elementId }` shape.
    socket.on(OCCUPANCY_EVENTS.JOIN, (data) => {
      secureSocketEvent(OCCUPANCY_EVENTS.JOIN, occupancyJoinSchema,
        (socket, d) => this.arrangeRoomHandler.handleOccupancyJoin(socket, namespace, d))(socket, data);
    });

    socket.on(OCCUPANCY_EVENTS.LEAVE, (data) => {
      secureSocketEvent(OCCUPANCY_EVENTS.LEAVE, occupancyLeaveSchema,
        (socket, d) => this.arrangeRoomHandler.handleOccupancyLeave(socket, namespace, d))(socket, data);
    });

    socket.on(OCCUPANCY_EVENTS.HEARTBEAT, (data) => {
      secureSocketEvent(OCCUPANCY_EVENTS.HEARTBEAT, occupancyJoinSchema,
        (socket, d) => this.arrangeRoomHandler.handleOccupancyHeartbeat(socket, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.VOICE_STATE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.VOICE_STATE, arrangeVoiceStateSchema,
        (socket, d) => this.arrangeRoomHandler.handleVoiceState(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.PROJECT_SCALE_CHANGE, async (data: { roomId: string; rootNote: string; scale: 'major' | 'minor' }) => {
      const rateLimitCheck = await checkSocketRateLimitAsync(socket, ARRANGE_EVENTS.PROJECT_SCALE_CHANGE);
      if (!rateLimitCheck.allowed) {
        socket.emit('error', createSocketErrorPayload(
          `Rate limit exceeded for project scale change. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          {
            code: SOCKET_ERROR_CODES.RATE_LIMITED,
            retryAfter: rateLimitCheck.retryAfter,
          },
        ));
        return;
      }
      this.arrangeRoomHandler.handleProjectScaleChange(socket, namespace, data);
    });

    socket.on(ARRANGE_EVENTS.MARKER_ADD, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.MARKER_ADD, arrangeMarkerAddSchema,
        (socket, d) => this.arrangeRoomHandler.handleMarkerAdd(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.MARKER_UPDATE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.MARKER_UPDATE, arrangeMarkerUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleMarkerUpdate(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.MARKER_DELETE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.MARKER_DELETE, arrangeMarkerDeleteSchema,
        (socket, d) => this.arrangeRoomHandler.handleMarkerDelete(socket, namespace, d))(socket, data);
    });

    socket.on(ARRANGE_EVENTS.FULL_STATE_UPDATE, (data) => {
      secureSocketEvent(ARRANGE_EVENTS.FULL_STATE_UPDATE, arrangeFullStateUpdateSchema,
        // DEV-303/DEV-304: same brand-cast at the boundary, applied across the whole tracks
        // array (track volume) and regions array (companion region config volume).
        (socket, d) => this.arrangeRoomHandler.handleFullStateUpdate(socket, namespace, {
          ...d,
          state: {
            ...d.state,
            tracks: d.state.tracks.map((track) => ({ ...track, volume: toDecibels(track.volume) })),
            regions: d.state.regions.map((region) => withRegionVolumeInDecibels(region)),
          },
        }))(socket, data);
    });

    // Monitor-share events — DEV-191: validated (Zod) + rate-limited like every other arrange event.
    socket.on(ARRANGE_EVENTS.MONITOR_SHARE_STATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.MONITOR_SHARE_STATE, arrangeMonitorShareStateSchema,
        (socket, d) => this.arrangeRoomHandler.handleMonitorShareState(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.MONITOR_SHARE_NOTE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.MONITOR_SHARE_NOTE, arrangeMonitorShareNoteSchema,
        (socket, d) => this.arrangeRoomHandler.handleMonitorShareNote(socket, namespace, d), data);
    });

    // Save lock events for collaborative project saving
    socket.on(ARRANGE_EVENTS.SAVE_LOCK_REQUEST, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.SAVE_LOCK_REQUEST, arrangeSaveLockRequestSchema,
        (socket, d) => this.arrangeRoomHandler.handleSaveLockRequest(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.SAVE_LOCK_RELEASE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.SAVE_LOCK_RELEASE, arrangeSaveLockReleaseSchema,
        (socket, d) => this.arrangeRoomHandler.handleSaveLockRelease(socket, namespace, d), data);
    });

    // Chord track block events (DEV-279 P1)
    socket.on(ARRANGE_EVENTS.CHORD_BLOCK_ADD, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.CHORD_BLOCK_ADD, arrangeChordBlockAddSchema,
        (socket, d) => this.arrangeRoomHandler.handleChordBlockAdd(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.CHORD_BLOCK_REMOVE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.CHORD_BLOCK_REMOVE, arrangeChordBlockRemoveSchema,
        (socket, d) => this.arrangeRoomHandler.handleChordBlockRemove(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.CHORD_BLOCK_DRAG, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.CHORD_BLOCK_DRAG, arrangeChordBlockDragSchema,
        (socket, d) => this.arrangeRoomHandler.handleChordBlockDrag(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.CHORD_BLOCK_DRAG_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.CHORD_BLOCK_DRAG_COMMIT, arrangeChordBlockDragCommitSchema,
        (socket, d) => this.arrangeRoomHandler.handleChordBlockDragCommit(socket, namespace, d), data);
    });

    socket.on(ARRANGE_EVENTS.CHORD_BLOCK_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.CHORD_BLOCK_UPDATE, arrangeChordBlockUpdateSchema,
        (socket, d) => this.arrangeRoomHandler.handleChordBlockUpdate(socket, namespace, d), data);
    });

    // Companion-region config sync (DEV-279 P2 Task 2.8)
    socket.on(ARRANGE_EVENTS.COMPANION_CONFIG_UPDATE, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.COMPANION_CONFIG_UPDATE, arrangeCompanionConfigUpdateSchema,
        // DEV-304: `updates.volume` is an optional patch field — reuse `withVolumeInDecibels`.
        (socket, d) => this.arrangeRoomHandler.handleCompanionConfigUpdate(socket, namespace, {
          ...d,
          updates: withVolumeInDecibels(d.updates),
        }), data);
    });

    socket.on(ARRANGE_EVENTS.COMPANION_CONFIG_COMMIT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.COMPANION_CONFIG_COMMIT, arrangeCompanionConfigCommitSchema,
        (socket, d) => this.arrangeRoomHandler.handleCompanionConfigCommit(socket, namespace, {
          ...d,
          updates: withVolumeInDecibels(d.updates),
        }), data);
    });

    // Companion region convert/revert (DEV-279 Phase 3 Task 3.3a)
    socket.on(ARRANGE_EVENTS.COMPANION_REGION_CONVERT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.COMPANION_REGION_CONVERT, arrangeCompanionRegionConvertSchema,
        // DEV-304: `companionMetadata.config.volume` is always present here (a full config
        // snapshot, not a patch) — reuse `withCompanionConfigVolumeInDecibels`.
        (socket, d) => this.arrangeRoomHandler.handleCompanionRegionConvert(socket, namespace, {
          ...d,
          companionMetadata: {
            ...d.companionMetadata,
            config: withCompanionConfigVolumeInDecibels(d.companionMetadata.config),
          },
        }), data);
    });

    socket.on(ARRANGE_EVENTS.COMPANION_REGION_REVERT, (data) => {
      this.executeRateLimitedEvent(socket, ARRANGE_EVENTS.COMPANION_REGION_REVERT, arrangeCompanionRegionRevertSchema,
        (socket, d) => this.arrangeRoomHandler.handleCompanionRegionRevert(socket, namespace, d), data);
    });
  }
}
