import { describe, test, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { VIBES } from '../data/vibes';
import { applyVibeToStore, resolveVibe, VIBE_IDS } from './vibes';
import { CHORD_RHYTHMS } from '../data/chordRhythms';
import { BASS_PATTERNS } from '../data/bassPatterns';
import { DRUM_KITS } from '../data/drumKits';
import { DRUM_GRIDS } from '../data/drumGrids';
import { presetById } from '../audio/presetRegistry';
import { useAppStore } from './store';
import { createDefaultLoop } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import { defaultPadState } from './initialState';

/**
 * Every vibe, resolved once. Most of this file asserts on spec fields, which a
 * ResolvedVibe carries unchanged; the rest applies a vibe, which needs one.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);

describe('Instant Vibes Mode', () => {
  test('contains all 8 curated genre vibes with complete presets and feel settings', () => {
    expect(RESOLVED_VIBES.length).toBe(8);

    for (const vibe of RESOLVED_VIBES) {
      expect(Boolean(vibe.id)).toBe(true);
      expect(Boolean(vibe.name)).toBe(true);
      expect(vibe.bpm > 50 && vibe.bpm < 180).toBe(true);
      expect(Boolean(vibe.scaleRoot)).toBe(true);
      expect(Boolean(vibe.scaleType)).toBe(true);
      
      // Drum Beat & Kit
      // Was `expect(Boolean(vibe.soundKit)).toBe(true)`, which passes on any
      // non-empty string — which is how three vibes shipped naming a kit that
      // resolved to nothing at all.
      expect(Object.keys(DRUM_KITS), `${vibe.id} names a kit that does not exist`)
        .toContain(vibe.soundKit);
      expect(Boolean(vibe.drumPattern)).toBe(true);
      expect(Boolean(vibe.drumPattern.kick)).toBe(true);
      // No `snare` assertion: `house` (cyber-edm's grid) is clap-only by
      // decision 21 — in house the clap IS the backbeat and the snare row was
      // a duplicate of it. Kick and hihat are the rows every vibe still has.
      expect(Boolean(vibe.drumPattern.hihat)).toBe(true);

      // Chords & Feel
      expect(vibe.chords.length).toBe(4);
      expect(Boolean(vibe.chordRhythmId)).toBe(true);
      // Ensure rhythm pattern exists in registry
      const rhythmExists = CHORD_RHYTHMS.some((p) => p.id === vibe.chordRhythmId);
      expect(rhythmExists).toBe(true);

      expect(vibe.chordFeel >= 0 && vibe.chordFeel <= 1).toBe(true);
      expect(Boolean(vibe.chordPresetId)).toBe(true);

      // Bass & Feel
      expect(Boolean(vibe.bassPatternId)).toBe(true);
      // Ensure bass pattern exists in registry
      const bassExists = BASS_PATTERNS.some((p) => p.id === vibe.bassPatternId);
      expect(bassExists).toBe(true);

      expect(vibe.bassFeel >= 0 && vibe.bassFeel <= 1).toBe(true);
      expect(Boolean(vibe.bassPresetId)).toBe(true);

      // Synth Preset & Master Effects
      expect(Boolean(vibe.synthPresetId)).toBe(true);
      expect(Boolean(vibe.effects)).toBe(true);
    }
  });

  test("every vibe's soundKit is a real kit", () => {
    // The sibling of drumGrids.test.ts's "every grid names a real drum kit".
    // mergeDrumKit takes DRUM_KITS[name] as a Partial<DrumKit> and spreads it
    // over DEFAULT_DRUM_KIT, so an unknown name silently yields the default
    // kit — no error, no warning, just the wrong sound. Three vibes shipped
    // that way ('Hyperpop 2000', 'Minimal Glitch' x2) because the only
    // assertion here was that soundKit is truthy.
    for (const vibe of RESOLVED_VIBES) {
      expect(DRUM_KITS[vibe.soundKit], `${vibe.id} -> ${vibe.soundKit}`).toBeTruthy();
    }
  });

  test("a vibe's soundKit agrees with its own grid's kit, or says why not", () => {
    // A vibe chooses a sound as well as a rhythm, so it MAY disagree with its
    // grid — but every disagreement is deliberate and listed here. An
    // unlisted one is a repoint that forgot its grid, which is exactly how the
    // three dangling names went unnoticed.
    const DELIBERATE_DISAGREEMENT: Record<string, string> = {};
    for (const vibe of RESOLVED_VIBES) {
      const gridKit = DRUM_GRIDS[vibe.drumGridId].kit;
      const expected = DELIBERATE_DISAGREEMENT[vibe.id] ?? gridKit;
      expect(vibe.soundKit, `${vibe.id} (grid ${vibe.drumGridId} -> ${gridKit})`).toBe(expected);
    }
  });

  test('applyVibeToStore sets drum pattern, kit, chords, bass, feel, synth presets, and master effects', () => {
    const lofiVibe = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    applyVibeToStore(lofiVibe);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(lofiVibe.bpm);
    expect(state.scaleRoot).toBe(lofiVibe.scaleRoot);
    expect(state.scaleType).toBe(lofiVibe.scaleType);
    expect(state.soundKit).toBe(lofiVibe.soundKit);
    expect(state.chordRhythmId).toBe(lofiVibe.chordRhythmId);
    expect(state.chordFeel).toBe(lofiVibe.chordFeel);
    expect(state.chordSynthParams.preset).toBe(presetById(lofiVibe.chordPresetId)!.name);
    expect(state.bassPatternId).toBe(lofiVibe.bassPatternId);
    expect(state.bassFeel).toBe(lofiVibe.bassFeel);
    expect(state.bassSynthParams.preset).toBe(presetById(lofiVibe.bassPresetId)!.name);
    expect(state.synthParams.preset).toBe(presetById(lofiVibe.synthPresetId)!.name);
  });

  test('applyVibeToStore actually rewrites the sequencer track steps to match the vibe drum pattern', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;

    // Seed TWO distinguishing `true`s before applying the vibe: one in the
    // padding (index 20) and one inside the active window (index 3).
    //
    // The padding one proves preservation: asserting padding is `false` both
    // before and after cannot distinguish "genuinely preserved" from "reset to
    // false", so a seeded `true` that must survive is an independent proof, at
    // the applyVibeToStore entry point rather than only in writeStepWindow's
    // own unit tests.
    //
    // The in-window one is what makes the omitted-row branch below able to
    // fail. The four tracks this grid omits are exactly the four that ship
    // silent, so without a seeded hit inside the window, "cleared to false"
    // and "left untouched" are the same array — and replaceDrumPattern
    // regressing from clearing to merging would pass unnoticed.
    const before = useAppStore.getState().sequencerTracks;
    useAppStore
      .getState()
      .setSequencerTracks(before.map((t) => ({ ...t, steps: t.steps.map((v, i) => (i === 3 || i === 20 ? true : v)) })));

    applyVibeToStore(synthwave);

    const tracks = useAppStore.getState().sequencerTracks;
    // Every row this grid's pattern defines shares one meter width; borrow it
    // from any defined row to check the omitted rows' active window below.
    const windowLength = Object.values(synthwave.drumPattern)[0]!.length;
    for (const track of tracks) {
      const vibeSteps = synthwave.drumPattern[track.instrument];
      // drum-slice4 task 7 renamed INITIAL_SEQUENCER_TRACKS's `tom` entry to
      // `lowtom`, matching the grid row's own name — replaceDrumPattern
      // matches rows to tracks BY NAME, so every canonical track this grid's
      // origin group actually defines finds its row.
      if (vibeSteps === undefined) {
        // Decision 10 (permanent, not a Task 11 gap): an omitted row is as
        // legal as an all-false one, because replaceDrumPattern clears any
        // track the pattern does not name. Task 8 is what first creates
        // tracks in this state — four of the eleven, since this grid still
        // carries only the seven rows it was authored with — so this branch
        // pins the shape that clearing takes: the active window clears to
        // false, and the wider-meter padding beyond it survives untouched.
        expect(track.steps.slice(0, windowLength).every((v) => v === false), track.instrument).toBe(true);
        expect(track.steps[20], track.instrument).toBe(true);
        continue;
      }
      // Store rows are always 24-wide; the vibe's 16-step pattern lands in the
      // window and the untouched padding stays silent.
      expect(track.steps.length).toBe(24);
      expect(track.steps.slice(0, vibeSteps.length)).toEqual(vibeSteps);
      // Padding invariant: the seeded `true` at index 20 must survive.
      expect(track.steps[20]).toBe(true);
      expect(
        track.steps.slice(vibeSteps.length).every((v, i) => (vibeSteps.length + i === 20 ? v === true : v === false)),
      ).toBe(true);
    }
  });

  test('applies synthwave vibe with tight feel and no arpeggiator', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    // No vibe turns the arpeggiator on: it is a performance setting the user
    // drives from the UI, and INITIAL_SYNTH_PARAMS.arpActive is already false.
    expect(state.synthParams.arpActive).toBe(false);
  });
});

describe('vibe preset id resolution', () => {
  test('every vibe lead and comp preset id resolves in the factory library', () => {
    for (const vibe of RESOLVED_VIBES) {
      expect(`${vibe.id}.synthPresetId=${presetById(vibe.synthPresetId)?.id}`)
        .toBe(`${vibe.id}.synthPresetId=${vibe.synthPresetId}`);
      expect(`${vibe.id}.chordPresetId=${presetById(vibe.chordPresetId)?.id}`)
        .toBe(`${vibe.id}.chordPresetId=${vibe.chordPresetId}`);
    }
  });

  test('every vibe bass preset id resolves to a Bass-category preset', () => {
    for (const vibe of RESOLVED_VIBES) {
      expect(`${vibe.id}=${presetById(vibe.bassPresetId)?.category}`).toBe(`${vibe.id}=Bass`);
    }
  });
  // The pad-preset-category invariant lives in describe('vibe pad data', ...)
  // below, alongside the other pad-authoring invariants, rather than here —
  // one copy, not two.

  test('the 8x3 preset matrix is pinned exactly', () => {
    expect(RESOLVED_VIBES.map((v) => ({
      id: v.id,
      synthPresetId: v.synthPresetId,
      chordPresetId: v.chordPresetId,
      bassPresetId: v.bassPresetId,
    }))).toEqual([
      { id: 'lofi-chill', synthPresetId: 'factory-dream-keys', chordPresetId: 'factory-mellow-epiano', bassPresetId: 'bass-deep-sine' },
      { id: 'synthwave-80s', synthPresetId: 'factory-hyper-saw-lead', chordPresetId: 'factory-neon-poly-saw', bassPresetId: 'bass-saw-growl' },
      { id: 'cyber-edm', synthPresetId: 'factory-pluck', chordPresetId: 'factory-trance-pluck', bassPresetId: 'bass-punchy-square' },
      { id: 'deep-ambient', synthPresetId: 'factory-celestial-shimmer', chordPresetId: 'factory-warm-polypad', bassPresetId: 'bass-deep-sine' },
      { id: 'boom-bap', synthPresetId: 'factory-mellow-epiano', chordPresetId: 'factory-fm-tine-piano', bassPresetId: 'bass-round-pluck' },
      { id: 'zen-garden', synthPresetId: 'factory-glocken-bell', chordPresetId: 'factory-koto-pluck', bassPresetId: 'bass-warm-tri' },
      { id: 'lofi-waltz', synthPresetId: 'factory-fm-tine-piano', chordPresetId: 'factory-mellow-epiano', bassPresetId: 'bass-warm-tri' },
      { id: 'afro-six-eight', synthPresetId: 'factory-glocken-bell', chordPresetId: 'factory-fm-tine-piano', bassPresetId: 'bass-round-pluck' },
    ]);
  });

  test('no vibe carries arp data of any kind', () => {
    const ARP_FIELDS = ['synthArp', 'chordArp', 'bassArp', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'];
    for (const vibe of RESOLVED_VIBES) {
      for (const field of ARP_FIELDS) {
        expect(`${vibe.id}.${field}=${Object.prototype.hasOwnProperty.call(vibe, field)}`)
          .toBe(`${vibe.id}.${field}=false`);
      }
    }
  });

  test('applying any vibe leaves all three voices with the arpeggiator off', () => {
    for (const vibe of RESOLVED_VIBES) {
      applyVibeToStore(vibe);
      const s = useAppStore.getState();
      expect(`${vibe.id}.synth=${s.synthParams.arpActive}`).toBe(`${vibe.id}.synth=false`);
      expect(`${vibe.id}.chord=${s.chordSynthParams.arpActive}`).toBe(`${vibe.id}.chord=false`);
      expect(`${vibe.id}.bass=${s.bassSynthParams.arpActive}`).toBe(`${vibe.id}.bass=false`);
    }
    useAppStore.getState().hardStopAll();
  });

  test('loading a vibe leaves every preset select pointing at the preset that produced the sound', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyVibeToStore(synthwave);
    const state = useAppStore.getState();
    expect(state.synthParams.preset).toBe(presetById(synthwave.synthPresetId)!.name);
    expect(state.chordSynthParams.preset).toBe(presetById(synthwave.chordPresetId)!.name);
    expect(state.bassSynthParams.preset).toBe(presetById(synthwave.bassPresetId)!.name);
    useAppStore.getState().hardStopAll();
  });
});

describe('applyVibeToStore transport handling', () => {
  // The restart is no longer unconditional: restartAfterStop reads activeTab
  // and playbackScope, so both are INPUTS to every test below. bun shares one
  // process across test files, and siblings leave activeTab on a song-layer
  // tab (projectSlice.test.ts sets 'master', ArrangeView.test.tsx sets
  // 'arrange') without restoring it — under which the ambient `none` scope
  // falls through to the "no restart" row and these tests would fail on file
  // order alone. Pin the baseline instead of relying on some other file's
  // afterEach happening to run in between.
  beforeEach(() => {
    useAppStore.setState({ activeTab: 'sound', playbackScope: SCOPE_NONE });
  });

  // Wrap the store's own action functions in place (via `setState`, not a
  // fresh mock store) so applyVibeToStore's internal
  // `useAppStore.getState()` resolves to these wrapped references. Every
  // wrapper calls through to the real implementation captured just before
  // wrapping, so state still mutates normally; each wrapper just pushes a
  // label into `order` first so the *sequence* of calls — not just the end
  // state — is observable. That sequence is exactly what would break if
  // hardStopAll were removed or moved after the vibe-state writes.
  //
  // `setState` (rather than mutating the snapshot object returned by
  // `getState()` directly) is required here: zustand rebuilds the state
  // object on every `set()` call inside the transport actions, so a
  // property replaced in place on one snapshot would be silently dropped
  // the moment any action fires. Routing both the install and the restore
  // through `setState` keeps every generation of the state object wrapped
  // until we explicitly restore, and the restore always lands on the
  // current (not a stale) object.
  //
  // Since Phase 3 the restart is no longer a play(module) call at all — it is
  // one setState carrying the player fields and the scope together — so the
  // `play` wrapper below no longer sees it. It stays, because `playCalls`
  // staying EMPTY is now the assertion that the restart went through
  // restartPlayersPatch; the restart itself is observed by subscribing to the
  // store and recording the stopped->playing transition, which is the same
  // ordering fact the old `play:chords` entry stood for.
  function withOrderTracking<T>(order: string[], playCalls: string[], run: () => T): T {
    const originals = {
      hardStopAll: useAppStore.getState().hardStopAll,
      setBpm: useAppStore.getState().setBpm,
      setEffects: useAppStore.getState().setEffects,
      play: useAppStore.getState().play,
    };

    useAppStore.setState({
      hardStopAll: () => {
        order.push('hardStopAll');
        originals.hardStopAll();
      },
      // First vibe-state write in the function body (step 1).
      setBpm: (bpm) => {
        order.push('setBpm');
        originals.setBpm(bpm);
      },
      // Last vibe-state write in the function body (step 6, right before
      // the restart calls).
      setEffects: (effects) => {
        order.push('setEffects');
        originals.setEffects(effects);
      },
      play: (module) => {
        order.push(`play:${module}`);
        playCalls.push(module);
        originals.play(module);
      },
    });

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      for (const module of ['sequencer', 'chords', 'lead'] as const) {
        const field = `${module}Player` as const;
        if (state[field] === 'playing' && prev[field] !== 'playing') {
          order.push(`restart:${module}`);
        }
      }
    });

    try {
      return run();
    } finally {
      unsubscribe();
      useAppStore.setState({
        hardStopAll: originals.hardStopAll,
        setBpm: originals.setBpm,
        setEffects: originals.setEffects,
        play: originals.play,
      });
    }
  }

  test('cuts everything before writing new vibe state, and restarts only the players that were active', () => {
    // Real (unwrapped) call: get chords running before we start recording order.
    useAppStore.getState().play('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');

    const order: string[] = [];
    const playCalls: string[] = [];

    withOrderTracking(order, playCalls, () => applyVibeToStore(RESOLVED_VIBES[1]));

    // The hard stop must be the very first thing that happens — before any
    // vibe-state write — and every restart must come after the last write.
    // This is the assertion that would fail if the swap applied the new
    // vibe first and cut audio afterward (or not at all).
    expect(order[0]).toBe('hardStopAll');
    const hardStopIndex = order.indexOf('hardStopAll');
    const setBpmIndex = order.indexOf('setBpm');
    const setEffectsIndex = order.indexOf('setEffects');
    const restartIndex = order.indexOf('restart:chords');
    expect(hardStopIndex).toBeLessThan(setBpmIndex);
    expect(restartIndex).toBeGreaterThan(-1);
    expect(setEffectsIndex).toBeLessThan(restartIndex);

    // Chords was active, so it comes back; the Beat was not, so it stays put
    // — and nothing restarted it.
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
    expect(order).not.toContain('restart:sequencer');
    // The restart is one scope-carrying setState, not a play(module) call.
    expect(playCalls).toEqual([]);
  });

  test('a player that was stopping restarts rather than staying half-stopped', () => {
    useAppStore.getState().play('chords');
    useAppStore.getState().softStop('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('stopping');

    applyVibeToStore(RESOLVED_VIBES[0]);

    expect(useAppStore.getState().chordsPlayer).toBe('playing');
  });

  test('a swap while nothing plays leaves both players stopped and never calls play', () => {
    useAppStore.getState().hardStopAll();

    const order: string[] = [];
    const playCalls: string[] = [];

    withOrderTracking(order, playCalls, () => applyVibeToStore(RESOLVED_VIBES[0]));

    // The weak form (end state reads 'stopped') would also pass an
    // implementation that started and immediately re-stopped the players.
    // Asserting nothing ever went to 'playing' rules that out.
    expect(playCalls).toEqual([]);
    expect(order.filter((e) => e.startsWith('restart:'))).toEqual([]);
    expect(order[0]).toBe('hardStopAll');

    expect(useAppStore.getState().chordsPlayer).toBe('stopped');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
  });
});

test('ResolvedVibe presets carry no presentational fields', () => {
  const FORBIDDEN = ['color', 'bgGradient', 'borderColor', 'textColor'];
  for (const vibe of RESOLVED_VIBES) {
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(vibe, key)).toBe(false);
    }
  }
});

describe('applyVibeToStore audible cut', () => {
  // The regression this pins: the swap used to delegate the actual silencing
  // to a React effect keyed on the rendered player state. The whole swap runs
  // inside one onClick, React 18 batches it, and that state goes
  // 'playing' -> 'playing' — so the effect never re-ran and the old vibe's
  // queued chord and bass voices kept sounding over the new one. Asserting
  // the ORDER of store actions (the suite above) cannot see that: only an
  // assertion that the sources were actually silenced can.
  test('silences the chord, bass and pad buses, at the hard-stop release', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
    stopSource.mockClear();

    useAppStore.getState().play('chords');
    applyVibeToStore(RESOLVED_VIBES[1]);

    const silenced = stopSource.mock.calls.map((c) => c[0]);
    expect(silenced).toContain('chord');
    expect(silenced).toContain('bass');
    expect(silenced).toContain('pad');
    for (const call of stopSource.mock.calls) expect(call[1]).toBe(0.02);

    useAppStore.getState().hardStopAll();
    stopSource.mockRestore();
  });

  test('cuts BEFORE the new vibe state is written, so nothing of the old vibe is left queued', () => {
    // Load a vibe so the store holds a known progression, then record what
    // `chords` looked like at the moment each cut happened. A cut that
    // landed after `setChords` would see the NEW ids — i.e. the old vibe's
    // voices were still queued while the new progression was already live.
    applyVibeToStore(RESOLVED_VIBES[0]);
    const oldIds = useAppStore.getState().chords.map((c) => c.id);

    const chordIdsAtCut: string[][] = [];
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {
      chordIdsAtCut.push(useAppStore.getState().chords.map((c) => c.id));
    });
    stopSource.mockClear();

    useAppStore.getState().play('chords');
    applyVibeToStore(RESOLVED_VIBES[1]);

    expect(chordIdsAtCut.length > 0).toBe(true);
    for (const ids of chordIdsAtCut) expect(ids).toEqual(oldIds);

    useAppStore.getState().hardStopAll();
    stopSource.mockRestore();
  });
});

import { isNoteInScale } from '../utils/musicTheory';
import { SCALES } from '@/data/scales';
import { progressionById, resolveProgression } from '@/audio/chordProgressions';
import { isMeterId } from '../utils/meter';

describe('vibe scales', () => {
  test('every vibe scaleType is a real key of SCALES', () => {
    // This alone would have caught 'Pentatonic Major', which fell through to
    // Major for the whole life of the vibe.
    for (const vibe of RESOLVED_VIBES) {
      expect(SCALES[vibe.scaleType]).toBeDefined();
    }
  });

  test('Zen Garden is G Hirajoshi and plays the bamboo vamp', () => {
    const zen = RESOLVED_VIBES.find((v) => v.id === 'zen-garden')!;
    expect(zen.scaleRoot).toBe('G');
    expect(zen.scaleType).toBe('Hirajoshi');

    const resolved = resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi', 4);
    expect(zen.chords.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })))
      .toEqual(resolved.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })));
  });

  test('every note Zen Garden plays is inside G Hirajoshi, except the iv chord borrowed from the parent', () => {
    // zn2 is degree 3 (iv), which resolveDegreeQuality now derives as min from
    // Natural Minor rather than the old fully-inside sus4 — see scales.ts's
    // Hirajoshi comment. Its third, F, sits outside the five-note scale;
    // every other Zen Garden chord stays entirely inside it.
    const zen = RESOLVED_VIBES.find((v) => v.id === 'zen-garden')!;
    for (const chord of zen.chords) {
      const outside = chord.notes.filter((note) => !isNoteInScale(note, 'G', 'Hirajoshi'));
      if (chord.root === 'D' && chord.quality === 'min') {
        expect(outside).toEqual(['F4']);
      } else {
        expect(outside).toEqual([]);
      }
    }
  });
});

describe('vibe meters', () => {
  test('every vibe declares a real meter; the original six stay at 4/4, lofi-waltz is 3/4 and afro-six-eight is 6/8', () => {
    for (const vibe of RESOLVED_VIBES) {
      expect(isMeterId(vibe.meter), `${vibe.id} must declare a meter`).toBe(true);
      const expectedMeter = vibe.id === 'lofi-waltz' ? '3/4' : vibe.id === 'afro-six-eight' ? '6/8' : '4/4';
      expect(vibe.meter, `${vibe.id} meter`).toBe(expectedMeter);
    }
  });

  test('the eight vibe ids match their display names, and are unique', () => {
    expect(VIBES.map((v) => v.id)).toEqual([
      'lofi-chill',
      'synthwave-80s',
      'cyber-edm',
      'deep-ambient',
      'boom-bap',
      'zen-garden',
      'lofi-waltz',
      'afro-six-eight',
    ]);
    expect(new Set(VIBE_IDS).size).toBe(VIBE_IDS.length);
    // Deliberately NOT an id-derives-from-name check. Three of the eight would
    // fail one for reasons that are correct: lofi-chill and lofi-waltz drop the
    // internal hyphen of "Lo-Fi", and afro-six-eight spells out the digits of
    // "Afro 6/8". Those are id-spelling conventions, not drift.
  });

  test('applying a vibe writes its meter into the transport', () => {
    useAppStore.getState().setMeter('7/8');
    applyVibeToStore(RESOLVED_VIBES[0]);
    expect(useAppStore.getState().meterId).toBe('4/4');
  });

  test('applying a vibe from a narrower meter still lands the transport meter and the drum grid correctly', () => {
    // End-state sanity check only — NOT an ordering pin. Starting from a
    // narrower meter, applying a vibe leaves the transport at the vibe's own
    // meter and the grid holding the vibe's authored hits. It cannot by
    // itself prove setMeter ran before replaceDrumPattern: adaptStepRow
    // truncates a longer source row rather than stretching it, so
    // synthwave's kick step 12 — inside both a 14- and a 16-step window —
    // survives either call order (confirmed by manually swapping the two
    // calls: this assertion still passed). The real ordering pin is the
    // call-order recorder in the next test.
    useAppStore.getState().setMeter('7/8');
    applyVibeToStore(RESOLVED_VIBES[1]);
    const kick = useAppStore.getState().sequencerTracks.find((t) => t.instrument === 'kick')!;
    expect(useAppStore.getState().meterId).toBe('4/4');
    expect(kick.steps[12]).toBe(true);
  });

  test('setMeter runs before replaceDrumPattern — the order the drum grid depends on', () => {
    // Order-pin via a call recorder (same technique as `focusSynthTarget` in
    // synthControl.test.ts), rather than relying on drum-cell data to expose
    // a reorder: replaceDrumPattern reads the ACTIVE meter to decide
    // how to window the incoming rows, so if setMeter ran after it, the grid
    // would be adapted against the OUTGOING vibe's bar length. This directly
    // observes which of the two ran first, independent of any one vibe's
    // pattern shape.
    const order: string[] = [];
    const originals = {
      setMeter: useAppStore.getState().setMeter,
      replaceDrumPattern: useAppStore.getState().replaceDrumPattern,
    };
    useAppStore.setState({
      setMeter: (id) => {
        order.push('setMeter');
        originals.setMeter(id);
      },
      replaceDrumPattern: (pattern) => {
        order.push('replaceDrumPattern');
        originals.replaceDrumPattern(pattern);
      },
    });

    try {
      applyVibeToStore(RESOLVED_VIBES[0]);
    } finally {
      useAppStore.setState({ setMeter: originals.setMeter, replaceDrumPattern: originals.replaceDrumPattern });
    }

    expect(order).toEqual(['setMeter', 'replaceDrumPattern']);
  });

  test("each vibe's rhythm and bass pools stay inside its own meter", () => {
    // A vibe whose dice can land on a 4/4 pattern would silently adapt it every
    // reroll. Nothing forbids that at the type level; this is the guard.
    for (const v of RESOLVED_VIBES) {
      for (const id of v.random!.chordRhythms) {
        expect(CHORD_RHYTHMS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
      for (const id of v.random!.bassPatterns) {
        expect(BASS_PATTERNS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
    }
  });
});

describe('vibe pad data', () => {
  // Mirrors the existing bassPresetId invariant at the top of this file.
  test('every pad preset id resolves to a Pad-category preset', () => {
    for (const vibe of RESOLVED_VIBES) {
      if (!vibe.pad) continue;
      expect(`${vibe.id}=${presetById(vibe.pad.presetId)?.category}`).toBe(`${vibe.id}=Pad`);
    }
  });

  // An empty set is legal at runtime — it means a silent drone — but in
  // authored content it ships a layer that cannot make a sound, which is a
  // data bug rather than a choice.
  test('every vibe that ships a pad ships a non-empty interval set', () => {
    for (const vibe of RESOLVED_VIBES) {
      if (!vibe.pad) continue;
      expect(vibe.pad.droneIntervals.length).toBeGreaterThan(0);
    }
  });

  // The optional shape is a real choice, not a field every entry fills.
  test('the two boombap-pool vibes ship no pad', () => {
    const byId = Object.fromEntries(RESOLVED_VIBES.map((v) => [v.id, v]));
    expect(byId['boom-bap'].pad).toBeUndefined();
    expect(byId['afro-six-eight'].pad).toBeUndefined();
  });
});

describe('applying a vibe writes its pad', () => {
  // `useAppStore` is a process-wide singleton bun test shares across every
  // file in this process, and both tests below deliberately leave pad state
  // mutated (one leaves it muted, both leave lofi-chill's pad fields written)
  // to assert on the result of applying a vibe. Restore every pad key after
  // each test rather than patching individual fields inline, so a future
  // assertion added to either test can't reintroduce a partial restore.
  afterEach(() => {
    useAppStore.setState({ ...defaultPadState() });
    useAppStore.getState().hardStopAll();
  });

  test('a vibe with a pad unmutes and configures the layer', () => {
    const vibe = RESOLVED_VIBES.find((v) => v.pad)!;
    applyVibeToStore(vibe);
    const s = useAppStore.getState();
    expect(s.padMuted).toBe(false);
    expect(s.padMode).toBe(vibe.pad!.mode);
    expect(s.padVolume).toBe(vibe.pad!.volume);
    expect(s.padOctave).toBe(vibe.pad!.octave);
    expect(s.padVoicing).toBe(vibe.pad!.voicing);
    expect(s.padDroneDegree).toBe(vibe.pad!.droneDegree);
    expect(s.padDroneIntervals).toEqual(vibe.pad!.droneIntervals);
    expect(s.padSynthParams.preset).toBe(presetById(vibe.pad!.presetId)!.name);
  });

  // Muting is reversible and resetting is not: Boom Bap -> Synthwave -> Boom
  // Bap must not erase pad settings the user tuned by hand.
  test('a vibe without a pad mutes the layer and leaves its settings alone', () => {
    const withPad = RESOLVED_VIBES.find((v) => v.pad)!;
    const withoutPad = RESOLVED_VIBES.find((v) => !v.pad)!;
    applyVibeToStore(withPad);
    const octaveBefore = useAppStore.getState().padOctave;
    applyVibeToStore(withoutPad);
    const s = useAppStore.getState();
    expect(s.padMuted).toBe(true);
    expect(s.padOctave).toBe(octaveBefore);
  });
});

describe('resolveVibe', () => {
  test('every vibe in VIBES resolves — the module-evaluation guarantee, restored', () => {
    // The old table called resolveProgression/drumGridById/requireEffectChain
    // at module scope, so a typo'd id failed the moment anything imported it.
    // A VibeSpec resolves nothing, so this test IS that guarantee now.
    for (const spec of VIBES) {
      const resolved = resolveVibe(spec);
      expect(resolved.chords.length).toBeGreaterThan(0);
      expect(Object.keys(resolved.drumPattern).length).toBeGreaterThan(0);
      expect(Object.keys(resolved.effects).length).toBeGreaterThan(0);
    }
  });

  test('a resolved vibe carries every field of its spec unchanged', () => {
    for (const spec of VIBES) {
      const resolved = resolveVibe(spec);
      for (const [key, value] of Object.entries(spec)) {
        expect(resolved[key as keyof typeof resolved]).toEqual(value);
      }
    }
  });

  test('an unknown progressionId throws and names the vibe', () => {
    expect(() => resolveVibe({ ...VIBES[0], progressionId: 'nope' }))
      .toThrow('Vibe "lofi-chill" references unknown progression id: nope');
  });

  test('an unknown drumGridId throws and names the vibe', () => {
    expect(() => resolveVibe({ ...VIBES[0], drumGridId: 'nope' }))
      .toThrow('Vibe "lofi-chill" references unknown drum grid id: nope');
  });

  test('an unknown effectChainId throws', () => {
    // requireEffectChain is already the loud one and stays the loud one.
    expect(() => resolveVibe({ ...VIBES[0], effectChainId: 'nope' }))
      .toThrow('Unknown vibe effect chain id: nope');
  });

  test('resolveVibe hands back a fresh drum grid, never the library array', () => {
    const a = resolveVibe(VIBES[0]);
    const b = resolveVibe(VIBES[0]);
    expect(a.drumPattern.kick).toEqual(b.drumPattern.kick);
    expect(a.drumPattern.kick).not.toBe(b.drumPattern.kick);
  });
});

describe('the vibe table', () => {
  test('vibe ids are unique', () => {
    expect(new Set(VIBES.map((v) => v.id)).size).toBe(VIBES.length);
  });
});

describe('applyVibeToStore leaves a scope that matches what is sounding', () => {
  afterEach(() => {
    useAppStore.getState().hardStopAll();
    useAppStore.setState({ activeTab: 'sound' });
  });

  test('a vibe clicked mid-playback keeps the loop scope it started under', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    applyVibeToStore(RESOLVED_VIBES[0]);

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('a vibe clicked on the song layer during an audition also keeps playing', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    applyVibeToStore(RESOLVED_VIBES[0]);

    const s = useAppStore.getState();
    // A vibe never moves activeLoopId, so it is always the "same loop" row —
    // the song-layer stop rule cannot be triggered by clicking a vibe.
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('a vibe clicked with the transport stopped starts nothing and claims no scope', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
    });
    useAppStore.getState().hardStopAll();

    applyVibeToStore(RESOLVED_VIBES[0]);

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
  });
});
