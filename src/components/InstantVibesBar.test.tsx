import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { INSTANT_VIBES } from '../audio/instantVibes';
import { audioEngine } from '../audio/engine';
import { useAppStore } from '../store/store';
import { selectVibe } from './InstantVibesBar';

const noop = { onSelect: () => {}, onToast: () => {} };

beforeEach(() => {
  spyOn(audioEngine, 'init').mockImplementation(() => Promise.resolve());
  spyOn(audioEngine, 'resetClock').mockClear();
  useAppStore.setState({ isSequencerPlaying: false, isChordsPlaying: false });
});

describe('selectVibe', () => {
  test('does not start playback when transport is stopped', () => {
    useAppStore.setState({ isSequencerPlaying: false, isChordsPlaying: false });

    selectVibe(INSTANT_VIBES[0], noop);

    const state = useAppStore.getState();
    expect(state.isSequencerPlaying).toBe(false);
    expect(state.isChordsPlaying).toBe(false);
    expect(state.projectTitle).toBe(INSTANT_VIBES[0].projectTitle);
  });

  test('does not stop playback when transport is playing', () => {
    useAppStore.setState({ isSequencerPlaying: true, isChordsPlaying: true });

    selectVibe(INSTANT_VIBES[0], noop);

    const state = useAppStore.getState();
    expect(state.isSequencerPlaying).toBe(true);
    expect(state.isChordsPlaying).toBe(true);
  });
});
