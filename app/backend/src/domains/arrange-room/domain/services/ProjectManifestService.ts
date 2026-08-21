import { createHash } from 'crypto';
import { PROJECT_SCHEMA_VERSION, isSupportedProjectSchemaVersion } from '@jam-band/shared';
import type { ProjectManifest, ManifestDiff } from '../models/ProjectManifest';

/**
 * Service for computing content hashes and comparing manifests
 * for incremental project saves.
 */
export class ProjectManifestService {
  /**
   * Compute SHA-256 hash of a buffer, returned as hex string.
   */
  static computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Compute SHA-256 of project.json content (UTF-8 string).
   */
  static computeProjectJsonHash(projectJson: string): string {
    return ProjectManifestService.computeHash(Buffer.from(projectJson, 'utf-8'));
  }

  /**
   * Compute SHA-256 hashes for each audio file buffer.
   * Returns a map of audioFileId -> hex hash.
   */
  computeAudioHashes(
    audioFiles: Array<{ audioFileId: string; buffer: Buffer }>
  ): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const af of audioFiles) {
      hashes[af.audioFileId] = ProjectManifestService.computeHash(af.buffer);
    }
    return hashes;
  }

  /**
   * Build a ProjectManifest from current hashes.
   */
  buildManifest(
    projectJsonHash: string,
    audioHashes: Record<string, string>
  ): ProjectManifest {
    return {
      version: 1,
      projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      projectJsonHash,
      audioFiles: audioHashes,
    };
  }

  /**
   * Compare current state against the stored manifest.
   * Returns a ManifestDiff classifying each file as
   * unchanged, to-upload, or to-delete.
   */
  compareManifests(
    oldManifest: ProjectManifest | null,
    projectJsonHash: string,
    audioHashes: Record<string, string>
  ): ManifestDiff {
    if (oldManifest === null || !isSupportedProjectSchemaVersion(oldManifest.projectSchemaVersion)) {
      // First save, OR the old manifest was built under a different project-file era — either
      // way, it can't be trusted for an incremental diff. Upload everything, same as first-save.
      return {
        projectJsonChanged: true,
        audioToUpload: Object.keys(audioHashes),
        audioToDelete: [],
        audioUnchanged: [],
      };
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const projectJsonChanged = oldManifest.projectJsonHash !== projectJsonHash;

    const audioUnchanged: string[] = [];
    const audioToUpload: string[] = [];
    const audioToDelete: string[] = [];

    // Compare current audio against old manifest
    for (const [audioFileId, hash] of Object.entries(audioHashes)) {
      const oldHash = oldManifest.audioFiles[audioFileId];
      if (oldHash === undefined || oldHash !== hash) {
        audioToUpload.push(audioFileId);
      } else {
        audioUnchanged.push(audioFileId);
      }
    }

    // Find orphan audio files (in old manifest but not in current)
    for (const oldId of Object.keys(oldManifest.audioFiles)) {
      if (!(oldId in audioHashes)) {
        audioToDelete.push(oldId);
      }
    }

    return { projectJsonChanged, audioToUpload, audioToDelete, audioUnchanged };
  }

  /**
   * Serialize manifest to JSON string for storage.
   */
  serializeManifest(manifest: ProjectManifest): string {
    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Deserialize manifest from stored JSON string.
   * Validates the shape at runtime — throws on invalid manifests.
   */
  deserializeManifest(json: string): ProjectManifest {
    const parsed = JSON.parse(json) as { version: unknown; projectJsonHash: unknown };
    if (parsed.version !== 1 || typeof parsed.projectJsonHash !== 'string') {
      throw new Error('Invalid manifest: version must be 1 and projectJsonHash must be a string');
    }
    return parsed as unknown as ProjectManifest;
  }
}
