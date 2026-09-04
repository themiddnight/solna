import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { QuickSavePopover, isDismissKey } from './QuickSavePopover';

const base = {
  open: true,
  onClose: () => {},
  heading: 'Save Custom Preset:',
  placeholder: 'Preset Name...',
  saveLabel: 'Save Patch',
  name: '',
  onNameChange: () => {},
  onSubmit: () => {},
};

describe('QuickSavePopover', () => {
  test('buttonClassName is appended with a separating space', () => {
    const html = renderToString(
      <QuickSavePopover {...base} buttonClassName="cursor-pointer" />,
    );
    // Without the space the two classes fuse into one dead class
    // ("shrink-0cursor-pointer") and BOTH are lost.
    expect(html).toContain('shrink-0 cursor-pointer');
    expect(html).not.toContain('shrink-0cursor-pointer');
  });

  test('a leading-space buttonClassName does not double up', () => {
    const html = renderToString(
      <QuickSavePopover {...base} buttonClassName=" cursor-pointer" />,
    );
    expect(html).toContain('cursor-pointer');
    expect(html).not.toContain('shrink-0  cursor-pointer');
  });

  test('defaults use daisyUI card/input/button tokens', () => {
    const html = renderToString(<QuickSavePopover {...base} />);
    expect(html).toContain('card bg-base-100 border border-primary/40');
    expect(html).toContain('input input-sm');
    expect(html).toContain('btn btn-sm btn-primary');
    expect(html).toContain('btn btn-sm btn-ghost');
    expect(html).toContain('text-base-content');
    expect(html).toContain('text-primary');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('#2D355A');
    expect(html).not.toContain('#171B38');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
  });

  test('the optional category select is a daisyUI select', () => {
    const html = renderToString(
      <QuickSavePopover
        {...base}
        categories={[{ id: 'lead', label: 'Lead' }]}
        category="lead"
        onCategoryChange={() => {}}
      />,
    );
    expect(html).toContain('select select-sm');
    expect(html).toContain('Lead');
  });

  test('caller class overrides still win', () => {
    const html = renderToString(
      <QuickSavePopover
        {...base}
        inputClassName="input input-sm flex-1 min-w-[140px]"
      />,
    );
    expect(html).toContain('min-w-[140px]');
  });

  test('open=false renders nothing', () => {
    expect(renderToString(<QuickSavePopover {...base} open={false} />)).toBe('');
  });
});

describe('QuickSavePopover dismissal', () => {
  test('Escape dismisses; nothing else does', () => {
    expect(isDismissKey({ key: 'Escape' })).toBe(true);
    expect(isDismissKey({ key: 'Enter' })).toBe(false);
    expect(isDismissKey({ key: 'Esc' })).toBe(false);   // the IE spelling is not a browser we ship to
    expect(isDismissKey({ key: 'a' })).toBe(false);
  });

  /**
   * autoFocus is replaced by an effect that records the trigger first, so the
   * popover can hand focus back when it closes. The attribute must be gone from
   * the markup or React focuses the input before the effect can look at
   * document.activeElement.
   */
  test('the name input no longer carries autoFocus', () => {
    const html = renderToString(
      <QuickSavePopover
        open
        onClose={() => {}}
        heading="Save"
        placeholder="Name"
        saveLabel="Save"
        name=""
        onNameChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(html).not.toContain('autofocus');
    expect(html).toContain('class="input input-sm flex-1"');
  });
});
