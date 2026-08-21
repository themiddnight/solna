import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { coerceScale, isFutureProjectSchemaVersion, needsLegacyLoudnessReset } from '@jam-band/shared';
import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomStateService } from '../../application/ArrangeRoomStateService';
import type { ProjectStorageService } from '../../infrastructure/storage/ProjectStorageService';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { ProjectData } from '../models/ProjectData';
import type { Region } from '../models/ArrangeRoomState';
import { enrichAudioRegionsWithUrls } from '../utils/AudioRegionUtils';
import { normalizeCompanionVolumes } from './companionVolumeNormalization';
import { ProjectVersionMismatchError } from '../errors/ProjectVersionMismatchError';
import { resetLegacyLoudnessFields } from './legacyLoudnessReset';

export interface ImportedProjectData {
  projectData: ProjectData;
  savedAudioFiles: string[];
}

export class ProjectImportService {
  constructor(
    private readonly audioStorage: AudioRegionStorageService,
    private readonly arrangeRoomStateService: ArrangeRoomStateService,
    private readonly projectStorageService: ProjectStorageService
  ) { }

  /**
   * Import a project file, process audio, and update room state
   */
  async importProject(
    roomId: string,
    filePath: string,
    destinationDir: string,
    userId: string,
    username: string
  ): Promise<ImportedProjectData> {
    // Delegate complex file processing to internal method
    const { projectData, savedAudioFiles } = await this.processProjectFile(
      filePath,
      destinationDir,
      roomId
    );

    // DEV-295 (final-review fix wave): a legacy file's loudness fields must be reset BEFORE
    // they are written into Redis via updateState below — otherwise a later backend-driven save
    // re-stamps PROJECT_SCHEMA_VERSION onto un-reset values, permanently laundering them as
    // current-schema (see legacyLoudnessReset.ts doc comment for the full write-path gap).
    if (needsLegacyLoudnessReset(projectData.version)) {
      const reset = resetLegacyLoudnessFields(projectData);
      projectData.tracks = reset.tracks;
      projectData.regions = reset.regions;
      projectData.effectChains = reset.effectChains;
      projectData.synthStates = reset.synthStates;
    }
    // Ungated: repairs a companion volume that a PREVIOUS save already laundered under the
    // current version stamp, which the gate above can no longer reach.
    projectData.regions = normalizeCompanionVolumes(projectData.regions);

    // 4. Update audio URLs in project data to point to server
    projectData.regions = enrichAudioRegionsWithUrls(
      projectData.regions,
      roomId,
      this.audioStorage
    );

    // 5. Clean up old audio files from previous project (if any)
    // Only clean up if we have existing state AND the new project has different regions
    try {
      const existingState = await this.arrangeRoomStateService.getState(roomId);
      if (existingState && existingState.regions.length > 0) {
        const newRegionIds = new Set(projectData.regions.map((r: Region) => r.id));
        const oldAudioRegions = existingState.regions.filter(
          (r: Region) => r.type === 'audio' && !newRegionIds.has(r.id)
        );

        if (oldAudioRegions.length > 0) {
          loggingService.logInfo('Cleaning up old audio files (replaced by new project)', {
            roomId,
            oldAudioRegionCount: oldAudioRegions.length,
            oldRegionIds: oldAudioRegions.map((r: Region) => r.id),
          });
          for (const region of oldAudioRegions) {
            await this.audioStorage.deleteRegionAudio(roomId, region.id).catch((err) => {
              loggingService.logInfo('Failed to delete old audio region during import cleanup (non-critical)', {
                roomId,
                regionId: region.id,
                error: err instanceof Error ? err.message : String(err)
              });
            });
          }
        }
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectImportService:importProject:cleanup',
        roomId,
      });
    }

    // 6. Update ArrangeRoomStateService with project data
    const state = await this.arrangeRoomStateService.getState(roomId);
    if (!state) {
      await this.arrangeRoomStateService.initializeState(roomId);
    }

    // Clear existing state and set new project data
    await this.arrangeRoomStateService.updateState(roomId, {
      tracks: projectData.tracks,
      regions: projectData.regions,
      bpm: projectData.project.bpm,
      timeSignature: projectData.project.timeSignature,
      scale: {
        rootNote: projectData.scale?.rootNote ?? 'C',
        scale: coerceScale(projectData.scale?.scale ?? 'major'),
      },
      synthStates: projectData.synthStates,
      // DEV-301: conditional spread — projectData.instrumentParamsStates is optional
      // (pre-DEV-301 project files have no key at all), and exactOptionalPropertyTypes
      // forbids assigning an explicit `undefined` into the optional field.
      ...(projectData.instrumentParamsStates !== undefined
        ? { instrumentParamsStates: projectData.instrumentParamsStates }
        : {}),
      effectChains: projectData.effectChains,
      markers: projectData.markers,
      // DEV-279: restore chordTrack from project data — missing this caused saved
      // chord blocks to disappear when the room state was reloaded from Redis
      // (state_sync on reconnect / another user joining).
      chordTrack: projectData.chordTrack ?? { id: '', projectId: '', blocks: [] },
      selectedTrackId: null,
      selectedRegionIds: [],
    });

    // 7. Save project metadata in memory
    this.projectStorageService.saveProject(roomId, projectData.metadata.name, username);

    return {
      projectData,
      savedAudioFiles,
    };
  }

  /**
   * Import a project directly from server-side storage (B2 or Local)
   * Optimization: Eliminates client-side download/upload roundtrip
   */
  async importProjectFromStorage(
    roomId: string,
    projectId: string,
    userId: string,
    _username: string
  ): Promise<ImportedProjectData> {
    try {
      // 1. Load project files from storage
      const { projectJson, audioFiles } = await this.projectStorageService.loadProjectFiles(
        userId,
        projectId
      );

      const projectData = JSON.parse(projectJson) as ProjectData;
      // DEV-295: refuse only a file from a NEWER build — legacy/older/missing versions pass
      // through untouched. A legacy file's loudness fields are reset below (backend mirror of
      // the FE's resetLegacyLoudnessFields) BEFORE they reach updateState / Redis.
      if (isFutureProjectSchemaVersion(projectData.version)) {
        throw new ProjectVersionMismatchError(projectData.version);
      }
      if (needsLegacyLoudnessReset(projectData.version)) {
        const reset = resetLegacyLoudnessFields(projectData);
        projectData.tracks = reset.tracks;
        projectData.regions = reset.regions;
        projectData.effectChains = reset.effectChains;
        projectData.synthStates = reset.synthStates;
      }
      // Ungated — see the sibling call in importProject().
      projectData.regions = normalizeCompanionVolumes(projectData.regions);

      const savedAudioFiles: string[] = [];

      // 2. Process audio files (Convert Buffer -> Temp File -> Process -> Room Audio)
      if (audioFiles.length > 0) {
        // Create temp directory for processing
        const tempDir = path.join(process.cwd(), 'tmp', 'project-import', roomId);
        await fs.promises.mkdir(tempDir, { recursive: true });

        try {
          // Process in batches
          const BATCH_SIZE = 5;
          for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
            const batch = audioFiles.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map(async (file) => {
                const regionId = file.fileName.replace(/\.(ogg|webm|wav)$/, '');
                const tempPath = path.join(tempDir, file.fileName);

                try {
                  // Write buffer to temp file
                  await fs.promises.writeFile(tempPath, file.buffer);

                  // Save using AudioRegionStorageService – skip encoding since
                  // audio from B2 is already Opus/Ogg (avoid lossy re-encode)
                  // so the hash matches manifest.json on the next save.
                  const result = await this.audioStorage.saveRegionAudio({
                    roomId,
                    regionId,
                    sourcePath: tempPath,
                    originalName: file.fileName,
                    skipEncoding: true,
                  });

                  loggingService.logInfo('Audio region imported from storage', {
                    roomId,
                    regionId,
                    sizeBytes: result.sizeBytes,
                  });

                  savedAudioFiles.push(regionId);
                } catch (error) {
                  loggingService.logError(error as Error, {
                    context: 'ProjectImportService:importStorage:saveAudio',
                    roomId,
                    regionId,
                  });
                } finally {
                  // Clean up individual temp file
                  await fs.promises.unlink(tempPath).catch(() => { });
                }
              })
            );
          }
        } finally {
          // Cleanup temp directory
          await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => { });
        }
      }

      // 3. Update Audio URLs
      projectData.regions = enrichAudioRegionsWithUrls(
        projectData.regions,
        roomId,
        this.audioStorage
      );

      // 4. Cleanup old state if exists
      // (Similar to standard import logic)
      try {
        const existingState = await this.arrangeRoomStateService.getState(roomId);
        if (existingState && existingState.regions.length > 0) {
          const newRegionIds = new Set(projectData.regions.map((r: Region) => r.id));
          const oldAudioRegions = existingState.regions.filter(
            (r: Region) => r.type === 'audio' && !newRegionIds.has(r.id)
          );

          for (const region of oldAudioRegions) {
            await this.audioStorage.deleteRegionAudio(roomId, region.id).catch(() => { });
          }
        }
      } catch {
        // Limit log noise for cleanup errors
      }

      // 5. Update Room State
      if (!await this.arrangeRoomStateService.getState(roomId)) {
        await this.arrangeRoomStateService.initializeState(roomId);
      }

      await this.arrangeRoomStateService.updateState(roomId, {
        tracks: projectData.tracks,
        regions: projectData.regions,
        bpm: projectData.project.bpm,
        timeSignature: projectData.project.timeSignature,
        scale: {
          rootNote: projectData.scale?.rootNote ?? 'C',
          scale: coerceScale(projectData.scale?.scale ?? 'major'),
        },
        synthStates: projectData.synthStates,
        // DEV-301: conditional spread — same exactOptionalPropertyTypes reasoning as above.
        ...(projectData.instrumentParamsStates !== undefined
          ? { instrumentParamsStates: projectData.instrumentParamsStates }
          : {}),
        effectChains: projectData.effectChains,
        markers: projectData.markers,
        // DEV-279: restore chordTrack from project data — same fix as importProject().
        chordTrack: projectData.chordTrack ?? { id: '', projectId: '', blocks: [] },
        selectedTrackId: null,
        selectedRegionIds: [],
      });

      // Save metadata without updating uploadedAt (preserve original timestamp)
      // This allows ProjectRetrievalService to return project metadata
      this.projectStorageService.saveProjectMetadata(roomId, projectData.metadata.name, _username);

      // Set project metadata in room state (projectId, projectOwnerId, hasBeenSaved)
      await this.arrangeRoomStateService.setProjectMetadata(roomId, projectId, userId, true);

      return {
        projectData,
        savedAudioFiles,
      };

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectImportService:importProjectFromStorage',
        roomId,
        projectId
      });
      throw error;
    }
  }

  /**
   * Extract and process a project .collab zip file
   */
  private async processProjectFile(
    filePath: string,
    destinationDir: string,
    roomId: string
  ): Promise<ImportedProjectData> {
    // 1. Read and extract the .collab zip file
    // We still need to read the zip directory structure, but we'll stream individual files
    const zipBuffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // 2. Extract project.json
    const projectJsonFile = zip.file('project.json');
    if (!projectJsonFile) {
      throw new Error('Invalid project file: project.json not found');
    }

    const projectJsonText = await projectJsonFile.async('text');
    const projectData = JSON.parse(projectJsonText) as ProjectData;
    // DEV-295: refuse only a file from a NEWER build — legacy/older/missing versions pass
    // through untouched. This method only extracts/validates; the loudness reset itself runs
    // in the caller (importProject), right before the reset projectData reaches updateState.
    if (isFutureProjectSchemaVersion(projectData.version)) {
      throw new ProjectVersionMismatchError(projectData.version);
    }

    // 3. Extract and save audio files in parallel with concurrency limit
    const audioFolder = zip.folder('audio');
    const savedAudioFiles: string[] = [];

    if (audioFolder) {
      const audioFiles = Object.keys(zip.files).filter((filePath) =>
        filePath.startsWith('audio/') && !filePath.endsWith('/')
      );

      // Process in batches to limit concurrency
      const BATCH_SIZE = 5;
      for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
        const batch = audioFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (audioPath) => {
            const audioFile = zip.file(audioPath);
            if (audioFile) {
              // Extract region ID from filename
              const fileName = path.basename(audioPath);
              const regionId = fileName.replace(/\.(ogg|webm|wav)$/, '');

              // Save to temporary file with unique name
              const uniqueSuffix = `${crypto.randomUUID()}`;
              const tempPath = path.join(
                destinationDir,
                `${uniqueSuffix}-${fileName}`
              );

              try {
                // Use stream to write file to disk instead of loading entire buffer into memory
                await new Promise<void>((resolve, reject) => {
                  audioFile
                    .nodeStream()
                    .pipe(fs.createWriteStream(tempPath))
                    .on('finish', () => resolve())
                    .on('error', reject);
                });

                // Save using AudioRegionStorageService (converts to opus)
                const result = await this.audioStorage.saveRegionAudio({
                  roomId,
                  regionId,
                  sourcePath: tempPath,
                  originalName: fileName,
                });

                loggingService.logInfo('Audio region saved successfully', {
                  roomId,
                  regionId,
                  filePath: result.filePath,
                  sizeBytes: result.sizeBytes,
                });

                savedAudioFiles.push(regionId);
              } catch (error) {
                loggingService.logError(error as Error, {
                  context: 'ProjectImportService:processProjectFile:saveAudio',
                  roomId,
                  regionId,
                  tempPath,
                });
              } finally {
                // Clean up temp file
                await fs.promises.unlink(tempPath).catch((err) => {
                  loggingService.logInfo('Failed to delete temp file (non-critical)', {
                    tempPath,
                    error: err instanceof Error ? err.message : String(err)
                  });
                });
              }
            }
          })
        );
      }
    }

    return {
      projectData,
      savedAudioFiles,
    };
  }
}
