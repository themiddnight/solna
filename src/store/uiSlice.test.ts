import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createUiSlice,
  persistFollowPlayhead,
  persistKeyboardMode,
  readStoredFollowPlayhead,
  readStoredKeyboardMode,
} from './uiSlice';
import { buildProjectContent, PROJECT_CONTENT_KEYS } from './projectFormat';
import { partializeAppState, useAppStore } from './store';
import { SCOPE_NONE } from './playbackScope';

// Storage access itself can throw (Safari private browsing, "block all
// cookies", some embedded webviews) — not merely return null. These stubs
// simulate that failure mode without needing a real blocked browser.
const throwingGetStorage = {
  getItem(): string | null {
    throw new Error('SecurityError: storage is blocked');
  },
};

const throwingSetStorage = {
  setItem(): void {
    throw new Error('SecurityError: storage is blocked');
  },
};

describe('readStoredKeyboardMode', () => {
  test('adopts a valid stored value', () => {
    const storage = { getItem: () => 'chord' };
    expect(readStoredKeyboardMode(storage)).toBe('chord');
  });

  test('returns null when nothing is stored', () => {
    const storage = { getItem: () => null };
    expect(readStoredKeyboardMode(storage)).toBeNull();
  });

  test('rejects an invalid stored value rather than adopting it', () => {
    expect(readStoredKeyboardMode({ getItem: () => 'banana' })).toBeNull();
    expect(readStoredKeyboardMode({ getItem: () => '' })).toBeNull();
  });

  test('degrades to null when storage access throws, instead of propagating', () => {
    expect(readStoredKeyboardMode(throwingGetStorage)).toBeNull();
  });

  test('returns null with no storage injected and no global (bun test has no localStorage)', () => {
    expect(readStoredKeyboardMode()).toBeNull();
  });
});

describe('persistKeyboardMode', () => {
  test('writes the mode under the storage key when storage works normally', () => {
    const calls: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => {
        calls.push([key, value]);
      },
    };
    persistKeyboardMode('chromatic', storage);
    expect(calls).toEqual([['solna_keyboard_mode', 'chromatic']]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistKeyboardMode('chord', throwingSetStorage)).not.toThrow();
  });

  test('does not throw with no storage injected and no global (bun test has no localStorage)', () => {
    expect(() => persistKeyboardMode('scale-locked')).not.toThrow();
  });
});

describe('createUiSlice defaults', () => {
  test('falls back to scale-locked when there is no global localStorage (bun test)', () => {
    const calls: Record<string, unknown>[] = [];
    const slice = createUiSlice(((partial: Record<string, unknown>) => calls.push(partial)) as never);
    expect(slice.keyboardMode).toBe('scale-locked');
  });

  test('setKeyboardMode still updates in-memory state when the write-through throws', () => {
    let applied: Record<string, unknown> | undefined;
    const slice = createUiSlice(((partial: Record<string, unknown>) => {
      applied = partial;
    }) as never);
    // persistKeyboardMode() inside setKeyboardMode resolves the real (absent)
    // localStorage global and swallows the failure; state must still update.
    slice.setKeyboardMode('chord');
    expect(applied).toEqual({ keyboardMode: 'chord' });
  });
});

describe('follow-playhead preference', () => {
  test('adopts a valid stored value in both directions', () => {
    expect(readStoredFollowPlayhead({ getItem: () => 'on' })).toBe(true);
    expect(readStoredFollowPlayhead({ getItem: () => 'off' })).toBe(false);
  });

  test('returns null for nothing stored, garbage, or a boolean-looking string', () => {
    expect(readStoredFollowPlayhead({ getItem: () => null })).toBeNull();
    expect(readStoredFollowPlayhead({ getItem: () => 'banana' })).toBeNull();
    // 'false' is the shape a naive String(boolean) write would leave behind;
    // it must not read as `false` and must not read as `true` either.
    expect(readStoredFollowPlayhead({ getItem: () => 'false' })).toBeNull();
  });

  test('degrades to null when storage access throws, instead of propagating', () => {
    expect(readStoredFollowPlayhead(throwingGetStorage)).toBeNull();
  });

  test('writes on/off under its own storage key', () => {
    const calls: Array<[string, string]> = [];
    const storage = { setItem: (key: string, value: string) => { calls.push([key, value]); } };
    persistFollowPlayhead(true, storage);
    persistFollowPlayhead(false, storage);
    expect(calls).toEqual([
      ['solna_follow_playhead', 'on'],
      ['solna_follow_playhead', 'off'],
    ]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistFollowPlayhead(false, throwingSetStorage)).not.toThrow();
  });

  test('defaults to following when nothing is stored', () => {
    const slice = createUiSlice((() => {}) as never);
    expect(slice.followPlayhead).toBe(true);
  });

  test('toggleFollowPlayhead flips the current value', () => {
    let applied: Record<string, unknown> | undefined;
    const slice = createUiSlice(((updater: (state: { followPlayhead: boolean }) => Record<string, unknown>) => {
      applied = updater({ followPlayhead: true });
    }) as never);
    slice.toggleFollowPlayhead();
    expect(applied).toEqual({ followPlayhead: false });
  });

  // The sibling test above covers the throwing case, because it can: it calls
  // `persistFollowPlayhead` with an injected `throwingSetStorage`. The action
  // takes no storage argument, so a test that calls it and asserts "did not
  // throw" injects nothing — it passed only because bun defines no global
  // `localStorage` and the ReferenceError was swallowed inside
  // `persistGuardedStorageValue`. Under jsdom it would have been vacuous AND
  // written into real storage, making the default-value test above it
  // order-dependent. What IS worth pinning is that the flip happens in one
  // `set`, with the write-through beside it.
  test('toggleFollowPlayhead writes through as it flips, in a single set', () => {
    const applied: Record<string, unknown>[] = [];
    const slice = createUiSlice(((updater: (state: { followPlayhead: boolean }) => Record<string, unknown>) => {
      applied.push(updater({ followPlayhead: false }));
    }) as never);
    slice.toggleFollowPlayhead();
    expect(applied).toEqual([{ followPlayhead: true }]);
  });

  test('never rides in the persisted project blob', () => {
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('followPlayhead' in persisted).toBe(false);
    expect(PROJECT_CONTENT_KEYS).not.toContain('followPlayhead' as never);
  });
});

describe('input deck dock state', () => {
  test('defaults to a closed keyboard panel', () => {
    const calls: Record<string, unknown>[] = [];
    const slice = createUiSlice(((partial: Record<string, unknown>) => calls.push(partial)) as never);
    expect(slice.isInputPanelOpen).toBe(false);
    expect(slice.inputPanelMode).toBe('keyboard');
  });

  test('setIsInputPanelOpen updates the flag', () => {
    let applied: Record<string, unknown> | undefined;
    const slice = createUiSlice(((partial: Record<string, unknown>) => { applied = partial; }) as never);
    slice.setIsInputPanelOpen(true);
    expect(applied).toEqual({ isInputPanelOpen: true });
  });

  test('setInputPanelMode updates the mode', () => {
    let applied: Record<string, unknown> | undefined;
    const slice = createUiSlice(((partial: Record<string, unknown>) => { applied = partial; }) as never);
    slice.setInputPanelMode('drums');
    expect(applied).toEqual({ inputPanelMode: 'drums' });
  });
});

describe('track solo state', () => {
  beforeEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  // Restores everything this block writes, not just soloTracks: the transport
  // fields below are only at their defaults by luck otherwise, and bun runs the
  // next test file against this same store instance.
  afterEach(() => {
    useAppStore.setState({
      soloTracks: [],
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      playbackScope: SCOPE_NONE,
    });
  });

  test('starts empty', () => {
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('toggling is additive and canonically ordered', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('lead');
    expect(useAppStore.getState().soloTracks).toEqual(['lead', 'drums']);
  });

  test('toggling the same track again removes it', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('clearSoloTracks empties the set', () => {
    useAppStore.getState().toggleSoloTrack('pad');
    useAppStore.getState().clearSoloTracks();
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('clearing an already-empty set keeps the array reference stable', () => {
    const before = useAppStore.getState().soloTracks;
    useAppStore.getState().clearSoloTracks();
    expect(useAppStore.getState().soloTracks).toBe(before);
  });

  // `playbackScope` is asserted here, so it is ARRANGED here: bun shares the
  // store singleton across test files, so a `loop` scope left behind by an
  // earlier file would fail this test for a reason that has nothing to do with
  // solo. Same for the three player fields — set to what the assertion needs
  // rather than trusted to still be at their defaults.
  test('solo does not start playback: pressing it with the transport stopped is silent', () => {
    useAppStore.setState({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      playbackScope: SCOPE_NONE,
    });
    useAppStore.getState().toggleSoloTrack('drums');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope.kind).toBe('none');
  });
});

describe('solo is never persisted (spec §4, prohibition 1)', () => {
  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  test('it appears in neither partializeAppState nor PROJECT_CONTENT_KEYS', () => {
    useAppStore.setState({ soloTracks: ['drums', 'lead'] });

    const persisted = partializeAppState(useAppStore.getState());
    expect(Object.keys(persisted)).not.toContain('soloTracks');

    expect([...PROJECT_CONTENT_KEYS]).not.toContain('soloTracks');

    const content = buildProjectContent(useAppStore.getState());
    expect(Object.keys(content).sort()).toEqual([...PROJECT_CONTENT_KEYS].sort());
  });

  test('it never reaches LoopMixPatch: no loop carries a solo key', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    for (const loop of useAppStore.getState().loops) {
      expect(Object.keys(loop)).not.toContain('soloTracks');
      expect(Object.keys(loop)).not.toContain('solo');
    }
  });
});

describe('recordingTrack — the armed melody track', () => {
  afterEach(() => {
    useAppStore.getState().setRecordingTrack(null);
  });

  test('starts disarmed', () => {
    expect(useAppStore.getState().recordingTrack).toBeNull();
  });

  /**
   * ONE value, not a boolean per track. A pair of booleans has nothing
   * stopping both being true, and one live-capture clock would then write two
   * grids from a single keypress — a state no UI can reach, so no test would
   * find it. The type makes it unrepresentable instead, and this test is what
   * pins the type's intent to a behaviour a reviewer can read.
   */
  test('arming a second track replaces the first — two can never be armed at once', () => {
    useAppStore.getState().setRecordingTrack('lead');
    useAppStore.getState().setRecordingTrack('fx');
    expect(useAppStore.getState().recordingTrack).toBe('fx');
  });

  test('is NOT persisted — a reload must never come back recording', () => {
    useAppStore.getState().setRecordingTrack('lead');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('recordingTrack' in persisted).toBe(false);
    expect('leadRecording' in persisted).toBe(false);
  });
});

describe('loop-copy session state', () => {
  afterEach(() => {
    useAppStore.getState().setLoopCopySelection([], null);
  });

  test('starts with nothing selected and no remembered source', () => {
    expect(useAppStore.getState().loopCopySelection).toEqual([]);
    expect(useAppStore.getState().loopCopySourceId).toBeNull();
  });

  test('setLoopCopySelection remembers the selection and the source in one set()', () => {
    useAppStore.getState().setLoopCopySelection(['lead-sound', 'chord-progression'], 'loop-source');
    expect(useAppStore.getState().loopCopySelection).toEqual(['lead-sound', 'chord-progression']);
    expect(useAppStore.getState().loopCopySourceId).toBe('loop-source');
  });

  test('is NOT persisted — a reload must come back with the dialog defaulting fresh', () => {
    useAppStore.getState().setLoopCopySelection(['mix'], 'loop-source');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('loopCopySelection' in persisted).toBe(false);
    expect('loopCopySourceId' in persisted).toBe(false);
    expect([...PROJECT_CONTENT_KEYS]).not.toContain('loopCopySelection');
    expect([...PROJECT_CONTENT_KEYS]).not.toContain('loopCopySourceId');
  });
});

describe('loop clipboard buffer', () => {
  afterEach(() => {
    useAppStore.getState().clearLoopClipboard();
  });

  test('starts empty', () => {
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('setLoopClipboard stores the source reference', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'loop-source' });
    expect(useAppStore.getState().loopClipboard).toEqual({
      sourceLoopId: 'loop-source',
    });
  });

  test('clearLoopClipboard empties it', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'a' });
    useAppStore.getState().clearLoopClipboard();
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('is NOT persisted — absent from partializeAppState and PROJECT_CONTENT_KEYS', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'a' });
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('loopClipboard' in persisted).toBe(false);
    expect([...PROJECT_CONTENT_KEYS]).not.toContain('loopClipboard');
  });
});
