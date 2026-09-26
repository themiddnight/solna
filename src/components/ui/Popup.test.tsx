import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Popup } from './Popup';

function render(
  open: boolean,
  align: 'start' | 'end' = 'end',
  extra: { side?: 'bottom' | 'top'; className?: string } = {},
) {
  return renderToString(
    <Popup
      open={open}
      onClose={() => {}}
      align={align}
      panelClassName="w-80 p-2"
      trigger={<button type="button" id="btn-popup-test">Open</button>}
      {...extra}
    >
      <p>Panel body</p>
    </Popup>,
  );
}

describe('Popup', () => {
  test('closed renders only the trigger inside the dropdown wrapper, no panel', () => {
    const html = render(false);
    expect(html).toBe('<div class="dropdown dropdown-end"><button type="button" id="btn-popup-test">Open</button></div>');
  });

  test('open adds dropdown-open and mounts the z-50 panel after the trigger', () => {
    const html = render(true);
    expect(html).toContain('<div class="dropdown dropdown-end dropdown-open"><button type="button" id="btn-popup-test">Open</button>');
    expect(html).toContain('<p>Panel body</p></div>');
  });

  // A pointerdown on panel padding (or, in Safari, on a <button>) leaves
  // focus on the panel — inside the wrapper — instead of dropping it to
  // <body>. -1 keeps it out of the tab order; it is not a control, so no ring.
  test('the open panel is focusable by pointer only, with no focus ring', () => {
    expect(render(true)).toContain('<div tabindex="-1" class="dropdown-content z-50 outline-none w-80 p-2">');
  });

  test('align start anchors the panel to the trigger’s start edge', () => {
    expect(render(true, 'start')).toContain('<div class="dropdown dropdown-start dropdown-open">');
  });

  test('side top opens the panel above the trigger (daisyUI dropdown-top)', () => {
    expect(render(true, 'start', { side: 'top' })).toContain('<div class="dropdown dropdown-start dropdown-top dropdown-open">');
    expect(render(false, 'start', { side: 'bottom' })).toBe(
      '<div class="dropdown dropdown-start"><button type="button" id="btn-popup-test">Open</button></div>',
    );
  });

  test('className lands last on the wrapper', () => {
    expect(render(false, 'start', { side: 'top', className: 'flex' })).toContain('<div class="dropdown dropdown-start dropdown-top flex">');
  });

  test('an unshifted panel carries no transform', () => {
    expect(render(true)).not.toContain('style=');
  });
});
