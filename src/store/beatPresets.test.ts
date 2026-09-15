import { describe, expect, test } from 'bun:test';
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { beatParamsFromPreset, beatPresetById, defaultBeatState } from './beatPresets';

describe('beatPresetById', () => {
  test('resolves every factory id', () => {
    for (const preset of BEAT_PRESETS) {
      expect(beatPresetById(preset.id)?.id).toBe(preset.id);
    }
  });

  test('an unknown id resolves to undefined rather than a guess', () => {
    expect(beatPresetById('no-such-preset')).toBeUndefined();
  });
});

describe('beatParamsFromPreset', () => {
  test('records the resolved id as the base and copies the whole patch', () => {
    const params = beatParamsFromPreset('warehouse');
    const preset = beatPresetById('warehouse')!;
    expect(params.basePresetId).toBe('warehouse');
    expect(params.outputTrimDb).toBe(preset.patch.outputTrimDb);
    expect(params.filter).toEqual(preset.patch.filter);
    expect(params.voices).toEqual(preset.patch.voices);
  });

  test('an unknown id falls back to the default preset and says so in basePresetId', () => {
    const params = beatParamsFromPreset('no-such-preset');
    expect(params.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
    expect(params.voices).toEqual(beatPresetById(DEFAULT_BEAT_PRESET_ID)!.patch.voices);
  });

  test('the copy is deep — editing the result never writes back into the factory table', () => {
    const params = beatParamsFromPreset('trap-beat');
    params.voices.kick.gain = 0.01;
    params.filter.cutoff = 100;
    expect(beatPresetById('trap-beat')!.patch.voices.kick.gain).not.toBe(0.01);
    expect(beatPresetById('trap-beat')!.patch.filter.cutoff).toBe(12000);
    expect(beatParamsFromPreset('trap-beat').voices.kick.gain).not.toBe(0.01);
  });
});

describe('defaultBeatState', () => {
  test('is the default preset, the starter groove, and an unmuted mix', () => {
    const { beatParams, beatPattern, beatMix } = defaultBeatState();
    expect(beatParams.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
    expect(Object.keys(beatPattern.rows)).toEqual([...BEAT_VOICE_IDS]);
    expect(Object.keys(beatMix.voices)).toEqual([...BEAT_VOICE_IDS]);
    for (const voice of BEAT_VOICE_IDS) {
      expect(beatMix.voices[voice].muted).toBe(false);
    }
    expect(beatMix.muted).toBe(false);
    // NOT silent: a new project opens on a groove, and its exact onsets are
    // pinned in `initialState.test.ts`. What is asserted here is only that it
    // is not empty — an empty default means the first thing a new user hears
    // after pressing play is nothing.
    expect(BEAT_VOICE_IDS.some((voice) => beatPattern.rows[voice].some(Boolean))).toBe(true);
  });

  test('every row is stored at the widest meter s bar width, so a meter change never truncates one', () => {
    const { beatPattern } = defaultBeatState();
    for (const voice of BEAT_VOICE_IDS) {
      expect(beatPattern.rows[voice].length).toBe(24);
    }
  });

  test('two calls share nothing — a row written in one loop cannot appear in another', () => {
    const first = defaultBeatState();
    const second = defaultBeatState();
    // Step 1, silent in the starter groove, so this write is a change.
    first.beatPattern.rows.kick[1] = true;
    first.beatParams.voices.kick.gain = 0.01;
    expect(second.beatPattern.rows.kick[1]).toBe(false);
    expect(second.beatParams.voices.kick.gain).not.toBe(0.01);
  });
});
