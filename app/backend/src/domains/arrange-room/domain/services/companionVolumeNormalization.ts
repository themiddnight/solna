/**
 * Version-independent repair for a companion volume this build cannot represent.
 *
 * `resetLegacyLoudnessFields` only fires when the project file's `version !==
 * PROJECT_SCHEMA_VERSION`. That gate has a one-way leak: a legacy percent volume (0..100) that
 * escaped a reset — e.g. a `MidiRegion.companionMetadata.config.volume`, which earlier builds
 * deliberately skipped as "a historical snapshot" — gets the current version stamped over it on
 * the next save. From then on the file looks current, the reset never runs again, and every
 * `region_add` carrying that region is rejected by the shared `volume: -60..12` bound (the user
 * sees a region that duplicates locally but never persists).
 *
 * This pass reads the value instead of the version stamp, so it repairs those already-laundered
 * projects. It is deliberately narrow: only companion volumes, only when out of range.
 */
import { normalizeCompanionVolumeDb } from '@jam-band/shared';
import { toDecibels } from '../models/ArrangeRoomState';
import type { Region } from '../models/ArrangeRoomState';

function normalizeRegion(region: Region): Region {
  if (region.type === 'companion') {
    const normalized = normalizeCompanionVolumeDb(region.config.volume);
    return normalized === region.config.volume
      ? region
      : { ...region, config: { ...region.config, volume: toDecibels(normalized) } };
  }
  if (region.type === 'midi' && region.companionMetadata) {
    const current = region.companionMetadata.config.volume;
    const normalized = normalizeCompanionVolumeDb(current);
    return normalized === current
      ? region
      : {
          ...region,
          companionMetadata: {
            ...region.companionMetadata,
            config: { ...region.companionMetadata.config, volume: toDecibels(normalized) },
          },
        };
  }
  return region;
}

/** Pure: returns a new array only where a region actually needed repair. */
export function normalizeCompanionVolumes(regions: Region[]): Region[] {
  return regions.map(normalizeRegion);
}
