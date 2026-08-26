import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { startEngineSync, stopEngineSync } from './engineSync';

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
});
