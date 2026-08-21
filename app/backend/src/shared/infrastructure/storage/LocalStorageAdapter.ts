import fs from 'fs/promises';
import path from 'path';
import { loggingService } from '../logging/LoggingService';
import type { StorageAdapter } from './StorageAdapter';
import { config } from '../../../config/environment';

export class LocalStorageAdapter implements StorageAdapter {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || config.storage.recordingsDir;
    this.ensureDirectory(this.baseDir).catch((error: unknown) => {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to create base directory'),
        { context: 'LocalStorageAdapter.constructor', baseDir: this.baseDir }
      );
    });
    
    // Set public base URL for file access
    this.publicBaseUrl = config.storage.publicBaseUrl !== '' ? config.storage.publicBaseUrl : '';
    
    loggingService.logInfo('Local Storage Adapter initialized', {
      baseDir: this.baseDir,
    });
  }

  async saveFile(key: string, buffer: Buffer, contentType?: string): Promise<string> {
    const filePath = this.resolveKey(key);
    const dirPath = path.dirname(filePath);

    try {
      await this.ensureDirectory(dirPath);
      await fs.writeFile(filePath, buffer);
      
      loggingService.logInfo(`File saved to local storage: ${key}`, {
        path: filePath,
        size: buffer.length,
        contentType,
      });
      
      return key;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save file to local storage'),
        { context: 'LocalStorageAdapter', key, path: filePath }
      );
      throw error;
    }
  }

  async getFile(key: string): Promise<Buffer | null> {
    const filePath = this.resolveKey(key);

    try {
      const buffer = await fs.readFile(filePath);
      return buffer;
    } catch (error: unknown) {
      const _msg = error instanceof Error ? error.message : String(error);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get file from local storage'),
        { context: 'LocalStorageAdapter', key, path: filePath }
      );
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this.resolveKey(key);

    try {
      await fs.unlink(filePath);
      loggingService.logInfo(`File deleted from local storage: ${key}`, {
        path: filePath,
      });
    } catch (error: unknown) {
      // If file doesn't exist, consider it deleted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete file from local storage'),
        { context: 'LocalStorageAdapter', key, path: filePath }
      );
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const filePath = this.resolveKey(key);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileUrl(key: string): Promise<string> {
    // For local storage, we construct a URL based on the server configuration
    if (this.publicBaseUrl !== '') {
      return `${this.publicBaseUrl}/${key}`;
    }
    
    // Fallback to relative path if no public base URL is configured
    // This might need adjustment based on how static files are served
    return `/files/${key}`;
  }

  async listFiles(prefix: string): Promise<string[]> {
    const dirPath = this.resolveKey(prefix);
    const results: string[] = [];

    try {
      // Check if directory exists
      try {
        await fs.access(dirPath);
      } catch {
        return [];
      }

      // Recursive function to list files
      const scanDir = async (currentDir: string, relativePath: string) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          const entryRelativePath = path.join(relativePath, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(entryPath, entryRelativePath);
          } else {
            // Convert path separators to forward slashes for consistency with S3 keys
            const key = path.join(prefix, entryRelativePath).split(path.sep).join('/');
            results.push(key);
          }
        }
      };

      await scanDir(dirPath, '');
      return results;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to list files from local storage'),
        { context: 'LocalStorageAdapter', prefix, path: dirPath }
      );
      return [];
    }
  }

  /**
   * Resolve a storage key to an absolute path and assert it stays inside baseDir.
   * Universal backstop against path traversal (DEV-182): any key containing "../" that
   * would escape the base directory throws instead of reading/writing outside it.
   */
  private resolveKey(key: string): string {
    const baseResolved = path.resolve(this.baseDir);
    const target = path.resolve(this.baseDir, key);
    if (target !== baseResolved && !target.startsWith(baseResolved + path.sep)) {
      throw new Error(`Storage key escapes base directory: ${key}`);
    }
    return target;
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}
