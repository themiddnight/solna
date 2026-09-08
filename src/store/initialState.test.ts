import { describe, expect, test } from 'bun:test';
import { presetById } from '../audio/presetRegistry';
import { PAD_INTERVALS } from '../types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DRUM_TYPES } from '../data/drumKits';
import {
  defaultPadState,
  DEFAULT_BASS_PRESET_ID,
  INITIAL_BASS_SYNTH_PARAMS,
  INITIAL_PAD_SYNTH_PARAMS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
  PAD_DEFAULT_PRESET_ID,
} from './initialState';

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

describe('bass defaults', () => {
  test('the default bass preset id resolves to a Bass-category preset', () => {
    const preset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(preset?.category).toBe('Bass');
  });

  test('INITIAL_BASS_SYNTH_PARAMS is the resolved preset, not the bare synth default', () => {
    const preset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(INITIAL_BASS_SYNTH_PARAMS.oscType).toBe(preset!.params.oscType!);
    expect(INITIAL_BASS_SYNTH_PARAMS.filterCutoff).toBe(preset!.params.filterCutoff!);
  });

  // applyPreset stamps `preset: preset.name`; the historical bass default did
  // not. Keeping the field absent is what makes this a move and not a change.
  test('the bass default carries no preset name, matching the pre-merge value', () => {
    expect(INITIAL_BASS_SYNTH_PARAMS.preset).toBe(INITIAL_SYNTH_PARAMS.preset);
  });
});

describe('INITIAL_SEQUENCER_TRACKS', () => {
  test('every track is coloured from the drum namespace, one token per voice', () => {
    expect(INITIAL_SEQUENCER_TRACKS.map((t) => t.color)).toEqual(
      DRUM_TYPES.map((voice) => `bg-drum-${voice}`),
    );
  });

  test('every track stores a full-width bar', () => {
    for (const t of INITIAL_SEQUENCER_TRACKS) {
      expect(t.steps.length, t.instrument).toBe(MAX_STEPS_PER_BAR);
    }
  });

  test('the sequencer ships one track per drum voice, in the canonical order', () => {
    expect(INITIAL_SEQUENCER_TRACKS.map((t) => t.instrument)).toEqual([...DRUM_TYPES]);
  });

  test('every track id follows its instrument, and every bar is stored at the widest width', () => {
    for (const track of INITIAL_SEQUENCER_TRACKS) {
      expect(track.id, `${track.instrument} id`).toBe(`track-${track.instrument}`);
      expect(track.steps, `${track.instrument} bar width`).toHaveLength(24);
    }
  });

  test('the four new voices ship silent — a fresh session sounds like the old one plus nothing', () => {
    for (const added of ['rimshot', 'hitom', 'ride', 'bell']) {
      const track = INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === added)!;
      expect(track.steps.some(Boolean), `${added} must ship silent`).toBe(false);
    }
  });

  test('the factory beat that was on `tom` is now on `lowtom`, and it is still empty', () => {
    expect(INITIAL_SEQUENCER_TRACKS.some((t) => t.instrument === 'tom')).toBe(false);
    const lowtom = INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === 'lowtom')!;
    expect(lowtom.steps.some(Boolean)).toBe(false);
  });

  test('no two tracks share a steps array', () => {
    const arrays = INITIAL_SEQUENCER_TRACKS.map((t) => t.steps);
    expect(new Set(arrays).size).toBe(arrays.length);
  });
});
