import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultLoop } from './loopSlice';
import { startVibeNavClear } from './vibeNav';
import { useAppStore } from './store';

let stop: (() => void) | null = null;

// Captured fresh in every beforeEach and restored in afterEach regardless of
// how the test body exits, same discipline as soloNav.test.ts — this file
// mutates activeLoopId/loops/selectedVibeId directly and bun runs every test
// file in one process with no isolation.
let baseline: Pick<ReturnType<typeof useAppStore.getState>, 'activeLoopId' | 'loops' | 'selectedVibeId'>;

beforeEach(() => {
  const state = useAppStore.getState();
  baseline = {
    activeLoopId: state.activeLoopId,
    loops: state.loops,
    selectedVibeId: state.selectedVibeId,
  };
  stop = startVibeNavClear();
});

afterEach(() => {
  stop?.();
  stop = null;
  useAppStore.setState({ ...baseline });
});

describe('the vibe chip highlight is cleared by an activeLoopId change', () => {
  test('changing the active loop clears it', () => {
    useAppStore.setState({ selectedVibeId: 'lofi-chill' });
    useAppStore.getState().setActiveLoop('some-other-loop-id');
    expect(useAppStore.getState().selectedVibeId).toBe(null);
  });

  test('re-entering the loop already active does not clear it — nothing was left', () => {
    const { activeLoopId } = useAppStore.getState();
    useAppStore.setState({ selectedVibeId: 'lofi-chill' });
    // Same id written back: the selector's own Object.is comparison sees no
    // change, so the listener never runs — no `leavingLoop` check needed at
    // the call site to express this, the subscription mechanism IS the check.
    useAppStore.setState({ activeLoopId });
    expect(useAppStore.getState().selectedVibeId).toBe('lofi-chill');
  });

  test('adding a loop clears it — the cursor moved onto a slot the vibe was never applied to', () => {
    useAppStore.setState({ selectedVibeId: 'synthwave-80s' });
    useAppStore.getState().addLoop();
    expect(useAppStore.getState().selectedVibeId).toBe(null);
  });

  test('duplicating the active loop clears it (the auto-activate branch moves the cursor)', () => {
    const loop = createDefaultLoop();
    useAppStore.setState({ loops: [loop], activeLoopId: loop.id, selectedVibeId: 'boom-bap' });
    useAppStore.getState().duplicateLoop(loop.id);
    expect(useAppStore.getState().selectedVibeId).toBe(null);
  });

  /**
   * The mechanism-level assertion, and the reason there is no separate test
   * per writer (loadLoop, deleteLoop, the song advance): the subscription
   * watches the FIELD, so any writer of it — including ones that do not
   * exist yet — clears the chip. See soloNav.test.ts's identical test for
   * the sibling feature this one is deliberately modeled on.
   */
  test('a bare write of activeLoopId clears it, whoever the writer is', () => {
    useAppStore.setState({ selectedVibeId: 'deep-ambient' });
    useAppStore.setState({ activeLoopId: 'written-by-nobody-in-particular' });
    expect(useAppStore.getState().selectedVibeId).toBe(null);
    expect(useAppStore.getState().activeLoopId).toBe('written-by-nobody-in-particular');
  });
});
