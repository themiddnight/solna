import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import { HEADER_FIELD_SHELL } from '../ui/fieldClasses';
import { LoopSelector, onSelectLoop } from './LoopSelector';

// onSelectLoop -> loadLoop mutates the shared singleton store (the flat
// per-loop slices, activeLoopId, player states). bun runs every test file in
// one process without isolation, so restore the default baseline before AND
// after each test so the suite stays order-independent.
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

beforeEach(resetStore);
afterEach(resetStore);

describe('LoopSelector', () => {
  test('renders the default active loop as an option', () => {
    const html = renderToString(<LoopSelector />);
    expect(html).toContain('id="select-loop"');
    expect(html).toContain('value="loop-default-1"');
    // An unnamed loop must not render a blank option.
    expect(html).toContain('untitled-1');
  });

  // The navbar showed a loop NAME with nothing saying it was a loop, or a
  // control. `appearance-none` is what lets a long name ellipsise rather than
  // paint over the chevron — see HEADER_SELECT.
  test('it is captioned, framed, and truncates rather than overrunning its arrow', () => {
    const html = renderToString(<LoopSelector />);
    expect(html).toContain('>Loop<');
    expect(html).toContain(HEADER_FIELD_SHELL);
    expect(html).toContain('appearance-none');
    expect(html).not.toContain('max-w-');
  });

  test('onSelectLoop loads the picked loop into the store', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');

    onSelectLoop('loop-b');

    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
  });
});
