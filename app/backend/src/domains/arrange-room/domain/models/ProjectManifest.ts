/**
 * Manifest file stored alongside project.json in B2.
 * Records content hashes for incremental save comparison.
 */
export interface ProjectManifest {
  /** Schema version for forward-compatibility of the MANIFEST'S OWN shape (hash-map format) —
   * distinct from projectSchemaVersion below, which versions the project.json ERA it describes. */
  version: 1;
  /** PROJECT_SCHEMA_VERSION (from @jam-band/shared) at the time this manifest was built. A
   * mismatch means the manifest describes a project.json from a different, incompatible era —
   * compareManifests treats that the same as "no manifest yet" (DEV-310). */
  projectSchemaVersion: number;
  /** SHA-256 hex digest of the UTF-8 project.json content */
  projectJsonHash: string;
  /** Map of audioFileId → SHA-256 hex digest of the .ogg file bytes */
  audioFiles: Record<string, string>;
}

/**
 * Result of comparing current state against the stored manifest.
 */
export interface ManifestDiff {
  /** true when project.json should be uploaded */
  projectJsonChanged: boolean;
  /** audioFileIds whose content has changed or are new → upload */
  audioToUpload: string[];
  /** audioFileIds that exist in the old manifest but are no longer referenced → delete */
  audioToDelete: string[];
  /** audioFileIds whose hash matched the old manifest → skip */
  audioUnchanged: string[];
}
