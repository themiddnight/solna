import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { SOLO_NAV_KEYS, soloNavUnchanged, startSoloNavClear } from './soloNav';

let stop: (() => void) | null = null;

beforeEach(() => {
  useAppStore.setState({ activeTab: 'sound', patternSegment: 'lead', soloTracks: [] });
  stop = startSoloNavClear();
});

afterEach(() => {
  stop?.();
  stop = null;
  useAppStore.setState({ activeTab: 'sound', patternSegment: 'lead', soloTracks: [] });
});

describe('SOLO_NAV_KEYS', () => {
  /**
   * Exhaustive on purpose. The subscription covers every WRITER of these three
   * fields by construction; the one thing a future contributor can still forget
   * is a new navigation AXIS. This test is where that decision has to be made
   * out loud instead of by omission.
   */
  test('is exactly the three navigation fields §4 names', () => {
    expect([...SOLO_NAV_KEYS]).toEqual(['activeTab', 'patternSegment', 'activeLoopId']);
  });
});

describe('solo is cleared by navigation', () => {
  test('changing tab clears it', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing layer clears it — a layer change is a tab change', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('lead');
    useAppStore.getState().setActiveTab('arrange');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing the Pattern segment clears it', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('bass');
    useAppStore.getState().setPatternSegment('beat');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing the active loop clears it', () => {
    const before = useAppStore.getState().activeLoopId;
    useAppStore.getState().toggleSoloTrack('pad');
    useAppStore.getState().setActiveLoop('some-other-loop-id');
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ activeLoopId: before });
  });

  test('adding a loop clears it — the cursor moved', () => {
    const before = useAppStore.getState().activeLoopId;
    const beforeLoops = useAppStore.getState().loops;
    useAppStore.getState().toggleSoloTrack('chord');
    useAppStore.getState().addLoop();
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ loops: beforeLoops, activeLoopId: before });
  });

  /**
   * The mechanism-level assertion, and the reason there is no per-writer test
   * for loadLoop, deleteLoop or the song advance: the subscription watches the
   * FIELD, so any writer of it — including ones that do not exist yet — clears
   * the set.
   */
  test('a bare write of activeLoopId clears it, whoever the writer is', () => {
    const before = useAppStore.getState().activeLoopId;
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.setState({ activeLoopId: 'written-by-nobody-in-particular' });
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ activeLoopId: before });
  });

  test('a non-navigating set() leaves the solo alone', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setBpm(useAppStore.getState().bpm + 1);
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });

  test('re-selecting the same tab is not a navigation and does not clear', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });
});

describe('soloNavUnchanged', () => {
  test('compares all three fields', () => {
    const base = { activeTab: 'sound', patternSegment: 'lead', activeLoopId: 'a' } as const;
    expect(soloNavUnchanged(base, { ...base })).toBe(true);
    expect(soloNavUnchanged(base, { ...base, activeTab: 'pattern' })).toBe(false);
    expect(soloNavUnchanged(base, { ...base, patternSegment: 'beat' })).toBe(false);
    expect(soloNavUnchanged(base, { ...base, activeLoopId: 'b' })).toBe(false);
  });
});
