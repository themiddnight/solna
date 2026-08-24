import { describe, test, expect } from 'bun:test';
import { INSTANT_VIBES, applyInstantVibeToStore } from './instantVibes';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { FACTORY_PRESETS } from '../audio/synthPresets';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { useAppStore } from './store';

describe('Instant Vibes Mode', () => {
  test('contains all 6 curated genre vibes with complete presets and feel settings', () => {
    expect(INSTANT_VIBES.length).toBe(6);

    for (const vibe of INSTANT_VIBES) {
      expect(Boolean(vibe.id)).toBe(true);
      expect(Boolean(vibe.name)).toBe(true);
      expect(vibe.bpm > 50 && vibe.bpm < 180).toBe(true);
      expect(Boolean(vibe.scaleRoot)).toBe(true);
      expect(Boolean(vibe.scaleType)).toBe(true);
      
      // Drum Beat & Kit
      expect(Boolean(vibe.soundKit)).toBe(true);
      expect(Boolean(vibe.drumPattern)).toBe(true);
      expect(Boolean(vibe.drumPattern.kick)).toBe(true);
      expect(Boolean(vibe.drumPattern.snare)).toBe(true);
      expect(Boolean(vibe.drumPattern.hihat)).toBe(true);

      // Chords & Feel
      expect(vibe.chords.length).toBe(4);
      expect(Boolean(vibe.chordRhythmId)).toBe(true);
      // Ensure rhythm pattern exists in registry
      const rhythmExists = RHYTHM_PATTERNS.some((p) => p.id === vibe.chordRhythmId);
      expect(rhythmExists).toBe(true);

      expect(vibe.chordFeel >= 0 && vibe.chordFeel <= 1).toBe(true);
      expect(Boolean(vibe.chordPresetName)).toBe(true);

      // Bass & Feel
      expect(Boolean(vibe.bassPatternId)).toBe(true);
      // Ensure bass pattern exists in registry
      const bassExists = BASS_PATTERNS.some((p) => p.id === vibe.bassPatternId);
      expect(bassExists).toBe(true);

      expect(vibe.bassFeel >= 0 && vibe.bassFeel <= 1).toBe(true);
      expect(Boolean(vibe.bassPresetName)).toBe(true);

      // Synth Preset & Master Effects
      expect(Boolean(vibe.synthPresetName)).toBe(true);
      expect(Boolean(vibe.effects)).toBe(true);
    }
  });

  test('applyInstantVibeToStore sets drum pattern, kit, chords, bass, feel, synth presets, and master effects', () => {
    const lofiVibe = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    applyInstantVibeToStore(lofiVibe);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(lofiVibe.bpm);
    expect(state.scaleRoot).toBe(lofiVibe.scaleRoot);
    expect(state.scaleType).toBe(lofiVibe.scaleType);
    expect(state.soundKit).toBe(lofiVibe.soundKit);
    expect(state.chordRhythmId).toBe(lofiVibe.chordRhythmId);
    expect(state.chordFeel).toBe(lofiVibe.chordFeel);
    expect(state.chordSynthParams.preset).toBe(lofiVibe.chordPresetName);
    expect(state.bassPatternId).toBe(lofiVibe.bassPatternId);
    expect(state.bassFeel).toBe(lofiVibe.bassFeel);
    expect(state.bassSynthParams.preset).toBe(lofiVibe.bassPresetName);
    expect(state.synthParams.preset).toBe(lofiVibe.synthPresetName);
  });

  test('applyInstantVibeToStore actually rewrites the sequencer track steps to match the vibe drum pattern', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const tracks = useAppStore.getState().sequencerTracks;
    for (const track of tracks) {
      const vibeSteps = synthwave.drumPattern[track.instrument];
      expect(Boolean(vibeSteps)).toBe(true);
      expect(track.steps).toEqual(vibeSteps.map((v) => v === 1));
    }
  });

  test('applies synthwave vibe with tight feel and active arpeggiator', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    expect(state.synthParams.arpActive).toBe(true);
    expect(state.synthParams.arpMode).toBe('updown');
  });
});

describe('vibe preset name resolution', () => {
  const factoryNames = new Set(FACTORY_PRESETS.map((p) => p.name));
  const factoryBassNames = new Set(FACTORY_BASS_PRESETS.map((p) => p.name));

  test('every vibe synth and chord preset name resolves to a factory preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(factoryNames.has(vibe.synthPresetName)).toBe(true);
      expect(factoryNames.has(vibe.chordPresetName)).toBe(true);
    }
  });

  test('every vibe bass preset name resolves to a factory bass preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(factoryBassNames.has(vibe.bassPresetName)).toBe(true);
    }
  });

  test('loading a vibe leaves the preset select pointing at a real preset', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s');
    applyInstantVibeToStore(synthwave!);
    const state = useAppStore.getState();
    expect(factoryNames.has(state.synthParams.preset)).toBe(true);
    expect(factoryNames.has(state.chordSynthParams.preset)).toBe(true);
  });
});

test('InstantVibe presets carry no presentational fields', () => {
  const FORBIDDEN = ['color', 'bgGradient', 'borderColor', 'textColor'];
  for (const vibe of INSTANT_VIBES) {
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(vibe, key)).toBe(false);
    }
  }
});
