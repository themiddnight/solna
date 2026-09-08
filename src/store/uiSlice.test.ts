import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createUiSlice, persistKeyboardMode, readStoredKeyboardMode } from './uiSlice';
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
