import { describe, expect, test } from 'bun:test';
import { presetById } from '../audio/synthPresets';
import { PAD_INTERVALS } from '../types';
import { defaultPadState, INITIAL_PAD_SYNTH_PARAMS, PAD_DEFAULT_PRESET_ID } from './initialState';

describe('pad defaults', () => {
  // The default is resolved by id at module load. If the id is ever renamed in
  // synthPresets.ts, INITIAL_PAD_SYNTH_PARAMS would silently fall back to the
  // bare INITIAL_SYNTH_PARAMS and every new project would ship a raw saw as its
  // "pad". This test is the only thing that makes that rename loud.
  test('the default pad preset id resolves to a Pad-category preset', () => {
    const preset = presetById(PAD_DEFAULT_PRESET_ID);
    expect(preset?.category).toBe('Pad');
  });

  test('INITIAL_PAD_SYNTH_PARAMS is the resolved preset, not the bare synth default', () => {
    const preset = presetById(PAD_DEFAULT_PRESET_ID);
    expect(INITIAL_PAD_SYNTH_PARAMS.oscType).toBe(preset!.params.oscType!);
    expect(INITIAL_PAD_SYNTH_PARAMS.filterCutoff).toBe(preset!.params.filterCutoff!);
  });

  // padMuted:false is the NEW-project default. The migrations deliberately
  // override it to true. See the migration task; collapsing the two is the
  // failure this pair of expectations exists to catch.
  test('a new project ships an audible pad', () => {
    expect(defaultPadState().padMuted).toBe(false);
  });

  test('the default drone selection is root + fifth + octave on degree I', () => {
    expect(defaultPadState().padDroneDegree).toBe(0);
    expect(defaultPadState().padDroneIntervals).toEqual([1, 5, 8]);
  });

  test('every default interval is a member of the union', () => {
    for (const i of defaultPadState().padDroneIntervals) {
      expect(PAD_INTERVALS).toContain(i);
    }
  });
});
