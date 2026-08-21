import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type DeleteMarkerEntry,
  type ObjectVersion,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { loggingService } from '../logging/LoggingService';
import { config, type Config } from '../../../config/environment';
import type { StorageAdapter } from './StorageAdapter';

export class BackblazeStorageAdapter implements StorageAdapter {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string | undefined;

  /**
   * @param bucketStorageConfig Injectable for tests (aws-sdk-client-mock pattern);
   *   production call sites construct with no args and get the global config.
   */
  constructor(bucketStorageConfig: Config['storage']['bucketStorage'] = config.storage.bucketStorage) {
    const backblazeConfig = bucketStorageConfig;

    if (!backblazeConfig.endpoint || !backblazeConfig.region) {
      throw new Error('Backblaze endpoint and region must be configured');
    }

    if (!backblazeConfig.accessKeyId || !backblazeConfig.secretAccessKey) {
      throw new Error('Backblaze credentials must be configured');
    }

    if (!backblazeConfig.bucketName) {
      throw new Error('Backblaze bucket name must be configured');
    }

    let endpoint = backblazeConfig.endpoint;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
      loggingService.logInfo('Added https:// prefix to Backblaze endpoint', {
        original: backblazeConfig.endpoint,
        corrected: endpoint,
      });
    } else if (endpoint.startsWith('http://')) {
      endpoint = `https://${endpoint.slice('http://'.length)}`;
      loggingService.logInfo('Upgraded Backblaze endpoint from http:// to https://', {
        original: backblazeConfig.endpoint,
        corrected: endpoint,
      });
    }

    this.s3Client = new S3Client({
      endpoint,
      region: backblazeConfig.region,
      credentials: {
        accessKeyId: backblazeConfig.accessKeyId,
        secretAccessKey: backblazeConfig.secretAccessKey,
      },
      requestHandler: {
        requestTimeout: 30000,
        httpsAgent: {
          timeout: 30000,
        },
      },
      maxAttempts: 5, // More retries for unstable connections
    });

    this.bucketName = backblazeConfig.bucketName;
    this.publicUrl = backblazeConfig.publicUrl ?? undefined;

    loggingService.logInfo('Backblaze B2 Storage Adapter initialized', {
      endpoint: backblazeConfig.endpoint,
      region: backblazeConfig.region,
      bucketName: this.bucketName,
    });
  }

  async saveFile(key: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);
      loggingService.logInfo(`File saved to Backblaze: ${key}`, {
        bucket: this.bucketName,
        contentType,
        size: buffer.length,
      });
      return key;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save file to Backblaze'),
        { context: 'BackblazeStorageAdapter', key, bucket: this.bucketName },
      );
      throw error;
    }
  }

  async getFile(key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3Client.send(command);

      if (!response.Body) {
        return null;
      }

      const buffer = await this.streamToBuffer(response.Body as Readable);
      return buffer;
    } catch (error: unknown) {
      const _msg = error instanceof Error ? error.message : String(error);
      const err = error as Record<string, unknown>;
      if (err.name === 'NoSuchKey' || (err.$metadata as Record<string, unknown> | undefined)?.httpStatusCode === 404) {
        return null;
      }

      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get file from Backblaze'),
        { context: 'BackblazeStorageAdapter', key, bucket: this.bucketName },
      );
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);

      loggingService.logInfo(`File deleted from Backblaze: ${key}`, {
        bucket: this.bucketName,
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete file from Backblaze'),
        { context: 'BackblazeStorageAdapter', key, bucket: this.bucketName },
      );
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      const _msg = error instanceof Error ? error.message : String(error);
      const err = error as Record<string, unknown>;
      if (err.name === 'NotFound' || (err.$metadata as Record<string, unknown> | undefined)?.httpStatusCode === 404) {
        return false;
      }

      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to check file existence in Backblaze'),
        { context: 'BackblazeStorageAdapter', key, bucket: this.bucketName },
      );
      return false;
    }
  }

  async getFileUrl(key: string): Promise<string> {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      // Set expiration to 7 days (604800 seconds) - max allowed by Backblaze B2
      // For profile pictures, consider using public bucket or CDN for permanent URLs
      return await getSignedUrl(this.s3Client, command, { expiresIn: 604800 });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get file URL from Backblaze'),
        { context: 'BackblazeStorageAdapter', key, bucket: this.bucketName },
      );
      throw error;
    }
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: 1000,
      });
      const response = await this.s3Client.send(command);
      return (response.Contents || [])
        .map((obj) => obj.Key || '')
        .filter((key): key is string => Boolean(key));
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to list files from Backblaze'),
        { context: 'BackblazeStorageAdapter', prefix, bucket: this.bucketName },
      );
      return [];
    }
  }

  async listFileVersions(prefix: string): Promise<Array<{ key: string; versionId?: string; isDeleteMarker?: boolean }>> {
    try {
      const command = new ListObjectVersionsCommand({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: 1000,
      });
      const response = await this.s3Client.send(command);

      const versions: Array<{ key: string; versionId?: string; isDeleteMarker?: boolean }> = [];

      if (response.Versions) {
        for (const version of response.Versions) {
          const versionEntry = this.mapVersion(version, false);
          if (versionEntry) {
            versions.push(versionEntry);
          }
        }
      }

      if (response.DeleteMarkers) {
        for (const marker of response.DeleteMarkers) {
          const markerEntry = this.mapDeleteMarker(marker);
          if (markerEntry) {
            versions.push(markerEntry);
          }
        }
      }

      return versions;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to list file versions from Backblaze'),
        { context: 'BackblazeStorageAdapter', prefix, bucket: this.bucketName },
      );
      return [];
    }
  }

  async deleteFileVersion(key: string, versionId?: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        VersionId: versionId,
      });
      await this.s3Client.send(command);

      loggingService.logInfo(`File version deleted from Backblaze: ${key}`, {
        bucket: this.bucketName,
        versionId,
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete file version from Backblaze'),
        { context: 'BackblazeStorageAdapter', key, versionId, bucket: this.bucketName },
      );
      throw error;
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      const chunkBuf = chunk as Uint8Array;
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunkBuf);
    }

    return Buffer.concat(chunks);
  }

  private mapVersion(version: ObjectVersion, isDeleteMarker: boolean) {
    if (!version.Key) {
      return null;
    }

    const entry: { key: string; versionId?: string; isDeleteMarker?: boolean } = {
      key: version.Key,
      isDeleteMarker,
    };

    if (version.VersionId) {
      entry.versionId = version.VersionId;
    }

    return entry;
  }

  private mapDeleteMarker(marker: DeleteMarkerEntry) {
    if (!marker.Key) {
      return null;
    }

    const entry: { key: string; versionId?: string; isDeleteMarker?: boolean } = {
      key: marker.Key,
      isDeleteMarker: true,
    };

    if (marker.VersionId) {
      entry.versionId = marker.VersionId;
    }

    return entry;
  }
}
