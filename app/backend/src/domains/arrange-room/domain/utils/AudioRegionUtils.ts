import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import type { Region, AudioRegion } from '../models/ArrangeRoomState';

/**
 * Enriches audio regions with their playback URLs using the storage service.
 * Handles fallback for audioFileId and ensures data consistency.
 */
export function enrichAudioRegionsWithUrls(
  regions: Region[],
  roomId: string,
  audioStorage: AudioRegionStorageService
): Region[] {
  return regions.map((region: Region) => {
    if (region.type === 'audio') {
      const audioRegion = region as AudioRegion & { audioFileId?: string };
      // Use audioFileId if available (for regions that share the same audio file)
      // Otherwise fall back to region.id
      const audioFileId = audioRegion.audioFileId || audioRegion.id;
      return {
        ...region,
        audioUrl: audioStorage.getRegionPlaybackPath(roomId, audioFileId),
        // Ensure audioFileId is set for proper reference
        audioFileId,
      };
    }
    return region;
  });
}
