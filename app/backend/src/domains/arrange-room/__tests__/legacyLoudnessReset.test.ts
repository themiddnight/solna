/* eslint-disable @typescript-eslint/naming-convention -- fixture object keys mirror real
   Redis-state Record<string, ...> keys (`track:<id>`, `<trackId>`), which are inherently
   hyphen/colon-bearing and can never satisfy camelCase/PascalCase/UPPER_CASE. */
/**
 * DEV-295 (final-review fix wave) — backend mirror of the frontend `legacyLoudnessReset.test.ts`
 * (`app/frontend/src/features/rooms/arrange/services/__tests__/legacyLoudnessReset.test.ts`).
 * Same reset-half / preserve-half / purity structure, against the backend's `ProjectData` types
 * (`Track`, `Region`, `EffectChainState`, `synthStates`' generic shape) instead of the frontend's
 * `SerializedProject`.
 *
 * Every value below is deliberately a legacy-era value (linear volume, percent volume, linear
 * vocoder multiplier) so the *reset* half of this suite proves the function actually rewrites
 * them, and the *preserve* half proves everything else survives byte-identical.
 */
import { DEFAULT_COMPANION_VOLUME_DB, DEFAULT_VOCODER_OUTPUT_GAIN_DB, DEFAULT_SYNTH_GAIN_DB } from '@jam-band/shared';
import { toDecibels, UNITY_DB } from '../domain/models/ArrangeRoomState';
import type {
  CompanionRegion,
  CompanionRegionConfig,
  MidiRegion,
  AudioRegion,
  Track,
  EffectChainState,
} from '../domain/models/ArrangeRoomState';
import type { ProjectData } from '../domain/models/ProjectData';
import { resetLegacyLoudnessFields } from '../domain/services/legacyLoudnessReset';

const legacyCompanionConfig: CompanionRegionConfig = {
  style: 'walking',
  density: 'normal',
  volume: toDecibels(70), // legacy percent-era value — must reset to DEFAULT_COMPANION_VOLUME_DB
  isMuted: false, // must NOT be touched
};

const companionRegion: CompanionRegion = {
  id: 'region-companion',
  trackId: 'track-1',
  name: 'Companion Region',
  start: 0,
  length: 4,
  loopEnabled: false,
  loopIterations: 1,
  color: '#3b82f6',
  type: 'companion',
  config: legacyCompanionConfig,
};

const midiRegionWithCompanionMetadata: MidiRegion = {
  id: 'region-midi-converted',
  trackId: 'track-1',
  name: 'Converted Companion',
  start: 4,
  length: 4,
  loopEnabled: false,
  loopIterations: 1,
  color: '#3b82f6',
  type: 'midi',
  notes: [{ id: 'note-1', pitch: 60, velocity: 100, start: 0, duration: 1 }],
  sustainEvents: [{ id: 'sustain-1', start: 0, end: 1 }],
  // Historical snapshot, not live region state — must survive untouched.
  companionMetadata: {
    config: { ...legacyCompanionConfig, isMuted: true },
    chordTrackSnapshot: [],
    convertedAt: '2026-01-01T00:00:00.000Z',
  },
};

const audioRegion: AudioRegion = {
  id: 'region-audio',
  trackId: 'track-2',
  name: 'Audio Region',
  start: 0,
  length: 8,
  loopEnabled: false,
  loopIterations: 1,
  color: '#22c55e',
  type: 'audio',
  audioUrl: '/audio/audio-1.wav',
  audioFileId: 'audio-1',
  gain: -4.5, // already dB pre-epic — must NOT be touched
  recordedBpm: 120,
};

const legacyTrack1: Track = {
  id: 'track-1',
  name: 'Legacy Midi Track',
  type: 'midi',
  volume: toDecibels(0.8), // legacy linear-era value — must reset to UNITY_DB
  pan: -0.35, // must NOT be touched
  color: '#3b82f6',
  regionIds: ['region-companion', 'region-midi-converted'],
};

const legacyTrack2: Track = {
  id: 'track-2',
  name: 'Legacy Audio Track',
  type: 'audio',
  volume: toDecibels(0.2),
  pan: 0.6,
  color: '#22c55e',
  regionIds: ['region-audio'],
};

const vocoderChain: EffectChainState = {
  type: 'track:track-1',
  effects: [
    {
      id: 'vocoder-1',
      type: 'vocoder',
      bypassed: false,
      order: 0,
      parameters: [
        { name: 'Dry/Wet', value: 1 },
        // legacy linear-era value (1-12x multiplier) — must reset to DEFAULT_VOCODER_OUTPUT_GAIN_DB
        { name: 'Output gain', value: 8 },
      ],
    },
  ],
};

const vocoderExtChain: EffectChainState = {
  type: 'track:track-2',
  effects: [
    {
      id: 'vocoderext-1',
      type: 'vocoderext',
      bypassed: false,
      order: 0,
      parameters: [{ name: 'Output gain', value: 6 }],
    },
  ],
};

const mixedNonVocoderChain: EffectChainState = {
  type: 'virtual_instrument',
  effects: [
    {
      id: 'compressor-1',
      type: 'compressor',
      bypassed: false,
      order: 0,
      parameters: [
        { name: 'Threshold', value: -24 },
        // Same parameter NAME as the vocoder's gain param, but a non-vocoder effect type —
        // the match must be scoped to type === vocoder|vocoderext, not name alone.
        { name: 'Output gain', value: 5 },
      ],
    },
    {
      id: 'ducker-1',
      type: 'ducker',
      bypassed: false,
      order: 1,
      parameters: [{ name: 'Threshold', value: -30 }],
    },
  ],
};

function buildLegacyProjectData(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    version: 1,
    metadata: {
      name: 'Legacy Project',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
    },
    project: {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      gridDivision: 16,
      loop: { enabled: false, start: 0, end: 8 },
      isMetronomeEnabled: true,
      snapToGrid: true,
    },
    scale: { rootNote: 'C', scale: 'major' },
    tracks: [legacyTrack1, legacyTrack2],
    regions: [companionRegion, midiRegionWithCompanionMetadata, audioRegion],
    effectChains: {
      'track:track-1': vocoderChain,
      'track:track-2': vocoderExtChain,
      virtual_instrument: mixedNonVocoderChain,
    },
    synthStates: {
      'track-1': { volume: 0.5, ampAttack: 0.01 }, // legacy linear-era value
    },
    instrumentParamsStates: {
      'track-3': { volume: -12 }, // must NOT be touched — not in the 4-field inventory
    },
    markers: [{ id: 'marker-1', position: 8, description: 'Chorus' }],
    chordTrack: { id: 'chord-track-1', projectId: 'project-1', blocks: [] },
    ...overrides,
  };
}

describe('resetLegacyLoudnessFields (backend)', () => {
  describe('reset half', () => {
    it('resets tracks[].volume to UNITY_DB', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      expect(result.tracks[0]?.volume).toBe(UNITY_DB);
      expect(result.tracks[1]?.volume).toBe(UNITY_DB);
    });

    it('resets a companion region config.volume to DEFAULT_COMPANION_VOLUME_DB', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const region = result.regions.find((r) => r.id === 'region-companion');
      expect(region?.type).toBe('companion');
      expect(region && region.type === 'companion' ? region.config.volume : undefined).toBe(
        DEFAULT_COMPANION_VOLUME_DB,
      );
    });

    it("resets a vocoder effect's Output gain parameter to DEFAULT_VOCODER_OUTPUT_GAIN_DB", () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const chain = result.effectChains['track:track-1'];
      const outputGain = chain?.effects[0]?.parameters.find((p) => p.name === 'Output gain');
      expect(outputGain?.value).toBe(DEFAULT_VOCODER_OUTPUT_GAIN_DB);
    });

    it("resets a vocoderext effect's Output gain parameter to DEFAULT_VOCODER_OUTPUT_GAIN_DB", () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const chain = result.effectChains['track:track-2'];
      const outputGain = chain?.effects[0]?.parameters.find((p) => p.name === 'Output gain');
      expect(outputGain?.value).toBe(DEFAULT_VOCODER_OUTPUT_GAIN_DB);
    });

    it('resets synthStates[*].volume to DEFAULT_SYNTH_GAIN_DB', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      expect(result.synthStates['track-1']?.volume).toBe(DEFAULT_SYNTH_GAIN_DB);
    });

    it('does NOT touch a non-vocoder effect parameter that happens to be named "Output gain"', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const chain = result.effectChains.virtual_instrument;
      const compressor = chain?.effects.find((e) => e.id === 'compressor-1');
      const outputGain = compressor?.parameters.find((p) => p.name === 'Output gain');
      expect(outputGain?.value).toBe(5);
    });
  });

  describe('preserve half', () => {
    it('does not touch tracks[].pan', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      expect(result.tracks[0]?.pan).toBe(-0.35);
      expect(result.tracks[1]?.pan).toBe(0.6);
    });

    it('does not touch a companion region config.isMuted', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const region = result.regions.find((r) => r.id === 'region-companion');
      expect(region?.type === 'companion' ? region.config.isMuted : undefined).toBe(false);
    });

    it('resets regions[].companionMetadata.config.volume — a revert restores it as live state', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const region = result.regions.find((r) => r.id === 'region-midi-converted');
      expect(region?.type === 'midi' ? region.companionMetadata?.config.volume : undefined).toBe(
        DEFAULT_COMPANION_VOLUME_DB,
      );
    });

    it('does not touch regions[].companionMetadata.config.isMuted', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const region = result.regions.find((r) => r.id === 'region-midi-converted');
      expect(region?.type === 'midi' ? region.companionMetadata?.config.isMuted : undefined).toBe(true);
    });

    it('does not touch regions[].gain (AudioRegion.gain — already dB pre-epic)', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const region = result.regions.find((r) => r.id === 'region-audio');
      expect(region?.type === 'audio' ? region.gain : undefined).toBe(-4.5);
    });

    it('does not touch a compressor Threshold parameter', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const compressor = result.effectChains.virtual_instrument?.effects.find((e) => e.id === 'compressor-1');
      const threshold = compressor?.parameters.find((p) => p.name === 'Threshold');
      expect(threshold?.value).toBe(-24);
    });

    it('does not touch a ducker Threshold parameter', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      const ducker = result.effectChains.virtual_instrument?.effects.find((e) => e.id === 'ducker-1');
      const threshold = ducker?.parameters.find((p) => p.name === 'Threshold');
      expect(threshold?.value).toBe(-30);
    });

    it('does not touch instrumentParamsStates', () => {
      const result = resetLegacyLoudnessFields(buildLegacyProjectData());
      expect(result.instrumentParamsStates?.['track-3']?.volume).toBe(-12);
    });

    it('does not touch markers or chordTrack', () => {
      const project = buildLegacyProjectData();
      const result = resetLegacyLoudnessFields(project);
      expect(result.markers).toEqual(project.markers);
      expect(result.chordTrack).toEqual(project.chordTrack);
    });

    it('preserves an unknown field a future build added, that this build does not model', () => {
      type WithExtra = ProjectData & { legacyUnknownField: string };
      const project: WithExtra = { ...buildLegacyProjectData(), legacyUnknownField: 'mystery-value' };
      const result = resetLegacyLoudnessFields(project);
      expect((result as WithExtra).legacyUnknownField).toBe('mystery-value');
    });
  });

  describe('purity and edge cases', () => {
    it('does not mutate its input', () => {
      const project = buildLegacyProjectData();
      const snapshotVolume = project.tracks[0]?.volume;
      resetLegacyLoudnessFields(project);
      expect(project.tracks[0]?.volume).toBe(snapshotVolume);
      const region = project.regions[0];
      expect(region?.type === 'companion' ? region.config.volume : undefined).toBe(70);
      expect(project.synthStates['track-1']?.volume).toBe(0.5);
    });

    it('returns a new object, not the same reference', () => {
      const project = buildLegacyProjectData();
      const result = resetLegacyLoudnessFields(project);
      expect(result).not.toBe(project);
    });

    it('does not throw on a project with no companion regions, no effect chains, and no synth states', () => {
      const minimal = buildLegacyProjectData({
        regions: [audioRegion],
        effectChains: {},
        synthStates: {},
      });
      expect(() => resetLegacyLoudnessFields(minimal)).not.toThrow();
    });
  });
});
