import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { INSTANT_VIBES, applyInstantVibeToStore } from '../store/instantVibes';
import { audioEngine } from '../audio/engine';
import { useAppStore } from '../store/store';
import { startEngineSync, stopEngineSync } from '../store/engineSync';
import { selectVibe, InstantVibesBar, resolveSelectedVibeId, rerollVibe } from './InstantVibesBar';

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

const swallow = { onToast: () => {} };

describe('rerollVibe', () => {
  test('a reroll changes the music but never the genre anchor', () => {
    const vibe = INSTANT_VIBES[0];
    applyInstantVibeToStore(vibe);
    const before = useAppStore.getState();
    const authored = {
      scaleRoot: before.scaleRoot,
      chordRhythmId: before.chordRhythmId,
      bassPatternId: before.bassPatternId,
    };

    rerollVibe(vibe, swallow);

    const after = useAppStore.getState();
    expect(after.scaleType).toBe(vibe.scaleType);
    expect(after.scaleRoot).not.toBe(authored.scaleRoot);
    expect(after.chordRhythmId).not.toBe(authored.chordRhythmId);
    expect(after.bassPatternId).not.toBe(authored.bassPatternId);
    expect(after.chords.length).toBeGreaterThan(0);
    expect(after.projectTitle).toBe(vibe.projectTitle);
  });

  test('the toast carries both lines', () => {
    let received: { headline: string; detail: string } | null = null;
    rerollVibe(INSTANT_VIBES[0], { onToast: (t) => { received = t; } });
    expect(received).not.toBeNull();
    expect(received!.headline.startsWith('🎲 ')).toBe(true);
    expect(received!.detail.includes(' · drums: ')).toBe(true);
  });

  // Non-regression: the atomic-swap fix lives in applyInstantVibeToStore and a
  // reroll must inherit it rather than re-implement it.
  test('a reroll cuts the chord and bass sources synchronously', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {}).mockClear();
    useAppStore.setState({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });

    rerollVibe(INSTANT_VIBES[0], swallow);

    expect(stopSource).toHaveBeenCalledWith('chord', 0.02);
    expect(stopSource).toHaveBeenCalledWith('bass', 0.02);
    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('playing');
    expect(after.chordsPlayer).toBe('playing');
    stopSource.mockRestore();
  });

  test('a reroll while stopped leaves both players stopped', () => {
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
    rerollVibe(INSTANT_VIBES[0], swallow);
    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('stopped');
    expect(after.chordsPlayer).toBe('stopped');
  });

  /**
   * A reroll rewinds the shared bar grid, and that is INTENDED.
   *
   * applyInstantVibeToStore calls hardStopAll(), which takes engineSync's
   * transport flags to 0, then restarts the players that were running, which
   * takes them back up — and zustand's subscription is synchronous and not
   * React-batched, so the `flags !== 0 && prevFlags === 0` branch really runs.
   * The user tested this on the chip click and reported it as good ("every
   * press starts playing anew, the old sound doesn't hang over"). A reroll is
   * the same gesture. Pinned here so a refactor cannot silently drop it.
   */
  test('a reroll rewinds the shared bar grid — intended, not a regression', () => {
    spyOn(audioEngine, 'init').mockImplementation(() => {});
    useAppStore.setState({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    startEngineSync();
    const resetClock = spyOn(audioEngine, 'resetClock').mockImplementation(() => {}).mockClear();

    rerollVibe(INSTANT_VIBES[0], swallow);

    // Tear the subscription down BEFORE asserting: a failing expect would
    // otherwise leak a live engineSync into every later test in the file.
    const calls = resetClock.mock.calls.length;
    stopEngineSync();
    expect(calls).toBe(1);
  });

  test('the chip stays highlighted after a reroll', () => {
    rerollVibe(INSTANT_VIBES[0], swallow);
    expect(resolveSelectedVibeId(useAppStore.getState().projectTitle)).toBe(INSTANT_VIBES[0].id);
  });
});
