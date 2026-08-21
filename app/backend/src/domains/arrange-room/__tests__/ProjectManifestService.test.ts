/* eslint-disable @typescript-eslint/naming-convention */
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import { ProjectManifestService } from '../domain/services/ProjectManifestService';
import type { ProjectManifest } from '../domain/models/ProjectManifest';

describe('ProjectManifestService', () => {
  let service: ProjectManifestService;

  beforeEach(() => {
    service = new ProjectManifestService();
  });

  describe('computeHash', () => {
    it('returns a 64-char hex string for a buffer', () => {
      const buffer = Buffer.from('hello');
      const hash = ProjectManifestService.computeHash(buffer);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns the same hash for identical content', () => {
      const a = Buffer.from('test data');
      const b = Buffer.from('test data');
      expect(ProjectManifestService.computeHash(a)).toBe(ProjectManifestService.computeHash(b));
    });

    it('returns different hashes for different content', () => {
      const a = Buffer.from('test data A');
      const b = Buffer.from('test data B');
      expect(ProjectManifestService.computeHash(a)).not.toBe(ProjectManifestService.computeHash(b));
    });
  });

  describe('computeProjectJsonHash', () => {
    it('computes SHA-256 of UTF-8 encoded string', () => {
      const json = '{"version":"1.0.0"}';
      const hash = ProjectManifestService.computeProjectJsonHash(json);
      // Verify against known SHA-256
      const expected = ProjectManifestService.computeHash(Buffer.from(json, 'utf-8'));
      expect(hash).toBe(expected);
    });
  });

  describe('computeAudioHashes', () => {
    it('returns a map of audioFileId → hash for each audio file', () => {
      const audioFiles = [
        { audioFileId: 'file-1', buffer: Buffer.from('audio content 1') },
        { audioFileId: 'file-2', buffer: Buffer.from('audio content 2') },
      ];
      const hashes = service.computeAudioHashes(audioFiles);
      expect(Object.keys(hashes)).toHaveLength(2);
      expect(hashes['file-1']).toBe(ProjectManifestService.computeHash(audioFiles[0]!.buffer));
      expect(hashes['file-2']).toBe(ProjectManifestService.computeHash(audioFiles[1]!.buffer));
    });

    it('returns empty object for empty input', () => {
      expect(service.computeAudioHashes([])).toEqual({});
    });
  });

  describe('buildManifest', () => {
    it('builds a manifest with version 1 and provided hashes', () => {
      const manifest = service.buildManifest(
        'sha256:abc123...',
        { 'file-1': 'sha256:def456...' }
      );
      expect(manifest.version).toBe(1);
      expect(manifest.projectSchemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(manifest.projectJsonHash).toBe('sha256:abc123...');
      expect(manifest.audioFiles).toEqual({ 'file-1': 'sha256:def456...' });
    });
  });

  describe('compareManifests', () => {
    const oldManifest: ProjectManifest = {
      version: 1,
      projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      projectJsonHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      audioFiles: {
        'file-unchanged': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'file-removed': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'file-changed': 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
    };

    it('detects projectJson changed when hash differs', () => {
      const diff = service.compareManifests(
        oldManifest,
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        { 'file-unchanged': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
      );
      expect(diff.projectJsonChanged).toBe(true);
    });

    it('detects projectJson unchanged when hash matches', () => {
      const diff = service.compareManifests(
        oldManifest,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        { 'file-unchanged': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
      );
      expect(diff.projectJsonChanged).toBe(false);
    });

    it('classifies audio: unchanged, new, changed, deleted', () => {
      const diff = service.compareManifests(
        oldManifest,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        {
          'file-unchanged': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'file-changed': 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          'file-new': '0000000000000000000000000000000000000000000000000000000000000000',
        }
      );
      expect(diff.projectJsonChanged).toBe(false);
      expect(diff.audioUnchanged).toEqual(['file-unchanged']);
      expect(diff.audioToUpload).toEqual(expect.arrayContaining(['file-changed', 'file-new']));
      expect(diff.audioToDelete).toEqual(['file-removed']);
    });

    it('returns all-audio-to-upload for null oldManifest (first save)', () => {
      const diff = service.compareManifests(
        null,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        {
          'file-1': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'file-2': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        }
      );
      expect(diff.projectJsonChanged).toBe(true);
      expect(diff.audioToUpload).toEqual(expect.arrayContaining(['file-1', 'file-2']));
      expect(diff.audioToDelete).toEqual([]);
      expect(diff.audioUnchanged).toEqual([]);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips a manifest through JSON', () => {
      const manifest: ProjectManifest = {
        version: 1,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        projectJsonHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        audioFiles: { 'file-1': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      };
      const json = service.serializeManifest(manifest);
      const parsed = service.deserializeManifest(json);
      expect(parsed).toEqual(manifest);
    });
  });
});

describe('ProjectManifestService — projectSchemaVersion (DEV-310)', () => {
  let service: ProjectManifestService;

  beforeEach(() => {
    service = new ProjectManifestService();
  });

  it('buildManifest stamps the current PROJECT_SCHEMA_VERSION', () => {
    const manifest = service.buildManifest('hash-abc', { 'file-1': 'hash-1' });
    expect(manifest.projectSchemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('compareManifests treats a projectSchemaVersion mismatch as if there were no manifest (full re-upload)', () => {
    const staleManifest = {
      version: 1 as const,
      projectSchemaVersion: PROJECT_SCHEMA_VERSION - 1, // built under an earlier project-file era
      projectJsonHash: 'old-hash',
      audioFiles: { 'file-1': 'old-hash-1' },
    };
    const diff = service.compareManifests(staleManifest, 'new-hash', { 'file-1': 'old-hash-1' });
    // Same result shape as the existing oldManifest === null branch: everything re-uploads,
    // even audio whose content hash is unchanged — because the manifest itself can no longer
    // be trusted to describe the same project-file era.
    expect(diff.projectJsonChanged).toBe(true);
    expect(diff.audioToUpload).toEqual(['file-1']);
    expect(diff.audioUnchanged).toEqual([]);
  });

  it('compareManifests still does a normal incremental diff when projectSchemaVersion matches', () => {
    const currentManifest = {
      version: 1 as const,
      projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      projectJsonHash: 'same-hash',
      audioFiles: { 'file-1': 'same-hash-1' },
    };
    const diff = service.compareManifests(currentManifest, 'same-hash', { 'file-1': 'same-hash-1' });
    expect(diff.projectJsonChanged).toBe(false);
    expect(diff.audioUnchanged).toEqual(['file-1']);
  });
});
