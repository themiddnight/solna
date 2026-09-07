import { describe, expect, test } from 'bun:test';
import { presetById } from '../audio/presetRegistry';
import { PAD_INTERVALS } from '../types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { SequencerTrack } from '../types';
import { DRUM_TYPES } from '../data/drumKits';
import {
  defaultPadState,
  DEFAULT_BASS_PRESET_ID,
  INITIAL_BASS_SYNTH_PARAMS,
  INITIAL_PAD_SYNTH_PARAMS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
  PAD_DEFAULT_PRESET_ID,
  recolourDrumTracks,
  renameDrumTrack,
  renameSoundKit,
  withDrumTracks,
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

describe('withDrumTracks', () => {
  const kick = INITIAL_SEQUENCER_TRACKS[0];

  // The five tracks a REAL pre-v13 build actually wrote. A literal, not a
  // slice of INITIAL_SEQUENCER_TRACKS: that constant's roster and order have
  // moved twice already (drum-slice2, drum-slice4), and a fixture that tracks
  // the roster it is supposed to predate stops testing anything — it would
  // silently start asserting on whatever five entries currently sit first
  // instead of the five names a real legacy payload holds.
  const LEGACY_FIVE = ['kick', 'snare', 'hihat', 'openhat', 'clap'];
  const legacyFiveTracks = () =>
    LEGACY_FIVE.map((instrument) => INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === instrument)!);

  test('a 5-track payload becomes 11, and the first five are THE SAME OBJECTS', () => {
    // toBe, not toEqual. A toEqual assertion passes against a withDrumTracks
    // that rebuilds every track from defaults and happens to reproduce the
    // same values today; toBe fails against it. That distinction is the whole
    // point of the transform: a user's renamed, recoloured, muted,
    // reprogrammed track must come back as THE SAME OBJECT, not an equal one.
    const before = legacyFiveTracks().map((t) => ({
      ...t,
      name: `${t.name} (mine)`,
      muted: true,
    }));
    const after = withDrumTracks(before);
    expect(after).toHaveLength(11);
    for (let i = 0; i < 5; i += 1) expect(after[i]).toBe(before[i]);
    expect(after.map((t) => t.instrument).slice(5)).toEqual([
      'rimshot', 'hitom', 'lowtom', 'ride', 'crash', 'bell',
    ]);
  });

  test('the appended tracks are silent — no existing session changes sound', () => {
    // All six voices this real legacy payload lacks are the ones added since
    // it was written, and all six ship with an empty bar.
    const after = withDrumTracks(legacyFiveTracks());
    for (const instrument of ['rimshot', 'hitom', 'lowtom', 'ride', 'crash', 'bell']) {
      const track = after.find((t) => t.instrument === instrument)!;
      expect(track.steps.some(Boolean), instrument).toBe(false);
    }
  });

  test('the appended tracks do not share arrays with the module constant', () => {
    // Two loops each run this over their own tracks. If the appended track
    // were the module object, toggling a rimshot step in one loop would
    // toggle it in the other and in INITIAL_SEQUENCER_TRACKS itself.
    const a = withDrumTracks(legacyFiveTracks());
    const b = withDrumTracks(legacyFiveTracks());
    const aRimshot = a.find((t) => t.instrument === 'rimshot')!;
    const bRimshot = b.find((t) => t.instrument === 'rimshot')!;
    const moduleRimshot = INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === 'rimshot')!;
    expect(aRimshot).not.toBe(bRimshot);
    expect(aRimshot.steps).not.toBe(bRimshot.steps);
    expect(aRimshot.steps).not.toBe(moduleRimshot.steps);
  });

  test('running it twice is running it once', () => {
    const once = withDrumTracks(legacyFiveTracks());
    const twice = withDrumTracks(once);
    expect(twice).toEqual(once);
    // And the second pass is a no-op by identity, not just by value.
    expect(twice).toBe(once);
  });

  test('an already-complete array comes back untouched, by identity', () => {
    expect(withDrumTracks(INITIAL_SEQUENCER_TRACKS)).toBe(INITIAL_SEQUENCER_TRACKS);
  });

  test('it never rewrites a track that is present', () => {
    const renamed = [{ ...kick, name: 'My Kick', color: 'bg-custom-brand', muted: true }];
    const after = withDrumTracks(renamed);
    expect(after[0]).toBe(renamed[0]);
    expect(after[0].name).toBe('My Kick');
    expect(after[0].color).toBe('bg-custom-brand');
  });

  test('a 2-track payload gains the other nine, each as its factory entry', () => {
    // Consequence worth pinning: it appends ANY missing canonical track, which
    // is what lets slice 2 reuse it unchanged for ride and bell. Nothing in
    // the app can delete a track, so only a hand-edited .solna reaches here.
    const after = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 2));
    expect(after.map((t) => t.instrument)).toEqual([...DRUM_TYPES]);
    // A restored track comes back as its FACTORY entry, row and all: the
    // transform copies INITIAL_SEQUENCER_TRACKS, it does not blank it. So
    // "an appended track is silent" is a property of the six rows whose
    // factory rows are empty — and NOT of the transform. A hand-edited file
    // that deleted the hihat gets the factory hihat back, its eight hits
    // included. Every payload the app itself can produce holds the original
    // five programmed tracks, so the only tracks a real migration appends are
    // the silent ones, and that is what makes the "no existing session
    // changes sound" guarantee true where it counts.
    for (const t of after) {
      const factory = INITIAL_SEQUENCER_TRACKS.find((c) => c.instrument === t.instrument)!;
      expect(t.steps, t.instrument).toEqual(factory.steps);
    }
    // The last two appended rows in canonical order are crash and bell, not
    // tom and crash — the roster grew to eleven voices in Task 8.
    expect(after[9].instrument).toBe('crash');
    expect(after[9].steps.some(Boolean)).toBe(false);
    expect(after[10].instrument).toBe('bell');
    expect(after[10].steps.some(Boolean)).toBe(false);
  });

  test('an empty array becomes the full canonical set', () => {
    expect(withDrumTracks([])).toHaveLength(11);
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

describe('renameDrumTrack', () => {
  const tom = {
    id: 'track-tom', name: 'My Tom', instrument: 'tom',
    steps: [true, false, true, false], volume: 0.4, muted: true, color: 'bg-primary',
  } as unknown as SequencerTrack;

  test('rewrites the instrument and id, and keeps everything the user owns', () => {
    const [next] = renameDrumTrack([tom], 'tom', 'lowtom');
    expect(next.instrument).toBe('lowtom');
    expect(next.id).toBe('track-lowtom');
    expect(next.name).toBe('My Tom');
    expect(next.steps).toEqual([true, false, true, false]);
    expect(next.volume).toBe(0.4);
    expect(next.muted).toBe(true);
    expect(next.color).toBe('bg-primary');
  });

  test('is idempotent, and returns the same array when there is nothing to rename', () => {
    const once = renameDrumTrack([tom], 'tom', 'lowtom');
    expect(renameDrumTrack(once, 'tom', 'lowtom')).toBe(once);
  });

  test('drops a BLANK target row and renames into it', () => {
    // Not hypothetical: an old payload runs the earlier version steps first, and
    // those append against the eleven-voice constant — so it arrives holding the
    // user's `tom` AND a blank `lowtom`.
    const blank = { ...tom, id: 'track-lowtom', instrument: 'lowtom', steps: [false, false] };
    const out = renameDrumTrack([tom, blank as unknown as SequencerTrack], 'tom', 'lowtom');
    expect(out).toHaveLength(1);
    expect(out[0].steps).toEqual([true, false, true, false]);
  });

  test('touches neither when the target row has programmed steps', () => {
    // Someone owns both rows; losing either is worse than a stale name.
    const both = [tom, { ...tom, id: 'track-lowtom', instrument: 'lowtom' } as SequencerTrack];
    expect(renameDrumTrack(both, 'tom', 'lowtom')).toBe(both);
  });

  test('survives the junk a pre-sanitize payload can hold', () => {
    const junk = [null, 7, { instrument: 'tom' }] as unknown as SequencerTrack[];
    expect(renameDrumTrack(junk, 'tom', 'lowtom')[2].instrument).toBe('lowtom');
  });
});

describe('renameSoundKit', () => {
  test('rewrites only the matching name', () => {
    expect(renameSoundKit({ soundKit: '909 Modern' }, '909 Modern', 'Club Standard'))
      .toEqual({ soundKit: 'Club Standard' });
  });

  test('returns the same object when it does not match, and is idempotent', () => {
    const other = { soundKit: 'Warehouse' };
    expect(renameSoundKit(other, '909 Modern', 'Club Standard')).toBe(other);
    const once = renameSoundKit({ soundKit: '909 Modern' }, '909 Modern', 'Club Standard');
    expect(renameSoundKit(once, '909 Modern', 'Club Standard')).toBe(once);
  });
});

describe('recolourDrumTracks', () => {
  const track = (instrument: string, color: string) =>
    ({ id: `track-${instrument}`, name: instrument, instrument,
       steps: [], volume: 1, muted: false, color }) as unknown as SequencerTrack;

  test('rewrites a factory colour onto the drum namespace, per instrument', () => {
    const out = recolourDrumTracks([
      track('kick', 'bg-error'), track('snare', 'bg-warning'), track('hihat', 'bg-success'),
      track('openhat', 'bg-accent'), track('clap', 'bg-secondary'),
      track('lowtom', 'bg-primary'), track('crash', 'bg-info'),
    ]);
    expect(out.map((t) => t.color)).toEqual([
      'bg-drum-kick', 'bg-drum-snare', 'bg-drum-hihat', 'bg-drum-openhat',
      'bg-drum-clap', 'bg-drum-lowtom', 'bg-drum-crash',
    ]);
  });

  test("keeps a colour the user chose, including another track's factory token", () => {
    // The map is per instrument, not a set of seven strings: bg-error was the
    // KICK's colour, so a snare wearing it is a user's choice, not a leftover.
    const mine = [track('snare', 'bg-error'), track('kick', 'bg-drum-kick')];
    expect(recolourDrumTracks(mine)).toBe(mine);
  });

  test('is idempotent and leaves an unknown instrument alone', () => {
    const once = recolourDrumTracks([track('kick', 'bg-error')]);
    expect(recolourDrumTracks(once)).toBe(once);
    const alien = [track('banjo', 'bg-error')];
    expect(recolourDrumTracks(alien)).toBe(alien);
  });
});

test('renameDrumTrack runs BEFORE recolourDrumTracks, or the tom row keeps bg-primary', () => {
  const tom = { id: 'track-tom', instrument: 'tom', steps: [], volume: 1,
                muted: false, name: 'Tom', color: 'bg-primary' } as unknown as SequencerTrack;
  expect(recolourDrumTracks([tom])[0].color).toBe('bg-primary');
  expect(recolourDrumTracks(renameDrumTrack([tom], 'tom', 'lowtom'))[0].color).toBe('bg-drum-lowtom');
});

test('rename BEFORE append renames; append BEFORE rename repairs — one lowtom either way', () => {
  // The documented order is rename-then-append: it never creates the blank row
  // at all. The reverse works only because renameDrumTrack drops a blank target,
  // which is a REPAIR path for old payloads that came through the v13/v5 steps,
  // not a licence to rely on it.
  const tom = { id: 'track-tom', name: 'Tom', instrument: 'tom', volume: 0.8, muted: false,
                color: 'bg-primary', steps: [true, false, true] } as unknown as SequencerTrack;
  const wrong = renameDrumTrack(withDrumTracks([tom]), 'tom', 'lowtom');
  const right = withDrumTracks(renameDrumTrack([tom], 'tom', 'lowtom'));
  for (const out of [wrong, right]) {
    const lowtoms = out.filter((t) => t.instrument === 'lowtom');
    expect(lowtoms).toHaveLength(1);
    expect(lowtoms[0].steps).toEqual([true, false, true]);
    expect(out.some((t) => t.instrument === 'tom')).toBe(false);
  }
});
