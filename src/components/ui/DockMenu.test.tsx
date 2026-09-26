import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DockMenu, DockMenuList } from './DockMenu';

// Same helper as BottomInputDock.test.tsx: ties an assertion to ONE element's opening tag.
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

const OPTIONS = ['alpha', 'beta'] as const;
const LABELS = { alpha: 'Alpha', beta: 'Beta' } as const;
const TITLES = { alpha: 'The first', beta: 'The second' } as const;

function renderMenu(disabled = false) {
  return renderToString(
    <DockMenu
      triggerId="btn-test-chip"
      triggerLabel="Test: Beta"
      triggerTitle="Pick one"
      triggerClassName="btn btn-xs"
      disabled={disabled}
      options={OPTIONS}
      current="beta"
      idPrefix="btn-test"
      labels={LABELS}
      onPick={() => {}}
    >
      <span>Beta</span>
    </DockMenu>,
  );
}

describe('DockMenu', () => {
  test('the trigger is a real <button> that names its list and reports it closed', () => {
    const tag = openTagContaining(renderMenu(), 'id="btn-test-chip"');
    expect(tag.startsWith('<button')).toBe(true);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-label="Test: Beta"');
    expect(tag).toContain('aria-expanded="false"');
    expect(tag).toContain('aria-controls="btn-test-list"');
    expect(tag).toContain('title="Pick one"');
    expect(tag).not.toContain('role=');
    expect(tag).not.toContain('disabled');
  });

  // No tabindex anywhere: daisyUI turns off pointer events on a `[tabindex]`
  // first child of an open dropdown, and the old focusable-list hack is gone.
  test('closed, it is the Popup wrapper, opening upward, with no panel and no tabindex', () => {
    const html = renderMenu();
    expect(html.startsWith('<div class="dropdown dropdown-start dropdown-top flex"><button')).toBe(true);
    expect(html).not.toContain('dropdown-content');
    expect(html).not.toContain('btn-test-alpha');
    expect(html).not.toContain('tabindex');
  });

  test('disabled, the trigger is a disabled button', () => {
    expect(openTagContaining(renderMenu(true), 'id="btn-test-chip"')).toContain('disabled=""');
  });
});

describe('DockMenuList', () => {
  const html = renderToString(
    <DockMenuList options={OPTIONS} current="beta" idPrefix="btn-test" labels={LABELS} titles={TITLES} onPick={() => {}} />,
  );

  test('is a plain menu list: no role="menu", no tabindex', () => {
    expect(openTagContaining(html, 'id="btn-test-list"')).toBe('<ul id="btn-test-list" class="menu menu-sm w-full p-0">');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('tabindex');
  });

  test('one button per option, only the current one marked', () => {
    const alpha = openTagContaining(html, 'id="btn-test-alpha"');
    const beta = openTagContaining(html, 'id="btn-test-beta"');
    expect(alpha).not.toContain('aria-current');
    expect(alpha).toContain('title="The first"');
    expect(beta).toContain('aria-current="true"');
    expect(beta).toContain('active font-bold');
    expect(html).toContain('>Alpha</button>');
  });
});
