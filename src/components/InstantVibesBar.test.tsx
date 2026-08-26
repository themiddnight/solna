import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { INSTANT_VIBES } from '../store/instantVibes';
import { audioEngine } from '../audio/engine';
import { useAppStore } from '../store/store';
import { selectVibe, InstantVibesBar, resolveSelectedVibeId } from './InstantVibesBar';

const noop = { onToast: () => {} };

beforeEach(() => {
  spyOn(audioEngine, 'init').mockImplementation(() => Promise.resolve());
  spyOn(audioEngine, 'resetClock').mockClear();
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
});

describe('selectVibe', () => {
  test('does not start playback when transport is stopped', () => {
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });

    selectVibe(INSTANT_VIBES[0], noop);

    const state = useAppStore.getState();
    expect(state.sequencerPlayer).toBe('stopped');
    expect(state.chordsPlayer).toBe('stopped');
    expect(state.projectTitle).toBe(INSTANT_VIBES[0].projectTitle);
  });

  test('does not stop playback when transport is playing', () => {
    useAppStore.setState({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });

    selectVibe(INSTANT_VIBES[0], noop);

    const state = useAppStore.getState();
    expect(state.sequencerPlayer).toBe('playing');
    expect(state.chordsPlayer).toBe('playing');
  });
});

describe('resolveSelectedVibeId', () => {
  test('a persisted vibe project title selects exactly that one vibe', () => {
    // A reload restores the project title of a previously loaded vibe, so the
    // selection has to follow it rather than a separate, hardcoded default.
    for (const vibe of INSTANT_VIBES) {
      expect(resolveSelectedVibeId(vibe.projectTitle)).toBe(vibe.id);
    }
  });

  test('a project title matching no vibe selects none', () => {
    expect(resolveSelectedVibeId('Cosmic Horizon Jam')).toBe(null);
    expect(resolveSelectedVibeId('')).toBe(null);
  });

  test('vibe project titles are unique, so at most one can ever match', () => {
    const titles = INSTANT_VIBES.map((v) => v.projectTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('vibe selection highlight', () => {
  test('renders no highlight when the project title matches no vibe', () => {
    // The store's default projectTitle ('Cosmic Horizon Jam') is not a vibe
    // title, and renderToString reads that initial snapshot.
    const html = renderToString(<InstantVibesBar />);

    expect(html).not.toContain('btn-primary');
  });
});

describe('InstantVibesBar markup', () => {
  test('preset buttons are daisyUI buttons and the dead animate-in classes are gone', () => {
    const html = renderToString(<InstantVibesBar />);

    // Nothing is selected in the default state, so only the idle variant
    // renders here; the selected variant is covered by resolveSelectedVibeId.
    expect(html).toContain('btn btn-xs');
    expect(html).toContain('btn-soft');
    expect(html).toContain('btn btn-xs btn-ghost btn-square');
    // tailwindcss-animate is not installed, so these class names generate no CSS.
    expect(html).not.toContain('animate-in');
    expect(html).not.toContain('fade-in ');
  });
});
