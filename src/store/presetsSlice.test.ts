import { describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_LIBRARY_ENTRIES } from './presetsSlice';
import { TRACK_SYNTH_DEFAULTS } from './initialState';

describe('presetsSlice library caps', () => {
  test('saveCustomPreset caps customSynthPresets at MAX_LIBRARY_ENTRIES, dropping the oldest', () => {
    const { getState } = useAppStore;
    for (let i = 0; i < MAX_LIBRARY_ENTRIES + 5; i++) {
      getState().saveCustomPreset(`Preset ${i}`, TRACK_SYNTH_DEFAULTS.bass);
    }
    const presets = getState().customSynthPresets;
    expect(presets.length).toBe(MAX_LIBRARY_ENTRIES);
    // Newest (last saved) survives at the front; oldest 5 were dropped.
    expect(presets[0]!.name).toBe(`Preset ${MAX_LIBRARY_ENTRIES + 4}`);
    expect(presets.some((p) => p.name === 'Preset 0')).toBe(false);
  });

  test('saveCustomChordProgression caps customChordProgressions at MAX_LIBRARY_ENTRIES, dropping the oldest', () => {
    const { getState } = useAppStore;
    for (let i = 0; i < MAX_LIBRARY_ENTRIES + 5; i++) {
      getState().saveCustomChordProgression(`Prog ${i}`, []);
    }
    const progressions = getState().customChordProgressions;
    expect(progressions.length).toBe(MAX_LIBRARY_ENTRIES);
    // Newest (last saved) survives at the front; oldest 5 were dropped.
    expect(progressions[0]!.name).toBe(`Prog ${MAX_LIBRARY_ENTRIES + 4}`);
    expect(progressions.some((p) => p.name === 'Prog 0')).toBe(false);
  });

  test('saveCustomBeatPreset caps customBeatPresets at MAX_LIBRARY_ENTRIES, dropping the oldest', () => {
    const { getState } = useAppStore;
    for (let i = 0; i < MAX_LIBRARY_ENTRIES + 5; i++) {
      getState().saveCustomBeatPreset(`Beat ${i}`, getState().beatParams);
    }
    const presets = getState().customBeatPresets;
    expect(presets.length).toBe(MAX_LIBRARY_ENTRIES);
    // Newest (last saved) survives at the front; oldest 5 were dropped.
    expect(presets[0]!.name).toBe(`Beat ${MAX_LIBRARY_ENTRIES + 4}`);
    expect(presets.some((p) => p.name === 'Beat 0')).toBe(false);
  });
});
