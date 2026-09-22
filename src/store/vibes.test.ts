import { describe, test, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { VIBES } from '../data/vibes';
import { applyVibeToStore, resolveVibe, resolveVibeSynthParams, VIBE_IDS } from './vibes';
import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';
import type { LeadNote } from '../audio/playback/leadMelody';
import { CHORD_RHYTHMS } from '../data/chordRhythms';
import { BASS_PATTERNS } from '../data/bassPatterns';
import { DRUM_GRIDS } from '../data/drumGrids';
import { BEAT_PRESETS, BEAT_VOICE_IDS } from '@/data/beatPresets';
import { beatPresetById } from './beatPresets';
import { presetById } from '@/utils/synthPresets';
import { useAppStore } from './store';
import { createDefaultLoop } from './loopSlice';
import { loopLabel, loopStatePatch } from './loop';
import { SCOPE_NONE } from './playbackScope';
import { defaultPadState, INITIAL_EFFECTS } from './initialState';
import { DEFAULT_BPM } from './transportSlice';
import { DEFAULT_METER_ID, MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import { gainToDb, toLinearGain } from '../utils/gainUnits';
import type { ChordItem } from '../types';

/**
 * Every vibe, resolved once. Most of this file asserts on spec fields, which a
 * ResolvedVibe carries unchanged; the rest applies a vibe, which needs one.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);

// applyVibeToStore rewrites bpm, meter, effects and the loop content wholesale,
// and the 'audible cut' block leaves them behind (its tests restore their own
// spy and hardStopAll the players, but not the content). Restore the default
// baseline before AND after each test there so the suite stays
// order-independent — a sibling file, or a future test after that block, that
// reads the store must not see a leftover vibe's chords, key or bpm.
const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    activeTab: 'sound',
    playbackScope: SCOPE_NONE,
    selectedVibeId: null,
    bpm: DEFAULT_BPM,
    meterId: DEFAULT_METER_ID,
    effects: { ...INITIAL_EFFECTS },
  });
};

describe('Instant Vibes Mode', () => {
  test('contains all 8 curated genre vibes with complete presets and feel settings', () => {
    expect(RESOLVED_VIBES.length).toBe(8);

    for (const vibe of RESOLVED_VIBES) {
      expect(Boolean(vibe.id)).toBe(true);
      expect(Boolean(vibe.name)).toBe(true);
      expect(vibe.bpm > 50 && vibe.bpm < 180).toBe(true);
      expect(Boolean(vibe.scaleRoot)).toBe(true);
      expect(Boolean(vibe.scaleType)).toBe(true);
      
      // Drum Beat & Sound
      // Was a bare `Boolean(...)` on the kit NAME a vibe used to carry, which
      // passes on any non-empty string — which is how three vibes shipped
      // naming a kit that resolved to nothing at all.
      expect(BEAT_PRESETS.map((p) => p.id), `${vibe.id} names a Beat preset that does not exist`)
        .toContain(vibe.beatPresetId);
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

  test("every vibe's beatPresetId is a real Beat preset", () => {
    // The sibling of drumGrids.test.ts's "every grid names a real Beat
    // preset", and strict for the reason recorded there: `setBeatPreset`
    // falls an unknown id back to the DEFAULT preset, so a typo here is not
    // an error and not a warning, just the wrong sound under the vibe's name.
    // Three vibes shipped that way ('Hyperpop 2000', 'Minimal Glitch' x2)
    // back when the only assertion here was that the field is truthy.
    for (const vibe of RESOLVED_VIBES) {
      expect(beatPresetById(vibe.beatPresetId), `${vibe.id} -> ${vibe.beatPresetId}`).toBeTruthy();
    }
  });

  test("a vibe's beatPresetId agrees with its own grid's, or says why not", () => {
    // A vibe chooses a sound as well as a rhythm, so it MAY disagree with its
    // grid — but every disagreement is deliberate and listed here. An
    // unlisted one is a repoint that forgot its grid, which is exactly how the
    // three dangling names went unnoticed.
    const DELIBERATE_DISAGREEMENT: Record<string, string> = {};
    for (const vibe of RESOLVED_VIBES) {
      const gridPreset = DRUM_GRIDS[vibe.drumGridId].beatPresetId;
      const expected = DELIBERATE_DISAGREEMENT[vibe.id] ?? gridPreset;
      expect(vibe.beatPresetId, `${vibe.id} (grid ${vibe.drumGridId} -> ${gridPreset})`).toBe(expected);
    }
  });

  test('applyVibeToStore sets drum pattern, Beat sound, chords, bass, feel, synth presets, and master effects', () => {
    const lofiVibe = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    applyVibeToStore(lofiVibe);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(lofiVibe.bpm);
    expect(state.scaleRoot).toBe(lofiVibe.scaleRoot);
    expect(state.scaleType).toBe(lofiVibe.scaleType);
    // The Beat SOUND, installed whole and recorded as the base — the patch is
    // the preset's own, not a merge over whatever the loop was holding.
    expect(state.beatParams.basePresetId).toBe(lofiVibe.beatPresetId);
    expect(state.beatParams.voices).toEqual(beatPresetById(lofiVibe.beatPresetId)!.patch.voices);
    expect(state.chordRhythmId).toBe(lofiVibe.chordRhythmId);
    expect(state.chordFeel).toBe(lofiVibe.chordFeel);
    expect(state.chordSynthParams.sourcePresetId).toBe(presetById(lofiVibe.chordPresetId)!.id);
    expect(state.bassPatternId).toBe(lofiVibe.bassPatternId);
    expect(state.bassFeel).toBe(lofiVibe.bassFeel);
    expect(state.bassSynthParams.sourcePresetId).toBe(presetById(lofiVibe.bassPresetId)!.id);
    expect(state.synthParams.sourcePresetId).toBe(presetById(lofiVibe.synthPresetId)!.id);
  });

  test('applyVibeToStore actually rewrites the Beat pattern to match the vibe drum grid', () => {
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
    // fail. The four voices this grid omits ship silent, so without a seeded
    // hit inside the window, "cleared to false" and "left untouched" are the
    // same array — and replaceBeatPattern regressing from clearing to merging
    // would pass unnoticed.
    const seeded = { ...useAppStore.getState().beatPattern.rows };
    for (const voice of BEAT_VOICE_IDS) {
      seeded[voice] = seeded[voice].map((v, i) => (i === 3 || i === 20 ? true : v));
    }
    useAppStore.setState({ beatPattern: { rows: seeded } });

    applyVibeToStore(synthwave);

    const rows = useAppStore.getState().beatPattern.rows;
    // Every row this grid's pattern defines shares one meter width; borrow it
    // from any defined row to check the omitted rows' active window below.
    const windowLength = Object.values(synthwave.drumPattern)[0]!.length;
    for (const voice of BEAT_VOICE_IDS) {
      const vibeSteps = synthwave.drumPattern[voice];
      const row = rows[voice];
      if (vibeSteps === undefined) {
        // An omitted row is as legal as an all-false one, because
        // replaceBeatPattern CLEARS any voice the grid does not name: a vibe
        // gives you that grid, never that grid plus the last one's leftovers.
        // Only the active window clears; the wider-meter padding survives.
        expect(row.slice(0, windowLength).every((v) => v === false), voice).toBe(true);
        expect(row[20], voice).toBe(true);
        continue;
      }
      // Stored rows are always 24-wide; the vibe's 16-step grid lands in the
      // window and the untouched padding keeps its seeded hit.
      expect(row.length).toBe(MAX_STEPS_PER_BAR);
      expect(row.slice(0, vibeSteps.length), voice).toEqual(vibeSteps);
      expect(row[20], voice).toBe(true);
      expect(
        row.slice(vibeSteps.length).every((v, i) => (vibeSteps.length + i === 20 ? v === true : v === false)),
        voice,
      ).toBe(true);
    }
    // ...and the hits are genuinely inside the WINDOW the stepper reads. The
    // sweep above compares against the grid, so it would pass on an all-false
    // row if the grid had one; and a whole-row `some` would be satisfied by
    // the seeded padding hit at index 20 alone, which is outside the 16-step
    // window and never sounds. This is the assertion that says the vibe put
    // audible hits where playback looks.
    expect(rows.kick.slice(0, windowLength).filter((v) => v).length).toBeGreaterThan(0);
    expect(synthwave.drumPattern.kick!.filter((v) => v).length).toBeGreaterThan(0);
  });

  test('applies synthwave vibe with tight feel and its own arp setting', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    // A vibe CAN reach the arpeggiator now — `VibeSpec.arp` is one of the
    // three axes it sets — so this asserts the table, not an absence.
    // Synthwave's lead is a held supersaw and states `active: false`; the
    // "exactly one vibe arms an arpeggiator" test below owns the rule itself.
    expect(state.synthArpSettings).toEqual(synthwave.arp.synth);
    expect(synthwave.arp.synth.active).toBe(false);
  });
});

describe("a vibe's Beat sound and Beat pattern", () => {
  test('the Beat sound and the Beat pattern are two independent writes', () => {
    // The grid a vibe names carries its own `beatPresetId` as provenance and
    // nothing applies it; the vibe's own `beatPresetId` is what becomes the
    // sound. Applying the vibe must therefore write the VIBE's preset, never
    // the grid's, and must write the grid's rows either way.
    const vibe = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    applyVibeToStore(vibe);
    const state = useAppStore.getState();
    expect(state.beatParams.basePresetId).toBe(vibe.beatPresetId);
    expect(state.beatPattern.rows.kick.slice(0, vibe.drumPattern.kick!.length)).toEqual(
      vibe.drumPattern.kick!,
    );
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

  test('every vibe states Arp for all five tracks, as literal data', () => {
    // A vibe is a complete setting of the loop, and Arp is part of what the
    // user hears. Leaving a track out would make "apply Lo-Fi Chill" mean
    // something different depending on what the previous vibe had armed.
    for (const vibe of RESOLVED_VIBES) {
      expect(Object.keys(vibe.arp).sort(), vibe.id).toEqual(['bass', 'chord', 'fx', 'pad', 'synth']);
      for (const [target, arp] of Object.entries(vibe.arp)) {
        expect(`${vibe.id}.${target}=${typeof arp.active}/${typeof arp.mode}/${typeof arp.rate}/${typeof arp.octaves}`)
          .toBe(`${vibe.id}.${target}=boolean/string/string/number`);
      }
    }
  });

  test('no vibe carries the legacy flat arp fields', () => {
    const ARP_FIELDS = ['synthArp', 'chordArp', 'bassArp', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'];
    for (const vibe of RESOLVED_VIBES) {
      for (const field of ARP_FIELDS) {
        expect(`${vibe.id}.${field}=${Object.prototype.hasOwnProperty.call(vibe, field)}`)
          .toBe(`${vibe.id}.${field}=false`);
      }
    }
  });

  test('applying a vibe installs exactly the Arp settings it declares', () => {
    for (const vibe of RESOLVED_VIBES) {
      applyVibeToStore(vibe);
      const s = useAppStore.getState();
      expect(s.synthArpSettings, vibe.id).toEqual(vibe.arp.synth);
      expect(s.chordArpSettings, vibe.id).toEqual(vibe.arp.chord);
      expect(s.bassArpSettings, vibe.id).toEqual(vibe.arp.bass);
      expect(s.fxArpSettings, vibe.id).toEqual(vibe.arp.fx);
      expect(s.padArpSettings, vibe.id).toEqual(vibe.arp.pad);
    }
    useAppStore.getState().hardStopAll();
  });

  test('exactly one vibe arms an arpeggiator, and it is Cyber EDM’s lead', () => {
    // Pinned so that arming one is always a decision somebody made, never a
    // default that spread. A vibe that switches the arpeggiator on behind the
    // user's back is the failure the previous "always off" rule guarded
    // against; stating it per vibe keeps the guard and makes the axis real.
    const armed = RESOLVED_VIBES.flatMap((vibe) =>
      Object.entries(vibe.arp)
        .filter(([, arp]) => arp.active)
        .map(([target]) => `${vibe.id}.${target}`),
    );
    expect(armed).toEqual(['cyber-edm.synth']);
  });

  test('applying a vibe installs each named preset’s own patch on its own bus', () => {
    for (const vibe of RESOLVED_VIBES) {
      applyVibeToStore(vibe);
      const s = useAppStore.getState();
      expect(s.synthParams.patch, vibe.id).toEqual(presetById(vibe.synthPresetId)!.patch);
      expect(s.chordSynthParams.patch, vibe.id).toEqual(presetById(vibe.chordPresetId)!.patch);
      expect(s.bassSynthParams.patch, vibe.id).toEqual(presetById(vibe.bassPresetId)!.patch);
      expect(s.fxSynthParams.patch, vibe.id).toEqual(presetById(vibe.fxPresetId)!.patch);
      if (vibe.pad) {
        expect(s.padSynthParams.patch, vibe.id).toEqual(presetById(vibe.pad.presetId)!.patch);
      }
    }
    useAppStore.getState().hardStopAll();
  });

  test('loading a vibe leaves every preset select pointing at the preset that produced the sound', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyVibeToStore(synthwave);
    const state = useAppStore.getState();
    expect(state.synthParams.sourcePresetId).toBe(presetById(synthwave.synthPresetId)!.id);
    expect(state.chordSynthParams.sourcePresetId).toBe(presetById(synthwave.chordPresetId)!.id);
    expect(state.bassSynthParams.sourcePresetId).toBe(presetById(synthwave.bassPresetId)!.id);
    useAppStore.getState().hardStopAll();
  });
});

/**
 * A vibe replaces the whole progression, and a custom pattern's cycle is
 * defined against that progression — so applying one has to re-clamp both
 * custom lanes' loop lengths and holds in the same write. It is an AUTOMATIC
 * clamp, not an explicit selection: the length moves to the nearest divisor of
 * the new bar count and the arrays are left at their stored width, exactly as
 * Lead/FX leave the bars a shorter cycle can no longer reach.
 */
describe('applyVibeToStore re-clamps the custom pattern lanes', () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  // Three bars, so 4/4's divisors are 1 and 3 rather than the factory's 1, 2, 4.
  const THREE_BAR_CHORDS: ChordItem[] = [
    { id: 'c1', root: 'A', quality: 'min7', bars: 2 },
    { id: 'c2', root: 'F', quality: 'maj7', bars: 1 },
  ];

  test('the new progression lowers the dormant cycle without deleting its bars', () => {
    useAppStore.setState({ meterId: '4/4' });
    useAppStore.getState().setChords(THREE_BAR_CHORDS);
    useAppStore.getState().setCustomChordLoopLength(3);
    useAppStore.getState().setCustomBassLoopLength(3);
    useAppStore.getState().setCustomChordEvent(32, true); // bar three, offset 0
    useAppStore.getState().setCustomBassEvent(0, 'root');

    applyVibeToStore(RESOLVED_VIBES[0]); // four one-bar chords

    const s = useAppStore.getState();
    expect(s.chordRhythmMode).toBe('preset');
    expect(s.bassPatternMode).toBe('preset');
    // 3 is not a divisor of 4, so both cycles lower to 2...
    expect(s.customChordLoopLength).toBe(2);
    expect(s.customBassLoopLength).toBe(2);
    // ...and the third bar survives: the dormant onset is still stored, so
    // raising the length again brings it back instead of losing the work.
    expect(s.customChordRhythm).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(s.customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);
    expect(s.customBassPattern).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(s.customBassPattern[0]).toBe('root');
  });

  test('a cycle the new progression can still divide is left alone', () => {
    useAppStore.setState({ meterId: '4/4' });
    useAppStore.getState().setCustomChordLoopLength(2);
    useAppStore.getState().setCustomChordEvent(16, true); // bar two, offset 0
    useAppStore.getState().setCustomBassLoopLength(4);

    applyVibeToStore(RESOLVED_VIBES[0]); // four bars, so 2 and 4 both still divide

    const s = useAppStore.getState();
    expect(s.customChordLoopLength).toBe(2);
    expect(s.customBassLoopLength).toBe(4);
    expect(s.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
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
      play: useAppStore.getState().play,
    };

    useAppStore.setState({
      hardStopAll: () => {
        order.push('hardStopAll');
        originals.hardStopAll();
      },
      play: (module) => {
        order.push(`play:${module}`);
        playCalls.push(module);
        originals.play(module);
      },
    });

    // The vibe's content is ONE write now (vibeContentPatch), so it is
    // observed as the notification that changes the chords or the effects.
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.chords !== prev.chords || state.effects !== prev.effects) order.push('content');
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
    const contentIndex = order.indexOf('content');
    const restartIndex = order.indexOf('restart:chords');
    expect(hardStopIndex).toBeLessThan(contentIndex);
    expect(restartIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeLessThan(restartIndex);
    expect(order.filter((e) => e === 'content')).toEqual(['content']);

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
  beforeEach(resetStore);
  afterEach(resetStore);

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

import { generateBlockChordNotes, isNoteInScale } from '../utils/musicTheory';
import { SCALES } from '@/data/scales';
import { progressionById, resolveProgression } from '@/audio/chordProgressions';
import { isMeterId } from '../utils/timeSignature';

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

    const resolved = resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi');
    expect(zen.chords.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars })))
      .toEqual(resolved.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars })));
  });

  test('every note Zen Garden plays is inside G Hirajoshi, except the iv chord borrowed from the parent', () => {
    // zn2 is degree 3 (iv), which resolveDegreeQuality now derives as min from
    // Natural Minor rather than the old fully-inside sus4 — see scales.ts's
    // Hirajoshi comment. Its third, F, sits outside the five-note scale;
    // every other Zen Garden chord stays entirely inside it.
    const zen = RESOLVED_VIBES.find((v) => v.id === 'zen-garden')!;
    for (const chord of zen.chords) {
      const notes = generateBlockChordNotes(chord.quality, chord.root, 4);
      const outside = notes.filter((note) => !isNoteInScale(note, 'G', 'Hirajoshi'));
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
    // itself prove setMeter ran before replaceBeatPattern: adaptStepRow
    // truncates a longer source row rather than stretching it, so
    // synthwave's kick step 12 — inside both a 14- and a 16-step window —
    // survives either call order (confirmed by manually swapping the two
    // calls: this assertion still passed). The real ordering pin is the
    // wider-meter padding test in vibes.atomic.test.ts.
    useAppStore.getState().setMeter('7/8');
    applyVibeToStore(RESOLVED_VIBES[1]);
    expect(useAppStore.getState().meterId).toBe('4/4');
    expect(useAppStore.getState().beatPattern.rows.kick[12]).toBe(true);
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
    // `pad.volume` is authored linear (DEV-383 divergence 4); `padVolume` is a
    // dB fader (DEV-386), so applyVibeToStore must convert at the boundary.
    expect(s.padVolume).toBe(gainToDb(toLinearGain(vibe.pad!.volume)));
    expect(s.padOctave).toBe(vibe.pad!.octave);
    expect(s.padVoicing).toBe(vibe.pad!.voicing);
    expect(s.padDroneDegree).toBe(vibe.pad!.droneDegree);
    expect(s.padDroneIntervals).toEqual(vibe.pad!.droneIntervals);
    expect(s.padSynthParams.sourcePresetId).toBe(presetById(vibe.pad!.presetId)!.id);
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

describe('a vibe stamps the active loop with its display name', () => {
  beforeEach(() => {
    useAppStore.setState({ activeTab: 'sound', playbackScope: SCOPE_NONE });
  });

  test('writes the vibe NAME, not its id, into the active loop and no other', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    const a = { ...createDefaultLoop(), id: 'loop-a', name: '', tempName: 'untitled-1' };
    const b = { ...createDefaultLoop(), id: 'loop-b', name: '', tempName: 'untitled-2' };
    useAppStore.setState({ loops: [a, b], activeLoopId: 'loop-a' });

    applyVibeToStore(synthwave);

    const loops = useAppStore.getState().loops;
    // A copied NAME, not a stored vibeId: an id is a reference that claims
    // identity and goes on claiming it after the sound has moved on, while a
    // name claims only history, which cannot go stale.
    expect(loops.find((l) => l.id === 'loop-a')!.tempName).toBe('Synthwave 80s');
    expect(loops.find((l) => l.id === 'loop-b')!.tempName).toBe('untitled-2');
  });

  test('writes it even behind a user name, leaving the displayed label unchanged', () => {
    const lofi = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    const named = { ...createDefaultLoop(), id: 'loop-a', name: 'Drop', tempName: 'untitled-1' };
    useAppStore.setState({ loops: [named], activeLoopId: 'loop-a' });

    applyVibeToStore(lofi);

    const loop = useAppStore.getState().loops[0];
    // tempName always means "the last vibe applied here"; it simply stays
    // invisible behind the user's name. A conditional write would make
    // clearing that name reveal a stale untitled number instead of the vibe
    // the loop was actually built from — the one moment the field exists for.
    expect(loop.tempName).toBe('Lo-Fi Chill');
    expect(loop.name).toBe('Drop');
    expect(loopLabel(loop)).toBe('Drop');
  });
});

describe('applyVibeToStore — the FX track', () => {
  test('writes fxSynthParams from the vibe fx preset', () => {
    const vibe = resolveVibe(VIBES.find((v) => v.id === 'synthwave-80s')!);
    applyVibeToStore(vibe);
    expect(useAppStore.getState().fxSynthParams).toEqual(
      resolveVibeSynthParams(vibe.fxPresetId, 'fx'),
    );
  });

  /**
   * A vibe supplies a VOICE, never NOTES — exactly what it already does for the
   * lead. Applying a vibe must never destroy something the user wrote.
   */
  test('never writes fxMelodySteps', () => {
    const steps = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
    steps[0] = [{ note: 'C4', len: 6 }];
    const vibe = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    // Already in the vibe's key, so no key change moves the notes: this pins
    // that the vibe writes no notes of its own, not what a key change does.
    useAppStore.setState({ fxMelodySteps: steps, scaleRoot: vibe.scaleRoot, scaleType: vibe.scaleType });
    applyVibeToStore(vibe);
    expect(useAppStore.getState().fxMelodySteps[0]).toEqual([{ note: 'C4', len: 6 }]);
  });

  test('never writes leadMelodySteps either — the rule is the same for both', () => {
    const steps = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
    steps[0] = [{ note: 'E4', len: 6 }];
    const vibe = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    useAppStore.setState({ leadMelodySteps: steps, scaleRoot: vibe.scaleRoot, scaleType: vibe.scaleType });
    applyVibeToStore(vibe);
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'E4', len: 6 }]);
  });

  test('a vibe that changes the key moves FX exactly as it moves Lead', () => {
    const steps = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
    steps[0] = [{ note: 'E4', len: 6 }];
    const vibe = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    useAppStore.setState({
      leadMelodySteps: steps,
      fxMelodySteps: steps.map((cell) => [...cell]),
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
    });
    applyVibeToStore(vibe);
    const s = useAppStore.getState();
    expect(s.fxMelodySteps[0]).toEqual(s.leadMelodySteps[0]);
    expect(s.leadMelodySteps[0]).not.toEqual([{ note: 'E4', len: 6 }]);
  });
});

describe("a vibe's Beat filter override", () => {
  /**
   * The filter override, laid OVER the preset's own filter and not merged into
   * it — the one part of a Beat patch a vibe may state for itself.
   *
   * Its own test because it is the half that silently stopped working: the
   * write went to a legacy field the audio path had already stopped reading,
   * so eight vibes shipped an override that reached nothing. The assertion is
   * the OVERRIDE's values and explicitly not the preset's, so an apply that
   * quietly drops it fails here rather than agreeing with the preset.
   */
  test('applyVibeToStore lays the vibe\'s Beat filter over the preset it installed', () => {
    const lofiVibe = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    expect(lofiVibe.beatFilterCutoff).toBeDefined();
    applyVibeToStore(lofiVibe);
    const { beatParams } = useAppStore.getState();
    expect(beatParams.filter).toEqual({
      type: lofiVibe.beatFilterType!,
      cutoff: lofiVibe.beatFilterCutoff!,
      resonance: lofiVibe.beatFilterResonance!,
    });
    expect(beatParams.filter).not.toEqual(beatPresetById(lofiVibe.beatPresetId)!.patch.filter);
    // The rest of the patch is still the preset's, untouched by the override.
    expect(beatParams.voices).toEqual(beatPresetById(lofiVibe.beatPresetId)!.patch.voices);
  });
});

describe('a vibe apply and the reharmonize badge', () => {
  // Same hygiene as the 'audible cut' block above: applyVibeToStore rewrites
  // the key and chords wholesale, so a sibling file reading the store after
  // this one must not see this test's vibe left behind.
  afterEach(resetStore);

  test('a vibe installs its own chords unharmonized and clears the reharmonized badge', () => {
    const vibe = RESOLVED_VIBES.find((v) => v.scaleRoot !== useAppStore.getState().scaleRoot)!;
    useAppStore.setState({ autoReharmonize: true, reharmonizedIndicator: true });
    applyVibeToStore(vibe);
    const s = useAppStore.getState();
    expect(s.chords.map((c) => `${c.root}${c.quality}`)).toEqual(vibe.chords.map((c) => `${c.root}${c.quality}`));
    expect(s.reharmonizedIndicator).toBe(false);
  });
});
