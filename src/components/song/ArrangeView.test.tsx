import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { loopStatePatch } from '../../store/loop';
import { createDefaultLoop } from '../../store/loopSlice';
import { useAppStore } from '../../store/store';
import { ArrangeView, buildEditRoute, editLoop } from './ArrangeView';

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
