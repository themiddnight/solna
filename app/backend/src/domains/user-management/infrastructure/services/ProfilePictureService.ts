import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../../config/environment';
import { BackblazeStorageAdapter } from '../../../../shared/infrastructure/storage/BackblazeStorageAdapter';
import { LocalStorageAdapter } from '../../../../shared/infrastructure/storage/LocalStorageAdapter';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { StorageAdapter } from '../../../../shared/infrastructure/storage/StorageAdapter';

/**
 * Service for managing user profile pictures on disk or cloud storage
 * Stores profile pictures in profile-pictures/{userId}/{filename}
 */
export class ProfilePictureService {
  private readonly storageAdapter: StorageAdapter;

  constructor() {
    // Initialize Storage Adapter based on configuration
    if (config.storage.bucketStorage.enabled) {
      try {
        this.storageAdapter = new BackblazeStorageAdapter();
        loggingService.logInfo('ProfilePictureService initialized with Backblaze storage');
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'ProfilePictureService.initializeBackblaze' });
        this.storageAdapter = new LocalStorageAdapter();
      }
    } else {
      this.storageAdapter = new LocalStorageAdapter();
      loggingService.logInfo('ProfilePictureService initialized with Local storage');
    }
  }

  /**
   * Save a profile picture for a user
   * Returns the public URL of the saved picture
   */
  async saveProfilePicture(userId: string, buffer: Buffer, contentType: string = 'image/jpeg'): Promise<string> {
    const filename = this.generateFilename();
    const key = this.getProfilePictureKey(userId, filename);

    await this.storageAdapter.saveFile(key, buffer, contentType);

    loggingService.logInfo('Profile picture saved', {
      userId,
      key,
      size: buffer.length,
    });

    const url = await this.storageAdapter.getFileUrl(key);
    return url;
  }

  /**
   * Delete all profile pictures for a user
   * Used when updating profile picture to remove old ones
   */
  async deleteUserProfilePictures(userId: string): Promise<void> {
    const prefix = `profile-pictures/${userId}/`;

    try {
      const files = await this.storageAdapter.listFiles(prefix);

      if (files.length === 0) {
        return;
      }

      loggingService.logInfo('Deleting old profile pictures', {
        userId,
        fileCount: files.length,
      });

      // Delete all files
      await Promise.all(
        files.map((fileKey: string) => this.storageAdapter.deleteFile(fileKey))
      );
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete old profile pictures'),
        { context: 'ProfilePictureService', userId, prefix }
      );
      // Don't throw - continue with saving new picture
    }
  }

  /**
   * Delete a specific profile picture by its URL
   */
  async deleteProfilePictureByUrl(url: string): Promise<void> {
    try {
      // Extract the key from the URL
      // URL format: https://bucket-url/profile-pictures/{userId}/{filename}
      // or local: /profile-pictures/{userId}/{filename}
      const urlPath = new URL(url).pathname;
      const key = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;

      if (key.startsWith('profile-pictures/')) {
        await this.storageAdapter.deleteFile(key);
        loggingService.logInfo('Profile picture deleted', { key });
      }
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete profile picture by URL'),
        { context: 'ProfilePictureService', url }
      );
      // Don't throw - continue with saving new picture
    }
  }

  /**
   * Get the storage key for a profile picture
   */
  private getProfilePictureKey(userId: string, filename: string): string {
    return `profile-pictures/${userId}/${filename}`;
  }

  /**
   * Generate a unique filename for profile picture
   */
  private generateFilename(): string {
    const uniqueId = uuidv4();
    return `profile-${uniqueId}.jpg`;
  }
}

export const profilePictureService = new ProfilePictureService();
