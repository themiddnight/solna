import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { loopStatePatch } from '../../store/loop';
import { createDefaultLoop } from '../../store/loopSlice';
import { useAppStore } from '../../store/store';
import { ArrangeView, buildEditRoute, editLoop } from './ArrangeView';
import { loopIdKeyOf } from './loopIdKey';
import { getActiveChordIndex, SortableLoopCard } from './SortableLoopCard';

// editLoop -> loadLoop mutates the shared singleton store (flat slices,
// activeLoopId, player states). bun runs every test file in one process
// without isolation, so restore the default baseline before AND after each
// test so the suite stays order-independent.
const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    playbackScope: { kind: 'none' },
  });
};

interface FakeWindow {
  history: { state: unknown; pushState: (state: unknown, title: string, url?: string) => void };
  calls: Array<{ method: string; url: string }>;
}

function installFakeWindow(): FakeWindow {
  const calls: FakeWindow['calls'] = [];
  const fakeWindow: FakeWindow = {
    history: {
      state: null,
      pushState: (_state: unknown, _title: string, url?: string) =>
        calls.push({ method: 'pushState', url: url ?? '' }),
    },
    calls,
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  return fakeWindow;
}

beforeEach(resetStore);

afterEach(() => {
  resetStore();
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
});

describe('ArrangeView', () => {
  test('renders the default single loop with its bar count and disabled delete', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-arrange-add"');
    expect(html).toContain('Loop 1');
    expect(html).toContain('4 bars');
    expect(html).toContain('btn-loop-delete-loop-default-1');
    // A single loop cannot be deleted.
    expect(html).toContain('disabled');
  });

  test('never uses raw colour literals', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('rgba(');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('dark:');
  });

  test('each loop renders an inline four-channel mixer', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('btn-mute-synth-loop-default-1');
    expect(html).toContain('btn-mute-drum-loop-default-1');
    expect(html).toContain('btn-mute-chord-loop-default-1');
    expect(html).toContain('btn-mute-bass-loop-default-1');
    expect(html).toContain('slider-synth-loop-default-1');
  });

  test('each loop row renders an Edit deep-link button', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-loop-edit-loop-default-1"');
    expect(html).toContain('>Edit</button>');
  });

  test('renders key/scale and chord progression for loops', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('Key:');
    expect(html).toContain('Natural Minor');
    expect(html).toContain('Progression:');
  });

  test('renders rename button for loops', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-loop-rename-loop-default-1"');
  });

  test('renders repeat count selector for loops', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="select-repeat-loop-default-1"');
    expect(html).toContain('Repeat:');
    expect(html).toContain('<option value="1"');
    expect(html).toContain('<option value="2"');
  });

  test('renders isolated play button for each loop', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-loop-play-loop-default-1"');
    expect(html).toContain('Play');
  });

  test('renders active chord highlight when loop is playing', () => {
    const loop = createDefaultLoop();
    const html = renderToString(
      <SortableLoopCard
        loop={loop}
        index={0}
        totalLoops={1}
        isPlaying={true}
        isActive={true}
        currentStepInLoop={0}
        totalStepsInLoop={64}
        stepsPerBar={16}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onRename={() => {}}
        onSetRepeat={() => {}}
        onTogglePlayLoop={() => {}}
        onSetMix={() => {}}
      />
    );
    expect(html).toContain('badge-primary font-bold ring-2');
  });
});

describe('getActiveChordIndex helper', () => {
  test('returns -1 for empty chords or invalid steps', () => {
    expect(getActiveChordIndex([], 0, 16)).toBe(-1);
    expect(getActiveChordIndex([{ bars: 1 }], 0, 0)).toBe(-1);
  });

  test('correctly maps step offset to chord index based on chord bars', () => {
    const chords = [{ bars: 2 }, { bars: 1 }, { bars: 1 }]; // 2 bars (0-31), 1 bar (32-47), 1 bar (48-63)
    expect(getActiveChordIndex(chords, 0, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 31, 16)).toBe(0);
    expect(getActiveChordIndex(chords, 32, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 47, 16)).toBe(1);
    expect(getActiveChordIndex(chords, 48, 16)).toBe(2);
    expect(getActiveChordIndex(chords, 63, 16)).toBe(2);
    // Wraps into next cycle properly
    expect(getActiveChordIndex(chords, 64, 16)).toBe(0);
  });
});

describe('ArrangeView deep-link', () => {
  test('buildEditRoute returns the loop-editor URL', () => {
    expect(buildEditRoute('loop-b')).toBe('/loop?tab=synth&loopId=loop-b');
  });

  test('editLoop pushes the URL, opens the synth tab and loads the loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
    });
    const fakeWindow = installFakeWindow();

    editLoop('loop-b');

    // Exactly one history entry: the explicit pushState. The store
    // subscriptions (tab -> ?tab, activeLoopId -> ?loopId) are not mounted in
    // this unit test; in the app they see the URL already matches and skip.
    expect(fakeWindow.calls).toHaveLength(1);
    expect(fakeWindow.calls[0].method).toBe('pushState');
    expect(fakeWindow.calls[0].url).toBe('/loop?tab=synth&loopId=loop-b');
    expect(useAppStore.getState().activeTab).toBe('synth');
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
  });
});

// renderToString cannot pin this: zustand's getServerSnapshot freezes on
// getInitialState(), so a setState between two renders never reaches the
// markup (confirmed empirically — even setting `loops: []` left "Loop 1" in
// the output); and DndContext's internal useId counter advances between ANY
// two renders regardless of state, so two back-to-back renderToString calls
// are never byte-identical even with zero mutation in between. Neither
// re-render counts nor cross-render array identity are observable through
// this harness (see .claude/rules/testing.md), so the invariant is pinned on
// the id-content key itself, driven through the real store write.
describe('loopIds identity across the real setLoopMix path', () => {
  test('setLoopMix on the active loop rewrites loops but not the id key', () => {
    const { activeLoopId } = useAppStore.getState();
    const before = useAppStore.getState().loops;
    const beforeKey = loopIdKeyOf(before);

    useAppStore.getState().setLoopMix(activeLoopId, { synthVolume: 0.42 });

    const after = useAppStore.getState().loops;
    // Confirms the pre-existing mirrored-write behaviour this task leans on:
    // the array AND the touched loop object both get a fresh identity.
    expect(after).not.toBe(before);
    expect(after.find((l) => l.id === activeLoopId)).not.toBe(
      before.find((l) => l.id === activeLoopId)
    );
    // The id key React's useMemo depends on is unchanged (primitive string
    // equality), so the derived loopIds array is not rebuilt by this write.
    expect(loopIdKeyOf(after)).toBe(beforeKey);
  });
});

describe('loopIds changes on add, remove and reorder through the real store actions', () => {
  test('addLoop changes the id key', () => {
    const before = loopIdKeyOf(useAppStore.getState().loops);
    useAppStore.getState().addLoop();
    expect(loopIdKeyOf(useAppStore.getState().loops)).not.toBe(before);
  });

  test('deleteLoop changes the id key', () => {
    useAppStore.getState().addLoop();
    const before = loopIdKeyOf(useAppStore.getState().loops);
    const { activeLoopId } = useAppStore.getState();
    useAppStore.getState().deleteLoop(activeLoopId);
    expect(loopIdKeyOf(useAppStore.getState().loops)).not.toBe(before);
  });

  test('reorderLoops changes the id key', () => {
    useAppStore.getState().addLoop();
    const before = loopIdKeyOf(useAppStore.getState().loops);
    const { activeLoopId } = useAppStore.getState();
    useAppStore.getState().reorderLoops(activeLoopId, -1);
    expect(loopIdKeyOf(useAppStore.getState().loops)).not.toBe(before);
  });
});
