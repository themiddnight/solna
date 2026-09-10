import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { SOLO_NAV_KEYS, soloNavSignature, startSoloNavClear } from './soloNav';

let stop: (() => void) | null = null;

// Captured fresh in every beforeEach, before anything in this file mutates
// the store, and restored in afterEach regardless of how the test body
// exits. This is what makes the loop/scope/bpm-touching tests below safe in
// any order: each test's own baseline is what it is restored to, not a
// value some earlier test happened to leave behind.
//
// Covers everything `newProject()` -> `install()` writes, not just
// activeLoopId/loops/playbackScope/bpm: the "project content swap" test below
// drives the real installer, which also touches currentProjectId,
// currentProjectName, projectBaselineHash, dirty, songLoopIndex, meterId,
// masterVolume and effects. Bun does not isolate modules per test file, so an
// unrestored write here leaks into whichever file the process runs next.
let baseline: Pick<
  ReturnType<typeof useAppStore.getState>,
  | 'activeLoopId'
  | 'loops'
  | 'playbackScope'
  | 'bpm'
  | 'currentProjectId'
  | 'currentProjectName'
  | 'projectBaselineHash'
  | 'dirty'
  | 'songLoopIndex'
  | 'meterId'
  | 'masterVolume'
  | 'effects'
>;

beforeEach(() => {
  const state = useAppStore.getState();
  baseline = {
    activeLoopId: state.activeLoopId,
    loops: state.loops,
    playbackScope: state.playbackScope,
    bpm: state.bpm,
    currentProjectId: state.currentProjectId,
    currentProjectName: state.currentProjectName,
    projectBaselineHash: state.projectBaselineHash,
    dirty: state.dirty,
    songLoopIndex: state.songLoopIndex,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    effects: state.effects,
  };
  useAppStore.setState({ activeTab: 'sound', focusTrack: 'synth', soloTracks: [] });
  stop = startSoloNavClear();
});

afterEach(() => {
  stop?.();
  stop = null;
  // Runs even when an `expect` above threw, so a failing assertion can never
  // cascade into a later test by leaving any of the baseline fields pointed
  // somewhere a subsequent test didn't put them.
  useAppStore.setState({
    activeTab: 'sound',
    focusTrack: 'synth',
    soloTracks: [],
    ...baseline,
  });
});

describe('SOLO_NAV_KEYS', () => {
  /**
   * Exhaustive on purpose. The subscription covers every WRITER of these
   * axes by construction; the one thing a future contributor can still
   * forget is a new navigation AXIS. This test is where that decision has to
   * be made out loud instead of by omission.
   */
  test('is exactly the layer and active-loop axes', () => {
    expect([...SOLO_NAV_KEYS]).toEqual(['layer', 'activeLoopId']);
  });

  /**
   * The listener must never write a field the selector reads. If `soloTracks`
   * were added here, `clearSoloTracks()` would fire on every toggle — not an
   * infinite loop (the emptiness guard stops it after one nested hop), but
   * every `toggleSoloTrack` call would read back as `[]` immediately, with no
   * compile error and no other test catching it. This constant is the only
   * place that silent failure can be caught before it ships.
   */
  test('never watches soloTracks itself', () => {
    expect(SOLO_NAV_KEYS).not.toContain('soloTracks');
  });
});

describe('soloNavSignature', () => {
  /**
   * Binds SOLO_NAV_KEYS to what is actually watched at runtime, not just at
   * the type level. Without this, adding a key to the source table
   * alone (without touching soloNavSignature) would still pass the
   * exhaustive-list test above while the subscription kept watching only
   * the old fields — a constant that lies with a green suite.
   */
  test('reads exactly the fields SOLO_NAV_KEYS names', () => {
    const signature = soloNavSignature(useAppStore.getState());
    expect(Object.keys(signature)).toEqual([...SOLO_NAV_KEYS]);
  });

  test('derives layer from activeTab and reads activeLoopId live', () => {
    useAppStore.setState({ activeTab: 'arrange' });
    const state = useAppStore.getState();
    const signature = soloNavSignature(state);
    expect(signature).toEqual({
      layer: 'song',
      activeLoopId: state.activeLoopId,
    });
  });
});

describe('solo survives a Sound <-> Pattern tab change', () => {
  /**
   * Sound and Pattern are the two halves of editing one loop, and the user
   * crosses between them constantly while working on it — that crossing must
   * not cost the solo, which is the whole point of this change.
   */
  test('a Sound -> Pattern tab change does not clear it', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });

  test('Sound -> Pattern -> Sound does not clear it', () => {
    useAppStore.getState().toggleSoloTrack('pad');
    expect(useAppStore.getState().soloTracks).toEqual(['pad']);
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual(['pad']);
    useAppStore.getState().setActiveTab('sound');
    expect(useAppStore.getState().soloTracks).toEqual(['pad']);
  });
});

describe('solo survives a focus change', () => {
  /**
   * The clear on a segment change is GONE, and this is the test that keeps it
   * gone. With one `focusTrack`, "segment change" and "target change" are the
   * same event — soloNav's own docblock used to argue that the first must
   * clear and the second must not, which a merged value makes contradictory.
   * The target rule wins: solo is a monitoring gesture whose whole purpose is
   * comparing tracks, and clearing here would make a multi-track solo set
   * unbuildable anywhere.
   */
  test('a focus change with a non-empty set leaves it intact', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('bass');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
    useAppStore.getState().setFocusTrack('drum');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
    useAppStore.getState().setFocusTrack('synth');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
  });

  test('a multi-track set is buildable across focuses', () => {
    useAppStore.getState().setFocusTrack('drum');
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setFocusTrack('synth');
    useAppStore.getState().toggleSoloTrack('lead');
    expect(useAppStore.getState().soloTracks).toEqual(['lead', 'drums']);
  });
});

describe('solo is cleared by navigation', () => {
  test('changing layer (Loop -> Song) clears it', () => {
    useAppStore.getState().toggleSoloTrack('lead');
    expect(useAppStore.getState().soloTracks).toEqual(['lead']);
    useAppStore.getState().setActiveTab('arrange');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing the active loop clears it', () => {
    useAppStore.getState().toggleSoloTrack('pad');
    expect(useAppStore.getState().soloTracks).toEqual(['pad']);
    useAppStore.getState().setActiveLoop('some-other-loop-id');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('adding a loop clears it — the cursor moved', () => {
    useAppStore.getState().toggleSoloTrack('chord');
    expect(useAppStore.getState().soloTracks).toEqual(['chord']);
    useAppStore.getState().addLoop();
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  /**
   * The mechanism-level assertion, and the reason there is no per-writer test
   * for loadLoop, deleteLoop or the song advance: the subscription watches the
   * FIELD, so any writer of it — including ones that do not exist yet — clears
   * the set. This is the test that carries the whole design argument, so it
   * gets both the non-empty precondition and a follow-up assertion, not a
   * single `expect`.
   */
  test('a bare write of activeLoopId clears it, whoever the writer is', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
    useAppStore.setState({ activeLoopId: 'written-by-nobody-in-particular' });
    expect(useAppStore.getState().soloTracks).toEqual([]);
    expect(useAppStore.getState().activeLoopId).toBe('written-by-nobody-in-particular');
  });

  /**
   * A whole-project content swap (New / Open / Import) clears solo directly
   * inside `install()` in projectSlice.ts, not through this subscription —
   * loop ids are not unique across projects (every fresh project's default
   * loop is `loop-default-1`), so soloNav's activeLoopId watch cannot be
   * trusted to catch it on its own. Exercised here via the real writer,
   * `newProject`, so the guarantee is checked end to end regardless of which
   * mechanism provides it.
   */
  test('a project content swap (newProject) clears it', () => {
    useAppStore.getState().toggleSoloTrack('bass');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
    useAppStore.getState().newProject();
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('a non-navigating set() leaves the solo alone', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
    useAppStore.getState().setBpm(useAppStore.getState().bpm + 1);
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });

  test('re-selecting the same tab is not a navigation and does not clear', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });
});
