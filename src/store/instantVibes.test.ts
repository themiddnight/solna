import { describe, test, expect, spyOn } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { INSTANT_VIBES, applyInstantVibeToStore } from './instantVibes';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { FACTORY_PRESETS } from '../audio/synthPresets';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { useAppStore } from './store';

describe('Instant Vibes Mode', () => {
  test('contains all 6 curated genre vibes with complete presets and feel settings', () => {
    expect(INSTANT_VIBES.length).toBe(6);

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
      expect(Boolean(vibe.chordPresetName)).toBe(true);

      // Bass & Feel
      expect(Boolean(vibe.bassPatternId)).toBe(true);
      // Ensure bass pattern exists in registry
      const bassExists = BASS_PATTERNS.some((p) => p.id === vibe.bassPatternId);
      expect(bassExists).toBe(true);

      expect(vibe.bassFeel >= 0 && vibe.bassFeel <= 1).toBe(true);
      expect(Boolean(vibe.bassPresetName)).toBe(true);

      // Synth Preset & Master Effects
      expect(Boolean(vibe.synthPresetName)).toBe(true);
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
    expect(state.chordSynthParams.preset).toBe(lofiVibe.chordPresetName);
    expect(state.bassPatternId).toBe(lofiVibe.bassPatternId);
    expect(state.bassFeel).toBe(lofiVibe.bassFeel);
    expect(state.bassSynthParams.preset).toBe(lofiVibe.bassPresetName);
    expect(state.synthParams.preset).toBe(lofiVibe.synthPresetName);
  });

  test('applyInstantVibeToStore actually rewrites the sequencer track steps to match the vibe drum pattern', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const tracks = useAppStore.getState().sequencerTracks;
    for (const track of tracks) {
      const vibeSteps = synthwave.drumPattern[track.instrument];
      expect(Boolean(vibeSteps)).toBe(true);
      expect(track.steps).toEqual(vibeSteps.map((v) => v === 1));
    }
  });

  test('applies synthwave vibe with tight feel and active arpeggiator', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    expect(state.synthParams.arpActive).toBe(true);
    expect(state.synthParams.arpMode).toBe('updown');
  });
});

describe('vibe preset name resolution', () => {
  const factoryNames = new Set(FACTORY_PRESETS.map((p) => p.name));
  const factoryBassNames = new Set(FACTORY_BASS_PRESETS.map((p) => p.name));

  test('every vibe synth and chord preset name resolves to a factory preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(factoryNames.has(vibe.synthPresetName)).toBe(true);
      expect(factoryNames.has(vibe.chordPresetName)).toBe(true);
    }
  });

  test('every vibe bass preset name resolves to a factory bass preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(factoryBassNames.has(vibe.bassPresetName)).toBe(true);
    }
  });

  test('loading a vibe leaves the preset select pointing at a real preset', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s');
    applyInstantVibeToStore(synthwave!);
    const state = useAppStore.getState();
    expect(factoryNames.has(state.synthParams.preset)).toBe(true);
    expect(factoryNames.has(state.chordSynthParams.preset)).toBe(true);
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
