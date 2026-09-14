import { describe, expect, test } from 'bun:test';
import { presetById } from '@/utils/synthPresets';
import { PAD_INTERVALS } from '../types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DRUM_TYPES } from '../data/drumKits';
import { defaultPadState, defaultTrackSynth, INITIAL_SEQUENCER_TRACKS, TRACK_SYNTH_PRESET_IDS } from './initialState';
import { SUBTRACTIVE_INIT, SUBTRACTIVE_INIT_PRESET_ID } from '@/utils/synthPresets';

describe('track patch defaults', () => {
  // Each default is resolved by id at module load. If an id is ever renamed in
  // synthPresets.ts the resolver THROWS rather than falling back — there is no
  // second literal patch body left to fall back to. These tests are what keep
  // that throw unreachable.
  test('every track default resolves to a preset and installs its patch whole', () => {
    for (const [target, id] of Object.entries(TRACK_SYNTH_PRESET_IDS)) {
      const preset = presetById(id);
      expect(preset, `${target} -> ${id}`).toBeDefined();
      const resolved = defaultTrackSynth(target as keyof typeof TRACK_SYNTH_PRESET_IDS);
      expect(resolved.patch, target).toEqual(preset!.patch);
      expect(resolved.sourcePresetId, target).toBe(id);
    }
  });

  test('a track default is a fresh copy, never the library entry', () => {
    // A patch holds arrays (`oscillators`, `env2Routes`) and every loop holds
    // five patches: a shared object would let one in-place write reach the
    // factory table and every future default at once.
    const a = defaultTrackSynth('pad');
    const b = defaultTrackSynth('pad');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.patch.synth.oscillators).not.toBe(b.patch.synth.oscillators);
    a.patch.synth.oscillators[0].levelDb = -42;
    expect(defaultTrackSynth('pad').patch.synth.oscillators[0].levelDb).not.toBe(-42);
  });

  test('the init patch is the library entry it names', () => {
    expect(SUBTRACTIVE_INIT.sourcePresetId).toBe(SUBTRACTIVE_INIT_PRESET_ID);
    expect(SUBTRACTIVE_INIT.patch).toEqual(presetById(SUBTRACTIVE_INIT_PRESET_ID)!.patch);
  });
});

describe('pad defaults', () => {
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
