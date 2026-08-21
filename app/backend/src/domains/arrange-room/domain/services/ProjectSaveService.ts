import { ProjectSerializationService } from './ProjectSerializationService';
import { ProjectManifestService } from './ProjectManifestService';
import type { ArrangeRoomStateService } from '../../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import type { ProjectStorageService } from '../../infrastructure/storage/ProjectStorageService';
import type { ProjectManifest } from '../models/ProjectManifest';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { randomUUID } from 'crypto';

/** Steps emitted during project save for real-time progress UX. */
export type SaveProgressStep = 'preparing' | 'saving_data' | 'saving_audio' | 'finalizing';

/** Detail payload for save progress events. */
export interface SaveProgressDetail {
  current?: number;
  total?: number;
}

/** Callback invoked at each save step boundary. */
export type SaveProgressCallback = (
  step: SaveProgressStep,
  detail?: SaveProgressDetail
) => void;

/**
 * Service for saving projects from room state to Backblaze storage
 * This replaces the old flow where frontend sends projectData + audioFiles
 */
export class ProjectSaveService {
  private readonly serializationService: ProjectSerializationService;
  private readonly manifestService: ProjectManifestService;

  constructor(
    private readonly arrangeRoomStateService: ArrangeRoomStateService,
    private readonly audioStorage: AudioRegionStorageService,
    private readonly projectStorageService: ProjectStorageService,
    serializationService?: ProjectSerializationService
  ) {
    this.serializationService = serializationService ?? new ProjectSerializationService(audioStorage);
    this.manifestService = new ProjectManifestService();
  }

  /**
   * Save project from room state to Backblaze storage
   * This is the new backend-driven save flow
   */
  async saveProjectFromRoom(
    roomId: string,
    projectId: string,
    userId: string,
    projectName?: string,
    options: { replaceExisting?: boolean; onProgress?: SaveProgressCallback } = {}
  ): Promise<void> {
    const startTime = Date.now();
    try {
      loggingService.logInfo('[SAVE-START] Starting project save', { roomId, projectId, userId });

      // 1. Get room state from Redis
      const stateStart = Date.now();
      const state = await this.arrangeRoomStateService.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }
      loggingService.logInfo('[SAVE-STATE] Got room state from Redis', {
        duration: `${Date.now() - stateStart}ms`,
        regionCount: state.regions.length,
      });

      // 2. Serialize project data
      const serializeStart = Date.now();
      const finalProjectName = projectName || 'Untitled Project';
      const projectData = this.serializationService.serializeRoomState(state, finalProjectName);
      const projectJson = JSON.stringify(projectData, null, 2);
      const projectJsonHash = ProjectManifestService.computeProjectJsonHash(projectJson);
      loggingService.logInfo('[SAVE-SERIALIZE] Serialized project data', {
        duration: `${Date.now() - serializeStart}ms`,
        projectJsonHash,
      });

      // 3. Collect audio files from server volume
      const collectStart = Date.now();
      const audioFiles = await this.serializationService.collectAudioFiles(roomId, state.regions);
      const totalAudioSize = audioFiles.reduce((sum, f) => sum + f.buffer.length, 0);
      loggingService.logInfo('[SAVE-COLLECT] Collected audio files', {
        duration: `${Date.now() - collectStart}ms`,
        audioFileCount: audioFiles.length,
        totalSizeMB: (totalAudioSize / 1024 / 1024).toFixed(2),
      });

      // 4. Compute audio hashes
      const audioHashes = this.manifestService.computeAudioHashes(
        audioFiles.map((af) => ({ audioFileId: af.audioFileId, buffer: af.buffer }))
      );

      // 5. Download old manifest and compare
      let oldManifest: ProjectManifest | null = null;
      if (options.replaceExisting) {
        const manifestStart = Date.now();
        oldManifest = await this.projectStorageService.getManifest(userId, projectId);
        loggingService.logInfo('[SAVE-MANIFEST] Downloaded old manifest', {
          duration: `${Date.now() - manifestStart}ms`,
          exists: oldManifest !== null,
        });
      }

      const diff = this.manifestService.compareManifests(oldManifest, projectJsonHash, audioHashes);
      this.emitProgress(options.onProgress, 'preparing');
      loggingService.logInfo('[SAVE-DIFF] Manifest comparison result', {
        projectJsonChanged: diff.projectJsonChanged,
        audioToUpload: diff.audioToUpload.length,
        audioUnchanged: diff.audioUnchanged.length,
        audioToDelete: diff.audioToDelete.length,
      });

      // 6. Build new manifest
      const newManifest = this.manifestService.buildManifest(projectJsonHash, audioHashes);

      // 7. Filter audio files — only upload changed/new ones
      const audioFilesToUpload = audioFiles.filter((af) =>
        diff.audioToUpload.includes(af.audioFileId)
      );

      // 8. Save to Backblaze
      const uploadStart = Date.now();
      this.emitProgress(options.onProgress, 'saving_data');
      loggingService.logInfo('[SAVE-UPLOAD] Starting upload to Backblaze', {
        projectJsonSizeKB: (projectJson.length / 1024).toFixed(2),
        audioToUpload: audioFilesToUpload.length,
        audioSkipped: diff.audioUnchanged.length,
        audioToDelete: diff.audioToDelete.length,
      });

      // Emit a single audio save progress event before the batched upload.
      // Audio files are uploaded in a single batch call (no per-file granularity),
      // so report 1/1 rather than fast-firing per-file counters that flash
      // before any actual upload begins.
      if (audioFilesToUpload.length > 0) {
        this.emitProgress(options.onProgress, 'saving_audio', {
          current: 1,
          total: 1,
        });
      }

      if (options.replaceExisting) {
        await this.projectStorageService.replaceProjectFilesSafely(userId, projectId, {
          ...(diff.projectJsonChanged ? { projectJson } : {}),
          audioFiles: audioFilesToUpload.map((af) => ({
            fileName: af.fileName,
            buffer: af.buffer,
          })),
          manifest: newManifest,
          orphanAudioIds: diff.audioToDelete,
          preservedAudioIds: diff.audioUnchanged,
        });
      } else {
        await this.projectStorageService.saveProjectFiles(userId, projectId, {
          projectJson,
          audioFiles: audioFilesToUpload.map((af) => ({
            fileName: af.fileName,
            buffer: af.buffer,
          })),
          manifest: newManifest,
        });
      }

      loggingService.logInfo('[SAVE-UPLOAD] Upload to Backblaze completed', {
        duration: `${Date.now() - uploadStart}ms`,
      });

      this.emitProgress(options.onProgress, 'finalizing');

      loggingService.logInfo('[SAVE-COMPLETE] Project saved successfully', {
        totalDuration: `${Date.now() - startTime}ms`,
        roomId, projectId, userId, projectName: finalProjectName,
        audioUploaded: audioFilesToUpload.length,
        audioSkipped: diff.audioUnchanged.length,
        audioDeleted: diff.audioToDelete.length,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectSaveService:saveProjectFromRoom',
        duration: `${Date.now() - startTime}ms`,
        roomId, projectId, userId,
      });
      throw error;
    }
  }

  /**
   * Create a new project from room state
   * This generates a new project ID and saves it
   */
  async createProjectFromRoom(
    roomId: string,
    userId: string,
    projectName: string,
    _projectDescription?: string
  ): Promise<string> {
    try {
      const projectId = randomUUID();

      // Note: _projectDescription is intentionally unused — description
      // is handled by the caller via setProjectMetadata after creation.
      await this.saveProjectFromRoom(roomId, projectId, userId, projectName);

      loggingService.logInfo('New project created from room state', {
        roomId,
        projectId,
        userId,
        projectName,
      });

      return projectId;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectSaveService:createProjectFromRoom',
        roomId,
        userId,
      });
      throw error;
    }
  }

  /** Emit a progress callback defensively — never let callback failures fail the save. */
  private emitProgress(
    onProgress: SaveProgressCallback | undefined,
    step: SaveProgressStep,
    detail?: SaveProgressDetail
  ): void {
    try {
      onProgress?.(step, detail);
    } catch {
      // Progress callback failure must not fail the save
    }
  }
}
