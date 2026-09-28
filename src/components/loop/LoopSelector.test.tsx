import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import { HEADER_FIELD_SHELL } from '../ui/fieldClasses';
import { LoopSelector, onSelectLoop } from './LoopSelector';

/** The full opening tag of the element whose markup contains `needle`; throws when it is absent. */
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

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

  // UX F-10: the caption used to drop below `sm`, leaving the phone header a
  // bare name that read as a title rather than a loop picker.
  test('the Loop caption shows at every width, the phone included', () => {
    const html = renderToString(<LoopSelector />);
    // Throws if the caption text changes, rather than slicing '' and passing.
    const caption = openTagContaining(html, '>Loop<');
    expect(caption.startsWith('<span')).toBe(true);
    expect(caption).not.toContain('hidden');
  });

  // Review 4123990330: the caption made the phone shell wider and it ran over
  // the wordmark. The wordmark's text now hides below `sm` (Wordmark.tsx), so
  // the select keeps its width from 360px up and narrows only on a 320px phone.
  test('the select keeps its width from 360px up, narrowing only below', () => {
    const select = openTagContaining(renderToString(<LoopSelector />), 'id="select-loop"');
    expect(select).toContain('w-24 min-[360px]:w-32');
  });

  test('onSelectLoop loads the picked loop into the store', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');

    onSelectLoop('loop-b');

    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
  });
});
