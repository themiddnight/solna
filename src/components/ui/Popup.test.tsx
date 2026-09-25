import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Popup } from './Popup';

function render(open: boolean, align: 'start' | 'end' = 'end') {
  return renderToString(
    <Popup
      open={open}
      onClose={() => {}}
      align={align}
      panelClassName="w-80 p-2"
      trigger={<button type="button" id="btn-popup-test">Open</button>}
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
    expect(html).toContain('<div class="dropdown-content z-50 w-80 p-2"><p>Panel body</p></div>');
  });

  test('align start anchors the panel to the trigger’s start edge', () => {
    expect(render(true, 'start')).toContain('<div class="dropdown dropdown-start dropdown-open">');
  });

  test('an unshifted panel carries no transform', () => {
    expect(render(true)).not.toContain('style=');
  });
});
