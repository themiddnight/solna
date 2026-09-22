import { describe, expect, test } from 'bun:test';
import { presetById } from '@/utils/synthPresets';
import { PAD_INTERVALS, type BeatVoiceId } from '../types';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import { BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '../data/beatPresets';
import { defaultBeatState } from './beatPresets';
import { defaultPadState, defaultTrackSynth, TRACK_SYNTH_PRESET_IDS } from './initialState';
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

describe('the Beat state a fresh loop starts on', () => {
  test('it names the default preset and stores one full-width row per voice', () => {
    const { beatPattern, beatMix, beatParams } = defaultBeatState();
    expect(beatParams.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
    for (const voice of BEAT_VOICE_IDS) {
      expect(beatPattern.rows[voice], voice).toHaveLength(MAX_STEPS_PER_BAR);
      expect(beatMix.voices[voice].muted, voice).toBe(false);
    }
  });

  /**
   * THE STARTER BEAT, pinned as step indexes.
   *
   * It is not decoration and it is not new: these are exactly the rows the
   * table this model replaced shipped, and they are what a brand-new project
   * plays the first time somebody presses play. An empty grid there means the
   * first thing a new user hears is nothing, which is why this is a test and
   * not a comment — the default went briefly empty during this rewrite with
   * nothing failing.
   *
   * Written as indexes rather than as a row of twenty-four booleans so a
   * reader can see the groove: four-on-the-floor kick, backbeat snare and
   * clap, eighths on the closed hat, one open hat lifting into beat four.
   */
  test('it ships the starter groove, and the accent voices ship silent', () => {
    const { beatPattern } = defaultBeatState();
    const onsets = (voice: BeatVoiceId) =>
      beatPattern.rows[voice].flatMap((on, i) => (on ? [i] : []));
    expect(onsets('kick')).toEqual([0, 4, 8, 12]);
    expect(onsets('snare')).toEqual([4, 12]);
    expect(onsets('clap')).toEqual([4, 12]);
    expect(onsets('hihat')).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(onsets('openhat')).toEqual([10]);
    for (const voice of ['rimshot', 'hitom', 'lowtom', 'ride', 'crash', 'bell'] as const) {
      expect(onsets(voice), voice).toEqual([]);
    }
    // Every onset is inside a 4/4 bar, so the starter beat is fully audible at
    // the default meter rather than partly parked in wider-meter padding.
    for (const voice of BEAT_VOICE_IDS) {
      for (const step of onsets(voice)) expect([voice, step < 16]).toEqual([voice, true]);
    }
  });

  test('no two rows share an array', () => {
    const rows = BEAT_VOICE_IDS.map((voice) => defaultBeatState().beatPattern.rows[voice]);
    expect(new Set(rows).size).toBe(rows.length);
  });

  test('two calls never share a row object', () => {
    expect(defaultBeatState().beatPattern.rows.kick).not.toBe(
      defaultBeatState().beatPattern.rows.kick,
    );
  });
});
