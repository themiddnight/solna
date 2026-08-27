import { describe, test, expect, spyOn } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { INSTANT_VIBES, applyInstantVibeToStore } from './instantVibes';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { presetById } from '../audio/synthPresets';
import { useAppStore } from './store';

describe('Instant Vibes Mode', () => {
  test('contains all 6 curated genre vibes with complete presets and feel settings', () => {
    expect(INSTANT_VIBES.length).toBe(8);

    for (const vibe of INSTANT_VIBES) {
      expect(Boolean(vibe.id)).toBe(true);
      expect(Boolean(vibe.name)).toBe(true);
      expect(vibe.bpm > 50 && vibe.bpm < 180).toBe(true);
      expect(Boolean(vibe.scaleRoot)).toBe(true);
      expect(Boolean(vibe.scaleType)).toBe(true);
      
      // Drum Beat & Kit
      expect(Boolean(vibe.soundKit)).toBe(true);
      expect(Boolean(vibe.drumPattern)).toBe(true);
      expect(Boolean(vibe.drumPattern.kick)).toBe(true);
      expect(Boolean(vibe.drumPattern.snare)).toBe(true);
      expect(Boolean(vibe.drumPattern.hihat)).toBe(true);

      // Chords & Feel
      expect(vibe.chords.length).toBe(4);
      expect(Boolean(vibe.chordRhythmId)).toBe(true);
      // Ensure rhythm pattern exists in registry
      const rhythmExists = RHYTHM_PATTERNS.some((p) => p.id === vibe.chordRhythmId);
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

  test('applyInstantVibeToStore sets drum pattern, kit, chords, bass, feel, synth presets, and master effects', () => {
    const lofiVibe = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    applyInstantVibeToStore(lofiVibe);

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

  test('applyInstantVibeToStore actually rewrites the sequencer track steps to match the vibe drum pattern', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;

    // Seed the padding (indices 16-23) with a distinguishing `true` before
    // applying the vibe. Asserting padding is `false` both before and after
    // can't distinguish "genuinely preserved" from "reset to false" — a
    // seeded `true` that must survive makes this an independent proof, at the
    // applyInstantVibeToStore entry point rather than just writeStepWindow's
    // own unit tests.
    const before = useAppStore.getState().sequencerTracks;
    useAppStore
      .getState()
      .setSequencerTracks(before.map((t) => ({ ...t, steps: t.steps.map((v, i) => (i === 20 ? true : v)) })));

    applyInstantVibeToStore(synthwave);

    const tracks = useAppStore.getState().sequencerTracks;
    for (const track of tracks) {
      const vibeSteps = synthwave.drumPattern[track.instrument];
      expect(Boolean(vibeSteps)).toBe(true);
      // Store rows are always 24-wide; the vibe's 16-step pattern lands in the
      // window and the untouched padding stays silent.
      expect(track.steps.length).toBe(24);
      expect(track.steps.slice(0, vibeSteps.length)).toEqual(vibeSteps.map((v) => v === 1));
      // Padding invariant: the seeded `true` at index 20 must survive.
      expect(track.steps[20]).toBe(true);
      expect(
        track.steps.slice(vibeSteps.length).every((v, i) => (vibeSteps.length + i === 20 ? v === true : v === false)),
      ).toBe(true);
    }
  });

  test('applies synthwave vibe with tight feel and no arpeggiator', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

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
    for (const vibe of INSTANT_VIBES) {
      expect(`${vibe.id}.synthPresetId=${presetById(vibe.synthPresetId)?.id}`)
        .toBe(`${vibe.id}.synthPresetId=${vibe.synthPresetId}`);
      expect(`${vibe.id}.chordPresetId=${presetById(vibe.chordPresetId)?.id}`)
        .toBe(`${vibe.id}.chordPresetId=${vibe.chordPresetId}`);
    }
  });

  test('every vibe bass preset id resolves to a Bass-category preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(`${vibe.id}=${presetById(vibe.bassPresetId)?.category}`).toBe(`${vibe.id}=Bass`);
    }
  });

  test('the 8x3 preset matrix is pinned exactly', () => {
    expect(INSTANT_VIBES.map((v) => ({
      id: v.id,
      synthPresetId: v.synthPresetId,
      chordPresetId: v.chordPresetId,
      bassPresetId: v.bassPresetId,
    }))).toEqual([
      { id: 'lofi-chill', synthPresetId: 'factory-dream-keys', chordPresetId: 'factory-mellow-epiano', bassPresetId: 'bass-deep-sine' },
      { id: 'synthwave-80s', synthPresetId: 'factory-hyper-saw-lead', chordPresetId: 'factory-neon-poly-saw', bassPresetId: 'bass-saw-growl' },
      { id: 'cyber-dance', synthPresetId: 'factory-pluck', chordPresetId: 'factory-trance-pluck', bassPresetId: 'bass-punchy-square' },
      { id: 'ambient-chill', synthPresetId: 'factory-celestial-shimmer', chordPresetId: 'factory-warm-polypad', bassPresetId: 'bass-deep-sine' },
      { id: 'hiphop-groove', synthPresetId: 'factory-mellow-epiano', chordPresetId: 'factory-fm-tine-piano', bassPresetId: 'bass-round-pluck' },
      { id: 'asian-zen', synthPresetId: 'factory-glocken-bell', chordPresetId: 'factory-koto-pluck', bassPresetId: 'bass-warm-tri' },
      { id: 'lofi-waltz', synthPresetId: 'factory-fm-tine-piano', chordPresetId: 'factory-mellow-epiano', bassPresetId: 'bass-warm-tri' },
      { id: 'afro-six-eight', synthPresetId: 'factory-glocken-bell', chordPresetId: 'factory-fm-tine-piano', bassPresetId: 'bass-round-pluck' },
    ]);
  });

  test('no vibe carries arp data of any kind', () => {
    const ARP_FIELDS = ['synthArp', 'chordArp', 'bassArp', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'];
    for (const vibe of INSTANT_VIBES) {
      for (const field of ARP_FIELDS) {
        expect(`${vibe.id}.${field}=${Object.prototype.hasOwnProperty.call(vibe, field)}`)
          .toBe(`${vibe.id}.${field}=false`);
      }
    }
  });

  test('applying any vibe leaves all three voices with the arpeggiator off', () => {
    for (const vibe of INSTANT_VIBES) {
      applyInstantVibeToStore(vibe);
      const s = useAppStore.getState();
      expect(`${vibe.id}.synth=${s.synthParams.arpActive}`).toBe(`${vibe.id}.synth=false`);
      expect(`${vibe.id}.chord=${s.chordSynthParams.arpActive}`).toBe(`${vibe.id}.chord=false`);
      expect(`${vibe.id}.bass=${s.bassSynthParams.arpActive}`).toBe(`${vibe.id}.bass=false`);
    }
    useAppStore.getState().hardStopAll();
  });

  test('loading a vibe leaves every preset select pointing at the preset that produced the sound', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);
    const state = useAppStore.getState();
    expect(state.synthParams.preset).toBe(presetById(synthwave.synthPresetId)!.name);
    expect(state.chordSynthParams.preset).toBe(presetById(synthwave.chordPresetId)!.name);
    expect(state.bassSynthParams.preset).toBe(presetById(synthwave.bassPresetId)!.name);
    useAppStore.getState().hardStopAll();
  });
});

describe('applyInstantVibeToStore transport handling', () => {
  // Wrap the store's own action functions in place (via `setState`, not a
  // fresh mock store) so applyInstantVibeToStore's internal
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

    try {
      return run();
    } finally {
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

    withOrderTracking(order, playCalls, () => applyInstantVibeToStore(INSTANT_VIBES[1]));

    // The hard stop must be the very first thing that happens — before any
    // vibe-state write — and every restart must come after the last write.
    // This is the assertion that would fail if the swap applied the new
    // vibe first and cut audio afterward (or not at all).
    expect(order[0]).toBe('hardStopAll');
    const hardStopIndex = order.indexOf('hardStopAll');
    const setBpmIndex = order.indexOf('setBpm');
    const setEffectsIndex = order.indexOf('setEffects');
    const playIndex = order.indexOf('play:chords');
    expect(hardStopIndex).toBeLessThan(setBpmIndex);
    expect(setEffectsIndex).toBeLessThan(playIndex);

    // Chords was active, so it comes back; the Beat was not, so it stays put
    // — and play() was never even called for it.
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
    expect(playCalls).not.toContain('sequencer');
  });

  test('a player that was stopping restarts rather than staying half-stopped', () => {
    useAppStore.getState().play('chords');
    useAppStore.getState().softStop('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('stopping');

    applyInstantVibeToStore(INSTANT_VIBES[0]);

    expect(useAppStore.getState().chordsPlayer).toBe('playing');
  });

  test('a swap while nothing plays leaves both players stopped and never calls play', () => {
    useAppStore.getState().hardStopAll();

    const order: string[] = [];
    const playCalls: string[] = [];

    withOrderTracking(order, playCalls, () => applyInstantVibeToStore(INSTANT_VIBES[0]));

    // The weak form (end state reads 'stopped') would also pass an
    // implementation that started and immediately re-stopped the players.
    // Asserting play was never invoked rules that out.
    expect(playCalls).toEqual([]);
    expect(order[0]).toBe('hardStopAll');

    expect(useAppStore.getState().chordsPlayer).toBe('stopped');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
  });
});

test('InstantVibe presets carry no presentational fields', () => {
  const FORBIDDEN = ['color', 'bgGradient', 'borderColor', 'textColor'];
  for (const vibe of INSTANT_VIBES) {
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(vibe, key)).toBe(false);
    }
  }
});

describe('applyInstantVibeToStore audible cut', () => {
  // The regression this pins: the swap used to delegate the actual silencing
  // to a React effect keyed on the rendered player state. The whole swap runs
  // inside one onClick, React 18 batches it, and that state goes
  // 'playing' -> 'playing' — so the effect never re-ran and the old vibe's
  // queued chord and bass voices kept sounding over the new one. Asserting
  // the ORDER of store actions (the suite above) cannot see that: only an
  // assertion that the sources were actually silenced can.
  test('silences the chord and bass buses, at the hard-stop release', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
    stopSource.mockClear();

    useAppStore.getState().play('chords');
    applyInstantVibeToStore(INSTANT_VIBES[1]);

    const silenced = stopSource.mock.calls.map((c) => c[0]);
    expect(silenced).toContain('chord');
    expect(silenced).toContain('bass');
    for (const call of stopSource.mock.calls) expect(call[1]).toBe(0.02);

    useAppStore.getState().hardStopAll();
    stopSource.mockRestore();
  });

  test('cuts BEFORE the new vibe state is written, so nothing of the old vibe is left queued', () => {
    // Load a vibe so the store holds a known progression, then record what
    // `chords` looked like at the moment each cut happened. A cut that
    // landed after `setChords` would see the NEW ids — i.e. the old vibe's
    // voices were still queued while the new progression was already live.
    applyInstantVibeToStore(INSTANT_VIBES[0]);
    const oldIds = useAppStore.getState().chords.map((c) => c.id);

    const chordIdsAtCut: string[][] = [];
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {
      chordIdsAtCut.push(useAppStore.getState().chords.map((c) => c.id));
    });
    stopSource.mockClear();

    useAppStore.getState().play('chords');
    applyInstantVibeToStore(INSTANT_VIBES[1]);

    expect(chordIdsAtCut.length > 0).toBe(true);
    for (const ids of chordIdsAtCut) expect(ids).toEqual(oldIds);

    useAppStore.getState().hardStopAll();
    stopSource.mockRestore();
  });
});

import { SCALES, isNoteInScale } from '../utils/musicTheory';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';
import { isMeterId } from '../utils/meter';

describe('vibe scales', () => {
  test('every vibe scaleType is a real key of SCALES', () => {
    // This alone would have caught 'Pentatonic Major', which fell through to
    // Major for the whole life of the vibe.
    for (const vibe of INSTANT_VIBES) {
      expect(SCALES[vibe.scaleType]).toBeDefined();
    }
  });

  test('Zen Garden is G Hirajoshi and plays the bamboo vamp', () => {
    const zen = INSTANT_VIBES.find((v) => v.id === 'asian-zen')!;
    expect(zen.scaleRoot).toBe('G');
    expect(zen.scaleType).toBe('Hirajoshi');

    const resolved = resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi', 4);
    expect(zen.chords.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })))
      .toEqual(resolved.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })));
  });

  test('every note Zen Garden plays is inside G Hirajoshi', () => {
    const zen = INSTANT_VIBES.find((v) => v.id === 'asian-zen')!;
    for (const chord of zen.chords) {
      for (const note of chord.notes) {
        expect(isNoteInScale(note, 'G', 'Hirajoshi')).toBe(true);
      }
    }
  });
});

describe('vibe meters', () => {
  test('every vibe declares a real meter; the original six stay at 4/4, lofi-waltz is 3/4 and afro-six-eight is 6/8', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(isMeterId(vibe.meter), `${vibe.id} must declare a meter`).toBe(true);
      const expectedMeter = vibe.id === 'lofi-waltz' ? '3/4' : vibe.id === 'afro-six-eight' ? '6/8' : '4/4';
      expect(vibe.meter, `${vibe.id} meter`).toBe(expectedMeter);
    }
  });

  test('the eight vibe ids are unchanged — they are persisted in project files', () => {
    expect(INSTANT_VIBES.map((v) => v.id)).toEqual([
      'lofi-chill',
      'synthwave-80s',
      'cyber-dance',
      'ambient-chill',
      'hiphop-groove',
      'asian-zen',
      'lofi-waltz',
      'afro-six-eight',
    ]);
  });

  test('applying a vibe writes its meter into the transport', () => {
    useAppStore.getState().setMeter('7/8');
    applyInstantVibeToStore(INSTANT_VIBES[0]);
    expect(useAppStore.getState().meterId).toBe('4/4');
  });

  test('applying a vibe from a narrower meter still lands the transport meter and the drum grid correctly', () => {
    // End-state sanity check only — NOT an ordering pin. Starting from a
    // narrower meter, applying a vibe leaves the transport at the vibe's own
    // meter and the grid holding the vibe's authored hits. It cannot by
    // itself prove setMeter ran before applyDrumPattern: adaptStepRow
    // truncates a longer source row rather than stretching it, so
    // synthwave's kick step 12 — inside both a 14- and a 16-step window —
    // survives either call order (confirmed by manually swapping the two
    // calls: this assertion still passed). The real ordering pin is the
    // call-order recorder in the next test.
    useAppStore.getState().setMeter('7/8');
    applyInstantVibeToStore(INSTANT_VIBES[1]);
    const kick = useAppStore.getState().sequencerTracks.find((t) => t.instrument === 'kick')!;
    expect(useAppStore.getState().meterId).toBe('4/4');
    expect(kick.steps[12]).toBe(true);
  });

  test('setMeter runs before applyDrumPattern — the order the drum grid depends on', () => {
    // Order-pin via a call recorder (same technique as `focusSynthTarget` in
    // synthControl.test.ts), rather than relying on drum-cell data to expose
    // a reorder: applyDrumPattern (Task 9) reads the ACTIVE meter to decide
    // how to window the incoming rows, so if setMeter ran after it, the grid
    // would be adapted against the OUTGOING vibe's bar length. This directly
    // observes which of the two ran first, independent of any one vibe's
    // pattern shape.
    const order: string[] = [];
    const originals = {
      setMeter: useAppStore.getState().setMeter,
      applyDrumPattern: useAppStore.getState().applyDrumPattern,
    };
    useAppStore.setState({
      setMeter: (id) => {
        order.push('setMeter');
        originals.setMeter(id);
      },
      applyDrumPattern: (pattern) => {
        order.push('applyDrumPattern');
        originals.applyDrumPattern(pattern);
      },
    });

    try {
      applyInstantVibeToStore(INSTANT_VIBES[0]);
    } finally {
      useAppStore.setState({ setMeter: originals.setMeter, applyDrumPattern: originals.applyDrumPattern });
    }

    expect(order).toEqual(['setMeter', 'applyDrumPattern']);
  });

  test("each vibe's rhythm and bass pools stay inside its own meter", () => {
    // A vibe whose dice can land on a 4/4 pattern would silently adapt it every
    // reroll. Nothing forbids that at the type level; this is the guard.
    for (const v of INSTANT_VIBES) {
      for (const id of v.variation!.rhythmIds) {
        expect(RHYTHM_PATTERNS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
      for (const id of v.variation!.bassPatternIds) {
        expect(BASS_PATTERNS.find((p) => p.id === id)!.meter, `${v.id}/${id}`).toBe(v.meter);
      }
    }
  });
});
