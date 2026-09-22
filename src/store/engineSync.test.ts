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
import type { MasterEffects } from '../types';
import type { ActiveSynth } from '../types/synth';
import { SOURCE_BUSES } from './sourceBuses';

/**
 * `base` with one nested DSP field moved. Cutoff is the field these tests
 * reach for because it is continuous, is applied to sounding voices, and is
 * nowhere near the `common` block the topology rules read — so a change here
 * is unambiguously "an ordinary knob moved".
 */
function withCutoff(base: ActiveSynth, cutoffHz: number): ActiveSynth {
  return {
    ...base,
    patch: {
      ...base.patch,
      synth: { ...base.patch.synth, filter: { ...base.patch.synth.filter, cutoffHz } },
    },
  };
}
import { DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB, faderDbToGain } from './levelUnits';

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

describe('engineSync: bootstrap and transport transitions', () => {
  test('a fully stopped restart settles every current source bus before resetting the clock', () => {
    const events: string[] = [];
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {});
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockImplementation((source, _state, _time, mode) => {
      events.push(`source:${source}:${mode}`);
    });
    const resetClock = spyOn(audioEngine, 'resetClock').mockImplementation(() => {
      events.push('resetClock');
    });
    startEngineSync();
    events.length = 0;

    useAppStore.getState().play('sequencer');

    expect(events).toEqual([
      ...SOURCE_BUSES.map((bus) => `source:${bus.source}:settle`),
      'resetClock',
    ]);
    init.mockRestore();
    setSourceState.mockRestore();
    resetClock.mockRestore();
  });

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

});

describe('engineSync: transport and effects pushes', () => {
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

});

describe('engineSync: synth params and drum levels', () => {
  test('a one-shot patch change reaches the engine in the same tick', () => {
    // The coalescer is leading-edge on purpose: a preset load or a vibe apply
    // must NOT wait for an animation frame.
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthPatch.mockClear();

    useAppStore.setState((s) => ({ synthParams: withCutoff(s.synthParams, 1111) }));

    expect(updateSynthPatch).toHaveBeenCalledTimes(1);
    const [previous, next, source] = updateSynthPatch.mock.calls[0] as [ActiveSynth, ActiveSynth, string];
    expect(next.patch.synth.filter.cutoffHz).toBe(1111);
    expect(source).toBe('synth');
    // The engine is told what the patch WAS as well, so it can apply only the
    // controls that actually moved.
    expect(previous.patch.synth.filter.cutoffHz).not.toBe(1111);
    updateSynthPatch.mockRestore();
  });

  test('changing only Arp never touches the DSP', () => {
    // Arp is performance state consumed by the Arp player. A toggle that
    // reached updateSynthPatch would cancel and re-plan the ramps of every
    // voice sounding on the bus for a value no voice reads.
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockImplementation(() => {});
    startEngineSync();
    updateSynthPatch.mockClear();

    const arp = useAppStore.getState().synthArpSettings;
    useAppStore.getState().setSynthArpSettings({ ...arp, active: !arp.active });

    expect(updateSynthPatch).not.toHaveBeenCalled();
    useAppStore.getState().setSynthArpSettings(arp);
    updateSynthPatch.mockRestore();
  });

  test('one action touching three patch sources applies all three immediately', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthPatch.mockClear();

    useAppStore.setState((s) => ({
      synthParams: withCutoff(s.synthParams, 301),
      chordSynthParams: withCutoff(s.chordSynthParams, 302),
      bassSynthParams: withCutoff(s.bassSynthParams, 303),
    }));

    expect(updateSynthPatch.mock.calls.map((c) => c[2]).sort()).toEqual([
      'bass',
      'chord',
      'synth',
    ]);
    updateSynthPatch.mockRestore();
  });

  test('a per-voice Beat level converts dB to linear gain at the boundary', () => {
    startEngineSync();
    // Cleared AFTER startEngineSync's fireImmediately push (every voice starts
    // at unity) so each assertion below is a genuine change, not a same-value
    // no-op the equality-guarded subscription would (correctly) suppress.
    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    // The push re-sends every voice on any change, so kick's own call is found
    // by voice, not by position.
    const callFor = (voice: string) =>
      setDrumTrackGain.mock.calls.find((c) => c[0] === voice) as [string, number];

    useAppStore.getState().setBeatVoiceLevel('kick', -6);
    expect(callFor('kick')[1]).toBeCloseTo(0.5011872, 6);

    setDrumTrackGain.mockClear();
    useAppStore.getState().setBeatVoiceLevel('kick', 0);
    expect(callFor('kick')[1]).toBeCloseTo(1, 6);
  });

  /**
   * One mute decision, expressed in two places that must agree: the engine
   * voice gain here and the scheduled hit `planBeatStep` skips. A muted
   * voice therefore builds no voice AND would be silent if one were built —
   * never a fader value the pads would still play through.
   */
  test('a muted Beat voice reaches the engine as a gain of 0, not as its fader value', () => {
    useAppStore.getState().setBeatVoiceLevel('snare', 0);
    startEngineSync();
    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    const callFor = (voice: string) =>
      setDrumTrackGain.mock.calls.find((c) => c[0] === voice) as [string, number];

    useAppStore.getState().toggleBeatVoiceMuted('snare');
    expect(callFor('snare')[1]).toBe(0);

    setDrumTrackGain.mockClear();
    useAppStore.getState().toggleBeatVoiceMuted('snare');
    expect(callFor('snare')[1]).toBeCloseTo(1, 6);
  });

  test('an unrelated store write does not re-push the voice gains', () => {
    startEngineSync();
    const setDrumTrackGain = spyOn(audioEngine, 'setDrumTrackGain').mockClear();
    useAppStore.getState().setBpm(131);
    expect(setDrumTrackGain).not.toHaveBeenCalled();
  });

});

describe('engineSync: the Beat instrument', () => {
  afterEach(() => {
    useAppStore.getState().setBeatPreset('retro-drive');
  });

  test('the bootstrap installs the loop`s own Beat Params — voices, trim and filter', () => {
    const setDrumKit = spyOn(audioEngine, 'setDrumKit').mockClear();
    const setBeatFilter = spyOn(audioEngine, 'setBeatFilter').mockClear();
    startEngineSync();

    const params = useAppStore.getState().beatParams;
    expect(setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
    // `undefined` for the time: a live push means "now", and only the offline
    // render's pass boundary supplies one.
    expect(setBeatFilter).toHaveBeenCalledWith(
      params.filter.cutoff, params.filter.resonance, params.filter.type, undefined,
    );
    setDrumKit.mockRestore();
    setBeatFilter.mockRestore();
  });

  /**
   * A vibe, a preset pick and a committed knob release all land here: they
   * write `beatParams` and nothing else, so this subscription is the ONLY
   * thing that makes the kit a user picked the kit a user hears.
   */
  test('a committed params change reaches the engine', () => {
    startEngineSync();
    const setDrumKit = spyOn(audioEngine, 'setDrumKit').mockClear();

    useAppStore.getState().setBeatPreset('lo-fi-vinyl');

    const params = useAppStore.getState().beatParams;
    expect(setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
    setDrumKit.mockRestore();
  });

  test('applyEngineSnapshot re-applies the Beat Params after the AudioContext exists', () => {
    startEngineSync();
    useAppStore.getState().setBeatPreset('lo-fi-vinyl');
    const setDrumKit = spyOn(audioEngine, 'setDrumKit').mockClear();

    applyEngineSnapshot();

    const params = useAppStore.getState().beatParams;
    expect(setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
    setDrumKit.mockRestore();
  });

  test('the Beat bus fader and mute read beatMix, not a flat field', () => {
    startEngineSync();
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();

    useAppStore.getState().setBeatLevel(-12);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').gain).toBeCloseTo(faderDbToGain(-12), 6);

    useAppStore.getState().toggleBeatMuted();
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').muted).toBe(true);

    useAppStore.getState().toggleBeatMuted();
    useAppStore.getState().setBeatLevel(DEFAULT_BUS_TRIM_DB);
    setSourceState.mockRestore();
  });
});

describe('engineSync meter bridge: the meter and the snapshot', () => {
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

  test('applyEngineSnapshot re-applies the complete pad bus state after the AudioContext exists', () => {
    useAppStore.setState({ padVolume: 0.75, padMuted: true });
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    applyEngineSnapshot();
    expect(setSourceState).toHaveBeenCalledWith(
      'pad', { gain: faderDbToGain(0.75), muted: true }, undefined, 'settle',
    );
    useAppStore.setState({ padVolume: DEFAULT_FADER_DB, padMuted: false });
  });

  // Must-fix 3 (snapshot path): applySliceState converts EVERY bus, not just
  // pad. Deleting the faderDbToGain wrap for any one of the other four used
  // to leave the whole suite green — an un-converted -6 dB bus would reach
  // setSourceGain as -6, which the engine clamp floors to 0 (silence).

});

describe('engineSync source-bus atomicity', () => {
  test('applyEngineSnapshot settles each source bus atomically', () => {
    useAppStore.setState({
      soloTracks: [],
      synthMuted: false,
      chordMuted: false,
      bassMuted: false,
      padMuted: false,
    });
    setBeatBusMuted(false);
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();

    applyEngineSnapshot();

    expect(setSourceState.mock.calls).toEqual(SOURCE_BUSES.map((bus) => [
      bus.source,
      {
        gain: faderDbToGain(bus.selectLevelDb(useAppStore.getState())),
        muted: false,
      },
      undefined,
      'settle',
    ]));
    expect(setSourceGain).not.toHaveBeenCalled();
    expect(setSourceMuted).not.toHaveBeenCalled();
    setSourceState.mockRestore();
    setSourceGain.mockRestore();
    setSourceMuted.mockRestore();
  });

  test('a combined fader and mute edit sends the latest source state in one transition', () => {
    startEngineSync();
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    const setSourceGain = spyOn(audioEngine, 'setSourceGain').mockClear();
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();

    useAppStore.setState({ padVolume: -12, padMuted: true });

    expect(setSourceState.mock.calls).toEqual([
      ['pad', { gain: faderDbToGain(-12), muted: true }, undefined, 'transition'],
    ]);
    expect(setSourceGain).not.toHaveBeenCalled();
    expect(setSourceMuted).not.toHaveBeenCalled();
    useAppStore.setState({ padVolume: DEFAULT_FADER_DB, padMuted: false });
    setSourceState.mockRestore();
    setSourceGain.mockRestore();
    setSourceMuted.mockRestore();
  });
});

describe('engineSync meter bridge: effects debounce and bus faders', () => {
  test('applyEngineSnapshot converts every bus fader from dB to linear gain', () => {
    useAppStore.setState({
      synthVolume: -6,
      chordVolume: -60,
      bassVolume: 3,
      padVolume: -12,
    });
    useAppStore.getState().setBeatLevel(12);
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    applyEngineSnapshot();
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').gain).toBe(faderDbToGain(-6));
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').gain).toBe(0);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').gain).toBe(faderDbToGain(3));
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').gain).toBe(faderDbToGain(-12));
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').gain).toBe(faderDbToGain(12));
    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
      padVolume: DEFAULT_FADER_DB,
    });
    useAppStore.getState().setBeatLevel(DEFAULT_BUS_TRIM_DB);
  });

  // The knob path, not the bus path. Without this subscription a filter/detune
  // drag with the Synth view's Target set to Pad reshapes nothing that is
  // already sounding — and a drone holds for a whole loop pass, so the knob
  // looks dead for seconds at a time while chord and bass reshape instantly.

  test('padSynthParams reaches updateSynthPatch, in the snapshot and live', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    applyEngineSnapshot();
    const padCall = updateSynthPatch.mock.calls.find((c) => c[2] === 'pad') as [ActiveSynth, ActiveSynth, string];
    expect(padCall[1]).toBe(useAppStore.getState().padSynthParams);

    updateSynthPatch.mockClear();
    startEngineSync();
    const next = withCutoff(useAppStore.getState().padSynthParams, 3210);
    useAppStore.getState().setPadSynthParams(next);
    const live = updateSynthPatch.mock.calls.at(-1) as [ActiveSynth, ActiveSynth, string];
    expect(live[1]).toBe(next);
    expect(live[2]).toBe('pad');
  });

  test('the pad bus is bootstrapped and then tracks the store', () => {
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();

    // fireImmediately: the current value is pushed at subscribe time.
    expect(setSourceState).toHaveBeenCalledWith(
      'pad',
      { gain: faderDbToGain(useAppStore.getState().padVolume), muted: useAppStore.getState().padMuted },
      undefined,
      'transition',
    );

    useAppStore.getState().setPadVolume(0.42);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').gain).toBe(faderDbToGain(0.42));

    const before = useAppStore.getState().padMuted;
    useAppStore.getState().togglePadMuted();
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').muted).toBe(!before);
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

});

describe('engineSync meter bridge: every bus fader from dB to gain', () => {
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
    });
    useAppStore.getState().setBeatLevel(12);
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').gain).toBe(faderDbToGain(-3));
    // The bottom of the fader is TRUE silence, not 0.001 (decision 11).
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').gain).toBe(0);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').gain).toBe(faderDbToGain(6));
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').gain).toBe(faderDbToGain(-12));
    // The top arrives intact: the engine ceiling is derived from it (Step 10).
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').gain).toBe(faderDbToGain(12));

    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
      padVolume: DEFAULT_FADER_DB,
    });
    useAppStore.getState().setBeatLevel(DEFAULT_BUS_TRIM_DB);
  });

  // Optional-1 (bass on the subscription path was the one bus whose live
  // conversion could be deleted with the suite green: pad's live edit is
  // covered by 'the pad bus is bootstrapped and then tracks the store'
  // above, synth/chord/sequencer by the bootstrap test's neighbours below.

  test('each bus fader tracks a live edit, converted to linear gain', () => {
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();

    useAppStore.getState().setSynthVolume(-6);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').gain).toBeCloseTo(0.5011872, 6);
    useAppStore.getState().setSynthVolume(0);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').gain).toBe(1);

    useAppStore.getState().setChordVolume(-60);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').gain).toBe(0);

    useAppStore.getState().setBassVolume(-6);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').gain).toBe(faderDbToGain(-6));

    useAppStore.getState().setBeatLevel(12);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').gain).toBe(faderDbToGain(12));

    useAppStore.setState({
      synthVolume: DEFAULT_FADER_DB,
      chordVolume: DEFAULT_FADER_DB,
      bassVolume: DEFAULT_FADER_DB,
    });
    useAppStore.getState().setBeatLevel(DEFAULT_BUS_TRIM_DB);
  });

  // DEV-387 shipped this as four setPresetTrim calls in the snapshot path plus
  // one per synth-params subscription, and a test here asserted each of those
  // calls. A patch carries its own `common.outputGainDb` now, so there is
  // nothing left to push and nothing that can lag the patch it belongs to.
  //
  // A test asserting the store never writes the calibration trim override stood
  // here after that. It is gone with the override itself: `setPresetTrim` is no
  // longer on `AudioEngine`, so "the store must not call it" is a sentence the
  // compiler now enforces, and a spy on a method that does not exist is a test
  // that can only ever pass.

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
 * The source state last sent for one engine source, scanned
 * across the spy's whole call history rather than only calls "since the last
 * mockClear". A bus whose gain and effective mute stay unchanged within a
 * scenario is never re-pushed after its fireImmediately bootstrap: the atomic
 * source-state subscription compares both fields with `sourceStateEqual`, so
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
function lastSourceStateFor(
  calls: readonly unknown[][],
  source: string,
): { gain: number; muted: boolean } {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i][0] === source) return calls[i][1] as { gain: number; muted: boolean };
  }
  throw new Error(`setSourceState was never called with source '${source}'`);
}

/** The Beat bus mute is a field of `beatMix`, and the slice's own toggle is the
 *  only writer — so these tests set it the way the app does. */
function setBeatBusMuted(muted: boolean): void {
  if (useAppStore.getState().beatMix.muted !== muted) useAppStore.getState().toggleBeatMuted();
}

describe('track solo reaches the engine as bus audibility', () => {
  afterEach(() => {
    useAppStore.setState({
      soloTracks: [],
      synthMuted: false,
      chordMuted: false,
      bassMuted: false,
      padMuted: false,
    });
    setBeatBusMuted(false);
  });

  test('soloing drums silences the five melodic buses and keeps the drum bus open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();
    setSourceState.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'fx').muted).toBe(true);
    expect(setSourceState.mock.calls.some(([source]) => source === 'sequencer')).toBe(false);
  });

  test('solo beats mute: a muted bus opens when it is soloed', () => {
    useAppStore.setState({ soloTracks: [] });
    setBeatBusMuted(true);
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();
    setSourceState.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').muted).toBe(false);
  });

  test('solo is additive: drums + lead leaves both buses open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();

    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('lead');
    setSourceState.mockClear();
    applyEngineSnapshot();

    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'fx').muted).toBe(true);
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
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();
    startEngineSync();
    useAppStore.getState().toggleSoloTrack('drums');

    // While the solo is active: only the soloed bus (sequencer, drums' engine
    // name) is audible. synth and pad are muted despite their own mute flags
    // being false, and bass — the flag-false case that a solo-blind
    // implementation gets wrong — must be muted too.
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'fx').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').muted).toBe(false);

    useAppStore.getState().clearSoloTracks();

    // After clearing: every bus reads back exactly what its own mute flag
    // implies, chord included (chordMuted: true survives the whole journey).
    expect(lastSourceStateFor(setSourceState.mock.calls, 'synth').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'chord').muted).toBe(true);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'bass').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'pad').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'fx').muted).toBe(false);
    expect(lastSourceStateFor(setSourceState.mock.calls, 'sequencer').muted).toBe(false);
  });

  test('the snapshot pass and the subscriptions push the same audibility for the same state', () => {
    // Exercises both consumers over one unchanged state: startEngineSync's
    // fireImmediately bootstrap (the subscription path) first, then
    // applyEngineSnapshot (the applySliceState path) second, with the state
    // held fixed in between. Diverse mute flags plus a solo make the two
    // paths distinguishable — a revert of either consumer back to reading the
    // raw mute flag instead of busAudible would make its per-source values
    // disagree with the other's.
    const sources = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;
    useAppStore.setState({
      soloTracks: ['pad'],
      synthMuted: false,
      chordMuted: true,
      bassMuted: false,
      padMuted: true,
    });
    setBeatBusMuted(false);
    const setSourceState = spyOn(audioEngine, 'setSourceState').mockClear();

    startEngineSync();
    const fromSubscriptions = sources.map((s) => lastSourceStateFor(setSourceState.mock.calls, s).muted);

    setSourceState.mockClear();
    applyEngineSnapshot();
    const fromSnapshot = sources.map((s) => lastSourceStateFor(setSourceState.mock.calls, s).muted);

    expect(fromSnapshot).toEqual(fromSubscriptions);
    // Pinned so a bug that happens to agree on both paths (e.g. solo ignored
    // by both) is still caught: pad is soloed and audible despite padMuted,
    // synth is muted despite synthMuted: false.
    expect(fromSnapshot).toEqual([true, true, true, false, true, true]);
  });

  // Cross-layer regression guard, not coverage of this module: it exercises
  // no engineSync.ts code, and no change to that file could make it fail. It
  // guards the boundary between the bus-audibility layer here and the
  // per-voice drum mute layer in useSequencerPlayback.ts, so it stays even
  // though it is off-target for engineSync.ts itself.
  test('solo leaves the per-voice Beat mute layer untouched', () => {
    const voiceMutes = () => Object.values(useAppStore.getState().beatMix.voices).map((v) => v.muted);
    const before = voiceMutes();
    useAppStore.getState().toggleSoloTrack('drums');
    expect(voiceMutes()).toEqual(before);
  });
});
