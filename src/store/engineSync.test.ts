import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { startEngineSync, stopEngineSync } from './engineSync';

// bun's parallel workers share module singletons (the store) across test
// files, so transport state can leak in from earlier files — normalize what
// these tests depend on.
beforeEach(() => {
  useAppStore.setState({ isSequencerPlaying: false, isChordsPlaying: false });
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
    useAppStore.getState().toggleSequencerPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalled();
    init.mockClear();
    resetClock.mockClear();
    // playing -> stopped: init called again (old toggles inited on every
    // transition; init()'s resume path restores a browser-suspended context),
    // but the clock never resets
    useAppStore.getState().toggleSequencerPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
    // start sequencer while chords already playing: init, no reset
    useAppStore.getState().toggleChordsPlay();
    init.mockClear();
    resetClock.mockClear();
    useAppStore.getState().toggleSequencerPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
  });

  test('toggleMasterPlay from fully-stopped inits and resets the clock (0 -> 3)', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {}).mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();
    // Play All from stopped: both views start, engine inits, grid restarts
    useAppStore.getState().toggleMasterPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalled();
    // Stopping both: init still called (every transition), clock never resets
    init.mockClear();
    resetClock.mockClear();
    useAppStore.getState().toggleMasterPlay();
    expect(init).toHaveBeenCalled();
    expect(resetClock).not.toHaveBeenCalled();
  });
});
