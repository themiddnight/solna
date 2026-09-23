import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { loopLabel, loopStatePatch } from '@/store/loop';
import { createDefaultLoop, DEFAULT_LOOP_ID } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import { ArrangeView, buildEditRoute, editLoop, useLoopDeleteUndo } from './ArrangeView';
import { loopIdKeyOf } from './loopIdKey';
import { getActiveChordIndex, SortableLoopCard } from './SortableLoopCard';
import { keyChangeToastMessage, useLoopKeyChangeUndo } from './useLoopKeyChangeUndo';
import { subscribeLoopUndoDismissOnInstall } from './useLoopUndo';

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
    // The feedback wiring tests below raise real snackbars with real timers
    // (showFeedback); clearing the list every reset keeps a leftover entry —
    // or its still-armed timer clearing an unrelated key later — from ever
    // reaching another test in this shared-process file.
    feedback: [],
    feedbackHolds: 0,
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
    // The default loop has no user name, so the card reads the app's label.
    expect(html).toContain('untitled-1');
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
        label="untitled-1"
        isPlaying={true}
        isActive={true}
        currentStepInLoop={0}
        totalStepsInLoop={64}
        stepsPerBar={16}
        onSelect={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onCopyInto={() => {}}
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

  test('every card offers Copy into…, and the dialog is mounted once, closed', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-loop-copy-into-loop-default-1"');
    // Every card is mounted simultaneously inside the SortableContext, so a
    // per-card dialog would mount a full twelve-checkbox form per loop and
    // re-render all of them on every tick of the arrange playhead. One
    // dialog, held by copyTargetId, and it is closed until a card asks.
    expect(html).not.toContain('btn-loop-copy-apply');
    expect(html).not.toContain('select-loop-copy-source');
  });
});

describe('ArrangeView key change', () => {
  test('the Arrange header offers Change key… beside Add Loop', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-arrange-change-key"');
    expect(html.indexOf('btn-arrange-change-key')).toBeLessThan(html.indexOf('btn-arrange-add'));
  });

  test('the key change toast counts loops', () => {
    expect(keyChangeToastMessage({ snapshots: [{ loopId: 'a', content: {} as never }] })).toBe(
      'Key changed on 1 loop'
    );
    expect(
      keyChangeToastMessage({
        snapshots: [1, 2, 3].map((i) => ({ loopId: `l${i}`, content: {} as never })),
      })
    ).toBe('Key changed on 3 loops');
  });
});

/**
 * §5.6 Undo: proves the actual production wiring — `deleteLoopLive` through
 * `useLoopDeleteUndo` through `useLoopUndo` — lands a real snackbar in the
 * shared `feedback` list, not just that `buildLoopUndoRequest` (unit-tested
 * in `useLoopUndo.test.ts`) shapes a request correctly in isolation.
 *
 * `useLoopDeleteUndo`'s `onDelete` is a `useCallback`, so it is captured once
 * through one `renderToString` pass (the `Probe` idiom already used by
 * `useEffectsDraft.test.tsx`/`ChordView.test.tsx`) and then called directly —
 * no interaction/DOM needed, and it does not depend on an effect (unlike the
 * install-dismiss subscription below, which `renderToString` never runs:
 * effects are client-only, so that one is exercised through
 * `subscribeLoopUndoDismissOnInstall` directly instead).
 */
describe('ArrangeView loop-delete Undo (feedback wiring)', () => {
  const secondLoop = () => ({ ...createDefaultLoop(), id: 'loop-b' });

  const captureOnDelete = (): ((id: string) => void) => {
    let captured: ReturnType<typeof useLoopDeleteUndo> | null = null;
    function Probe() {
      captured = useLoopDeleteUndo();
      return null;
    }
    renderToString(<Probe />);
    return captured!.onDelete;
  };

  test('deleting a loop offers a snackbar keyed btn-undo-loop-delete, whose Undo restores it', () => {
    const b = secondLoop();
    useAppStore.setState({ loops: [createDefaultLoop(), b], activeLoopId: DEFAULT_LOOP_ID });

    captureOnDelete()(b.id);

    const entry = useAppStore.getState().feedback.find((e) => e.key === 'btn-undo-loop-delete');
    expect(entry).toBeDefined();
    expect(entry!.message).toBe(`${loopLabel(b)} deleted`);
    expect(entry!.action?.id).toBe('btn-undo-loop-delete');
    expect(useAppStore.getState().loops.some((l) => l.id === b.id)).toBe(false);

    useAppStore.getState().runFeedbackAction('btn-undo-loop-delete');

    expect(useAppStore.getState().loops.some((l) => l.id === b.id)).toBe(true);
    expect(useAppStore.getState().feedback.some((e) => e.key === 'btn-undo-loop-delete')).toBe(false);
  });

  test('a project install dismisses the pending delete Undo', () => {
    const b = secondLoop();
    useAppStore.setState({ loops: [createDefaultLoop(), b], activeLoopId: DEFAULT_LOOP_ID });
    captureOnDelete()(b.id);
    expect(useAppStore.getState().feedback.some((e) => e.key === 'btn-undo-loop-delete')).toBe(true);

    const unsubscribe = subscribeLoopUndoDismissOnInstall('btn-undo-loop-delete');
    useAppStore.setState({ projectInstallCount: useAppStore.getState().projectInstallCount + 1 });
    unsubscribe();

    expect(useAppStore.getState().feedback.some((e) => e.key === 'btn-undo-loop-delete')).toBe(false);
  });
});

/** Same wiring, the batch key-change path — §5.6 Undo, `keyChangeUndo` is now a snackbar only. */
describe('ArrangeView key-change Undo (feedback wiring)', () => {
  const captureOnApply = (): ((...args: Parameters<ReturnType<typeof useLoopKeyChangeUndo>['onApplyKeyChange']>) => void) => {
    let captured: ReturnType<typeof useLoopKeyChangeUndo> | null = null;
    function Probe() {
      captured = useLoopKeyChangeUndo();
      return null;
    }
    renderToString(<Probe />);
    return captured!.onApplyKeyChange;
  };

  test('applying a key change offers a snackbar keyed btn-undo-key-change, whose Undo restores the scale', () => {
    const before = useAppStore.getState().scaleRoot;

    captureOnApply()([DEFAULT_LOOP_ID], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true });

    expect(useAppStore.getState().scaleRoot).not.toBe(before);
    const entry = useAppStore.getState().feedback.find((e) => e.key === 'btn-undo-key-change');
    expect(entry).toBeDefined();
    expect(entry!.message).toBe('Key changed on 1 loop');
    expect(entry!.action?.id).toBe('btn-undo-key-change');

    useAppStore.getState().runFeedbackAction('btn-undo-key-change');

    expect(useAppStore.getState().scaleRoot).toBe(before);
    expect(useAppStore.getState().feedback.some((e) => e.key === 'btn-undo-key-change')).toBe(false);
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
    expect(buildEditRoute('loop-b')).toBe('/loop?tab=sound&loopId=loop-b');
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
    expect(fakeWindow.calls[0].url).toBe('/loop?tab=sound&loopId=loop-b');
    expect(useAppStore.getState().activeTab).toBe('sound');
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


/**
 * The follow-the-playhead scroll runs in an effect, which `renderToString`
 * never executes — so the header toggle's actual authority over it is pinned
 * off the source instead, the way Header.test.tsx pins the header's own row
 * order. Both halves matter: the guard is what makes "off" mean no scroll at
 * all, and the dependency is what makes turning it back on mid-song catch up
 * to the playing card instead of waiting for the next loop change.
 */
describe('followPlayhead gates the scroll effect', () => {
  const src = readFileSync(new URL('./ArrangeView.tsx', import.meta.url), 'utf8');

  test('the effect returns early when the toggle is off', () => {
    expect(src).toContain("if (!followPlayhead || !isPlaying || activeTab !== 'arrange' || !playingId) return;");
  });

  test('the flag is a dependency, so switching it on scrolls immediately', () => {
    expect(src).toContain('}, [followPlayhead, isPlaying, activeTab, playingId]);');
  });

  test('the per-tick step is still absent from those dependencies', () => {
    // Read the dep array out of the source and check it for `currentStep`,
    // rather than checking for one exact serialisation of the broken list.
    // The old assertion missed any other ordering and any prettier rewrap, so
    // adding the per-tick step — which re-fires the scroll 8-16x/sec and
    // fights the user's own scrolling — could land with this test green.
    const deps = /\}, \[([^\]]*)\]\);/g;
    const arrays = [...src.matchAll(deps)].map((m) => m[1]);
    const scrollDeps = arrays.find((a) => a.includes('followPlayhead'));
    expect(scrollDeps).toBeDefined();
    expect(scrollDeps).not.toContain('currentStep');
  });
});
