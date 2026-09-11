import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { pasteGroupsFor, copyLoopSection, pasteLoopSection } from './loopClipboard';
import { SCOPE_NONE } from './playbackScope';
import { useAppStore } from './store';

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
    loopClipboard: null,
    playbackScope: SCOPE_NONE,
    activeTab: 'sound',
  });
};

beforeEach(resetStore);
afterEach(resetStore);

describe('pasteGroupsFor', () => {
  test('a progression paste captures the key', () => {
    expect(pasteGroupsFor(['chord-progression'])).toEqual(['chord-progression', 'key']);
  });

  test('sound and rhythm pastes are unchanged', () => {
    expect(pasteGroupsFor(['chord-sound', 'chord-pattern'])).toEqual(['chord-sound', 'chord-pattern']);
    expect(pasteGroupsFor(['lead-sound'])).toEqual(['lead-sound']);
  });

  test('never adds key twice', () => {
    expect(pasteGroupsFor(['chord-progression', 'key'])).toEqual(['chord-progression', 'key']);
  });
});

describe('copyLoopSection / pasteLoopSection', () => {
  test('copy stores the active loop as the source', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-a', name: 'Verse' };
    useAppStore.setState({ loops: [loop], activeLoopId: 'loop-a', ...loopStatePatch(loop) });

    copyLoopSection();

    expect(useAppStore.getState().loopClipboard).toEqual({
      sourceLoopId: 'loop-a',
    });
  });

  test('paste applies the resolved groups via applyLoopCopy, and does not clear the buffer', () => {
    const target = { ...createDefaultLoop(), id: 'loop-b' };
    const source = { ...createDefaultLoop(), id: 'loop-a', scaleRoot: 'C', scaleType: 'Major' };
    useAppStore.setState({
      loops: [target, source],
      activeLoopId: 'loop-b',
      ...loopStatePatch(target),
      loopClipboard: { sourceLoopId: 'loop-a' },
    });

    pasteLoopSection(['chord-progression']);

    const after = useAppStore.getState();
    expect(after.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('C');
    expect(after.loopClipboard).not.toBeNull();
  });

  test('paste onto the same loop is a no-op', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-a' };
    useAppStore.setState({
      loops: [loop],
      activeLoopId: 'loop-a',
      ...loopStatePatch(loop),
      loopClipboard: { sourceLoopId: 'loop-a' },
    });

    pasteLoopSection(['mix']);
    expect(useAppStore.getState().loopClipboard).not.toBeNull();
  });

  test('paste clears the buffer when the source loop is gone', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-b' };
    useAppStore.setState({
      loops: [loop],
      activeLoopId: 'loop-b',
      ...loopStatePatch(loop),
      loopClipboard: { sourceLoopId: 'loop-deleted' },
    });

    pasteLoopSection(['mix']);
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('copy with no active loop is a no-op', () => {
    // activeLoopId is always a string; "no active loop" is a ghost id that
    // resolves to no loop in `loops`.
    useAppStore.setState({ loops: [], activeLoopId: 'ghost', loopClipboard: null });
    copyLoopSection();
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });
});
