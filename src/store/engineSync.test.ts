import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import {
  applyEngineSnapshot,
  EFFECT_KEYS_EXCEPT_DECAY,
  startEngineSync,
  stopEngineSync,
} from './engineSync';
import { getMeter } from '../utils/meter';
import type { MasterEffects, SynthParams } from '../types';
import { DEFAULT_FADER_DB, faderDbToGain } from './levelUnits';

// bun's parallel workers share module singletons (the store) across test
// files, so transport state can leak in from earlier files — normalize what
// these tests depend on.
beforeEach(() => {
  useAppStore.setState({
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    fxPlayer: 'stopped',
  });
});

afterEach(() => {
  stopEngineSync();
});

describe('engineSync', () => {
  test('fireImmediately bootstrap pushes the current state into the engine', () => {
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockClear();
    const setClockBpm = spyOn(audioEngine, 'setClockBpm').mockClear();
    startEngineSync();
    expect(setMasterVolume).toHaveBeenCalledWith(faderDbToGain(useAppStore.getState().masterVolume));
    expect(setClockBpm).toHaveBeenCalledWith(useAppStore.getState().bpm);
  });

  test('the master fader converts dB to linear gain at the boundary', () => {
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockClear();
    startEngineSync();
    useAppStore.getState().setMasterVolume(0);
    expect(setMasterVolume).toHaveBeenLastCalledWith(1);
    useAppStore.getState().setMasterVolume(-6);
    expect(setMasterVolume.mock.calls.at(-1)?.[0]).toBeCloseTo(0.5011872, 6);
    // The floor is TRUE silence, not dbToGain(-60)'s 0.001 (decision 11).
    useAppStore.getState().setMasterVolume(-60);
    expect(setMasterVolume.mock.calls.at(-1)?.[0]).toBe(0);
    // ...and one detent above it is quiet, not off.
    useAppStore.getState().setMasterVolume(-59.6);
    expect(setMasterVolume.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
    // The top of the range arrives intact — the engine ceiling is derived
    // from it now (Step 9), so nothing swallows the boost.
    useAppStore.getState().setMasterVolume(12);
    expect(setMasterVolume.mock.calls.at(-1)?.[0]).toBeCloseTo(3.9810717, 6);
  });

  test('store mutations flow one-way into the engine; teardown stops them', () => {
    const setClockBpm = spyOn(audioEngine, 'setClockBpm').mockClear();
    startEngineSync();
    useAppStore.getState().setBpm(130);
    expect(setClockBpm).toHaveBeenLastCalledWith(130);
    stopEngineSync();
    setClockBpm.mockClear();
    useAppStore.getState().setBpm(140);
    expect(setClockBpm).not.toHaveBeenCalled();
  });

  test('transport flags init on every transition, resetClock only on stopped -> playing', () => {
    // bun's spyOn calls through to the original by default, and real init()
    // needs window.AudioContext (absent in bun) — suppress it (same pattern as
    // store.test.ts:525); toHaveBeenCalled still verifies the transition.
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {}).mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();
    // stopped -> sequencer playing: init + clock reset
    useAppStore.getState().play('sequencer');
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalled();
    init.mockClear();
    resetClock.mockClear();
    // playing -> stopped: init called again (old toggles inited on every
    // transition; init()'s resume path restores a browser-suspended context),
    // but the clock never resets
    useAppStore.getState().hardStopAll();
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
    // start sequencer while chords already playing: init, no reset
    useAppStore.getState().play('chords');
    init.mockClear();
    resetClock.mockClear();
    useAppStore.getState().play('sequencer');
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
  });

  test('playAll from fully-stopped inits and resets the clock (0 -> 3)', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {}).mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();
    // Play All from stopped: both players start, engine inits, grid restarts
    useAppStore.getState().playAll();
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalled();
    // Stopping both: init still called (every transition), clock never resets
    init.mockClear();
    resetClock.mockClear();
    useAppStore.getState().hardStopAll();
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
  });

  test('a stopping player still counts as active, so the bar grid is never reset mid-flight', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {}).mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();

    useAppStore.getState().play('chords');
    expect(resetClock).toHaveBeenCalledTimes(1); // stopped -> active

    resetClock.mockClear();
    useAppStore.getState().softStop('chords');
    useAppStore.getState().play('sequencer');
    // Chords was 'stopping', i.e. still active, so this is NOT a
    // fully-stopped -> active transition and the grid must survive.
    expect(resetClock).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalled();

    useAppStore.getState().hardStopAll();
    resetClock.mockClear();
    useAppStore.getState().play('chords');
    expect(resetClock).toHaveBeenCalledTimes(1); // genuinely fully stopped
  });

  test('a respread effects object with unchanged values does not re-run updateEffects', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();

    // Any action that rebuilds the object without changing a value.
    useAppStore.setState((s) => ({ effects: { ...s.effects } }));

    expect(updateEffects).not.toHaveBeenCalled();
    updateEffects.mockRestore();
  });

  test('a real effects change still reaches the engine', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();

    useAppStore.setState((s) => ({ effects: { ...s.effects, reverbWet: 0.5 } }));

    expect(updateEffects).toHaveBeenCalledTimes(1);
    expect((updateEffects.mock.calls[0][0] as MasterEffects).reverbWet).toBe(0.5);
    updateEffects.mockRestore();
  });

  test('a respread synthParams object does not re-target live voices', () => {
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(() => {});
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({ synthParams: { ...s.synthParams } }));

    // updateSynthParams re-shapes every live voice; re-running it for no value
    // change cancels and re-plans their ramps for nothing.
    expect(updateSynthParams).not.toHaveBeenCalled();
    updateSynthParams.mockRestore();
  });

  test('a one-shot params change reaches the engine in the same tick', () => {
    // The coalescer is leading-edge on purpose: a preset load or a vibe apply
    // must NOT wait for an animation frame.
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({ synthParams: { ...s.synthParams, detune: 11 } }));

    expect(updateSynthParams).toHaveBeenCalledTimes(1);
    expect((updateSynthParams.mock.calls[0][0] as SynthParams).detune).toBe(11);
    expect(updateSynthParams.mock.calls[0][1]).toBe('synth');
    updateSynthParams.mockRestore();
  });

  test('one action touching three param sources applies all three immediately', () => {
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({
      synthParams: { ...s.synthParams, detune: 3 },
      chordSynthParams: { ...s.chordSynthParams, detune: 4 },
      bassSynthParams: { ...s.bassSynthParams, detune: 5 },
    }));

    expect(updateSynthParams.mock.calls.map((c) => c[1]).sort()).toEqual([
      'bass',
      'chord',
      'synth',
    ]);
    updateSynthParams.mockRestore();
  });

  test('a per-track drum level converts dB to linear gain at the boundary', () => {
    startEngineSync();
    const kick = useAppStore.getState().sequencerTracks[0];
    // Cleared AFTER startEngineSync's fireImmediately push (every factory
    // track starts at unity, DEV-386's own change) so each assertion below
    // is a genuine change, not a same-value no-op the equality-guarded
    // subscription would (correctly) suppress.
    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    // pushDrumTrackGains re-pushes every track on any change (see its own
    // comment in engineSync.ts), so kick's own call is found by instrument,
    // not by position.
    const callFor = (instrument: string) =>
      setDrumTrackGain.mock.calls.find((c) => c[0] === instrument) as [string, number];

    useAppStore.getState().setTrackVolume(kick.id, -6);
    expect(callFor(kick.instrument)[1]).toBeCloseTo(0.5011872, 6);

    setDrumTrackGain.mockClear();
    useAppStore.getState().setTrackVolume(kick.id, 0);
    expect(callFor(kick.instrument)[1]).toBeCloseTo(1, 6);
  });

  test('a voice whose track disappears is reset to unity, not left attenuated', () => {
    // The engine's drumTrackGains map outlives any one roster. Pull hitom
    // down, then swap in a roster that has no hitom track at all — reachable
    // from a loop switch or a sanitized import — and the vanished track's
    // attenuation must not survive on the pad.
    startEngineSync();
    const tracks = useAppStore.getState().sequencerTracks;
    const hitom = tracks.find((t) => t.instrument === 'hitom')!;
    useAppStore.getState().setTrackVolume(hitom.id, -30);

    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    useAppStore.setState({ sequencerTracks: tracks.filter((t) => t.instrument !== 'hitom') });

    const call = setDrumTrackGain.mock.calls.find((c) => c[0] === 'hitom') as [string, number];
    expect(call).toBeDefined();
    expect(call[1]).toBeCloseTo(1, 6);
  });

  test('an unrelated store write does not re-push the track gains', () => {
    startEngineSync();
    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    useAppStore.getState().setBpm(131);
    expect(setDrumTrackGain).not.toHaveBeenCalled();
  });
});

describe('engineSync meter bridge', () => {
  test('fireImmediately pushes the current meter into the engine at startup', () => {
    useAppStore.setState({ meterId: '4/4' });
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    startEngineSync();
    expect(setMeter).toHaveBeenCalledWith(getMeter('4/4'));
  });

  test('a meter change flows one-way into the engine; teardown stops it', () => {
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    startEngineSync();
    useAppStore.getState().setMeter('6/8');
    const meter6_8 = getMeter('6/8');
    expect(setMeter).toHaveBeenLastCalledWith(meter6_8);
    expect(meter6_8.stepsPerBar).toBe(12);
    expect(meter6_8.accentGroups).toEqual([6, 6]);

    stopEngineSync();
    setMeter.mockClear();
    useAppStore.getState().setMeter('3/4');
    expect(setMeter).not.toHaveBeenCalled();
    useAppStore.getState().setMeter('4/4');
  });

  test('applyEngineSnapshot re-applies the meter after the AudioContext exists', () => {
    useAppStore.setState({ meterId: '5/4' });
    const setMeter = spyOn(audioEngine, 'setMeter').mockClear();
    applyEngineSnapshot();
    expect(setMeter).toHaveBeenCalledWith(getMeter('5/4'));
    useAppStore.setState({ meterId: '4/4' });
  });

  test('applyEngineSnapshot re-applies the pad bus gain and mute after the AudioContext exists', () => {
    useAppStore.setState({ padVolume: 0.75, padMuted: true });
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    applyEngineSnapshot();
    expect(setSourceGain).toHaveBeenCalledWith('pad', faderDbToGain(0.75));
    expect(setSourceMuted).toHaveBeenCalledWith('pad', true);
    useAppStore.setState({ padVolume: DEFAULT_FADER_DB, padMuted: false });
  });

  // Must-fix 3 (snapshot path): applySliceState converts EVERY bus, not just
  // pad. Deleting the faderDbToGain wrap for any one of the other four used
  // to leave the whole suite green — an un-converted -6 dB bus would reach
  // setSourceGain as -6, which the engine clamp floors to 0 (silence).
  test('applyEngineSnapshot converts every bus fader from dB to linear gain', () => {
    useAppStore.setState({
      synthVolume: -6,
      chordVolume: -60,
      bassVolume: 3,
      padVolume: -12,
      masterSequencerVolume: 12,
    });
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    applyEngineSnapshot();
    expect(setSourceGain).toHaveBeenCalledWith('synth', faderDbToGain(-6));
    expect(setSourceGain).toHaveBeenCalledWith('chord', faderDbToGain(-60));
    expect(setSourceGain).toHaveBeenCalledWith('bass', faderDbToGain(3));
    expect(setSourceGain).toHaveBeenCalledWith('pad', faderDbToGain(-12));
    expect(setSourceGain).toHaveBeenCalledWith('sequencer', faderDbToGain(12));
    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
      padVolume: DEFAULT_FADER_DB,
      masterSequencerVolume: DEFAULT_FADER_DB,
    });
  });

  // The knob path, not the bus path. Without this subscription a filter/detune
  // drag with the Synth view's Target set to Pad reshapes nothing that is
  // already sounding — and a drone holds for a whole loop pass, so the knob
  // looks dead for seconds at a time while chord and bass reshape instantly.
  test('padSynthParams reaches updateSynthParams, in the snapshot and live', () => {
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockClear();
    applyEngineSnapshot();
    expect(updateSynthParams).toHaveBeenCalledWith(
      useAppStore.getState().padSynthParams,
      'pad',
    );

    updateSynthParams.mockClear();
    startEngineSync();
    const next = { ...useAppStore.getState().padSynthParams, filterCutoff: 3210 };
    useAppStore.getState().setPadSynthParams(next);
    expect(updateSynthParams).toHaveBeenCalledWith(next, 'pad');
  });

  test('the pad bus is bootstrapped and then tracks the store', () => {
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();

    // fireImmediately: the current value is pushed at subscribe time.
    expect(setSourceGain).toHaveBeenCalledWith('pad', faderDbToGain(useAppStore.getState().padVolume));
    expect(setSourceMuted).toHaveBeenCalledWith('pad', useAppStore.getState().padMuted);

    useAppStore.getState().setPadVolume(0.42);
    expect(setSourceGain).toHaveBeenLastCalledWith('pad', faderDbToGain(0.42));

    const before = useAppStore.getState().padMuted;
    useAppStore.getState().togglePadMuted();
    expect(setSourceMuted).toHaveBeenLastCalledWith('pad', !before);
    useAppStore.getState().togglePadMuted();
  });

  test('a reverbDecay drag does not re-run updateEffects', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    const setReverbDecay = spyOn(audioEngine, 'setReverbDecay').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();
    setReverbDecay.mockClear();

    for (const d of [2.1, 2.2, 2.3, 2.4]) {
      useAppStore.setState((s) => ({ effects: { ...s.effects, reverbDecay: d } }));
    }

    // Decay is committed on a trailing timer, and the wet-path listener must
    // not fire at all for a decay-only change.
    expect(updateEffects).not.toHaveBeenCalled();
    expect(setReverbDecay).not.toHaveBeenCalled();
    updateEffects.mockRestore();
    setReverbDecay.mockRestore();
  });

  test('applyEngineSnapshot applies the decay directly, bypassing the debounce', () => {
    const setReverbDecay = spyOn(audioEngine, 'setReverbDecay').mockImplementation(() => {});
    useAppStore.setState((s) => ({ effects: { ...s.effects, reverbDecay: 3.3 } }));
    setReverbDecay.mockClear();

    applyEngineSnapshot();

    expect(setReverbDecay).toHaveBeenCalledWith(3.3);
    setReverbDecay.mockRestore();
  });

  // Must-fix 3 (subscription path) + reshaped per review: seeding the store
  // BEFORE startEngineSync() exercises the fireImmediately bootstrap itself
  // (nothing else in this file does), rather than a warm-up write whose only
  // job was to make the next write fire.
  test('the fireImmediately bootstrap converts every bus fader from dB to linear gain', () => {
    useAppStore.setState({
      synthVolume: -3,
      chordVolume: -60,
      bassVolume: 6,
      padVolume: -12,
      masterSequencerVolume: 12,
    });
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    startEngineSync();
    expect(setSourceGain).toHaveBeenCalledWith('synth', faderDbToGain(-3));
    // The bottom of the fader is TRUE silence, not 0.001 (decision 11).
    expect(setSourceGain).toHaveBeenCalledWith('chord', 0);
    expect(setSourceGain).toHaveBeenCalledWith('bass', faderDbToGain(6));
    expect(setSourceGain).toHaveBeenCalledWith('pad', faderDbToGain(-12));
    // The top arrives intact: the engine ceiling is derived from it (Step 10).
    expect(setSourceGain).toHaveBeenCalledWith('sequencer', faderDbToGain(12));

    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
      padVolume: DEFAULT_FADER_DB,
      masterSequencerVolume: DEFAULT_FADER_DB,
    });
  });

  // Optional-1 (bass on the subscription path was the one bus whose live
  // conversion could be deleted with the suite green: pad's live edit is
  // covered by 'the pad bus is bootstrapped and then tracks the store'
  // above, synth/chord/sequencer by the bootstrap test's neighbours below.
  test('each bus fader tracks a live edit, converted to linear gain', () => {
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    startEngineSync();

    useAppStore.getState().setSynthVolume(-6);
    const [source, gain] = setSourceGain.mock.calls.at(-1) as [string, number];
    expect(source).toBe('synth');
    expect(gain).toBeCloseTo(0.5011872, 6);
    useAppStore.getState().setSynthVolume(0);
    expect(setSourceGain).toHaveBeenLastCalledWith('synth', 1);

    useAppStore.getState().setChordVolume(-60);
    expect((setSourceGain.mock.calls.at(-1) as [string, number])[1]).toBe(0);

    useAppStore.getState().setBassVolume(-6);
    expect(setSourceGain.mock.calls.at(-1)).toEqual(['bass', faderDbToGain(-6)]);

    useAppStore.getState().setMasterSequencerVolume(12);
    expect((setSourceGain.mock.calls.at(-1) as [string, number])[1]).toBeCloseTo(3.9810717, 6);

    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
      masterSequencerVolume: DEFAULT_FADER_DB,
    });
  });

  // DEV-387 shipped this as four setPresetTrim calls in the snapshot path plus
  // one per synth-params subscription, and these tests asserted each of those
  // calls. The trim is derived from `params.preset` inside triggerSynthNoteOn
  // now, so there is nothing left to push and nothing that can lag the params
  // it belongs to. What the store side still owes is the NEGATIVE: it must
  // never write the calibration override, because that override is consulted
  // BEFORE the derivation and a store-side write to it would pin a source at a
  // trim its patch does not have — the exact staleness the five pushes existed
  // to chase. The level itself is asserted where it is audible, in
  // engine.test.ts ("a voice's peak gain carries its own preset's calibration
  // trim") and presetPreview.test.ts.
  test('neither the snapshot nor a preset change writes the calibration trim override', () => {
    const setPresetTrim = spyOn(audioEngine, 'setPresetTrim').mockClear();

    applyEngineSnapshot();
    expect(setPresetTrim).not.toHaveBeenCalled();

    startEngineSync();
    const s = useAppStore.getState();
    useAppStore.getState().setSynthParams({ ...s.synthParams, preset: 'Some Other Patch' });
    useAppStore.getState().setChordSynthParams({ ...s.chordSynthParams, preset: 'Some Other Patch' });
    useAppStore.getState().setBassSynthParams({ ...s.bassSynthParams, preset: 'Some Other Patch' });
    useAppStore.getState().setPadSynthParams({ ...s.padSynthParams, preset: 'Some Other Patch' });
    expect(setPresetTrim).not.toHaveBeenCalled();

    useAppStore.setState({
      synthParams: s.synthParams,
      chordSynthParams: s.chordSynthParams,
      bassSynthParams: s.bassSynthParams,
      padSynthParams: s.padSynthParams,
    });
  });
});

describe('EFFECT_KEYS_EXCEPT_DECAY', () => {
  test('covers every MasterEffects field except reverbDecay', () => {
    // The effects subscription compares on this list. A field missing from it
    // is a knob the engine never hears — the subscription's equalityFn calls
    // the two objects equal and the listener never runs. Pinned as a literal
    // because the optional *Bypass keys are absent from INITIAL_EFFECTS and so
    // cannot be derived from it.
    expect([...EFFECT_KEYS_EXCEPT_DECAY].sort()).toEqual([
      'compressorAttack',
      'compressorEnabled',
      'compressorRatio',
      'compressorRelease',
      'compressorThreshold',
      'delayBypass',
      'delayFeedback',
      'delayWet',
      'distortionBypass',
      'distortionWet',
      'eqBypass',
      'eqHigh',
      'eqLow',
      'eqMid',
      'limiterAttack',
      'limiterEnabled',
      'limiterRatio',
      'limiterRelease',
      'limiterThreshold',
      'reverbBypass',
      'reverbWet',
    ]);
  });
});

/**
 * The value setSourceMuted was last called with for one engine source, scanned
 * across the spy's whole call history rather than only calls "since the last
 * mockClear". A bus whose audibility never flips within a scenario is, by
 * design, never re-pushed after its fireImmediately bootstrap (the mute
 * subscription's default `Object.is` equality only fires on a real flip), so
 * a call-history assertion for that bus would demand a redundant engine call
 * the implementation correctly never makes. What the feature promises is the
 * RESULTING engine state, not that a call happened — so read the last value
 * pushed for the source instead; for a bus that never re-fired, that is
 * exactly the bootstrap value, which is still the true current engine state.
 *
 * Throws rather than returning `undefined` for a source the spy was never
 * called with at all: a future `.toBeFalsy()` on the result must not read
 * "the engine was never told anything about this source" as a passing
 * assertion, so a never-pushed source fails loudly instead of quietly.
 */
function lastMutedFor(calls: readonly unknown[][], source: string): boolean {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i][0] === source) return calls[i][1] as boolean;
  }
  throw new Error(`setSourceMuted was never called with source '${source}'`);
}

describe('track solo reaches the engine as bus audibility', () => {
  afterEach(() => {
    useAppStore.setState({
      soloTracks: [],
      synthMuted: false,
      chordMuted: false,
      bassMuted: false,
      padMuted: false,
      drumMuted: false,
    });
  });

  test('soloing drums silences the four melodic buses and keeps the drum bus open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    setSourceMuted.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(setSourceMuted).toHaveBeenCalledWith('synth', true);
    expect(setSourceMuted).toHaveBeenCalledWith('chord', true);
    expect(setSourceMuted).toHaveBeenCalledWith('bass', true);
    expect(setSourceMuted).toHaveBeenCalledWith('pad', true);
    expect(setSourceMuted).not.toHaveBeenCalledWith('sequencer', true);
  });

  test('solo beats mute: a muted bus opens when it is soloed', () => {
    useAppStore.setState({ soloTracks: [], drumMuted: true });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    setSourceMuted.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(setSourceMuted).toHaveBeenCalledWith('sequencer', false);
  });

  test('solo is additive: drums + lead leaves both buses open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();

    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('lead');
    setSourceMuted.mockClear();
    applyEngineSnapshot();

    expect(setSourceMuted).toHaveBeenCalledWith('sequencer', false);
    expect(setSourceMuted).toHaveBeenCalledWith('synth', false);
    expect(setSourceMuted).toHaveBeenCalledWith('chord', true);
    expect(setSourceMuted).toHaveBeenCalledWith('bass', true);
    expect(setSourceMuted).toHaveBeenCalledWith('pad', true);
  });

  test('soloing overrides mute in both directions, and clearing hands every bus back to its own mute flag', () => {
    // Covers both axes in one journey: while the solo is active every
    // non-soloed bus must be muted regardless of its own mute flag — bass in
    // particular has bassMuted: false, so a solo-blind implementation (one
    // that selects the raw mute flag and never consults soloTracks) would
    // leave it audible here. That is the assertion the old, weaker version of
    // this test did not make: with only the post-clear state asserted, the
    // fireImmediately bootstrap alone satisfied it and solo never had to
    // reach the engine at all.
    useAppStore.setState({ soloTracks: [], chordMuted: true });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    useAppStore.getState().toggleSoloTrack('drums');

    // While the solo is active: only the soloed bus (sequencer, drums' engine
    // name) is audible. synth and pad are muted despite their own mute flags
    // being false, and bass — the flag-false case that a solo-blind
    // implementation gets wrong — must be muted too.
    expect(lastMutedFor(setSourceMuted.mock.calls, 'synth')).toBe(true);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'chord')).toBe(true);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'bass')).toBe(true);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'pad')).toBe(true);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'sequencer')).toBe(false);

    useAppStore.getState().clearSoloTracks();

    // After clearing: every bus reads back exactly what its own mute flag
    // implies, chord included (chordMuted: true survives the whole journey).
    expect(lastMutedFor(setSourceMuted.mock.calls, 'synth')).toBe(false);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'chord')).toBe(true);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'bass')).toBe(false);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'pad')).toBe(false);
    expect(lastMutedFor(setSourceMuted.mock.calls, 'sequencer')).toBe(false);
  });

  test('the snapshot pass and the subscriptions push the same audibility for the same state', () => {
    // Exercises both consumers over one unchanged state: startEngineSync's
    // fireImmediately bootstrap (the subscription path) first, then
    // applyEngineSnapshot (the applySliceState path) second, with the state
    // held fixed in between. Diverse mute flags plus a solo make the two
    // paths distinguishable — a revert of either consumer back to reading the
    // raw mute flag instead of busAudible would make its per-source values
    // disagree with the other's.
    const sources = ['synth', 'chord', 'bass', 'pad', 'sequencer'] as const;
    useAppStore.setState({
      soloTracks: ['pad'],
      synthMuted: false,
      chordMuted: true,
      bassMuted: false,
      padMuted: true,
      drumMuted: false,
    });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();

    startEngineSync();
    const fromSubscriptions = sources.map((s) => lastMutedFor(setSourceMuted.mock.calls, s));

    setSourceMuted.mockClear();
    applyEngineSnapshot();
    const fromSnapshot = sources.map((s) => lastMutedFor(setSourceMuted.mock.calls, s));

    expect(fromSnapshot).toEqual(fromSubscriptions);
    // Pinned so a bug that happens to agree on both paths (e.g. solo ignored
    // by both) is still caught: pad is soloed and audible despite padMuted,
    // synth is muted despite synthMuted: false.
    expect(fromSnapshot).toEqual([true, true, true, false, true]);
  });

  // Cross-layer regression guard, not coverage of this module: it exercises
  // no engineSync.ts code, and no change to that file could make it fail. It
  // guards the boundary between the bus-audibility layer here and the
  // per-voice drum mute layer in useSequencerPlayback.ts, so it stays even
  // though it is off-target for engineSync.ts itself.
  test('solo leaves the per-voice drum mute layer untouched', () => {
    const before = useAppStore.getState().sequencerTracks.map((t) => t.muted);
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().sequencerTracks.map((t) => t.muted)).toEqual(before);
  });
});
