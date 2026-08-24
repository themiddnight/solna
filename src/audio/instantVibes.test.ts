import { describe, test, expect } from 'bun:test';
import { INSTANT_VIBES, applyInstantVibeToStore } from './instantVibes';
import { RHYTHM_PATTERNS } from './rhythmPatterns';
import { BASS_PATTERNS } from './bassPatterns';
import { useAppStore } from '../store/store';

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
      expect(Boolean(vibe.drumPattern.Kick)).toBe(true);
      expect(Boolean(vibe.drumPattern.Snare)).toBe(true);
      expect(Boolean(vibe.drumPattern.HiHat)).toBe(true);

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
