import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { applyEngineSnapshot, startEngineSync, stopEngineSync } from './engineSync';
import { SOURCE_BUSES } from './sourceBuses';
import { withSourceTransitionTime } from './sourceTransition';

const initialSends = useAppStore.getState().trackSends;

beforeEach(() => {
  useAppStore.setState({
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    fxPlayer: 'stopped',
    soloTracks: [],
    trackSends: initialSends,
  });
});

afterEach(() => {
  stopEngineSync();
  useAppStore.setState({ soloTracks: [], chordMuted: false, trackSends: initialSends });
});

function spySends() {
  return spyOn(audioEngine, 'setSourceSends').mockImplementation(() => {});
}

describe('engineSync: per-track sends', () => {
  test('the bridge bootstraps every bus once, in SOURCE_BUSES order', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      expect(setSourceSends.mock.calls.map(([source]) => source)).toEqual(SOURCE_BUSES.map((b) => b.source));
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a setTrackSends write reaches the engine for that source only, as a transition', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().setTrackSends('chord', { reverb: 0.3, delay: 0.2, distortion: 0.1 });
      expect(setSourceSends.mock.calls).toEqual([
        ['chord', { reverb: 0.3, delay: 0.2, distortion: 0.1 }, undefined, 'transition'],
      ]);
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a write inside withSourceTransitionTime lands on that song boundary', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      withSourceTransitionTime(12.5, () =>
        useAppStore.getState().setTrackSends('bass', { reverb: 0, delay: 1, distortion: 0 }));
      expect(setSourceSends.mock.calls).toEqual([
        ['bass', { reverb: 0, delay: 1, distortion: 0 }, 12.5, 'transition'],
      ]);
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('solo and mute changes make no setSourceSends call (sends read no audibility)', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().toggleSoloTrack('drums');
      useAppStore.getState().toggleChordMuted();
      expect(setSourceSends).not.toHaveBeenCalled();
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('applyEngineSnapshot settles all six buses', () => {
    const setSourceSends = spySends();
    try {
      applyEngineSnapshot();
      const s = useAppStore.getState();
      expect(setSourceSends.mock.calls).toEqual(
        SOURCE_BUSES.map((bus) => [bus.source, s.trackSends[bus.source], undefined, 'settle']),
      );
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a transport start from full stop settles every bus sends beside its bus state', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {});
    const resetClock = spyOn(audioEngine, 'resetClock').mockImplementation(() => {});
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().play('sequencer');
      expect(setSourceSends.mock.calls.map(([source, , , mode]) => [source, mode]))
        .toEqual(SOURCE_BUSES.map((bus) => [bus.source, 'settle']));
    } finally {
      setSourceSends.mockRestore();
      resetClock.mockRestore();
      init.mockRestore();
    }
  });
});
