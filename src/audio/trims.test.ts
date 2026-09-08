import { describe, expect, test } from 'bun:test';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { NEUTRAL_TRIM_GAIN, drumTrimGainFor, synthTrimGainFor } from '@/audio/trims';

describe('drumTrimGainFor', () => {
  test('an unknown kit yields NEUTRAL_TRIM_GAIN', () => {
    expect(drumTrimGainFor('No Such Kit')).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('an undefined kit name yields NEUTRAL_TRIM_GAIN rather than throwing', () => {
    expect(drumTrimGainFor(undefined)).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('every committed kit entry becomes a positive finite gain', () => {
    for (const kitName of Object.keys(DRUM_TRIMS)) {
      const gain = drumTrimGainFor(kitName);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThan(0);
    }
  });
});

describe('synthTrimGainFor', () => {
  test('an unknown preset name is neutral — an uncalibrated patch must not be trimmed', () => {
    expect(synthTrimGainFor('A Name No Factory Preset Has')).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('an undefined preset name is neutral rather than a throw', () => {
    expect(synthTrimGainFor(undefined)).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('NEUTRAL_TRIM_GAIN is unity', () => {
    expect(NEUTRAL_TRIM_GAIN).toBe(1);
  });

  test('every committed preset id is resolvable from the name applyPreset writes', () => {
    // applyPreset sets `params.preset` to the preset NAME, and the table is keyed by
    // id (shared contract), so the name -> id resolution is the load-bearing step.
    for (const id of Object.keys(PRESET_TRIMS)) {
      const preset = SYNTH_PRESETS.find((p) => p.id === id);
      expect(preset).toBeDefined();
      expect(synthTrimGainFor(preset!.name)).toBeGreaterThan(0);
    }
  });

  test('factory preset names are unique, which is what makes name -> id sound', () => {
    const names = SYNTH_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
