import { DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import { normalizeCompanionVolumes } from '../domain/services/companionVolumeNormalization';
import { toDecibels } from '../domain/models/ArrangeRoomState';
import type {
  CompanionRegion,
  CompanionRegionConfig,
  MidiRegion,
  Region,
} from '../domain/models/ArrangeRoomState';

const configWithVolume = (volume: number): CompanionRegionConfig => ({
  style: 'walking',
  density: 'normal',
  volume: toDecibels(volume),
  isMuted: true,
});

const midiWithMetadataVolume = (volume: number): MidiRegion => ({
  id: 'region-converted',
  trackId: 'track-1',
  name: 'Companion 2',
  start: 0,
  length: 32,
  loopEnabled: false,
  loopIterations: 1,
  color: '#10b981',
  type: 'midi',
  notes: [],
  sustainEvents: [],
  companionMetadata: {
    config: configWithVolume(volume),
    chordTrackSnapshot: [],
    convertedAt: '2026-01-01T00:00:00.000Z',
  },
});

const companionWithVolume = (volume: number): CompanionRegion => ({
  id: 'region-companion',
  trackId: 'track-1',
  name: 'Companion 1',
  start: 0,
  length: 32,
  loopEnabled: false,
  loopIterations: 1,
  color: '#10b981',
  type: 'companion',
  config: configWithVolume(volume),
});

const metadataVolume = (region: Region | undefined): number | undefined =>
  region?.type === 'midi' ? region.companionMetadata?.config.volume : undefined;

const companionVolume = (region: Region | undefined): number | undefined =>
  region?.type === 'companion' ? region.config.volume : undefined;

describe('normalizeCompanionVolumes', () => {
  // The real defect: a percent-era 70 laundered under the current schema version, which the
  // version-gated legacy reset can no longer reach.
  it('repairs a converted MIDI region carrying a percent-era companionMetadata volume', () => {
    const [region] = normalizeCompanionVolumes([midiWithMetadataVolume(70)]);
    expect(metadataVolume(region)).toBe(DEFAULT_COMPANION_VOLUME_DB);
  });

  it('repairs a live companion region carrying an out-of-range volume', () => {
    const [region] = normalizeCompanionVolumes([companionWithVolume(70)]);
    expect(companionVolume(region)).toBe(DEFAULT_COMPANION_VOLUME_DB);
  });

  it('leaves an in-range volume untouched, object identity included', () => {
    const input = midiWithMetadataVolume(DEFAULT_COMPANION_VOLUME_DB);
    const [region] = normalizeCompanionVolumes([input]);
    expect(region).toBe(input);
  });

  it('does not touch companionMetadata.config.isMuted while repairing volume', () => {
    const [region] = normalizeCompanionVolumes([midiWithMetadataVolume(70)]);
    expect(region?.type === 'midi' ? region.companionMetadata?.config.isMuted : undefined).toBe(true);
  });

  it('passes through a plain MIDI region with no companion history', () => {
    const plain: MidiRegion = {
      id: 'plain',
      trackId: 'track-1',
      name: 'Plain',
      start: 0,
      length: 4,
      loopEnabled: false,
      loopIterations: 1,
      color: '#10b981',
      type: 'midi',
      notes: [],
      sustainEvents: [],
    };
    expect(normalizeCompanionVolumes([plain])[0]).toBe(plain);
  });
});
