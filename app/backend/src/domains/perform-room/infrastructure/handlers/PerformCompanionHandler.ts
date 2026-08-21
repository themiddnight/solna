import type { Namespace, Socket } from 'socket.io';
import crypto from 'crypto';
import {
  PERFORM_EVENTS,
  COMPANION_CONSTANTS,
  DEFAULT_CHORD_COMPANION_SETTINGS,
  createSocketErrorPayload,
  buildCompanionGenreUpdates,
  INSTRUMENT_CONSTANTS,
  isRestrictedUserTier,
  SOCKET_ERROR_CODES,
  type CompanionConfig,
  type CompanionGenrePreset,
  type CompanionIntensityStep,
  type CompanionProgressionFlavor,
  deriveRoleFromInstrument,
  defaultStyleForInstrument,
  DEFAULT_COMPANION_VOLUME_DB,
  VALID_PROGRESSION_FLAVORS,
  isCompanionGenrePreset,
  isCompanionIntensityStep,
  validateCompanionUpdates,
  COMPANION_CONFIG_BOUNDS,
} from '@jam-band/shared';
import type { SocketAuthUser } from '@/config/socket';
import { isValidProgressionPayload } from './progressionPayloadGuard';
import type { PerformRoomStateService } from '../../application/PerformRoomStateService';
import { companionRuntimeRegistry } from '../../application/CompanionRuntimeRegistry';
import { CompanionScheduler } from '../../application/CompanionScheduler';
import type { PerformRoomState } from '../../domain/models/PerformRoomState';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import type { RoomOccupancyOperations } from '../../../room-shared/application/RoomOccupancyService';
import type { OccupancySessionLookup } from '../../../room-shared/application/occupancySocketHandlers';
import * as occupancySocketHandlers from '../../../room-shared/application/occupancySocketHandlers';

interface PerformCompanionHandlerContext {
  stateService: PerformRoomStateService;
  getRoomMembershipService: () => RoomMembershipService | undefined;
  validateSession: (socket: Socket, roomId: string) => Promise<{ userId: string; username?: string } | null>;
  handleError: (socket: Socket, error: Error, context: string, roomId?: string) => void;
  /** Notifies the lobby that a room's companion count changed (add/remove). Optional. */
  onCompanionCountChanged?: ((roomId: string) => void) | undefined;
  /**
   * Verified-session lookup for `OCCUPANCY_EVENTS` orchestration (DEV-350 M4 Task 24, TR-33) —
   * matches `BaseRoomHandler.getSession`'s minimal resolved session shape, bound to
   * `PerformRoomHandler.getSession` by the constructor.
   */
  getSession: OccupancySessionLookup;
  /** Element occupancy service (DEV-350 M4 Task 24), bound to Perform's own state accessors. */
  getOccupancyService: () => RoomOccupancyOperations;
}

export class PerformCompanionHandler {
  /* eslint-disable @typescript-eslint/member-ordering */
  constructor(private readonly context: PerformCompanionHandlerContext) {}

  private syncCompanionRuntime(roomId: string, state: PerformRoomState): void {
    companionRuntimeRegistry.upsertFromPerformState(roomId, state);
  }

  /**
   * @param changed Which companion control(s) this particular sync was caused by, when the
   *   cause is a single companion update. COMPANION_STATE_SYNC bundles every companion
   *   mutation — add/remove/update, bulk preset, chord length, play/stop all — into one
   *   broadcast, so without this the receiving client cannot tell WHAT moved and therefore
   *   cannot attribute the change to a control. Attributing the whole payload instead let an
   *   unrelated action from a second user paint their badge on a control they never touched
   *   (DEV-350 Round 2 Task 16 review finding), which is why the FE deliberately attributed
   *   nothing at all until now. Omitted for the bundled/whole-state actions, where there is
   *   still no single honest answer (DEV-350 Round 9).
   */
  private emitCompanionState(
    namespace: Namespace,
    roomId: string,
    state: PerformRoomState,
    actingUserId: string,
    changed?: { companionId: string; keys: string[] },
    changedRoomControls?: string[],
  ): void {
    namespace.to(roomId).emit(PERFORM_EVENTS.COMPANION_STATE_SYNC, {
      companions: state.companions,
      companionChordLength: state.companionChordLength,
      companionChordProgression: state.companionChordProgression,
      companionProgressionFlavor: state.companionProgressionFlavor,
      companionSelectedGenrePreset: state.companionSelectedGenrePreset,
      companionSelectedIntensity: state.companionSelectedIntensity,
      companionOverrideInstruments: state.companionOverrideInstruments,
      userId: actingUserId,
      ...(changed ? { changed } : {}),
      ...(changedRoomControls && changedRoomControls.length > 0 ? { changedRoomControls } : {}),
    });
  }

  private async validateCompanionEditor(socket: Socket, roomId: string, action: string): Promise<{ userId: string; username?: string } | null> {
    const session = await this.context.validateSession(socket, roomId);
    if (session == null) return null;

    const roomMembershipService = this.context.getRoomMembershipService();
    if (!roomMembershipService) {
      socket.emit('error', createSocketErrorPayload('Membership service not available'));
      return null;
    }

    const user = await roomMembershipService.findUserInRoom(roomId, session.userId);
    if (user?.role === 'audience') {
      socket.emit('error', createSocketErrorPayload(`Audience cannot ${action} companions`));
      return null;
    }

    return session;
  }

  async handleCompanionAdd(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      instrumentId?: string;
      genrePreset?: CompanionGenrePreset;
      embellishmentIntensity?: CompanionIntensityStep;
    }
  ): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'add');
      if (!session) return;

      const instrumentId = data.instrumentId || INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT;
      const role = deriveRoleFromInstrument(instrumentId);
      const style = defaultStyleForInstrument(instrumentId);
      const state = await this.context.stateService.getState(data.roomId);
      const existingCompanions = state?.companions || [];

      if (existingCompanions.length >= COMPANION_CONSTANTS.MAX_PER_ROOM) {
        socket.emit('error', createSocketErrorPayload(
          `Cannot add more than ${COMPANION_CONSTANTS.MAX_PER_ROOM} companions per room`,
        ));
        return;
      }

      const authUser = (socket.data as { user?: SocketAuthUser } | undefined)?.user;
      const isRestricted = authUser == null || isRestrictedUserTier(authUser);
      if (isRestricted && existingCompanions.length >= COMPANION_CONSTANTS.MAX_PER_ROOM_RESTRICTED) {
        socket.emit('error', createSocketErrorPayload(
          'Sign up to add more companions',
          { code: SOCKET_ERROR_CODES.REGISTER_REQUIRED },
        ));
        return;
      }

      // Determine target genre and intensity
      let targetGenre = data.genrePreset;
      let targetIntensity = data.embellishmentIntensity;

      if (targetGenre == null && existingCompanions.length > 0) {
        targetGenre = existingCompanions[0]?.genrePreset;
      }
      if (targetIntensity == null && existingCompanions.length > 0) {
        targetIntensity = existingCompanions[0]?.embellishmentIntensity;
      }

      targetGenre = targetGenre ?? 'pop';
      targetIntensity = targetIntensity ?? 1;

      const shouldPlayOnAdd = existingCompanions.some((companion) => companion.isPlaying);

      const companion: CompanionConfig = {
        id: crypto.randomUUID(),
        instrumentId,
        role,
        style,
        density: 'normal',
        timing: 'normal',
        isPlaying: shouldPlayOnAdd,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        genrePreset: targetGenre,
        embellishmentIntensity: targetIntensity,
        ...(role === 'chord' && {
          ...DEFAULT_CHORD_COMPANION_SETTINGS,
        }),
        ...buildCompanionGenreUpdates(targetGenre, targetIntensity, role),
      };

      const updatedState = await this.context.stateService.addCompanion(data.roomId, companion);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId);
      this.context.onCompanionCountChanged?.(data.roomId);

      loggingService.logInfo('Companion added in perform room', {
        roomId: data.roomId,
        companionId: companion.id,
        role,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionAdd', data.roomId);
    }
  }

  async handleCompanionRemove(socket: Socket, namespace: Namespace, data: { roomId: string; companionId: string }): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'remove');
      if (!session) return;

      const updatedState = await this.context.stateService.removeCompanion(data.roomId, data.companionId);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId);
      this.context.onCompanionCountChanged?.(data.roomId);

      loggingService.logInfo('Companion removed in perform room', {
        roomId: data.roomId,
        companionId: data.companionId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionRemove', data.roomId);
    }
  }

  async handleCompanionUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; companionId: string; updates: unknown }): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'update');
      if (!session) return;

      const updates = validateCompanionUpdates(data.updates);
      // Snapshot the keys the CLIENT actually moved, before the server derives more below.
      // Attribution must name only those: an instrument change derives role/style/timing, and
      // naming them lit the Style and Timing badges in the settings popover for a row the
      // user never touched (same wrong-row class as the flavor badge on a genre click).
      const attributedKeys = Object.keys(updates);
      if (updates.instrumentId) {
        updates.role = deriveRoleFromInstrument(updates.instrumentId);
        if (updates.style == null) {
          updates.style = defaultStyleForInstrument(updates.instrumentId);
        }
        if (updates.timing == null) {
          updates.timing = 'normal';
        }
      }

      const updatedState = await this.context.stateService.updateCompanion(data.roomId, data.companionId, updates);
      CompanionScheduler.clearGeneratedNoteCache();
      this.syncCompanionRuntime(data.roomId, updatedState);
      // The keys come from the VALIDATED updates, not the raw client payload (TR-31/TR-33) —
      // they are echoed back to every client and used to key attribution badges.
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId, {
        companionId: data.companionId,
        keys: attributedKeys,
      });

      loggingService.logInfo('Companion updated in perform room', {
        roomId: data.roomId,
        companionId: data.companionId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionUpdate', data.roomId);
    }
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
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'update');
      if (!session) return;

      if (!isCompanionGenrePreset(data.genrePreset) || !isCompanionIntensityStep(data.embellishmentIntensity)) {
        socket.emit('error', createSocketErrorPayload('Invalid companion preset payload'));
        return;
      }

      // Snapshot BEFORE the write for the same reason as handleCompanionPresetControlsUpdate:
      // the badges follow the VALUE, not the payload. The Genre chips re-send the current
      // intensity alongside the new genre (and vice versa), so attributing everything that
      // arrived would light up both badges for one click.
      const before = await this.context.stateService.getState(data.roomId);
      const shouldOverrideInstruments = data.overrideInstruments === true;
      const updatedState = await this.context.stateService.updateAllCompanionPreset(
        data.roomId,
        data.genrePreset,
        data.embellishmentIntensity,
        { overrideInstruments: shouldOverrideInstruments },
      );
      CompanionScheduler.clearGeneratedNoteCache();
      this.syncCompanionRuntime(data.roomId, updatedState);
      // Wire-level names, from the VALIDATED payload (TR-31). The COMPANIONS panel routes
      // Genre and Intensity through this BULK path whenever the room holds at least one
      // companion, so this is the only place those two badges can come from in normal use.
      const changedRoomControls = [
        ...(data.genrePreset !== before?.companionSelectedGenrePreset ? ['genrePreset'] : []),
        ...(data.embellishmentIntensity !== before?.companionSelectedIntensity ? ['embellishmentIntensity'] : []),
        ...(shouldOverrideInstruments !== before?.companionOverrideInstruments ? ['overrideInstruments'] : []),
      ];
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId, undefined, changedRoomControls);

      loggingService.logInfo('All companion presets updated in perform room', {
        roomId: data.roomId,
        genrePreset: data.genrePreset,
        embellishmentIntensity: data.embellishmentIntensity,
        overrideInstruments: data.overrideInstruments === true,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionBulkPresetUpdate', data.roomId);
    }
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
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'update');
      if (!session) return;

      const updates: {
        companionSelectedGenrePreset?: CompanionGenrePreset;
        companionSelectedIntensity?: CompanionIntensityStep;
        companionOverrideInstruments?: boolean;
      } = {};

      if (data.genrePreset !== undefined) {
        if (!isCompanionGenrePreset(data.genrePreset)) {
          socket.emit('error', createSocketErrorPayload('Invalid companion preset controls payload'));
          return;
        }
        updates.companionSelectedGenrePreset = data.genrePreset;
      }

      if (data.embellishmentIntensity !== undefined) {
        if (!isCompanionIntensityStep(data.embellishmentIntensity)) {
          socket.emit('error', createSocketErrorPayload('Invalid companion preset controls payload'));
          return;
        }
        updates.companionSelectedIntensity = data.embellishmentIntensity;
      }

      if (data.overrideInstruments !== undefined) {
        if (typeof data.overrideInstruments !== 'boolean') {
          socket.emit('error', createSocketErrorPayload('Invalid companion preset controls payload'));
          return;
        }
        updates.companionOverrideInstruments = data.overrideInstruments;
      }

      // Snapshot BEFORE the write: what the badges need is the keys whose VALUE actually
      // moved, not the keys the client happened to send. The genre picker sends the current
      // intensity alongside the new genre (to keep a "mixed" selection consistent), so
      // attributing everything in the payload lit up three badges for one click — genre,
      // intensity and flavor — on every other client (DEV-350 Round 10).
      const before = await this.context.stateService.getState(data.roomId);
      const updatedState = await this.context.stateService.setCompanionPresetControls(data.roomId, updates);
      // Wire-level names (`updates` is keyed by state field; the client knows these three by
      // their payload names), taken from the VALIDATED set (TR-31).
      const changedRoomControls = [
        ...(updates.companionSelectedGenrePreset !== undefined
          && updates.companionSelectedGenrePreset !== before?.companionSelectedGenrePreset ? ['genrePreset'] : []),
        ...(updates.companionSelectedIntensity !== undefined
          && updates.companionSelectedIntensity !== before?.companionSelectedIntensity ? ['embellishmentIntensity'] : []),
        ...(updates.companionOverrideInstruments !== undefined
          && updates.companionOverrideInstruments !== before?.companionOverrideInstruments ? ['overrideInstruments'] : []),
      ];
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId, undefined, changedRoomControls);

      loggingService.logInfo('Companion preset controls updated in perform room', {
        roomId: data.roomId,
        updates,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionPresetControlsUpdate', data.roomId);
    }
  }

  async handleCompanionPlayAll(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'play');
      if (!session) return;

      const updatedState = await this.context.stateService.updateAllCompanionsPlayState(data.roomId, true);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId);

      loggingService.logInfo('All companions play state set to true', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionPlayAll', data.roomId);
    }
  }

  async handleCompanionStopAll(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'stop');
      if (!session) return;

      const updatedState = await this.context.stateService.updateAllCompanionsPlayState(data.roomId, false);
      this.syncCompanionRuntime(data.roomId, updatedState);
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId);

      loggingService.logInfo('All companions play state set to false', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionStopAll', data.roomId);
    }
  }

  async handleCompanionSetChordLength(socket: Socket, namespace: Namespace, data: { roomId: string; barsPerChord: number }): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'change chord length');
      if (!session) return;

      const validLengths = [0.5, 1, 2, 4] as const;
      if (!validLengths.includes(data.barsPerChord as (typeof validLengths)[number])) {
        socket.emit('error', createSocketErrorPayload('Invalid barsPerChord value'));
        return;
      }

      const before = await this.context.stateService.getState(data.roomId);
      const updatedState = await this.context.stateService.setCompanionChordLength(
        data.roomId,
        data.barsPerChord as (typeof validLengths)[number]
      );
      this.syncCompanionRuntime(data.roomId, updatedState);
      const didChange = before?.companionChordLength !== updatedState.companionChordLength;
      this.emitCompanionState(namespace, data.roomId, updatedState, session.userId, undefined, didChange ? ['chordLength'] : []);
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionSetChordLength', data.roomId);
    }
  }

  async handleCompanionSetProgressionFlavor(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; flavor: string; derived?: unknown },
  ): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'change progression flavor');
      if (!session) return;

      if (!VALID_PROGRESSION_FLAVORS.has(data.flavor as CompanionProgressionFlavor)) {
        socket.emit('error', createSocketErrorPayload('Invalid progression flavor value'));
        return;
      }

      const before = await this.context.stateService.getState(data.roomId);
      const updatedState = await this.context.stateService.setCompanionProgressionFlavor(
        data.roomId,
        data.flavor as CompanionProgressionFlavor,
      );
      // Changing flavor changes which chords resolve — drop stale generated notes.
      CompanionScheduler.clearGeneratedNoteCache();
      this.syncCompanionRuntime(data.roomId, updatedState);
      // `derived: true` marks a flavor that FOLLOWS a genre/intensity click rather than a
      // touch of the Harmonic Flavor select itself (CompanionStageControls' applyBulkPreset
      // resolves it via getGenreProgressionFlavor and broadcasts it separately). Attributing
      // it put the badge on the flavor row for a click the user made two controls higher up
      // — a wrong-row badge, and the only badge a genre click produced at all.
      const isDerived = data.derived === true;
      const didFlavorMove = before?.companionProgressionFlavor !== updatedState.companionProgressionFlavor;
      this.emitCompanionState(
        namespace,
        data.roomId,
        updatedState,
        session.userId,
        undefined,
        !isDerived && didFlavorMove ? ['progressionFlavor'] : [],
      );
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionSetProgressionFlavor', data.roomId);
    }
  }

  async handleCompanionSetChordProgression(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; progression: unknown },
  ): Promise<void> {
    try {
      const session = await this.validateCompanionEditor(socket, data.roomId, 'change chord progression');
      if (!session) return;

      if (!isValidProgressionPayload(data.progression)) {
        socket.emit('error', createSocketErrorPayload('Invalid chord progression payload'));
        return;
      }

      const before = await this.context.stateService.getState(data.roomId);
      const updatedState = await this.context.stateService.setCompanionChordProgression(
        data.roomId,
        data.progression,
      );
      this.syncCompanionRuntime(data.roomId, updatedState);
      // The Auto/Manual toggle and the manual editor both land here, so `progressionMode` is
      // named only when the MODE actually moved (same value-moved rule as every other room
      // control). A manual chord commit leaves the mode alone -- attributing it lit the
      // Auto/Manual toggle for an edit the user made inside the modal, which has its own
      // container badge (fed by occupancy on the progression lock) while it is open.
      const didModeMove = before?.companionChordProgression.mode !== updatedState.companionChordProgression.mode;
      this.emitCompanionState(
        namespace,
        data.roomId,
        updatedState,
        session.userId,
        undefined,
        didModeMove ? ['progressionMode'] : [],
      );
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionSetChordProgression', data.roomId);
    }
  }

  async handleCompanionVolumeEphemeral(socket: Socket, data: { roomId: string; companionId: string; volume: number }): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    const roomMembershipService = this.context.getRoomMembershipService();
    if (!roomMembershipService) return;

    try {
      const user = await roomMembershipService.findUserInRoom(data.roomId, session.userId);
      if (user?.role === 'audience') return;

      // No Math.round: dB is a continuous fader value, unlike the old integer-percent scale.
      const volume = Math.max(COMPANION_CONFIG_BOUNDS.volume.min, Math.min(COMPANION_CONFIG_BOUNDS.volume.max, data.volume));
      socket.to(data.roomId).emit(PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL, {
        companionId: data.companionId,
        volume,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleCompanionVolumeEphemeral', data.roomId);
    }
  }

  /**
   * Element occupancy (DEV-350 M4 Task 24) — thin delegations to the room-agnostic
   * `occupancySocketHandlers` module (`room-shared`), replacing the old FE-only
   * `handleCompanionVolumeLock/_Unlock`, `handleCompanionSettingsLock/_Unlock` and
   * `handleCompanionProgressionLock/_Unlock` methods. Mirrors `ArrangeLockHandler`'s
   * occupancy delegation exactly — same shared module, same event vocabulary, different
   * namespace (Task 7's Arrange wiring).
   */
  async handleOccupancyJoin(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    // Audience gate (DEV-350 M4 Task 24 review fix) — mirrors the old per-resource lock
    // handlers' `role === 'audience'` early-return exactly (including "no membership service
    // => deny", matching e.g. the old handleCompanionVolumeLock). Occupancy JOIN is the one
    // step that actually claims a slot; LEAVE/HEARTBEAT only ever affect occupancy the caller
    // already owns (enforced inside RoomOccupancyService by userId match), so they don't need
    // this gate. Without it, an audience socket could occupy a companion:* element and block
    // band members from editing it for up to the 5-minute occupancy TTL.
    const roomMembershipService = this.context.getRoomMembershipService();
    if (!roomMembershipService) {
      return;
    }
    const session = await this.context.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }
    const user = await roomMembershipService.findUserInRoom(data.roomId, session.userId);
    if (user?.role === 'audience') {
      return;
    }

    return occupancySocketHandlers.handleOccupancyJoin(
      this.context.getOccupancyService(),
      this.context.getSession,
      socket,
      namespace,
      data,
    );
  }

  async handleOccupancyLeave(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return occupancySocketHandlers.handleOccupancyLeave(
      this.context.getOccupancyService(),
      this.context.getSession,
      socket,
      namespace,
      data,
    );
  }

  async handleOccupancyHeartbeat(socket: Socket, data: { roomId: string; elementId: string }): Promise<void> {
    return occupancySocketHandlers.handleOccupancyHeartbeat(
      this.context.getOccupancyService(),
      this.context.getSession,
      socket,
      data,
    );
  }
}
