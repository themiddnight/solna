import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { QuickSavePopover, isDismissKey, popupShift } from './QuickSavePopover';

const trigger = {
  id: 'btn-quick-save-test',
  label: 'Save',
  icon: <span data-testid="icon" />,
  className: 'btn btn-sm btn-ghost gap-1',
  title: 'Save preset',
};

const base = {
  onOpen: () => {},
  onClose: () => {},
  trigger,
  heading: 'Save Custom Preset:',
  placeholder: 'Preset Name...',
  saveLabel: 'Save Patch',
  name: '',
  onNameChange: () => {},
  onSubmit: () => {},
};

describe('QuickSavePopover', () => {
  test('closed renders only the trigger button, no panel', () => {
    const html = renderToString(<QuickSavePopover {...base} open={false} />);
    expect(html).toContain('id="btn-quick-save-test"');
    expect(html).not.toContain('dropdown-open');
    expect(html).not.toContain('dropdown-content');
    expect(html).not.toContain('<input');
  });

  test('open renders the anchored dropdown-content panel with the name input', () => {
    const html = renderToString(<QuickSavePopover {...base} open={true} />);
    expect(html).toContain('dropdown dropdown-end dropdown-open');
    expect(html).toContain('dropdown-content');
    expect(html).toContain('id="btn-quick-save-test"');
    expect(html).toContain('input input-sm');
    expect(html).toContain('Save Custom Preset:');
    expect(html).toContain('btn btn-sm btn-primary');
    expect(html).toContain('btn btn-sm btn-ghost');
  });

  test('the trigger carries aria-haspopup/aria-expanded reflecting open', () => {
    const closedHtml = renderToString(<QuickSavePopover {...base} open={false} />);
    const openHtml = renderToString(<QuickSavePopover {...base} open={true} />);
    expect(closedHtml).toContain('aria-haspopup="dialog"');
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(openHtml).toContain('aria-expanded="true"');
  });

  test('the optional category select renders only when open and given', () => {
    const html = renderToString(
      <QuickSavePopover
        {...base}
        open={true}
        categories={[{ id: 'lead', label: 'Lead' }]}
        category="lead"
        onCategoryChange={() => {}}
      />,
    );
    expect(html).toContain('select select-sm');
    expect(html).toContain('Lead');
  });

  test('no daisyUI theme escape hatches (raw hex/palette classes)', () => {
    const html = renderToString(<QuickSavePopover {...base} open={true} />);
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
  });

  /**
   * autoFocus is replaced by an effect that records the trigger first, so the
   * popover can hand focus back when it closes. The attribute must be gone
   * from the markup or React focuses the input before the effect can look at
   * document.activeElement.
   */
  test('the name input no longer carries autoFocus', () => {
    const html = renderToString(<QuickSavePopover {...base} open={true} />);
    expect(html).not.toContain('autofocus');
  });
});

describe('QuickSavePopover dismissal', () => {
  test('Escape dismisses; nothing else does', () => {
    expect(isDismissKey({ key: 'Escape' })).toBe(true);
    expect(isDismissKey({ key: 'Enter' })).toBe(false);
    expect(isDismissKey({ key: 'Esc' })).toBe(false);   // the IE spelling is not a browser we ship to
    expect(isDismissKey({ key: 'a' })).toBe(false);
  });
});

describe('popupShift', () => {
  test('a panel that already fits needs no shift', () => {
    expect(popupShift({ left: 100, right: 300 }, 500)).toBe(0);
  });

  test('a panel overflowing the left edge shifts right by the overhang plus margin', () => {
    expect(popupShift({ left: -20, right: 200 }, 500, 8)).toBe(28);
  });

  test('a panel overflowing the right edge shifts left by the overhang plus margin', () => {
    expect(popupShift({ left: 400, right: 600 }, 500, 8)).toBe(-108);
  });

  test('a panel wider than the viewport pins its left edge to the margin', () => {
    // width (650) exceeds viewportWidth - 2*margin (484): pin left to 8,
    // rather than try (and fail) to also satisfy the right edge.
    expect(popupShift({ left: -50, right: 600 }, 500, 8)).toBe(58);
  });
});
