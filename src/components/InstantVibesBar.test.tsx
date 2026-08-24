import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { INSTANT_VIBES } from '../store/instantVibes';
import { audioEngine } from '../audio/engine';
import { useAppStore } from '../store/store';
import { selectVibe, InstantVibesBar } from './InstantVibesBar';

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

describe('InstantVibesBar markup', () => {
  test('preset buttons are daisyUI buttons and the dead animate-in classes are gone', () => {
    const html = renderToString(<InstantVibesBar />);

    expect(html).toContain('btn btn-xs');
    expect(html).toContain('btn-primary');
    expect(html).toContain('btn-outline');
    expect(html).toContain('btn btn-xs btn-ghost btn-square');
    // tailwindcss-animate is not installed, so these class names generate no CSS.
    expect(html).not.toContain('animate-in');
    expect(html).not.toContain('fade-in ');
  });
});
