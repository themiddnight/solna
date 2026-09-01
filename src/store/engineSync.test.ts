import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { applyEngineSnapshot, startEngineSync, stopEngineSync } from './engineSync';
import { getMeter } from '../utils/meter';
import type { MasterEffects, SynthParams } from '../types';

// bun's parallel workers share module singletons (the store) across test
// files, so transport state can leak in from earlier files — normalize what
// these tests depend on.
beforeEach(() => {
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
});

afterEach(() => {
  stopEngineSync();
});

describe('engineSync', () => {
  test('fireImmediately bootstrap pushes the current state into the engine', () => {
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockClear();
    const setClockBpm = spyOn(audioEngine, 'setClockBpm').mockClear();
    startEngineSync();
    expect(setMasterVolume).toHaveBeenCalledWith(useAppStore.getState().masterVolume);
    expect(setClockBpm).toHaveBeenCalledWith(useAppStore.getState().bpm);
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
});
