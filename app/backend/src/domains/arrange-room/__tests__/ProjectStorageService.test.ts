import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import { ProjectStorageService } from '../infrastructure/storage/ProjectStorageService';
import type { StorageAdapter } from '../../../shared/infrastructure/storage/StorageAdapter';
import type { ProjectManifest } from '../domain/models/ProjectManifest';

const mockManifest: ProjectManifest = {
  version: 1,
  projectSchemaVersion: PROJECT_SCHEMA_VERSION,
  projectJsonHash: 'abc123',
  audioFiles: {},
};

jest.mock('../../../config/environment', () => ({
  config: {
    storage: {
      bucketStorage: { enabled: false },
      recordingsDir: '/tmp/collab-project-storage-test',
      publicBaseUrl: '',
    },
  },
}));

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

class InMemoryStorageAdapter implements StorageAdapter {
  files = new Map<string, Buffer>();
  failOnSaveKey?: RegExp;
  deletedKeys: string[] = [];

  async saveFile(key: string, buffer: Buffer): Promise<string> {
    if (this.failOnSaveKey?.test(key)) {
      throw new Error(`save failed: ${key}`);
    }
    this.files.set(key, buffer);
    return key;
  }

  async getFile(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }

  async deleteFile(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.files.delete(key);
  }

  async fileExists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async getFileUrl(key: string): Promise<string> {
    return key;
  }

  async listFiles(prefix: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter((key) => key.startsWith(prefix));
  }
}

describe('ProjectStorageService safe replacement', () => {
  let service: ProjectStorageService;
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    service = new ProjectStorageService();
    adapter = new InMemoryStorageAdapter();
    (service as unknown as { storageAdapter: InMemoryStorageAdapter }).storageAdapter = adapter;
  });

  it('preserves existing project files when staging upload fails', async () => {
    const oldProjectKey = 'projects/user-1/project-1/project.json';
    const oldAudioKey = 'projects/user-1/project-1/audio/old.ogg';
    adapter.files.set(oldProjectKey, Buffer.from('old-project'));
    adapter.files.set(oldAudioKey, Buffer.from('old-audio'));
    adapter.failOnSaveKey = /\.staging\/.*audio\/new\.ogg$/;

    await expect(service.replaceProjectFilesSafely('user-1', 'project-1', {
      projectJson: 'new-project',
      audioFiles: [{ fileName: 'new.ogg', buffer: Buffer.from('new-audio') }],
      manifest: mockManifest,
    })).rejects.toThrow('save failed');

    expect(adapter.files.get(oldProjectKey)?.toString()).toBe('old-project');
    expect(adapter.files.get(oldAudioKey)?.toString()).toBe('old-audio');
  });

  it('cleans old files only after staged files are finalized', async () => {
    const oldProjectKey = 'projects/user-1/project-1/project.json';
    const oldAudioKey = 'projects/user-1/project-1/audio/old.ogg';
    const newAudioKey = 'projects/user-1/project-1/audio/new.ogg';
    adapter.files.set(oldProjectKey, Buffer.from('old-project'));
    adapter.files.set(oldAudioKey, Buffer.from('old-audio'));

    await service.replaceProjectFilesSafely('user-1', 'project-1', {
      projectJson: 'new-project',
      audioFiles: [{ fileName: 'new.ogg', buffer: Buffer.from('new-audio') }],
      manifest: mockManifest,
    });

    expect(adapter.files.get(oldProjectKey)?.toString()).toBe('new-project');
    expect(adapter.files.get(newAudioKey)?.toString()).toBe('new-audio');
    expect(adapter.files.has(oldAudioKey)).toBe(false);
    expect(adapter.deletedKeys).toContain(oldAudioKey);
  });
});
