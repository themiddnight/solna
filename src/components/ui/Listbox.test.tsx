import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Listbox, type ListboxGroup } from './Listbox';

const GROUPS: readonly ListboxGroup[] = [
  {
    label: 'Fruit',
    options: [
      { value: 'green apple', label: 'Apple', description: 'Crisp and tart' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  { label: 'Root veg', options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy' }] },
];

const HEADING = 'px-2 pt-2 pb-1 text-[11px] uppercase font-bold tracking-wider text-base-content/60';
const ROW = 'flex items-center gap-2 px-2 py-1.5 rounded-field cursor-pointer';

function render(value: string, groups: readonly ListboxGroup[] = GROUPS) {
  return renderToString(
    <Listbox id="lb" label="Food" groups={groups} value={value} onCommit={() => {}} className="max-h-96 overflow-y-auto" />,
  );
}

describe('Listbox: the listbox root', () => {
  test('is a focusable, labelled listbox pointing at the selected option', () => {
    expect(render('banana')).toContain(
      '<div id="lb" role="listbox" aria-label="Food" tabindex="0" aria-activedescendant="lb-opt-1" class="',
    );
  });

  test('takes the caller’s classes (the scroll box)', () => {
    expect(render('banana')).toMatch(/role="listbox"[^>]*class="[^"]*max-h-96 overflow-y-auto"/);
  });
});

describe('Listbox: groups and options', () => {
  test('each group is a role=group labelled by its visible heading', () => {
    const html = render('banana');
    expect(html).toContain(`<div role="group" aria-labelledby="lb-grp-0"><div id="lb-grp-0" class="${HEADING}">Fruit</div>`);
    expect(html).toContain(`<div role="group" aria-labelledby="lb-grp-1"><div id="lb-grp-1" class="${HEADING}">Root veg</div>`);
  });

  test('option ids run in flat order across groups', () => {
    const html = render('banana');
    expect(html).toContain('id="lb-opt-0" role="option" aria-selected="false" data-option-index="0"');
    expect(html).toContain('id="lb-opt-2" role="option" aria-selected="false" data-option-index="2"');
  });

  test('only the selected option is aria-selected, active, primary and checked', () => {
    const html = render('banana');
    expect(html.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain(`id="lb-opt-1" role="option" aria-selected="true" data-option-index="1" class="${ROW} bg-base-200"`);
    expect(html.match(/bg-base-200/g) ?? []).toHaveLength(1);
    expect(html).toContain('<div class="text-sm font-medium text-primary">Banana</div>');
    expect(html).toContain('<div class="text-sm font-medium">Apple</div>');
    expect(html.match(/lucide-check/g) ?? []).toHaveLength(1);
    const check = html.indexOf('lucide-check');
    expect(check).toBeGreaterThan(html.indexOf('id="lb-opt-1"'));
    expect(check).toBeLessThan(html.indexOf('id="lb-opt-2"'));
  });

  test('descriptions show under their names, and an option without one has none', () => {
    const html = render('banana');
    expect(html).toContain('<div class="text-xs text-base-content/70">Crisp and tart</div>');
    expect(html).toContain('<div class="text-xs text-base-content/70">Sweet and earthy</div>');
    expect(html.match(/text-base-content\/70/g) ?? []).toHaveLength(2);
  });
});

describe('Listbox: defensive values', () => {
  test('a value not among the options selects nothing and highlights the first option', () => {
    const html = render('stale key');
    expect(html).not.toContain('aria-selected="true"');
    expect(html).not.toContain('lucide-check');
    expect(html).toContain('aria-activedescendant="lb-opt-0"');
  });

  test('an empty list renders an empty listbox with no active descendant', () => {
    const html = render('anything', []);
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('aria-activedescendant');
    expect(html).not.toContain('role="option"');
  });
});
