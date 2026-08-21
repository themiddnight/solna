/**
 * DEV-182 backstop tests for LocalStorageAdapter — real temp dirs, zero mocks.
 *
 * The load-bearing test is resolveKey: any key that would escape baseDir via a
 * `../`-walk must throw on EVERY public entry point, so a traversal key can never
 * read or write outside the storage root. getFile/deleteFile ENOENT handling,
 * recursive listFiles with forward-slash normalization, and saveFile's parent-dir
 * creation are documented alongside.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalStorageAdapter } from '../LocalStorageAdapter';

describe('LocalStorageAdapter (real temp dirs, zero mocks)', () => {
  let baseDir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-storage-adapter-'));
    adapter = new LocalStorageAdapter(baseDir);
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('resolveKey — DEV-182 path-traversal backstop (THE load-bearing test)', () => {
    it('throws from every entry point on any key that escapes baseDir via a ../ walk', async () => {
      const escapingKeys = [
        '..',
        '../escape.txt',
        'sub/../../escape.txt',
        'a/../b/../../../escape.txt',
        'nested/../../escape.txt',
      ];

      for (const key of escapingKeys) {
        await expect(adapter.saveFile(key, Buffer.from('x'))).rejects.toThrow(
          /escapes base directory/
        );
        await expect(adapter.getFile(key)).rejects.toThrow(/escapes base directory/);
        await expect(adapter.deleteFile(key)).rejects.toThrow(/escapes base directory/);
        await expect(adapter.fileExists(key)).rejects.toThrow(/escapes base directory/);
        await expect(adapter.listFiles(key)).rejects.toThrow(/escapes base directory/);
      }
    });

    it('allows keys that walk up but resolve back inside baseDir (guard is on the resolved path)', async () => {
      const key = 'sub/../inside.txt';
      await adapter.saveFile(key, Buffer.from('ok'));
      await expect(adapter.getFile(key)).resolves.toEqual(Buffer.from('ok'));
    });
  });

  describe('getFile', () => {
    it('returns null for ENOENT (missing file)', async () => {
      await expect(adapter.getFile('missing.txt')).resolves.toBeNull();
    });

    it('returns null for ENOENT on a nested path', async () => {
      await expect(adapter.getFile('nested/also-missing.txt')).resolves.toBeNull();
    });

    it('returns the saved buffer for an existing file', async () => {
      await adapter.saveFile('present.txt', Buffer.from('hello'));
      await expect(adapter.getFile('present.txt')).resolves.toEqual(Buffer.from('hello'));
    });
  });

  describe('deleteFile', () => {
    it('silently no-ops on ENOENT (never-existed file)', async () => {
      await expect(adapter.deleteFile('never-existed.txt')).resolves.toBeUndefined();
    });

    it('deletes an existing file', async () => {
      await adapter.saveFile('to-delete.txt', Buffer.from('bye'));
      await expect(adapter.deleteFile('to-delete.txt')).resolves.toBeUndefined();
      await expect(adapter.getFile('to-delete.txt')).resolves.toBeNull();
    });
  });

  describe('listFiles', () => {
    it('recurses into subdirectories and normalizes separators to forward slashes', async () => {
      await adapter.saveFile('a.txt', Buffer.from('1'));
      await adapter.saveFile('nested/b.txt', Buffer.from('2'));
      await adapter.saveFile('nested/deep/c.txt', Buffer.from('3'));

      const keys = await adapter.listFiles('');
      expect(keys.sort()).toEqual(['a.txt', 'nested/b.txt', 'nested/deep/c.txt']);
      // Contract: keys are S3-style forward-slash keys on every platform.
      expect(keys.every((key) => !key.includes('\\'))).toBe(true);
    });

    it('keeps the prefix on keys when listing a subdirectory', async () => {
      await adapter.saveFile('nested/b.txt', Buffer.from('2'));
      await adapter.saveFile('nested/deep/c.txt', Buffer.from('3'));
      await adapter.saveFile('other.txt', Buffer.from('4'));

      const keys = await adapter.listFiles('nested');
      expect(keys.sort()).toEqual(['nested/b.txt', 'nested/deep/c.txt']);
    });

    it('returns [] for a missing directory', async () => {
      await expect(adapter.listFiles('does-not-exist')).resolves.toEqual([]);
    });
  });

  describe('saveFile', () => {
    it('creates parent directories for nested keys', async () => {
      const key = 'deep/nested/dir/file.txt';
      await expect(adapter.saveFile(key, Buffer.from('data'))).resolves.toBe(key);
      await expect(adapter.getFile(key)).resolves.toEqual(Buffer.from('data'));
      await expect(adapter.fileExists(key)).resolves.toBe(true);
    });

    it('returns the storage key on success', async () => {
      await expect(adapter.saveFile('flat.txt', Buffer.from('x'))).resolves.toBe('flat.txt');
    });

    it('fileExists is false for a missing file', async () => {
      await expect(adapter.fileExists('missing.txt')).resolves.toBe(false);
    });
  });
});
