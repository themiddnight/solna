import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { sanitizeLoops } from '@/store/sanitize';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import { HEADER_FIELD_SHELL } from '../ui/fieldClasses';
import { LoopRenameModal, LoopSelector, onSelectLoop, RENAME_LOOP_VALUE } from './LoopSelector';
import type { UseLoopRename } from './useLoopRename';

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
    // Scoped to the select: the rename dialog beside it is a `max-w-sm` Modal.
    expect(openTagContaining(html, 'id="select-loop"')).not.toContain('max-w-');
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
    let renames = 0;

    onSelectLoop('loop-b', () => renames++);

    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    expect(renames).toBe(0);
  });

  // UX F-10: newcomers open the picker looking for a rename.
  test('the picker ends with a Rename loop action, set apart from the loops', () => {
    const html = renderToString(<LoopSelector />);
    expect(html).toContain(
      '<option value="loop-default-1" selected="">untitled-1</option><hr/><option value="">Rename loop\u2026</option></select>',
    );
  });

  test('choosing the action asks for a rename and never changes the active loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    let renames = 0;

    onSelectLoop(RENAME_LOOP_VALUE, () => renames++);

    expect(renames).toBe(1);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
  });

  // A project file can carry any non-empty string as a loop id, so the action's
  // value has to be one no loop can have. sanitizeLoops replaces a blank id.
  test('no loop id, even a sanitised blank one, equals the action value', () => {
    const blankId = { ...createDefaultLoop(), id: '' };
    const ids = (sanitizeLoops([blankId, { ...blankId }]) ?? []).map((loop) => loop.id);
    expect(ids).toEqual(['loop-0', 'loop-1']);
    expect(ids).not.toContain(RENAME_LOOP_VALUE);
  });

  // The dialog stays mounted so closing it hands focus back to the select, and
  // a dialog without `open` is not showing.
  test('the rename dialog is mounted closed', () => {
    const html = renderToString(<LoopSelector />);
    expect(html).toContain('<dialog class="modal">');
    expect(html).not.toContain('<dialog class="modal" open');
  });
});

describe('LoopRenameModal', () => {
  const rename: UseLoopRename = {
    isOpen: true,
    formId: 'rename-form',
    inputRef: { current: null },
    draft: 'untitled-1',
    placeholder: 'untitled-1',
    setDraft: () => {},
    open: () => {},
    cancel: () => {},
    submit: () => {},
  };

  test('a titled sm Modal with one text input holding the draft', () => {
    const html = renderToString(<LoopRenameModal rename={rename} />);
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Rename loop</h3>');
    expect(html).toContain('max-w-sm');
    expect(html).toContain('<form id="rename-form"');
    expect(html).toContain('type="text" placeholder="untitled-1" class="input input-sm w-full" value="untitled-1"/>');
  });

  // R339: the buttons are the Modal footer, and Rename submits the form by id.
  test('Cancel and Rename sit in the footer, Rename naming the form', () => {
    const html = renderToString(<LoopRenameModal rename={rename} />);
    expect(html).toContain(
      '<div class="modal-action"><button type="button" class="btn btn-sm btn-ghost">Cancel</button><button type="submit" form="rename-form" class="btn btn-sm btn-primary">Rename</button></div>',
    );
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('modal-action'));
  });
});
