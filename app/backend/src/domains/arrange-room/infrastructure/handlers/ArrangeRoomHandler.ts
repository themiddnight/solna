import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { AudioRegionStorageService } from '@/domains/arrange-room/infrastructure/storage/AudioRegionStorageService';
import { BaseRoomHandler } from '@/shared/infrastructure/handlers/BaseRoomHandler';
import type { ProjectSaveLockService } from '@/domains/arrange-room/infrastructure/services/ProjectSaveLockService';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { projectRoomService } from '@/domains/arrange-room/infrastructure/storage/ProjectRoomService';
import { prisma } from '@/config/prisma';
import type { ChordBlock } from '@jam-band/shared';
import type { Track, Region, ArrangeTimeSignature, ArrangeRoomState, TimeMarker, MidiNote, EffectChainState, TrackUpdate, RegionUpdate, MidiNoteUpdate, TimeMarkerUpdate, ChordBlockUpdate, CompanionRegionConfig, CompanionRegionMetadata } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import type { RoomOccupancyOperations } from '@/domains/room-shared/application/RoomOccupancyService';

import { ArrangeTrackHandler } from './sub-handlers/ArrangeTrackHandler';
import { ArrangeRegionHandler } from './sub-handlers/ArrangeRegionHandler';
import { ArrangeNoteHandler } from './sub-handlers/ArrangeNoteHandler';
import { ArrangeLockHandler } from './sub-handlers/ArrangeLockHandler';
import { ArrangeMarkerHandler } from './sub-handlers/ArrangeMarkerHandler';
import { ArrangeMonitorShareHandler } from './sub-handlers/ArrangeMonitorShareHandler';
import { ArrangeChordTrackHandler } from './sub-handlers/ArrangeChordTrackHandler';
import { ArrangeCompanionHandler } from './sub-handlers/ArrangeCompanionHandler';

export class ArrangeRoomHandler extends BaseRoomHandler<ArrangeRoomStateService, ArrangeRoomState> {
  protected readonly roomType = 'arrange' as const;
  protected readonly eventPrefix = 'arrange';

  private readonly trackHandler = new ArrangeTrackHandler(this);
  private readonly regionHandler = new ArrangeRegionHandler(this);
  // DEV-350 Round 2, Task 2: note handlers split out of ArrangeRegionHandler (TR-20).
  private readonly noteHandler = new ArrangeNoteHandler(this);
  private readonly lockHandler = new ArrangeLockHandler(this);
  private readonly markerHandler = new ArrangeMarkerHandler(this);
  private readonly monitorShareHandler = new ArrangeMonitorShareHandler(this);
  private readonly chordTrackHandler = new ArrangeChordTrackHandler(this);
  private readonly companionHandler = new ArrangeCompanionHandler(this);

  // DEV-350 M2: element occupancy (presence badges) — bound to the same Redis-backed
  // getState/saveState pair as the state service, adapted since RoomOccupancyService's
  // saveState takes the occupancy Map plus the state snapshot it already read, not a full
  // ArrangeRoomState. That snapshot is reused as-is: the service's whole read-mutate-write
  // sequence holds `room-state-mutex:{roomId}` (TR-2), so re-reading here would only pay a
  // second Redis GET + full deserialize for a value that cannot have changed.
  private readonly occupancyService = new RoomOccupancyService(
    (roomId) => this.stateService.getState(roomId),
    async (roomId, occupancy, state) => {
      await this.stateService.saveState(roomId, { ...state, occupancy, lastUpdated: new Date() });
    }
  );

  constructor(
    arrangeRoomStateService: ArrangeRoomStateService,
    roomSessionManager: RoomSessionManager,
    roomLifecycleService: RoomLifecycleService,
    private readonly projectSaveLockService: ProjectSaveLockService,
    private readonly audioRegionStorageService?: AudioRegionStorageService
  ) {
    super(arrangeRoomStateService, roomSessionManager, roomLifecycleService);
  }

  // Expose ephemeral commit helpers as public for event handlers (TR-10)
  public override clearAllEphemeralCommitsForUser(userId: string): void {
    super.clearAllEphemeralCommitsForUser(userId);
  }

  // Public delegates for sub-handlers to access protected superclass members
  public getSessionPublic(socket: Socket) {
    return this.getSession(socket);
  }

  public validateSessionPublic(socket: Socket, roomId: string) {
    return this.validateSession(socket, roomId);
  }

  public validateSessionWithRetryPublic(socket: Socket, roomId: string) {
    return this.validateSessionWithRetry(socket, roomId);
  }

  public scheduleEphemeralCommitPublic(
    roomId: string,
    userId: string,
    fieldName: string,
    value: unknown,
    commitHandler: () => Promise<void>
  ): void {
    this.scheduleEphemeralCommit(roomId, userId, fieldName, value, commitHandler);
  }

  public clearEphemeralCommitPublic(roomId: string, userId: string, fieldName: string): void {
    this.clearEphemeralCommit(roomId, userId, fieldName);
  }

  public getStateService(): ArrangeRoomStateService {
    return this.stateService;
  }

  public getOccupancyService(): RoomOccupancyOperations {
    return this.occupancyService;
  }

  public getRoomSessionManager(): RoomSessionManager {
    return this.roomSessionManager;
  }

  public getRoomLifecycleService(): RoomLifecycleService {
    return this.roomLifecycleService;
  }

  public getProjectSaveLockService(): ProjectSaveLockService {
    return this.projectSaveLockService;
  }

  public getAudioRegionStorageService(): AudioRegionStorageService | undefined {
    return this.audioRegionStorageService;
  }

  /**
   * Handle request for current state (late joiner)
   */
  async handleRequestState(socket: Socket, data: { roomId: string }): Promise<void> {
    const session = await this.validateSessionWithRetry(socket, data.roomId);
    if (!session) {
      loggingService.logInfo(`ArrangeRoomHandler.handleRequestState: Invalid session or room`, { level: 'warn', dataRoomId: data.roomId, socketId: socket.id });
      socket.emit('error', createSocketErrorPayload('Invalid session or room'));
      return;
    }

    // Try to get state from Redis
    let state: ArrangeRoomState | null = null;
    try {
      state = await this.stateService.getState(data.roomId);
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler.handleRequestState', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to load room state. Please try again.'));
      return;
    }

    if (!state) {
      // Initialize empty state if not found in Redis
      state = await this.stateService.initializeState(data.roomId);

      // Check ROOM_PROJECTS — a project may have been linked via setProjectActiveRoom
      // before any user joined (e.g. test helper or project-open flow)
      let freshProjectId: string | undefined;
      let freshProjectOwnerId: string | undefined;
      let isFreshLocked = false;
      let hasFreshAllowFork = false;
      let freshOwnerUsername: string | undefined;
      try {
        const linked = await projectRoomService.getProjectByActiveRoom(data.roomId);
        if (linked) {
          const project = await prisma.savedProject.findUnique({
            where: { id: linked.id },
            select: { userId: true, isLocked: true, allowFork: true, user: { select: { username: true } } },
          });
          if (project) {
            freshProjectId = linked.id;
            freshProjectOwnerId = project.userId;
            isFreshLocked = project.isLocked;
            hasFreshAllowFork = project.allowFork;
            freshOwnerUsername = project.user.username ?? undefined;
          }
        }
      } catch (error) {
        loggingService.logError(error as Error, { context: 'ArrangeRoomHandler.handleRequestState.freshRoom.roomProjectsLookup' });
      }

      socket.emit(ARRANGE_EVENTS.STATE_SYNC, {
        tracks: [],
        regions: [],
        locks: [],
        occupancy: [],
        selectedTrackId: null,
        selectedRegionIds: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        synthStates: {},
        instrumentParamsStates: {},
        effectChains: {},
        markers: [],
        chordTrack: state.chordTrack,
        projectId: freshProjectId,
        projectOwnerId: freshProjectOwnerId,
        isLocked: isFreshLocked,
        hasBeenSaved: freshProjectId !== undefined,
        allowFork: hasFreshAllowFork,
        ownerUsername: freshOwnerUsername,
      });
      return;
    }

    // DEV-350 Round 2 Task 1: `ArrangeRoomState.locks` (the retired primitive element-lock
    // map) was deleted — it was already permanently empty in production. `locks` stays in the
    // STATE_SYNC wire payload, always empty, ONLY for older FE bundles still in flight during
    // the deploy window (clients that loaded before the deploy and have not reloaded). The
    // current FE consumer is already retired: `arrangeIncomingSync.ts`'s state-sync payload
    // type does not list `locks` at all. Drop this field once no pre-DEV-350 bundle can still
    // be connected.
    const locksArray: never[] = [];

    // DEV-350 M2: element occupancy (presence badges) — additive alongside locksArray,
    // consumed by Task 9's FE sync (not wired here).
    const occupancyArray = Array.from(state.occupancy.entries()).map(([elementId, occ]) => ({
      elementId,
      ...occ,
    }));

    // Self-heal: if state has projectId but Redis mapping is missing, auto-register
    // This covers server restart, failed setActiveRoom, or any other mapping loss
    let isProjectLocked = state.isLocked ?? false;
    let hasProjectAllowFork = false;
    let ownerUsername: string | undefined;
    let resolvedProjectId = state.projectId;
    let resolvedProjectOwnerId = state.projectOwnerId;

    if (state.projectId) {
      const existing = await projectRoomService.getActiveRoom(state.projectId);
      if (!existing.activeRoomId) {
        const conflict = await projectRoomService.trySetActiveRoom(state.projectId, data.roomId);
        if (conflict) {
          loggingService.logInfo('Self-heal skipped: project already has active room', {
            roomId: data.roomId,
            projectId: state.projectId,
            conflictRoomId: conflict.conflictRoomId,
          });
        } else {
          loggingService.logInfo('Self-healed project↔room mapping from arrange state', {
            roomId: data.roomId,
            projectId: state.projectId,
          });
        }
      }

      // Fetch isLocked and owner username from database to ensure it's up-to-date
      try {
        const project = await prisma.savedProject.findUnique({
          where: { id: state.projectId },
          select: { 
            isLocked: true,
            allowFork: true,
            user: {
              select: { username: true }
            }
          },
        });
        if (project) {
          isProjectLocked = project.isLocked;
          ownerUsername = project.user.username ?? undefined;
          hasProjectAllowFork = project.allowFork;
        }
      } catch (error) {
        loggingService.logError(error as Error, { context: 'ArrangeRoomHandler.handleRequestState.fetchIsLocked' });
      }
    } else {
      // state.projectId is null — check ROOM_PROJECTS for a pre-linked project
      // (e.g. project linked via setProjectActiveRoom before any save)
      try {
        const linked = await projectRoomService.getProjectByActiveRoom(data.roomId);
        if (linked) {
          const project = await prisma.savedProject.findUnique({
            where: { id: linked.id },
            select: { userId: true, isLocked: true, allowFork: true, user: { select: { username: true } } },
          });
          if (project) {
            resolvedProjectId = linked.id;
            resolvedProjectOwnerId = project.userId;
            isProjectLocked = project.isLocked;
            hasProjectAllowFork = project.allowFork;
            ownerUsername = project.user.username ?? undefined;
          }
        }
      } catch (error) {
        loggingService.logError(error as Error, { context: 'ArrangeRoomHandler.handleRequestState.roomProjectsLookup' });
      }
    }

    const hasBeenSavedResolved = state.hasBeenSaved || resolvedProjectId !== undefined;

    socket.emit(ARRANGE_EVENTS.STATE_SYNC, {
      tracks: state.tracks,
      regions: state.regions,
      locks: locksArray,
      occupancy: occupancyArray,
      selectedTrackId: state.selectedTrackId,
      selectedRegionIds: state.selectedRegionIds,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      projectScale: state.scale,
      synthStates: state.synthStates,
      instrumentParamsStates: state.instrumentParamsStates,
      effectChains: state.effectChains,
      markers: state.markers,
      chordTrack: state.chordTrack,
      voiceStates: state.voiceStates,
      broadcastStates: state.broadcastStates,
      projectId: resolvedProjectId,
      projectOwnerId: resolvedProjectOwnerId,
      isLocked: isProjectLocked,
      hasBeenSaved: hasBeenSavedResolved,
      allowFork: hasProjectAllowFork,
      ownerUsername,
    });

    loggingService.logInfo('Arrange room state requested', {
      roomId: data.roomId,
      userId: session.userId,
      trackCount: state.tracks.length,
      regionCount: state.regions.length,
    });
  }

  // --- Track Handler Delegation ---

  async handleTrackAdd(socket: Socket, namespace: Namespace, data: { roomId: string; track: Track }): Promise<void> {
    return this.trackHandler.handleTrackAdd(socket, namespace, data);
  }

  async handleTrackUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; updates: TrackUpdate }): Promise<void> {
    return this.trackHandler.handleTrackUpdate(socket, namespace, data);
  }

  async handleTrackPropertyCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; updates: TrackUpdate }): Promise<void> {
    return this.trackHandler.handleTrackPropertyCommit(socket, namespace, data);
  }

  async handleTrackDelete(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string }): Promise<void> {
    return this.trackHandler.handleTrackDelete(socket, namespace, data);
  }

  async handleTrackReorder(socket: Socket, namespace: Namespace, data: { roomId: string; trackIds: string[] }): Promise<void> {
    return this.trackHandler.handleTrackReorder(socket, namespace, data);
  }

  async handleTrackInstrumentChange(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; instrumentId: string; instrumentCategory?: string | undefined }): Promise<void> {
    return this.trackHandler.handleTrackInstrumentChange(socket, namespace, data);
  }

  async handleSynthParamsUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    return this.trackHandler.handleSynthParamsUpdate(socket, namespace, data);
  }

  async handleSynthParamsCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    return this.trackHandler.handleSynthParamsCommit(socket, namespace, data);
  }

  async handleInstrumentParamsUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    return this.trackHandler.handleInstrumentParamsUpdate(socket, namespace, data);
  }

  async handleInstrumentParamsCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    return this.trackHandler.handleInstrumentParamsCommit(socket, namespace, data);
  }

  async handleMasterVolumeUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; masterVolume: number }): Promise<void> {
    return this.trackHandler.handleMasterVolumeUpdate(socket, namespace, data);
  }

  async handleMasterVolumeCommit(socket: Socket, namespace: Namespace, data: { roomId: string; masterVolume: number }): Promise<void> {
    return this.trackHandler.handleMasterVolumeCommit(socket, namespace, data);
  }

  async handleBpmChange(socket: Socket, namespace: Namespace, data: { roomId: string; bpm: number }): Promise<void> {
    return this.trackHandler.handleBpmChange(socket, namespace, data);
  }

  async handleTimeSignatureChange(socket: Socket, namespace: Namespace, data: { roomId: string; timeSignature: ArrangeTimeSignature }): Promise<void> {
    return this.trackHandler.handleTimeSignatureChange(socket, namespace, data);
  }

  // --- Region Handler Delegation ---

  async handleRegionAdd(socket: Socket, namespace: Namespace, data: { roomId: string; region: Region }): Promise<void> {
    return this.regionHandler.handleRegionAdd(socket, namespace, data);
  }

  async handleRegionUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; updates: RegionUpdate }): Promise<void> {
    return this.regionHandler.handleRegionUpdate(socket, namespace, data);
  }

  async handleRegionMove(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; deltaBeats: number }): Promise<void> {
    return this.regionHandler.handleRegionMove(socket, namespace, data);
  }

  async handleRegionDrag(socket: Socket, namespace: Namespace, data: { roomId: string; updates: Array<{ regionId: string; newStart: number; trackId?: string | undefined }> }): Promise<void> {
    return this.regionHandler.handleRegionDrag(socket, namespace, data);
  }

  async handleRegionDragEnd(socket: Socket, namespace: Namespace, data: { roomId: string; updates: Array<{ regionId: string; newStart: number; trackId?: string | undefined }> }): Promise<void> {
    return this.regionHandler.handleRegionDragEnd(socket, namespace, data);
  }

  async handleRegionDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string }): Promise<void> {
    return this.regionHandler.handleRegionDelete(socket, namespace, data);
  }

  // --- Note Handler Delegation ---

  async handleNoteAdd(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; note: MidiNote }): Promise<void> {
    return this.noteHandler.handleNoteAdd(socket, namespace, data);
  }

  async handleNoteUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string; updates: MidiNoteUpdate }): Promise<void> {
    return this.noteHandler.handleNoteUpdate(socket, namespace, data);
  }

  async handleNoteDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string }): Promise<void> {
    return this.noteHandler.handleNoteDelete(socket, namespace, data);
  }

  async handleNoteRealtimeUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string; updates: MidiNoteUpdate }): Promise<void> {
    return this.noteHandler.handleNoteRealtimeUpdate(socket, namespace, data);
  }

  async handleEffectChainUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; chainType: string; effectChain: EffectChainState }): Promise<void> {
    return this.regionHandler.handleEffectChainUpdate(socket, namespace, data);
  }

  async handleEffectChainCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; chainType: string; effectChain: EffectChainState }): Promise<void> {
    return this.regionHandler.handleEffectChainCommit(socket, namespace, data);
  }

  // --- Lock Handler Delegation ---

  async handleSelectionChange(socket: Socket, namespace: Namespace, data: { roomId: string; selectedTrackId?: string | null | undefined; selectedRegionIds?: string[] | undefined }): Promise<void> {
    return this.lockHandler.handleSelectionChange(socket, namespace, data);
  }

  async handleOccupancyJoin(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return this.lockHandler.handleOccupancyJoin(socket, namespace, data);
  }

  async handleOccupancyLeave(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): Promise<void> {
    return this.lockHandler.handleOccupancyLeave(socket, namespace, data);
  }

  async handleOccupancyHeartbeat(socket: Socket, data: { roomId: string; elementId: string }): Promise<void> {
    return this.lockHandler.handleOccupancyHeartbeat(socket, data);
  }

  async handleSaveLockRequest(socket: Socket, namespace: Namespace, data: { roomId: string; projectId: string }): Promise<void> {
    return this.lockHandler.handleSaveLockRequest(socket, namespace, data);
  }

  async handleSaveLockRelease(socket: Socket, namespace: Namespace, data: { roomId: string; projectId: string; isSuccess?: boolean | undefined }): Promise<void> {
    return this.lockHandler.handleSaveLockRelease(socket, namespace, data);
  }

  // --- Marker Handler Delegation ---

  async handleMarkerAdd(socket: Socket, namespace: Namespace, data: { roomId: string; marker: { id: string; position: number; description?: string | undefined; color?: string | undefined } }): Promise<void> {
    return this.markerHandler.handleMarkerAdd(socket, namespace, data);
  }

  async handleMarkerUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; markerId: string; updates: TimeMarkerUpdate }): Promise<void> {
    return this.markerHandler.handleMarkerUpdate(socket, namespace, data);
  }

  async handleMarkerDelete(socket: Socket, namespace: Namespace, data: { roomId: string; markerId: string }): Promise<void> {
    return this.markerHandler.handleMarkerDelete(socket, namespace, data);
  }

  async handleFullStateUpdate(socket: Socket, namespace: Namespace, data: {
    roomId: string;
    state: {
      tracks: Track[];
      regions: Region[];
      markers: TimeMarker[];
      chordTrack: ChordBlock[];
      bpm: number;
      timeSignature: { numerator: number; denominator: number };
    };
  }): Promise<void> {
    return this.markerHandler.handleFullStateUpdate(socket, namespace, data);
  }

  async handleProjectScaleChange(socket: Socket, namespace: Namespace, data: { roomId: string; rootNote: string; scale: 'major' | 'minor' }): Promise<void> {
    return this.markerHandler.handleProjectScaleChange(socket, namespace, data);
  }

  // --- Monitor Share Handler Delegation ---

  async handleRecordingPreview(socket: Socket, namespace: Namespace, data: {
    roomId: string;
    preview: {
      trackId: string;
      recordingType: 'midi' | 'audio';
      startBeat: number;
      durationBeats: number;
    };
  }): Promise<void> {
    return this.monitorShareHandler.handleRecordingPreview(socket, namespace, data);
  }

  async handleRecordingPreviewEnd(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    return this.monitorShareHandler.handleRecordingPreviewEnd(socket, namespace, data);
  }

  async handleVoiceState(socket: Socket, namespace: Namespace, data: { roomId: string; isMuted: boolean }): Promise<void> {
    return this.monitorShareHandler.handleVoiceState(socket, namespace, data);
  }

  async handleMonitorShareState(socket: Socket, namespace: Namespace, data: { roomId: string; userId: string; username: string; sharing: boolean; trackId: string | null }): Promise<void> {
    return this.monitorShareHandler.handleMonitorShareState(socket, namespace, data);
  }

  async handleMonitorShareNote(socket: Socket, namespace: Namespace, data: {
    roomId: string;
    userId: string;
    trackId: string;
    noteData: {
      note: number;
      velocity: number;
      type: 'noteon' | 'noteoff';
    };
    timestamp: number;
  }): Promise<void> {
    return this.monitorShareHandler.handleMonitorShareNote(socket, namespace, data);
  }

  // --- Chord Track Handler Delegation ---

  async handleChordBlockAdd(socket: Socket, namespace: Namespace, data: { roomId: string; block: ChordBlock }): Promise<void> {
    return this.chordTrackHandler.handleChordBlockAdd(socket, namespace, data);
  }

  async handleChordBlockRemove(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string }): Promise<void> {
    return this.chordTrackHandler.handleChordBlockRemove(socket, namespace, data);
  }

  async handleChordBlockDrag(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; newStart: number }): Promise<void> {
    return this.chordTrackHandler.handleChordBlockDrag(socket, namespace, data);
  }

  async handleChordBlockDragCommit(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; newStart: number }): Promise<void> {
    return this.chordTrackHandler.handleChordBlockDragCommit(socket, namespace, data);
  }

  async handleChordBlockUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; updates: ChordBlockUpdate }): Promise<void> {
    return this.chordTrackHandler.handleChordBlockUpdate(socket, namespace, data);
  }

  // --- Companion Handler Delegation ---

  async handleCompanionConfigUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; updates: Partial<CompanionRegionConfig> }): Promise<void> {
    return this.companionHandler.handleCompanionConfigUpdate(socket, namespace, data);
  }

  async handleCompanionConfigCommit(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; updates: Partial<CompanionRegionConfig> }): Promise<void> {
    return this.companionHandler.handleCompanionConfigCommit(socket, namespace, data);
  }

  async handleCompanionRegionConvert(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; notes: MidiNote[]; companionMetadata: CompanionRegionMetadata }): Promise<void> {
    return this.companionHandler.handleCompanionRegionConvert(socket, namespace, data);
  }

  async handleCompanionRegionRevert(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string }): Promise<void> {
    return this.companionHandler.handleCompanionRegionRevert(socket, namespace, data);
  }

  // --- Leave Room Delegation ---

  async handleUserLeave(roomId: string, userId: string, namespace: Namespace): Promise<void> {
    await this.lockHandler.handleUserLeaveLocks(roomId, userId, namespace);
    await this.monitorShareHandler.handleUserLeaveMonitorShare(roomId, userId, namespace);
  }
}
