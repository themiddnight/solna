import path from 'path';
import { config } from '../../../../config/environment';
import { BackblazeStorageAdapter } from '../../../../shared/infrastructure/storage/BackblazeStorageAdapter';
import { LocalStorageAdapter } from '../../../../shared/infrastructure/storage/LocalStorageAdapter';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { StorageAdapter } from '../../../../shared/infrastructure/storage/StorageAdapter';
import type { ProjectManifest } from '../../domain/models/ProjectManifest';
import { randomUUID } from 'crypto';

interface StagedProjectFiles {
  stagingPrefix: string;
  finalKeys: Set<string>;
}

interface StorageAdapterWithVersioning extends StorageAdapter {
  listFileVersions?(prefix: string): Promise<Array<{ key: string; versionId?: string }>>;
  deleteFileVersion?(key: string, versionId?: string): Promise<void>;
}

/**
 * Service for managing saved project files on disk or cloud storage
 * Stores projects in /record-audio/{userId}/{projectId}/ (local) or projects/{userId}/{projectId}/ (Backblaze)
 * Also manages in-memory project storage for active rooms
 */
export class ProjectStorageService {
  private readonly storageAdapter: StorageAdapter;
  // In-memory storage for active room project metadata only (roomId -> metadata)
  // ProjectData is always serialized from Redis state (single source of truth)
  private readonly roomProjects: Map<string, {
    projectName: string;
    uploadedBy: string;
    uploadedAt: Date;
  }> = new Map();

  constructor() {
    // Initialize Storage Adapter based on configuration
    if (config.storage.bucketStorage.enabled) {
      try {
        this.storageAdapter = new BackblazeStorageAdapter();
        loggingService.logInfo('ProjectStorageService initialized with Backblaze storage');
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'ProjectStorageService.initializeBackblaze' });
        this.storageAdapter = new LocalStorageAdapter();
      }
    } else {
      this.storageAdapter = new LocalStorageAdapter();
      loggingService.logInfo('ProjectStorageService initialized with Local storage');
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Save project files to disk or cloud storage
   * Structure: {userId}/{projectId}/project.json and {userId}/{projectId}/audio/
   */
  async saveProjectFiles(
    userId: string,
    projectId: string,
    projectData: {
      projectJson: string;
      audioFiles?: Array<{ fileName: string; buffer: Buffer }>;
      manifest?: ProjectManifest;     // NEW — optional for backward compat
    }
  ): Promise<void> {
    // Save project.json
    const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');
    await this.storageAdapter.saveFile(
      projectJsonKey,
      Buffer.from(projectData.projectJson, 'utf-8'),
      'application/json'
    );

    // Save audio files if any
    if (projectData.audioFiles && projectData.audioFiles.length > 0) {
      for (const audioFile of projectData.audioFiles) {
        const audioKey = this.getProjectKey(userId, projectId, `audio/${audioFile.fileName}`);
        await this.storageAdapter.saveFile(
          audioKey,
          audioFile.buffer,
          'application/octet-stream'
        );
      }
    }

    // Save manifest if provided
    if (projectData.manifest) {
      await this.saveManifest(userId, projectId, projectData.manifest);
    }
  }

  /**
   * Download and parse the manifest for a project.
   * Returns null if no manifest exists (first save / legacy project).
   */
  async getManifest(userId: string, projectId: string): Promise<ProjectManifest | null> {
    const manifestKey = this.getProjectKey(userId, projectId, 'manifest.json');
    try {
      const buffer = await this.storageAdapter.getFile(manifestKey);
      if (!buffer) return null;
      const json = buffer.toString('utf-8');
      return JSON.parse(json) as ProjectManifest;
    } catch {
      // 404 or parse error → treat as no manifest (conservative)
      return null;
    }
  }

  /**
   * Upload manifest.json to the project's B2 prefix.
   */
  async saveManifest(userId: string, projectId: string, manifest: ProjectManifest): Promise<void> {
    const manifestKey = this.getProjectKey(userId, projectId, 'manifest.json');
    const json = JSON.stringify(manifest, null, 2);
    await this.storageAdapter.saveFile(
      manifestKey,
      Buffer.from(json, 'utf-8'),
      'application/json'
    );
  }

  /**
   * Delete audio files from B2 that are no longer referenced by any region.
   */
  async deleteOrphanAudioFiles(
    userId: string,
    projectId: string,
    orphanIds: string[]
  ): Promise<void> {
    if (orphanIds.length === 0) return;

    // Use version-aware delete if available (Backblaze), else plain delete
    const adapter = this.storageAdapter as StorageAdapterWithVersioning;

    await Promise.all(
      orphanIds.map(async (audioFileId) => {
        const key = this.getProjectKey(userId, projectId, `audio/${audioFileId}.ogg`);
        try {
          if (adapter.deleteFileVersion) {
            // Delete all versions including delete markers
            const versions = await adapter.listFileVersions?.(key) ?? [];
            await Promise.all(
              versions.map((v) => adapter.deleteFileVersion?.(key, v.versionId))
            );
          } else {
            await this.storageAdapter.deleteFile(key);
          }
          loggingService.logInfo('Deleted orphan audio file', {
            userId, projectId, audioFileId, key,
          });
        } catch (error) {
          // Log but don't throw — orphan cleanup is best-effort
          loggingService.logError(
            error instanceof Error ? error : new Error('Failed to delete orphan audio'),
            { context: 'ProjectStorageService:deleteOrphanAudioFiles', userId, projectId, audioFileId }
          );
        }
      })
    );
  }

  async saveProjectFilesToStaging(
    userId: string,
    projectId: string,
    projectData: {
      projectJson?: string;          // undefined → skip staging (unchanged)
      audioFiles?: Array<{ fileName: string; buffer: Buffer }>;
      manifest: ProjectManifest;     // REQUIRED — always staged
    },
    preservedAudioIds: string[] = []  // audioFileIds to keep but NOT re-upload
  ): Promise<StagedProjectFiles> {
    const stagingPrefix = this.getStagingPrefix(userId, projectId, randomUUID());
    const finalKeys = new Set<string>();

    // Always include project.json key (staged or preserved from previous save)
    finalKeys.add(this.getProjectKey(userId, projectId, 'project.json'));

    // Stage project.json only if changed
    if (projectData.projectJson !== undefined) {
      const projectJsonStagingKey = `${stagingPrefix}project.json`;
      await this.storageAdapter.saveFile(
        projectJsonStagingKey,
        Buffer.from(projectData.projectJson, 'utf-8'),
        'application/json'
      );
    }

    // Stage new/changed audio files
    if (projectData.audioFiles && projectData.audioFiles.length > 0) {
      for (const audioFile of projectData.audioFiles) {
        const relativeAudioPath = `audio/${audioFile.fileName}`;
        const stagingKey = `${stagingPrefix}${relativeAudioPath}`;
        finalKeys.add(this.getProjectKey(userId, projectId, relativeAudioPath));
        await this.storageAdapter.saveFile(
          stagingKey,
          audioFile.buffer,
          'application/octet-stream'
        );
      }
    }

    // Preserve unchanged audio files — add their keys to finalKeys so
    // cleanupOldProjectFilesExcept does NOT delete them
    for (const audioFileId of preservedAudioIds) {
      finalKeys.add(this.getProjectKey(userId, projectId, `audio/${audioFileId}.ogg`));
    }

    // Stage manifest.json (always)
    const manifestJson = JSON.stringify(projectData.manifest, null, 2);
    const manifestStagingKey = `${stagingPrefix}manifest.json`;
    finalKeys.add(this.getProjectKey(userId, projectId, 'manifest.json'));
    await this.storageAdapter.saveFile(
      manifestStagingKey,
      Buffer.from(manifestJson, 'utf-8'),
      'application/json'
    );

    return { stagingPrefix, finalKeys };
  }

  async finalizeStagedProjectFiles(userId: string, projectId: string, staged: StagedProjectFiles): Promise<void> {
    const stagedKeys = await this.storageAdapter.listFiles(staged.stagingPrefix);
    const projectJsonStagingKey = `${staged.stagingPrefix}project.json`;
    const projectJsonFinalKey = this.getProjectKey(userId, projectId, 'project.json');

    for (const stagedKey of stagedKeys.filter((key) => key !== projectJsonStagingKey)) {
      const buffer = await this.storageAdapter.getFile(stagedKey);
      if (!buffer) throw new Error(`Staged project file missing: ${stagedKey}`);
      const relativePath = stagedKey.replace(staged.stagingPrefix, '');
      await this.storageAdapter.saveFile(
        this.getProjectKey(userId, projectId, relativePath),
        buffer,
        'application/octet-stream'
      );
    }

    const projectJson = await this.storageAdapter.getFile(projectJsonStagingKey);
    if (projectJson) {
      await this.storageAdapter.saveFile(projectJsonFinalKey, projectJson, 'application/json');
    }
    // If project.json is not staged (unchanged), it's preserved via finalKeys in the caller
  }

  async cleanupStagedProjectFiles(staged: StagedProjectFiles): Promise<void> {
    try {
      const stagedKeys = await this.storageAdapter.listFiles(staged.stagingPrefix);
      await Promise.all(stagedKeys.map((key) => this.storageAdapter.deleteFile(key)));
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to cleanup staged project files'),
        { context: 'ProjectStorageService:cleanupStagedProjectFiles', stagingPrefix: staged.stagingPrefix }
      );
    }
  }

  async cleanupOldProjectFilesExcept(userId: string, projectId: string, keepKeys: Set<string>): Promise<void> {
    const prefix = this.getProjectPrefix(userId, projectId);

    try {
      const files = await this.storageAdapter.listFiles(prefix);
      const filesToDelete = files.filter((key) => (
        !key.startsWith(`${prefix}.staging/`) && !keepKeys.has(key)
      ));

      await Promise.all(filesToDelete.map((key) => this.storageAdapter.deleteFile(key)));
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to cleanup replaced project files'),
        { context: 'ProjectStorageService:cleanupOldProjectFilesExcept', userId, projectId, prefix }
      );
    }
  }

  async replaceProjectFilesSafely(
    userId: string,
    projectId: string,
    projectData: {
      projectJson?: string;          // undefined → skip project.json upload
      audioFiles?: Array<{ fileName: string; buffer: Buffer }>;
      manifest: ProjectManifest;     // REQUIRED
      orphanAudioIds?: string[];     // audioFileIds to delete from B2
      preservedAudioIds?: string[];  // audioFileIds to keep (not re-upload, not delete)
    }
  ): Promise<void> {
    const staged = await this.saveProjectFilesToStaging(
      userId, projectId, projectData,
      projectData.preservedAudioIds ?? []
    );

    try {
      await this.finalizeStagedProjectFiles(userId, projectId, staged);

      // Cleanup orphans AFTER successful finalize
      if (projectData.orphanAudioIds && projectData.orphanAudioIds.length > 0) {
        await this.deleteOrphanAudioFiles(userId, projectId, projectData.orphanAudioIds);
      }

      await this.cleanupOldProjectFilesExcept(userId, projectId, staged.finalKeys);
    } finally {
      await this.cleanupStagedProjectFiles(staged);
    }
  }

  /**
   * Load project files from disk or cloud storage
   */
  async loadProjectFiles(
    userId: string,
    projectId: string
  ): Promise<{
    projectJson: string;
    audioFiles: Array<{ fileName: string; buffer: Buffer }>;
  }> {
    const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');

    // Create a new timeout Promise per Promise.race() call to ensure each operation
    // gets the full 30s budget — reusing a single Promise would reduce the remaining
    // time for subsequent operations (fixed from shared-timeout anti-pattern).
    const makeTimeout = (): Promise<never> =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Storage operation timeout after 30 seconds')), 30000)
      );

    try {
      const projectJsonBuffer = await Promise.race([
        this.storageAdapter.getFile(projectJsonKey),
        makeTimeout()
      ]);

      if (!projectJsonBuffer) {
        throw new Error(`Project not found: ${projectId}`);
      }

      const projectJson = projectJsonBuffer.toString('utf-8');

      const audioFiles: Array<{ fileName: string; buffer: Buffer }> = [];
      const audioPrefix = this.getProjectKey(userId, projectId, 'audio/');
      
      const audioKeys = await Promise.race([
        this.storageAdapter.listFiles(audioPrefix),
        makeTimeout()
      ]);

      const BATCH_SIZE = 5;
      for (let i = 0; i < audioKeys.length; i += BATCH_SIZE) {
        const batch = audioKeys.slice(i, i + BATCH_SIZE);
        const buffers = await Promise.all(
          batch.map(async (key) => {
            try {
              const buffer = await Promise.race([
                this.storageAdapter.getFile(key),
                makeTimeout()
              ]);
              return buffer ? { fileName: key.replace(audioPrefix, ''), buffer } : null;
            } catch (error) {
              loggingService.logError(
                error instanceof Error ? error : new Error('Failed to load audio file'),
                { context: 'ProjectStorageService:loadAudioFile', key }
              );
              return null;
            }
          })
        );
        
        audioFiles.push(...buffers.filter((b): b is { fileName: string; buffer: Buffer } => b !== null));
      }

      loggingService.logInfo('Project files loaded successfully', {
        userId,
        projectId,
        audioFilesCount: audioFiles.length,
      });

      return { projectJson, audioFiles };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to load project files'),
        { context: 'ProjectStorageService:loadProjectFiles', userId, projectId }
      );
      throw error;
    }
  }

  /**
   * Delete all old project files including all versions (used when updating/saving over existing project)
   * This deletes project.json and all audio files
   */
  async deleteAllOldProjectFiles(userId: string, projectId: string): Promise<void> {
    const prefix = `projects/${userId}/${projectId}/`;
    
    try {
      // Use listFileVersions if available (Backblaze), otherwise listFiles
      const adapter = this.storageAdapter as StorageAdapterWithVersioning;
      
      if (adapter.listFileVersions) {
        const fileVersions = await adapter.listFileVersions(prefix);
        
        if (fileVersions.length === 0) {
          return;
        }

        loggingService.logInfo('Deleting all old project files and versions', {
          userId,
          projectId,
          totalVersions: fileVersions.length,
        });

        // Delete all versions
        await Promise.all(
          fileVersions.map((fileVersion) => 
            adapter.deleteFileVersion?.(fileVersion.key, fileVersion.versionId)
          )
        );
      } else {
        // Fallback to regular delete
        const files = await this.storageAdapter.listFiles(prefix);
        
        if (files.length === 0) {
          return;
        }

        loggingService.logInfo('Deleting all old project files', {
          userId,
          projectId,
          fileCount: files.length,
        });

        // Delete all files
        await Promise.all(
          files.map((fileKey) => this.storageAdapter.deleteFile(fileKey))
        );
      }
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete old project files'),
        { context: 'ProjectStorageService', userId, projectId, prefix }
      );
      // Don't throw - continue with saving new files
    }
  }

  /**
   * Delete old audio files from a project (used when updating/saving over existing project)
   * @deprecated Use deleteAllOldProjectFiles instead to delete all files including versions
   */
  async deleteOldAudioFiles(userId: string, projectId: string): Promise<void> {
    const audioPrefix = this.getProjectKey(userId, projectId, 'audio/');
    
    try {
      const audioKeys = await this.storageAdapter.listFiles(audioPrefix);
      
      if (audioKeys.length === 0) {
        return;
      }

      loggingService.logInfo('Deleting old audio files', {
        userId,
        projectId,
        fileCount: audioKeys.length,
      });

      // Delete all audio files
      await Promise.all(
        audioKeys.map((fileKey) => this.storageAdapter.deleteFile(fileKey))
      );
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete old audio files'),
        { context: 'ProjectStorageService', userId, projectId, prefix: audioPrefix }
      );
      // Don't throw - continue with saving new files
    }
  }

  /**
   * Delete project files from disk or cloud storage
   */
  async deleteProjectFiles(userId: string, projectId: string): Promise<void> {
    // Reuse logic from deleteAllOldProjectFiles as it handles versions and deletions correctly
    await this.deleteAllOldProjectFiles(userId, projectId);
  }

  /**
   * Check if project files exist
   */
  async projectFilesExist(userId: string, projectId: string): Promise<boolean> {
    const projectJsonKey = this.getProjectKey(userId, projectId, 'project.json');
    return await this.storageAdapter.fileExists(projectJsonKey);
  }

  /**
   * Save project metadata in memory for a room (used by ProjectController)
   * This is for active room projects, not saved user projects
   * Note: ProjectData is stored in Redis via ArrangeRoomState, not here
   */
  saveProject(roomId: string, projectName: string, uploadedBy: string): void {
    this.roomProjects.set(roomId, {
      projectName,
      uploadedBy,
      uploadedAt: new Date(),
    });
  }

  /**
   * Save project metadata without updating uploadedAt (used when loading project)
   * This preserves the original upload timestamp
   */
  saveProjectMetadata(roomId: string, projectName: string, uploadedBy: string, uploadedAt?: Date): void {
    this.roomProjects.set(roomId, {
      projectName,
      uploadedBy,
      uploadedAt: uploadedAt ?? new Date(),
    });
  }

  /**
   * Get project metadata from memory for a room (used by ProjectController)
   * This is for active room projects, not saved user projects
   * Note: To get ProjectData, serialize from Redis state via ArrangeRoomStateService
   */
  getProject(roomId: string): {
    projectName: string;
    uploadedBy: string;
    uploadedAt: Date;
  } | null {
    return this.roomProjects.get(roomId) || null;
  }

  /**
   * Delete project from memory for a room
   */
  deleteRoomProject(roomId: string): void {
    this.roomProjects.delete(roomId);
  }

  // ─── Private helpers ─────────────────────────────────────────

  /**
   * Get the storage key for a project file
   */
  private getProjectKey(userId: string, projectId: string, fileName: string): string {
    // Structure: projects/{userId}/{projectId}/{fileName}
    const prefix = `projects/${userId}/${projectId}/`;
    const key = `${prefix}${fileName}`;
    // Reject any fileName whose traversal would escape the project namespace. This also
    // covers Backblaze, where the LocalStorageAdapter filesystem containment check does not
    // apply (DEV-182). Legitimate fileNames contain no "../" so normalization is a no-op.
    const normalized = path.posix.normalize(key);
    if (normalized !== key || !normalized.startsWith(prefix)) {
      throw new Error(`Invalid project file path: ${fileName}`);
    }
    return key;
  }

  private getProjectPrefix(userId: string, projectId: string): string {
    return `projects/${userId}/${projectId}/`;
  }

  private getStagingPrefix(userId: string, projectId: string, stagingId: string): string {
    return `${this.getProjectPrefix(userId, projectId)}.staging/${stagingId}/`;
  }
}

export const projectStorageService = new ProjectStorageService();
