import type { ArrangeRoomState, Track, Region, AudioRegion, TimeMarker } from '../models/ArrangeRoomState';
import type { ProjectData, ScaleSettings } from '../models/ProjectData';
import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { ProjectManifestService } from './ProjectManifestService';
import { assertNever, DEFAULT_MASTER_VOLUME_DB, isFutureProjectSchemaVersion, PROJECT_SCHEMA_VERSION, type ChordTrack } from '@jam-band/shared';
import { ProjectVersionMismatchError } from '../errors/ProjectVersionMismatchError';
import fs from 'fs';

export interface AudioFileData {
  audioFileId: string;
  regionId: string;
  fileName: string;
  buffer: Buffer;
}

export interface SerializedProjectResult {
  projectData: ProjectData;
  audioFiles: AudioFileData[];
}

/**
 * Service for serializing and deserializing project data
 * Ported from frontend projectSerializer.ts to backend
 */
export class ProjectSerializationService {
  constructor(private readonly audioStorage: AudioRegionStorageService) {}

  /**
   * Serialize room state to ProjectData format
   * This is the backend equivalent of frontend's serializeProject()
   */
  serializeRoomState(
    state: ArrangeRoomState,
    projectName: string
  ): ProjectData {
    // Remove runtime properties from regions (audioUrl, audioBuffer, audioBlob)
    const sanitizedRegions = state.regions.map((region) => {
      switch (region.type) {
        case 'midi':
          return {
            id: region.id,
            trackId: region.trackId,
            name: region.name,
            start: region.start,
            length: region.length,
            loopEnabled: region.loopEnabled,
            loopIterations: region.loopIterations,
            color: region.color || '#3b82f6',
            type: region.type,
            notes: region.notes,
            sustainEvents: region.sustainEvents,
            ...(region.companionMetadata ? { companionMetadata: region.companionMetadata } : {}),
          };
        case 'audio':
          // Audio region - remove audioUrl (runtime property)
          return {
            id: region.id,
            trackId: region.trackId,
            name: region.name,
            start: region.start,
            length: region.length,
            loopEnabled: region.loopEnabled,
            loopIterations: region.loopIterations,
            color: region.color || '#3b82f6',
            type: region.type,
            audioFileId: region.audioFileId || region.id, // Use audioFileId for deduplication
            trimStart: region.trimStart,
            originalLength: region.originalLength,
            gain: region.gain,
            fadeInDuration: region.fadeInDuration,
            fadeOutDuration: region.fadeOutDuration,
            pitchShift: region.pitchShift,
            recordedBpm: region.recordedBpm,
            tempoMode: region.tempoMode,
          };
        case 'companion':
          return {
            id: region.id,
            trackId: region.trackId,
            name: region.name,
            start: region.start,
            length: region.length,
            loopEnabled: region.loopEnabled,
            loopIterations: region.loopIterations,
            color: region.color || '#3b82f6',
            type: region.type,
            config: region.config,
          };
        default:
          return assertNever(region);
      }
    });

    const projectData: ProjectData = {
      version: PROJECT_SCHEMA_VERSION,
      metadata: {
        name: projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      },
      project: {
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        gridDivision: 16,
        loop: {
          enabled: false,
          start: 0,
          end: 0,
        },
        isMetronomeEnabled: false,
        snapToGrid: true,
        // DEV-323: the master fader sits before the capture tap, so it is already baked into
        // every mixdown and export. Saving it is what makes reopening the project sound the
        // same as closing it did.
        masterVolume: state.masterVolume ?? DEFAULT_MASTER_VOLUME_DB,
      },
      scale: state.scale ?? { rootNote: 'C', scale: 'major' },
      tracks: state.tracks,
      regions: sanitizedRegions as Region[],
      effectChains: state.effectChains,
      synthStates: state.synthStates,
      // DEV-301: conditional spread, not a bare assignment — `state.instrumentParamsStates`
      // is optional (a room that never touched a non-synth instrument's pre-gain has none),
      // and exactOptionalPropertyTypes forbids assigning an explicit `undefined` into the
      // optional `instrumentParamsStates?` field below.
      ...(state.instrumentParamsStates !== undefined
        ? { instrumentParamsStates: state.instrumentParamsStates }
        : {}),
      markers: state.markers,
      chordTrack: state.chordTrack,
    };

    return projectData;
  }

  /**
   * Collect audio files from server volume
   * This is the backend equivalent of frontend's extractAudioFiles()
   */
  async collectAudioFiles(
    roomId: string,
    regions: Region[]
  ): Promise<AudioFileData[]> {
    const audioRegions = regions.filter((region): region is AudioRegion => {
      switch (region.type) {
        case 'audio':
          return true;
        case 'midi':
          return false;
        case 'companion':
          return false;
        default:
          return assertNever(region);
      }
    });

    // Deduplicate and collect file paths
    const uniqueFileIds = new Set<string>();
    const filesToRead: Array<{ audioFileId: string; filePath: string }> = [];

    for (const region of audioRegions) {
      const audioFileId = region.audioFileId || region.id;

      if (!uniqueFileIds.has(audioFileId)) {
        const filePath = this.audioStorage.resolveRegionFilePath(roomId, audioFileId);

        if (filePath && fs.existsSync(filePath)) {
          filesToRead.push({ audioFileId, filePath });
          uniqueFileIds.add(audioFileId);
        } else {
          loggingService.logInfo(`Audio file not found for region ${region.id}`, {
            roomId,
            audioFileId,
            filePath,
          });
        }
      }
    }

    // Read all files in parallel for better performance
    const results = await Promise.all(
      filesToRead.map(async ({ audioFileId, filePath }) => {
        try {
          const buffer = await fs.promises.readFile(filePath);
          return {
            audioFileId,
            regionId: audioFileId,
            fileName: `${audioFileId}.ogg`,
            buffer,
          };
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ProjectSerializationService:collectAudioFiles',
            roomId,
            audioFileId,
            filePath,
          });
          return null;
        }
      })
    );

    return results.filter((r) => r !== null) as AudioFileData[];
  }

  /**
   * Deserialize project data (for validation/processing)
   * Note: The actual room state update is handled by ArrangeRoomStateService
   *
   * DEV-295: refuses only a file from a NEWER build (unknown field meaning). Older integers,
   * the pre-epic `'1.0.0'` string, and a missing version all pass through untouched — no
   * loudness reset here, that's FE-only (see `projectSerializer.ts`'s `resetLegacyLoudnessFields`).
   */
  deserializeProjectData(projectData: ProjectData): {
    tracks: Track[];
    regions: Region[];
    bpm: number;
    timeSignature: { numerator: number; denominator: number };
    scale: ScaleSettings | undefined;
    synthStates: Record<string, Record<string, unknown>>;
    // DEV-301: optional, mirrors `ProjectData.instrumentParamsStates` — a pre-DEV-301 project
    // file has no key in project.json at all.
    instrumentParamsStates?: Record<string, Record<string, unknown>>;
    effectChains: Record<string, unknown>;
    markers: TimeMarker[];
    chordTrack: ChordTrack;
  } {
    if (isFutureProjectSchemaVersion(projectData.version)) {
      throw new ProjectVersionMismatchError(projectData.version);
    }

    return {
      tracks: projectData.tracks,
      regions: projectData.regions,
      bpm: projectData.project.bpm,
      timeSignature: projectData.project.timeSignature,
      scale: projectData.scale,
      synthStates: projectData.synthStates,
      // Conditional spread — same exactOptionalPropertyTypes reasoning as serializeRoomState.
      ...(projectData.instrumentParamsStates !== undefined
        ? { instrumentParamsStates: projectData.instrumentParamsStates }
        : {}),
      effectChains: projectData.effectChains,
      markers: projectData.markers,
      // DEV-279 P1 backward-compat: projects saved before chordTrack existed have no
      // field in project.json — restore as an empty track rather than undefined/crash.
      chordTrack: projectData.chordTrack ?? { id: '', projectId: '', blocks: [] },
    };
  }

  /**
   * Compute SHA-256 hash of serialized project.json content.
   */
  computeProjectJsonHash(projectData: ProjectData): string {
    const json = JSON.stringify(projectData, null, 2);
    return ProjectManifestService.computeProjectJsonHash(json);
  }

  /**
   * Serialize complete project with audio files
   */
  async serializeCompleteProject(
    state: ArrangeRoomState,
    projectName: string
  ): Promise<SerializedProjectResult> {
    const projectData = this.serializeRoomState(state, projectName);
    const audioFiles = await this.collectAudioFiles(state.roomId, state.regions);

    return {
      projectData,
      audioFiles,
    };
  }
}
